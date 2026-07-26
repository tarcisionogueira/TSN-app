// Coleta CLIENT-SIDE (staff) dos leiloeiros Vlance — economiza Bright Data usando o IP REAL do
// navegador do staff (a API do Vlance tem CORS aberto). O front coleta e POSTa aqui; o servidor
// valida, mapeia e faz upsert no acervo (fonte VLANCE). Gate garante ~2x/semana e 1 disparo/janela.
//
// SEGURANÇA: só STAFF (admin/analista/advogado) dispara → dado de fonte confiável (superfície mínima).
// Mesmo assim, o servidor NÃO confia cegamente: só aceita lotes de tenants conhecidos, mapeia ele
// mesmo (o cliente não injeta linhas de imoveis_leilao), limita quantidade e valores, dedup e
// pula simulação/encerrados. Tudo marcado fonte=VLANCE → auditável e reversível.
import { getAuthUser, getUserRoleById, unauthorized, forbidden } from './_auth.js';

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const APP_ORIGIN = process.env.APP_ORIGIN || 'https://bidprobrasil.com.br';
const STAFF = new Set(['admin', 'analista', 'advogado']);
const TENANTS = ['verdeamareloleiloes.com.br', 'sudesteleiloes.com.br', 'capitalvalorleiloes.com.br'];
const MAX_LOTES = 3000;

const j = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': APP_ORIGIN },
});
const sb = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...opts, headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
});
const rpc = (fn, args) => fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
  method: 'POST', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args),
});

const norm = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const numf = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const slug = (dom) => norm(dom).split('.')[0].replace(/leiloes?$/, '') || norm(dom).split('.')[0];
const RE_SIM = /simula|teste|homolog|sandbox/i;
const RE_ATIVO = /aberto|recebendo|lance|propost|dispon/i;

