/**
 * /api/enviar-alertas-cron — e-mail de oportunidades. Roda TODO DIA às 8h UTC.
 * Cadência por usuário:
 *   • 1º e-mail (boas-vindas): 24h após criar a conta, em QUALQUER dia — quem se
 *     cadastra no meio da semana não fica sem oportunidade até a segunda seguinte.
 *   • Recorrente: toda SEGUNDA-feira (com trava anti-reenvio de 7 dias).
 * Benefício de AMBOS os planos (Explorador e Investidor Pro): ATÉ 12 oportunidades.
 * Quem clicar em "cancelar" para de receber (opt-out via alertas_email.ativo=false).
 *
 * ASSERTIVIDADE (só oportunidades de interesse): quando o cliente tem filtro salvo
 * na busca (praça/tipo/valor/desconto/bairros), o e-mail respeita ESSE perfil e NÃO
 * cai no fallback amplo por estado — melhor não mandar do que mandar irrelevante.
 *
 * Seleção por usuário (ordem de interesse):
 *   1. Filtros salvos na busca (filtros_salvos) — sinal de interesse explícito.
 *   2. Cidade do cadastro (perfis.endereco_cidade/uf).
 *   3. Se tiver arrematação registrada → inclui similares (mesmo tipo/estado).
 *   4. Completa até 12 num raio de 200km (centróide IBGE offline + PostGIS);
 *      se não fechar 12, manda os que houver no raio, por maior desconto.
 *
 * Links do e-mail: card → /#/imovel/:id (tela do imóvel) · logo e botão → /#/buscar
 * (leva o cliente direto à plataforma/busca). Remetente: noreply@bidprobrasil.com.br.
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { isCronAuthorized } from './_auth.js';
import MUNICIPIOS from './_municipios.js';
import { assinarUnsub } from './cancelar-alertas.js';

const norm = (c) => (c || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
function centroide(cidade, uf) {
  if (!cidade || !uf) return null;
  const c = MUNICIPIOS[`${String(uf).toUpperCase()}|${norm(cidade)}`];
  return Array.isArray(c) ? { lat: c[0], lng: c[1] } : null;
}
const SEL = 'id,titulo,endereco,cidade,estado,tipo,modalidade,valor_minimo,valor_avaliacao,desconto_percentual,data_leilao,link_foto';

export default async function handler(req) {
  if (req.method !== 'GET' && req.method !== 'POST') return new Response('ok', { status: 200 });
  // Modo de teste: ?email=voce@x.com&secret=<CRON_SECRET> envia só para esse e-mail
  // (ignora a trava de 1x/semana e o opt-out) — prático para validar no navegador.
  const qs = new URL(req.url, 'http://localhost').searchParams;
  const testeEmail = (qs.get('email') || '').trim().toLowerCase();
  // Auth SOMENTE por header (isCronAuthorized) — sem ?secret= por query (vazaria em
  // logs e permitia bular opt-out/throttle). O ?email= só escolhe o destinatário de teste.
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });

  const URL_ = process.env.VITE_SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  const RESEND_KEY = process.env.RESEND_API_KEY;
  // Remetente do e-mail do CLIENTE: desacoplado do APP_FROM_EMAIL (que é o
  // remetente global de alertas de sistema/admin). Garante noreply@ para o
  // cliente independentemente do env global. Override dedicado se precisar.
  const FROM = process.env.APP_ALERTS_FROM || 'BidPro Brasil <noreply@bidprobrasil.com.br>';
  const BASE = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
  if (!URL_ || !KEY) return new Response(JSON.stringify({ error: 'env not configured' }), { status: 500 });
  const hdr = { apikey: KEY, Authorization: `Bearer ${KEY}` };
  const sbGet = async (path) => { try { const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: hdr }); return r.ok ? await r.json() : []; } catch { return []; } };
  const rpc = async (fn, body) => { try { const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { ...hdr, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return r.ok ? await r.json() : []; } catch { return []; } };

  const seteDias = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const ROLES = 'explorador,top2,top2_anual,assessorado,clube';

  // Destinatários: clientes com e-mail (batch). opt-out/último-envio via alertas_email.
  const filtroTeste = testeEmail ? `&email=eq.${encodeURIComponent(testeEmail)}` : '';
  const perfis = await sbGet(`perfis?select=id,nome,email,endereco_cidade,endereco_uf,created_at&email=not.is.null&role=in.(${ROLES})${filtroTeste}&limit=1000`);
  if (!Array.isArray(perfis) || !perfis.length) return new Response(JSON.stringify({ ok: true, enviados: 0, total: 0 }), { headers: { 'Content-Type': 'application/json' } });
  // Só UUIDs válidos entram na lista in.(...) — defesa contra interpolação indevida.
  const ids = perfis.map(p => p.id).filter(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || '')));
  const inList = `(${ids.join(',')})`;

  const [alertasArr, fsalvosArr, arremArr] = await Promise.all([
    sbGet(`alertas_email?user_id=in.${inList}&select=user_id,ativo,ultimo_envio,filtros,total_enviados`),
    sbGet(`filtros_salvos?user_id=in.${inList}&select=user_id,filtros,criado_em&order=criado_em.desc`),
    sbGet(`arrematacoes?user_id=in.${inList}&select=user_id,imovel_id`),
  ]);
  const alertaMap = {}; for (const a of alertasArr || []) alertaMap[a.user_id] = a;
  const filtroMap = {}; for (const f of fsalvosArr || []) if (!filtroMap[f.user_id]) filtroMap[f.user_id] = f.filtros; // 1º = mais recente
  const arremMap = {}; for (const a of arremArr || []) (arremMap[a.user_id] = arremMap[a.user_id] || []).push(a.imovel_id);

  // Tipos/estados dos imóveis já arrematados (para "similares")
  const arremImovelIds = [...new Set((arremArr || []).map(a => a.imovel_id).filter(Boolean))];
  const arremInfo = {};
  if (arremImovelIds.length) {
    const rows = await sbGet(`imoveis_leilao?id=in.(${arremImovelIds.join(',')})&select=id,tipo,estado`);
    for (const r of rows || []) arremInfo[r.id] = r;
  }

  const fmtBRL = v => v ? 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
  const fmtData = d => d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : null;
  let enviados = 0;
  const isSegunda = new Date().getUTCDay() === 1; // 8h UTC de segunda = 5h BRT de segunda

  for (const perfil of perfis) {
    try {
      const email = perfil.email; if (!email || !RESEND_KEY) continue;
      const a = alertaMap[perfil.id];
      if (!testeEmail) {
        if (a && a.ativo === false) continue;                       // opt-out (descadastrado)
        const nunca = !a?.ultimo_envio;
        if (nunca) {
          // 1º e-mail: só depois de 24h da criação da conta (em qualquer dia).
          const idadeMs = perfil.created_at ? (Date.now() - new Date(perfil.created_at).getTime()) : 0;
          if (idadeMs < 24 * 3600 * 1000) continue;
        } else {
          // Recorrente: só às segundas, e não reenvia se já mandou nos últimos 7 dias.
          if (!isSegunda) continue;
          if (a.ultimo_envio > seteDias) continue;
        }
      }

      // Filtro salvo na busca = sinal EXPLÍCITO de interesse (perfil + praça). Se
      // existir, o e-mail respeita esse perfil e não cai no fallback amplo.
      const filtroSalvo = filtroMap[perfil.id] || null;
      const filtros = filtroSalvo || a?.filtros || {};
      const temPerfilExplicito = !!filtroSalvo;
      const cidade = (filtros.cidades && filtros.cidades[0]) || perfil.endereco_cidade || '';
      const uf = filtros.estado || perfil.endereco_uf || '';

      // Condições ASSERTIVAS do perfil salvo (tipo/valor/desconto/bairros), aplicadas
      // nas consultas por nome de cidade — trazem só o que interessa ao cliente.
      const fTipos = Array.isArray(filtros.tipos) ? filtros.tipos.filter(Boolean) : [];
      const fBairros = Array.isArray(filtros.bairros) ? filtros.bairros.filter(Boolean) : [];
      const numOnly = (v) => Number(String(v ?? '').replace(/\D/g, '')) || 0;
      const cond = [
        fTipos.length ? `&tipo=in.(${[...fTipos, 'imovel'].map(encodeURIComponent).join(',')})` : '',
        filtros.valorMin ? `&valor_minimo=gte.${numOnly(filtros.valorMin)}` : '',
        filtros.valorMax ? `&valor_minimo=lte.${numOnly(filtros.valorMax)}` : '',
        filtros.descontoMin ? `&desconto_percentual=gte.${Number(filtros.descontoMin)}` : '',
        fBairros.length ? `&bairro=in.(${fBairros.map(b => encodeURIComponent(`"${b}"`)).join(',')})` : '',
      ].join('');

      // Monta o pool de candidatos (dedup por id)
      const pool = new Map();
      const add = (arr) => { for (const im of arr || []) if (im && im.id && !pool.has(im.id)) pool.set(im.id, im); };

      // 1) Cidade por nome (pega até não-geocodificados), já filtrada pelo perfil.
      if (cidade) add(await sbGet(`imoveis_leilao?select=${SEL}&ativo=eq.true&cidade=ilike.*${encodeURIComponent(cidade)}*${cond}&order=desconto_percentual.desc&limit=20`));
      // 2) Raio de 200km (centróide IBGE offline + PostGIS), respeitando tipo/valor/desconto.
      const cen = centroide(cidade, uf);
      if (cen) add(await rpc('buscar_por_raio_v2', {
        lat: cen.lat, lng: cen.lng, raio_metros: 200000, lim: 40,
        tipos_filtro: fTipos,
        valor_min: filtros.valorMin ? numOnly(filtros.valorMin) : 0,
        valor_max: filtros.valorMax ? numOnly(filtros.valorMax) : 9999999999,
        desconto_min: filtros.descontoMin ? Number(filtros.descontoMin) : 0,
      }));
      // 3) Similares às arrematações do usuário (mesmo tipo/estado)
      const meus = arremMap[perfil.id] || [];
      const tipos = [...new Set(meus.map(i => arremInfo[i]?.tipo).filter(Boolean))];
      for (const t of tipos.slice(0, 2)) add(await sbGet(`imoveis_leilao?select=${SEL}&ativo=eq.true&tipo=eq.${encodeURIComponent(t)}${uf ? `&estado=eq.${uf}` : ''}&order=desconto_percentual.desc&limit=8`));
      // 4) Fallback amplo por estado: SÓ para quem não deu perfil explícito (senão
      // mandaria imóvel fora do interesse). Sem match no perfil → não envia (o
      // `if (!top.length) continue` abaixo cuida disso) — melhor que ser irrelevante.
      if (pool.size === 0 && uf && !temPerfilExplicito) add(await sbGet(`imoveis_leilao?select=${SEL}&ativo=eq.true&estado=eq.${uf}&order=desconto_percentual.desc&limit=20`));

      // Ordena por maior desconto e pega até 12
      const top = [...pool.values()]
        .sort((x, y) => (Number(y.desconto_percentual) || 0) - (Number(x.desconto_percentual) || 0))
        .slice(0, 12);
      if (!top.length) continue;

      const local = [cidade, uf].filter(Boolean).join(' — ') || 'Brasil';
      const unsubUrl = `${BASE}/api/cancelar-alertas?token=${assinarUnsub(perfil.id)}`; // one-click LGPD (sem login)

      const cards = top.map(im => {
        const url = `${BASE}/#/imovel/${im.id}`;
        const foto = im.link_foto ? `<a href="${url}"><img src="${im.link_foto}" alt="" style="width:100%;height:130px;object-fit:cover;display:block;border-radius:10px 10px 0 0;"></a>` : '';
        const desc = Number(im.desconto_percentual) || 0;
        const descTag = desc > 0 ? `<span style="display:inline-block;background:#f0fdf4;color:#059669;border:1px solid #bbf7d0;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700;">${Math.round(desc)}% OFF</span>` : '';
        const dataLabel = fmtData(im.data_leilao);
        const dataTag = dataLabel ? `<span style="display:inline-block;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;margin-left:4px;">📅 ${dataLabel}</span>` : '';
        return `
        <div style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin-bottom:12px;background:#fff;">
          ${foto}
          <div style="padding:14px 16px;">
            <a href="${url}" style="text-decoration:none;color:#0f172a;"><div style="font-size:14px;font-weight:700;margin-bottom:4px;">${im.titulo || im.endereco || 'Imóvel em leilão'}</div></a>
            <div style="font-size:12px;color:#64748b;margin-bottom:8px;">📍 ${im.cidade || ''}${im.estado ? ' — ' + im.estado : ''}</div>
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
  <a href="${BASE}/#/buscar" style="text-decoration:none;">
    <div style="background:#0f172a;border-radius:16px 16px 0 0;padding:24px 28px;text-align:center;">
      <div style="font-size:22px;font-weight:800;color:#fff;">BidPro Brasil</div>
      <div style="font-size:12px;color:#94a3b8;margin-top:2px;">Leilão &amp; Investimentos</div>
    </div>
  </a>
  <div style="background:#fff;padding:28px;border-radius:0 0 16px 16px;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <h2 style="margin:0 0 4px;font-size:18px;color:#0f172a;">Olá${perfil.nome ? ', ' + perfil.nome.split(' ')[0] : ''}!</h2>
    <p style="margin:0 0 20px;color:#475569;font-size:14px;line-height:1.6;">Selecionamos <strong>${top.length} oportunidade${top.length > 1 ? 's' : ''}</strong> em <strong>${local}</strong> para você esta semana:</p>
    ${cards}
    <div style="text-align:center;margin-top:20px;"><a href="${BASE}/#/buscar" style="display:inline-block;background:#059669;color:#fff;text-decoration:none;padding:13px 28px;border-radius:10px;font-weight:700;font-size:15px;">Ver todos os imóveis →</a></div>
    <p style="font-size:11px;color:#94a3b8;text-align:center;margin-top:20px;">BidPro Brasil · Você recebe estas oportunidades semanalmente · <a href="${unsubUrl}" style="color:#94a3b8;">Cancelar</a></p>
  </div>
</div></body></html>`;

      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM, to: email, subject: `🏠 ${top.length} oportunidades em ${local} esta semana`, html }),
      });
      if (emailRes.ok) {
        await fetch(`${URL_}/rest/v1/alertas_email?on_conflict=user_id`, {
          method: 'POST',
          headers: { ...hdr, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({ user_id: perfil.id, ultimo_envio: new Date().toISOString(), total_enviados: (a?.total_enviados || 0) + 1 }),
        });
        enviados++;
      }
    } catch (e) {
      console.error('[enviar-alertas-cron] erro user', perfil.id, e?.message);
    }
  }

  return new Response(JSON.stringify({ ok: true, enviados, total: perfis.length }), { headers: { 'Content-Type': 'application/json' } });
}
