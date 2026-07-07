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

  // Dedup: imóveis já enviados nos últimos 60 dias (mais antigos podem repetir).
  const sessentaDias = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();
  const [alertasArr, fsalvosArr, arremArr, enviadosArr] = await Promise.all([
    sbGet(`alertas_email?user_id=in.${inList}&select=user_id,ativo,ultimo_envio,filtros,total_enviados`),
    sbGet(`filtros_salvos?user_id=in.${inList}&select=user_id,filtros,criado_em&order=criado_em.desc`),
    sbGet(`arrematacoes?user_id=in.${inList}&select=user_id,imovel_id`),
    sbGet(`alertas_enviados?user_id=in.${inList}&enviado_em=gte.${sessentaDias}&select=user_id,imovel_id`),
  ]);
  const alertaMap = {}; for (const a of alertasArr || []) alertaMap[a.user_id] = a;
  // TODOS os filtros salvos por usuário (mais recentes primeiro), até 6 — o e-mail
  // distribui 80% das vagas entre eles (assertividade por perfil/praça).
  const filtroListMap = {}; for (const f of fsalvosArr || []) { const l = (filtroListMap[f.user_id] = filtroListMap[f.user_id] || []); if (l.length < 6 && f.filtros) l.push(f.filtros); }
  const arremMap = {}; for (const a of arremArr || []) (arremMap[a.user_id] = arremMap[a.user_id] || []).push(a.imovel_id);
  const enviadosMap = {}; for (const e of enviadosArr || []) (enviadosMap[e.user_id] = enviadosMap[e.user_id] || new Set()).add(e.imovel_id);

  // Tipos/estados dos imóveis já arrematados (para "similares")
  const arremImovelIds = [...new Set((arremArr || []).map(a => a.imovel_id).filter(Boolean))];
  const arremInfo = {};
  if (arremImovelIds.length) {
    const rows = await sbGet(`imoveis_leilao?id=in.(${arremImovelIds.join(',')})&select=id,tipo,estado`);
    for (const r of rows || []) arremInfo[r.id] = r;
  }

  const fmtBRL = v => v ? 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
  const fmtData = d => d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : null;

  // Normalização = cidade_norm do banco (minúsc., sem acento, sem espaço/pontuação).
  const normCid = (c) => (c || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  const numOnly = (v) => Number(String(v ?? '').replace(/\D/g, '')) || 0;
  // Monta as condições PostgREST de UM filtro salvo (tipo/modalidade/valor/desconto/
  // bairros/cidades) — fiel ao que o cliente salvou na Busca.
  const condFiltro = (f) => {
    const p = [];
    const tipos = Array.isArray(f.tipos) ? f.tipos.filter(Boolean) : [];
    if (tipos.length) p.push(`tipo=in.(${[...tipos, 'imovel'].map(encodeURIComponent).join(',')})`);
    const mods = Array.isArray(f.modalidades) ? f.modalidades.filter(Boolean) : [];
    if (mods.length) p.push(`modalidade=in.(${mods.map(encodeURIComponent).join(',')})`);
    if (f.valorMin) p.push(`valor_minimo=gte.${numOnly(f.valorMin)}`);
    if (f.valorMax) p.push(`valor_minimo=lte.${numOnly(f.valorMax)}`);
    if (f.descontoMin) p.push(`desconto_percentual=gte.${Number(f.descontoMin)}`);
    const bairros = Array.isArray(f.bairros) ? f.bairros.filter(Boolean) : [];
    if (bairros.length) p.push(`bairro=in.(${bairros.map(b => encodeURIComponent(`"${b}"`)).join(',')})`);
    const cidades = Array.isArray(f.cidades) ? f.cidades.filter(Boolean) : [];
    if (cidades.length) p.push(`cidade_norm=in.(${cidades.map(c => encodeURIComponent(normCid(c))).join(',')})`);
    else if (f.estado) p.push(`estado=eq.${encodeURIComponent(f.estado)}`);
    return p.length ? '&' + p.join('&') : '';
  };
  const buscarPorFiltro = (f, lim) => sbGet(`imoveis_leilao?select=${SEL}&ativo=eq.true${condFiltro(f)}&order=desconto_percentual.desc&limit=${lim}`);

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

      // ── Seleção assertiva ────────────────────────────────────────────────
      // Referência = CIDADE do usuário (filtro salvo ou cadastro), nunca o estado.
      const savedFilters = filtroListMap[perfil.id] || [];
      const temPerfil = savedFilters.length > 0;
      const filtroBase = savedFilters[0] || a?.filtros || {};
      const cidadesRef = (Array.isArray(filtroBase.cidades) && filtroBase.cidades.length)
        ? filtroBase.cidades.filter(Boolean)
        : [perfil.endereco_cidade].filter(Boolean);
      const cidade = cidadesRef[0] || '';
      const uf = filtroBase.estado || perfil.endereco_uf || '';

      const enviadosSet = enviadosMap[perfil.id] || new Set();
      const LIMITE = 12;
      const pool = new Map();
      const add = (im, isNovo) => { if (im && im.id && !pool.has(im.id)) pool.set(im.id, { im, isNovo }); };
      // Prioriza NÃO-repetidos; só usa repetido quando falta novidade. Cada fonte já
      // vem ordenada por maior desconto (os >40% lideram — é o que fecha 30% líquido).
      const despejar = (lista, limite) => {
        const arr = (lista || []).filter(im => im && im.id);
        const frescos = arr.filter(im => !enviadosSet.has(im.id));
        const repetidos = arr.filter(im => enviadosSet.has(im.id));
        let n = 0;
        for (const im of [...frescos, ...repetidos]) {
          if (n >= limite || pool.size >= LIMITE) break;
          if (!pool.has(im.id)) { add(im, !enviadosSet.has(im.id)); n++; }
        }
      };

      // 1) 80% das vagas, DISTRIBUÍDAS entre os filtros salvos (independe da qtde).
      if (temPerfil) {
        const cota80 = Math.round(LIMITE * 0.8); // ~10 de 12
        const porFiltro = Math.max(1, Math.ceil(cota80 / savedFilters.length));
        for (const f of savedFilters) {
          if (pool.size >= cota80) break;
          despejar(await buscarPorFiltro(f, porFiltro * 4), porFiltro);
        }
      }

      // 2) Complemento (20% + o que faltar) via RAIO da(s) cidade(s) de referência.
      for (const cid of cidadesRef.slice(0, 3)) {
        if (pool.size >= LIMITE) break;
        const cen = centroide(cid, uf);
        if (cen) despejar(await rpc('buscar_por_raio_v2', { lat: cen.lat, lng: cen.lng, raio_metros: 200000, lim: 40 }), LIMITE - pool.size);
        if (pool.size < LIMITE) despejar(await sbGet(`imoveis_leilao?select=${SEL}&ativo=eq.true&cidade=ilike.*${encodeURIComponent(cid)}*&order=desconto_percentual.desc&limit=24`), LIMITE - pool.size);
      }

      // 3) Similares às arrematações do usuário (mesmo tipo), se ainda faltar.
      if (pool.size < LIMITE) {
        const meus = arremMap[perfil.id] || [];
        const tipos = [...new Set(meus.map(i => arremInfo[i]?.tipo).filter(Boolean))];
        for (const t of tipos.slice(0, 2)) {
          if (pool.size >= LIMITE) break;
          despejar(await sbGet(`imoveis_leilao?select=${SEL}&ativo=eq.true&tipo=eq.${encodeURIComponent(t)}${uf ? `&estado=eq.${uf}` : ''}&order=desconto_percentual.desc&limit=8`), LIMITE - pool.size);
        }
      }

      // Ordena por MAIOR desconto (os acima de 40% lideram) e pega até 12.
      const top = [...pool.values()].map(v => v.im)
        .sort((x, y) => (Number(y.desconto_percentual) || 0) - (Number(x.desconto_percentual) || 0))
        .slice(0, LIMITE);
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
        // Registra os imóveis enviados (dedup dos próximos envios; ignora repetidos).
        if (!testeEmail) {
          try {
            await fetch(`${URL_}/rest/v1/alertas_enviados`, {
              method: 'POST',
              headers: { ...hdr, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
              body: JSON.stringify(top.map(im => ({ user_id: perfil.id, imovel_id: im.id }))),
            });
          } catch { /* dedup é best-effort */ }
        }
        enviados++;
      }
    } catch (e) {
      console.error('[enviar-alertas-cron] erro user', perfil.id, e?.message);
    }
  }

  return new Response(JSON.stringify({ ok: true, enviados, total: perfis.length }), { headers: { 'Content-Type': 'application/json' } });
}