function inferirTipo(cat, sub, tit) {
  const t = norm(`${cat} ${sub} ${tit}`);
  if (/apartament|apto|flat|kitnet|studio|cobertura/.test(t)) return 'apartamento';
  if (/casa|sobrado|residenc/.test(t)) return 'casa';
  if (/terreno|lote|gleba|area|chacara/.test(t)) return 'terreno';
  if (/comercial|loja|sala|galp|predio|escritorio/.test(t)) return 'comercial';
  if (/rural|fazenda|sitio/.test(t)) return 'rural';
  return 'outros';
}
function dataLeilao(lote, pai) {
  for (const c of [lote?.dt_fechamento, pai?.dt, pai?.dt_formatada]) {
    let m = String(c || '').match(/(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0];
    m = String(c || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  }
  return null;
}
function fotoUrl(lote) {
  const f = Array.isArray(lote?.fotos) ? lote.fotos[0] : null;
  if (typeof f === 'string') return f;
  if (f && typeof f === 'object') for (const k of ['url', 'nm_foto', 'nm_arquivo', 'src', 'link']) if (f[k]) return String(f[k]);
  return null;
}
function montarRow(lote, pai, base, dom) {
  let va = [lote.vl_venda, lote.vl_lanceinicial, lote.vl_lanceminimo].map(numf).find((v) => v > 0) || 0;
  const vm = [lote.vl_lanceminimo, lote.vl_lanceinicial].map(numf).find((v) => v > 0) || 0;
  if (va > 0 && vm > va) va = vm; // evita desconto negativo (mín > avaliação)
  const desc = (va > 0 && vm > 0) ? Math.round((1 - vm / va) * 100) : null;
  const jud = norm(pai?.tp_judicial_extrajudicial) || norm(lote.tp_judicial_extrajudicial);
  return {
    fonte: 'VLANCE',
    fonte_id: `vlance_${slug(dom)}_${lote.lote_id}`,
    titulo: String(lote.nm_titulo_lote || `Lote ${lote.lote_id}`).slice(0, 180),
    tipo: inferirTipo(lote.nm_categoria, lote.nm_subcategoria, lote.nm_titulo_lote),
    modalidade: (jud.includes('jud') && !jud.includes('extra')) ? 'judicial' : 'extrajudicial',
    cidade: lote.nm_cidade || null,
    estado: String(lote.nm_estado || '').slice(0, 2).toUpperCase() || null,
    valor_avaliacao: va, valor_minimo: vm,
    descricao: String(lote.nm_titulo_lote || '').slice(0, 500),
    link_edital: `${base}/leilao/index/imoveis`,
    url_lote: base,
    link_foto: fotoUrl(lote),
    leiloeiro: String(lote.nm_leiloeiro || `${slug(dom)} Leilões`).slice(0, 120),
    data_leilao: dataLeilao(lote, pai),
    forma_pagamento: 'a_vista',
    ativo: true,
    viavel: (va > 0 && vm > 0) ? (1 - vm / va) >= 0.3 : null,
    score_viabilidade: (va > 0 && vm > 0) ? Math.min(100, Math.round((1 - vm / va) * 150)) : 30,
    desconto_percentual: (desc != null && desc >= 0) ? desc : null,
    atualizado_em: new Date().toISOString(),
  };
}
function ingerivel(lote) {
  if (!(Number(lote?.lote_id) > 0)) return false;
  if (RE_SIM.test(`${lote?.nm_titulo_lote || ''} ${lote?.nm_titulo_leilao || ''}`)) return false;
  if (!RE_ATIVO.test(String(lote?.nm_statuslote || ''))) return false;
  return true;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: {
      'Access-Control-Allow-Origin': APP_ORIGIN, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'authorization,content-type',
    } });
  }
  if (!SERVICE_KEY) return j({ error: 'Serviço indisponível' }, 500);
  const user = await getAuthUser(req);
  if (!user) return unauthorized();
  const role = await getUserRoleById(user.id);
  if (!STAFF.has(role)) return forbidden('Coleta restrita à equipe.');

  // GET → o gate decide se está na hora (claim atômico). Config p/ o front coletar.
  if (req.method === 'GET') {
    const r = await rpc('coleta_cliente_claim', { p_fonte: 'VLANCE' });
    const devida = r.ok ? (await r.json()) === true : false;
    return j({ devida, tenants: TENANTS, ep_leiloes: '/core/api/get-leiloes', ep_lotes: '/core/api/get-lotes', max_lotes: MAX_LOTES });
  }

  // POST → recebe os lotes CRUS coletados pelo navegador do staff; o servidor mapeia + valida + grava.
  if (req.method === 'POST') {
    let body; try { body = await req.json(); } catch { return j({ error: 'JSON inválido' }, 400); }
    const coletas = Array.isArray(body?.coletas) ? body.coletas : [];
    const rows = []; const vistos = new Set();
    for (const c of coletas) {
      const dom = String(c?.dominio || '').replace(/^www\./, '');
      if (!TENANTS.includes(dom)) continue; // só tenants conhecidos
      const base = `https://www.${dom}`;
      const leiloes = (c && typeof c.leiloes === 'object' && c.leiloes) ? c.leiloes : {};
      for (const lote of (Array.isArray(c?.lotes) ? c.lotes : [])) {
        if (rows.length >= MAX_LOTES) break;
        if (!ingerivel(lote)) continue;
        const row = montarRow(lote, leiloes[String(lote.leilao_id)] || {}, base, dom);
        if (row.valor_avaliacao > 500000000 || row.valor_minimo > 500000000) continue; // sanidade
        if (vistos.has(row.fonte_id)) continue;
        vistos.add(row.fonte_id);
        rows.push(row);
      }
    }
    let gravados = 0;
    if (rows.length) {
      const up = await sb('imoveis_leilao?on_conflict=fonte_id', {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows),
      });
      if (!up.ok) return j({ error: 'Falha ao gravar', detalhe: (await up.text().catch(() => '')).slice(0, 300) }, 502);
      gravados = rows.length;
      // fonte_saude p/ o monitor auto-aprendido passar a vigiar o VLANCE (best-effort).
      try { await sb('fonte_saude', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ fonte: 'VLANCE', status: 'ok', total: gravados, executado_em: new Date().toISOString() }) }); } catch { /* */ }
    }
    await rpc('coleta_cliente_concluir', { p_fonte: 'VLANCE' }); // fecha a janela (mesmo com 0 gravados)
    return j({ ok: true, gravados });
  }
  return j({ error: 'Método não permitido' }, 405);
}
