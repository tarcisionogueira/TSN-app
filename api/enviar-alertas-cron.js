export const config = { runtime: 'edge' };

import { isCronAuthorized } from './_auth.js';

export default async function handler(req) {
  if (req.method !== 'GET' && req.method !== 'POST') return new Response('ok', { status: 200 });

  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) return new Response(JSON.stringify({ error: 'env not configured' }), { status: 500 });

  const hdr = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const limiteEnvio = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Busca alertas ativos não enviados na última semana
  const alertasRes = await fetch(
    `${supabaseUrl}/rest/v1/alertas_email?select=*,perfis(email,nome)&ativo=eq.true&or=(ultimo_envio.is.null,ultimo_envio.lt.${limiteEnvio})`,
    { headers: hdr }
  );
  const alertas = await alertasRes.json();
  let enviados = 0;

  const RESEND_KEY = process.env.RESEND_API_KEY;
  const FROM = process.env.APP_FROM_EMAIL || 'BidPro Brasil <alertas@bidprobrasil.com.br>';
  const BASE_URL = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';

  for (const alerta of alertas || []) {
    try {
      const userEmail = alerta.perfis?.email;
      const userName = alerta.perfis?.nome || '';
      if (!userEmail || !RESEND_KEY) continue;

      const filtros = alerta.filtros || {};
      const agora = new Date();
      const em30Dias = new Date(agora.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

      // Constrói query com todos os filtros do usuário
      let query = `${supabaseUrl}/rest/v1/imoveis_leilao?select=id,titulo,endereco,cidade,estado,tipo,modalidade,valor_minimo,valor_avaliacao,desconto_percentual,data_leilao,link_foto,link_externo&ativo=eq.true&order=desconto_percentual.desc&limit=50`;
      if (filtros.estado) query += `&estado=eq.${filtros.estado}`;
      if (filtros.tipos?.length === 1) query += `&tipo=eq.${filtros.tipos[0]}`;
      if (filtros.valorMin) query += `&valor_minimo=gte.${filtros.valorMin}`;
      if (filtros.valorMax) query += `&valor_minimo=lte.${filtros.valorMax}`;
      if (filtros.modalidades?.length === 1) query += `&modalidade=eq.${filtros.modalidades[0]}`;

      const imoveisRes = await fetch(query, { headers: hdr });
      const imoveis = await imoveisRes.json();
      if (!Array.isArray(imoveis) || imoveis.length === 0) continue;

      // Filtra cidades se especificadas (OR ilike)
      let candidatos = imoveis;
      if (filtros.cidades?.length > 0) {
        const cidadesLower = filtros.cidades.map(c => c.toLowerCase());
        candidatos = imoveis.filter(im => im.cidade && cidadesLower.some(c => im.cidade.toLowerCase().includes(c)));
      }
      if (candidatos.length === 0) candidatos = imoveis; // fallback: usa todos do estado

      // ── Algoritmo de pontuação — ROI líquido estimado ───────────────────
      // Calcula margem bruta estimada para cada imóvel e filtra por threshold
      const MARGEM_THRESHOLD = 25; // % mínima de margem para alertas ideais

      const comMargem = candidatos.map(im => {
        const valorMinimo = Number(im.valor_minimo) || 0;
        const valorAvaliacao = Number(im.valor_avaliacao) || 0;
        let margemBruta = null;

        if (valorMinimo > 0 && valorAvaliacao > 0) {
          const custoAquisicao = valorMinimo * 1.05; // +5% ITBI, taxas, registro
          margemBruta = (valorAvaliacao - custoAquisicao) / custoAquisicao * 100;
        }

        let score = 0;

        if (margemBruta !== null) {
          // Base: margem bruta (até 50 pts para 100% de margem)
          score += margemBruta * 0.5;

          // Bônus: margem excepcional >= 50%
          if (margemBruta >= 50) score += 15;
        }

        // Leilão nos próximos 30 dias (até +20 pts com decaimento)
        if (im.data_leilao) {
          const dLeilao = new Date(im.data_leilao);
          const diasParaLeilao = (dLeilao - agora) / (1000 * 60 * 60 * 24);
          if (diasParaLeilao >= 0 && diasParaLeilao <= 30) {
            score += 20 * (1 - diasParaLeilao / 30);
          }
        }

        // Tipo preferido pelo usuário (+15 pts)
        if (filtros.tipos?.length > 0 && filtros.tipos.includes(im.tipo)) score += 15;

        return { ...im, _margemBruta: margemBruta, _score: score };
      });

      // Candidatos ideais: margem >= threshold
      let candidatosIdeais = comMargem.filter(im => im._margemBruta !== null && im._margemBruta >= MARGEM_THRESHOLD);
      const usouFallback = candidatosIdeais.length < 3;

      // Fallback: se menos de 3 atendem o critério, usa os melhores por desconto
      let top6;
      if (usouFallback) {
        top6 = comMargem
          .sort((a, b) => (Number(b.desconto_percentual) || 0) - (Number(a.desconto_percentual) || 0))
          .slice(0, 6);
      } else {
        top6 = candidatosIdeais.sort((a, b) => b._score - a._score).slice(0, 6);
      }

      // ── Email ────────────────────────────────────────────────────────────
      // Deep-link para abrir busca com filtros pré-preenchidos
      const qs = new URLSearchParams({
        ...(filtros.estado ? { estado: filtros.estado } : {}),
        ...(filtros.cidades?.length ? { cidades: filtros.cidades.join(',') } : {}),
        ...(filtros.tipos?.length ? { tipo: filtros.tipos[0] } : {}),
      });
      const deepLink = `${BASE_URL}/#/buscar${qs.toString() ? '?' + qs.toString() : ''}`;
      const unsubToken = btoa(`${alerta.user_id}:unsubscribe`);
      const unsubUrl = `${BASE_URL}/#/cancelar-alertas?token=${unsubToken}`;

      const fmtBRL = v => v ? 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
      const fmtData = d => d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : null;

      const cardsHtml = top6.map((im, i) => {
        const foto = im.link_foto ? `<img src="${im.link_foto}" alt="foto" style="width:100%;height:120px;object-fit:cover;display:block;border-radius:8px 8px 0 0;">` : '';
        const dataLabel = fmtData(im.data_leilao);
        // Margem arredondada ao múltiplo de 5 mais próximo
        const margemRounded = im._margemBruta !== null ? Math.round(im._margemBruta / 5) * 5 : null;
        const margemTag = margemRounded !== null
          ? `<span style="display:inline-block;background:#f0fdf4;color:#059669;border:1px solid #bbf7d0;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;">~Margem ${margemRounded}%</span>`
          : '';
        const dataTag = dataLabel ? `<span style="display:inline-block;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;margin-left:4px;">📅 ${dataLabel}</span>` : '';
        const margemDestaque = im._margemBruta !== null
          ? `<div style="margin-bottom:10px;padding:8px 12px;background:#f0fdf4;border-radius:8px;border-left:3px solid #059669;">
               <span style="font-size:12px;color:#064e3b;font-weight:600;">Margem estimada: <strong style="font-size:14px;">~${Math.round(im._margemBruta)}%</strong></span>
             </div>`
          : '';
        return `
        <div style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:12px;background:#fff;">
          ${foto}
          <div style="padding:14px 16px;">
            <div style="font-size:14px;font-weight:700;color:#0f172a;margin-bottom:4px;">${im.titulo || im.endereco || 'Imóvel em leilão'}</div>
            <div style="font-size:12px;color:#64748b;margin-bottom:8px;">📍 ${im.cidade || ''}${im.estado ? ' — ' + im.estado : ''}</div>
            <div style="margin-bottom:8px;">${margemTag}${dataTag}</div>
            ${margemDestaque}
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div>
                <div style="font-size:11px;color:#94a3b8;">Lance mínimo</div>
                <div style="font-size:16px;font-weight:800;color:#0f172a;">${fmtBRL(im.valor_minimo)}</div>
              </div>
              ${im.link_externo ? `<a href="${im.link_externo}" style="background:#0D63DB;color:#fff;text-decoration:none;padding:7px 14px;border-radius:8px;font-size:12px;font-weight:700;">Ver edital →</a>` : ''}
            </div>
          </div>
        </div>`;
      }).join('');

      const localFiltro = [filtros.cidades?.[0], filtros.estado].filter(Boolean).join(' — ') || 'Brasil';

      const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:24px 16px;">
  <div style="background:#0f172a;border-radius:16px 16px 0 0;padding:24px 28px;text-align:center;">
    <div style="font-size:22px;font-weight:800;color:#fff;">TSN Ativos</div>
    <div style="font-size:12px;color:#94a3b8;margin-top:2px;">Assessoria em Imóveis de Leilão</div>
  </div>
  <div style="background:#fff;padding:28px;border-radius:0 0 16px 16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <h2 style="margin:0 0 4px;font-size:18px;color:#0f172a;">Olá${userName ? ', ' + userName : ''}!</h2>
    <p style="margin:0 0 20px;color:#475569;font-size:14px;line-height:1.6;">
      Selecionamos as <strong>${top6.length} melhores oportunidades</strong> em <strong>${localFiltro}</strong> para você esta semana:${usouFallback ? '<br><span style="font-size:12px;color:#b45309;background:#fffbeb;border:1px solid #fde68a;padding:4px 10px;border-radius:6px;display:inline-block;margin-top:8px;">⚠️ Melhores disponíveis na região, fora do critério ideal de margem</span>' : ''}
    </p>
    ${cardsHtml}
    <div style="text-align:center;margin-top:20px;">
      <a href="${deepLink}" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;padding:13px 28px;border-radius:10px;font-weight:700;font-size:15px;">
        Ver todos os imóveis →
      </a>
    </div>
    <p style="font-size:11px;color:#94a3b8;text-align:center;margin-top:20px;">
      TSN Ativos · Você recebe estes alertas semanalmente ·
      <a href="${unsubUrl}" style="color:#94a3b8;">Cancelar alertas</a>
    </p>
  </div>
</div>
</body>
</html>`;

      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM,
          to: userEmail,
          subject: `🏠 ${top6.length} oportunidades em ${localFiltro} esta semana`,
          html,
        }),
      });

      if (emailRes.ok) {
        await fetch(`${supabaseUrl}/rest/v1/alertas_email?id=eq.${alerta.id}`, {
          method: 'PATCH',
          headers: { ...hdr, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ ultimo_envio: new Date().toISOString(), total_enviados: (alerta.total_enviados || 0) + 1 }),
        });
        enviados++;
      }
    } catch (e) {
      console.error('[enviar-alertas-cron] erro:', e?.message);
    }
  }

  return new Response(JSON.stringify({ ok: true, enviados, total: alertas?.length || 0 }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
