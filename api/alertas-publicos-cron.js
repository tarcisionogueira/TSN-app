/**
 * /api/alertas-publicos-cron — envia os alertas "avise-me" (leads PRÉ-CONTA da tabela
 * alerta_publico). Roda 1×/dia. Para cada alerta CONFIRMADO e ATIVO cujo último envio foi
 * há 3+ dias (throttle), busca imóveis ativos na cidade/UF ainda NÃO enviados a ele, e manda
 * até 6 — com link para a FICHA PÚBLICA (que tem o gate de cadastro) e descadastro em 1 clique.
 *
 * Isolado do enviar-alertas-cron (que é para usuários com conta): misturar os dois arriscaria
 * o motor que já funciona. Aqui o público é leve e o volume, no começo, pequeno.
 *
 * "avise-me quando SURGIR imóvel": v1 = qualquer lote ativo ainda não enviado a este alerta
 * (dedup por alerta_publico_enviados). Queda de preço fina virá quando houver histórico.
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { isCronAuthorized } from './_auth.js';
import { escapeHtml } from './_sanitize.js';
import { encerradoPorDatas } from './_leilao-encerrado.js';

export const GET = handler;
export const POST = handler;

const SEL = 'id,titulo,tipo,cidade,cidade_norm,estado,valor_minimo,valor_avaliacao,desconto_percentual,data_leilao,data_fim,link_foto';
const LIMITE_ALERTAS = 500;   // teto de runtime; se estourar, o log avisa (nada de corte silencioso)
const POR_ENVIO = 6;

async function handler(req) {
  if (req.method !== 'GET' && req.method !== 'POST') return new Response('ok', { status: 200 });
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });

  const URL_ = process.env.VITE_SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const BASE = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
  const FROM = process.env.APP_ALERTS_FROM || 'BidPro Brasil <noreply@bidprobrasil.com.br>';
  if (!URL_ || !KEY) return new Response(JSON.stringify({ error: 'env not configured' }), { status: 500 });
  const hdr = { apikey: KEY, Authorization: `Bearer ${KEY}` };

  const sbGet = async (path) => {
    try {
      const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: hdr, signal: AbortSignal.timeout(15000) });
      if (!r.ok) { console.error('[alertas-pub] GET', r.status, path.slice(0, 200), (await r.text().catch(() => '')).slice(0, 200)); return []; }
      return await r.json();
    } catch (e) { console.error('[alertas-pub] GET erro', path.slice(0, 150), e?.message); return []; }
  };

  const fmtBRL = (v) => (v ? 'R$ ' + Number(v).toLocaleString('pt-BR') : '—');
  const fmtData = (d) => (d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : null);

  const tresDias = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
  const alertas = await sbGet(`alerta_publico?confirmado=eq.true&ativo=eq.true&or=(ultimo_envio.is.null,ultimo_envio.lt.${tresDias})&select=id,email,cidade,cidade_norm,uf,token,total_enviados&order=criado_em.asc&limit=${LIMITE_ALERTAS}`);
  if (alertas.length === LIMITE_ALERTAS) console.warn(`[alertas-pub] teto de ${LIMITE_ALERTAS} alertas atingido — os demais entram na próxima rodada (sem corte silencioso).`);

  const { enviarEmail } = await import('./_email.js');
  let enviados = 0;

  for (const al of alertas) {
    try {
      const sent = await sbGet(`alerta_publico_enviados?alerta_id=eq.${al.id}&select=imovel_id`);
      const sentSet = new Set((sent || []).map((s) => s.imovel_id));

      const filtroLocal = al.cidade_norm ? `&cidade_norm=eq.${encodeURIComponent(al.cidade_norm)}` : '';
      const rows = await sbGet(`imoveis_leilao?select=${SEL}&ativo=eq.true&estado=eq.${encodeURIComponent(al.uf)}${filtroLocal}&order=desconto_percentual.desc.nullslast&limit=30`);
      const frescos = (rows || []).filter((im) => im && im.id && !sentSet.has(String(im.id)) && !encerradoPorDatas(im).encerrado).slice(0, POR_ENVIO);
      if (!frescos.length) continue;

      const local = al.cidade ? `${al.cidade}/${al.uf}` : al.uf;
      const unsubUrl = `${BASE}/api/alerta-descadastrar?token=${al.token}`;

      const cards = frescos.map((im) => {
        const url = `${BASE}/leilao/${im.id}`;
        // Só foto hospedada por nós carrega de forma confiável no e-mail; demais hosts (Caixa)
        // bloqueiam hotlink — melhor sem foto do que quadro quebrado.
        const foto = (im.link_foto && String(im.link_foto).includes('supabase.co'))
          ? `<a href="${url}"><img src="${im.link_foto}" alt="" style="width:100%;height:130px;object-fit:cover;display:block;border-radius:10px 10px 0 0;"></a>` : '';
        const desc = Number(im.desconto_percentual) || 0;
        const descTag = desc > 0 ? `<span style="display:inline-block;background:#f0fdf4;color:#059669;border:1px solid #bbf7d0;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;">${Math.round(desc)}% OFF</span>` : '';
        const dataLabel = fmtData(im.data_fim || im.data_leilao);
        const dataTag = dataLabel ? `<span style="display:inline-block;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;margin-left:4px;">📅 ${dataLabel}</span>` : '';
        return `<div style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin-bottom:12px;background:#fff;">
          ${foto}
          <div style="padding:14px 16px;">
            <a href="${url}" style="text-decoration:none;color:#0f172a;"><div style="font-size:14px;font-weight:700;margin-bottom:4px;">${escapeHtml(im.titulo || 'Imóvel em leilão')}</div></a>
            <div style="font-size:12px;color:#64748b;margin-bottom:8px;">📍 ${escapeHtml(im.cidade || '')}${im.estado ? ' — ' + escapeHtml(im.estado) : ''}</div>
            <div style="margin-bottom:10px;">${descTag}${dataTag}</div>
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div><div style="font-size:11px;color:#94a3b8;">Lance mínimo</div><div style="font-size:16px;font-weight:800;color:#0f172a;">${fmtBRL(im.valor_minimo)}</div></div>
              <a href="${url}" style="background:#0D63DB;color:#fff;text-decoration:none;padding:8px 16px;border-radius:8px;font-size:12px;font-weight:700;">Ver imóvel →</a>
            </div>
          </div>
        </div>`;
      }).join('');

      const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:24px 16px;">
  <a href="${BASE}/leiloes" style="text-decoration:none;">
    <div style="background:#0f172a;border-radius:16px 16px 0 0;padding:24px 28px;text-align:center;">
      <div style="font-size:22px;font-weight:800;color:#fff;">BidPro Brasil</div>
      <div style="font-size:12px;color:#94a3b8;margin-top:2px;">Leilão &amp; Investimentos</div>
    </div>
  </a>
  <div style="background:#fff;padding:28px;border-radius:0 0 16px 16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <h2 style="margin:0 0 4px;font-size:18px;color:#0f172a;">Novos imóveis em ${escapeHtml(local)} 🏠</h2>
    <p style="margin:0 0 20px;color:#475569;font-size:14px;line-height:1.6;">Você pediu para ser avisado — separamos <strong>${frescos.length}</strong> ${frescos.length > 1 ? 'oportunidades' : 'oportunidade'} para você:</p>
    ${cards}
    <div style="text-align:center;margin-top:20px;"><a href="${BASE}/leiloes" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;padding:13px 28px;border-radius:10px;font-weight:700;font-size:15px;">Ver todos os imóveis →</a></div>
    <p style="font-size:12px;color:#64748b;text-align:center;margin:18px 0 0;line-height:1.6;">Quer a ficha completa (mapa, análise e parecer jurídico)?<br><a href="${BASE}/#/login?modo=cadastro" style="color:#0D63DB;font-weight:700;">Crie sua conta grátis →</a></p>
    <p style="font-size:11px;color:#94a3b8;text-align:center;margin-top:16px;">Você recebe estes avisos porque se inscreveu em BidPro Brasil · <a href="${unsubUrl}" style="color:#94a3b8;">Cancelar</a></p>
  </div>
</div></body></html>`;

      const r = await enviarEmail({
        from: FROM, to: al.email,
        subject: `🏠 Novos imóveis em leilão em ${local}`,
        meta: { tipo: 'alerta_publico' },
        html,
      });
      if (r?.ok) {
        await fetch(`${URL_}/rest/v1/alerta_publico?id=eq.${al.id}`, {
          method: 'PATCH', headers: { ...hdr, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ ultimo_envio: new Date().toISOString(), total_enviados: (al.total_enviados || 0) + 1 }),
          signal: AbortSignal.timeout(15000),
        }).catch(() => {});
        // Registra os enviados (dedup dos próximos). ignore-duplicates: reenvio não quebra.
        await fetch(`${URL_}/rest/v1/alerta_publico_enviados`, {
          method: 'POST', headers: { ...hdr, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
          body: JSON.stringify(frescos.map((im) => ({ alerta_id: al.id, imovel_id: String(im.id) }))),
          signal: AbortSignal.timeout(15000),
        }).catch(() => {});
        enviados++;
      }
    } catch (e) {
      console.error('[alertas-pub] erro alerta', al.id, e?.message);
    }
  }

  return new Response(JSON.stringify({ ok: true, enviados, alertas: alertas.length }), { headers: { 'Content-Type': 'application/json' } });
}
