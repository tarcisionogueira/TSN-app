/**
 * /api/veiculo-compartilhado — link de compartilhamento da tela do veículo (05/10, pedido do dono).
 *
 * A tela do veículo é exclusiva da equipe. Quem recebe o link vê a MESMA tela (VeiculoDetalhe em
 * modo `compartilhado`, rota pública /#/v/<token>) — sem "Solicitar análise" e sem caminho para o
 * leiloeiro: o acervo não é aberto ao público, então o servidor nem ENTREGA o que levaria lá
 * (link_lote, anexos do leiloeiro, URLs na descrição). Esconder só no front não bastaria.
 *
 * POST { veiculo_id }  (admin/analista) → reaproveita o link vigente do veículo ou cria um (30 dias).
 * GET  ?token=         (sem login)      → dados do veículo, já saneados, + FIPE gravada (sem
 *                                         consulta on-demand: visitante não gasta cota).
 */
export const config = { runtime: 'edge' };

import { getUser, unauthorized } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const APP_ORIGIN = process.env.APP_ORIGIN || 'https://bidprobrasil.com.br';
const ROLES_EQUIPE = ['admin', 'analista'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;
const VALIDADE_DIAS = 30;

// Mesmas colunas da tela, MENOS o que leva ao leiloeiro (link_lote, anexos). `raw` sai reduzido
// ao que localDoPatio() lê (src/utils/patioVeiculo.js).
const COLUNAS = [
  'id', 'titulo', 'descricao', 'marca', 'modelo', 'ano_fabricacao', 'ano_modelo', 'placa', 'chassi', 'renavam', 'km',
  'valor_minimo', 'valor_avaliacao', 'desconto_percentual', 'modalidade', 'origem_venda', 'cidade', 'estado',
  'fotos', 'data_leilao', 'leiloeiro', 'sinistro', 'is_sucata', 'financiavel',
  'combustivel', 'cambio', 'cor', 'motor_alerta', 'ipva_situacao', 'tipo_veiculo',
  'valor_fipe', 'fipe_codigo', 'fipe_mes_referencia', 'fipe_status', 'fipe_atualizado_em',
  'resultado_leilao', 'valor_lance_vencedor', 'teve_lance',
  'raw', 'forma_pagamento', 'opcionais', 'status_patio',
].join(',');

const json = (o, s = 200, extra = {}) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': APP_ORIGIN, ...extra } });
const sb = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...opts, headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
});
async function ler(path) {
  const r = await sb(path);
  if (!r.ok) throw new Error(`${path.split('?')[0]} HTTP ${r.status}`);
  return r.json();
}

const semLinks = (s) => (s == null ? s : String(s).replace(/\b(?:https?:\/\/|www\.)\S+/gi, '[link removido]'));

function sanear(v) {
  const raw = (v.raw && typeof v.raw === 'object') ? v.raw : {};
  const loc = raw.product?.location;
  return {
    ...v,
    descricao: semLinks(v.descricao),
    raw: {
      lot_location_address: raw.lot_location_address ?? null,
      offerDescription: semLinks(raw.offerDescription ?? null),
      addr: raw.addr ?? null,
      localidade: raw.localidade ?? null,
      local: raw.local ?? null,
      lot_location: raw.lot_location ?? null,
      product: loc ? { location: { city: loc.city ?? null, locationGeo: loc.locationGeo ?? null } } : null,
    },
  };
}

function novoToken() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': APP_ORIGIN, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } });
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Configuração ausente' }, 500);

  try {
    if (req.method === 'GET') {
      const token = new URL(req.url).searchParams.get('token') || '';
      if (!TOKEN_RE.test(token)) return json({ error: 'Link inválido.' }, 404);
      const [c] = await ler(`veiculo_compartilhamento?token=eq.${token}&select=veiculo_id,expira_em,acessos&limit=1`);
      if (!c) return json({ error: 'Link inválido.' }, 404);
      if (Date.parse(c.expira_em) < Date.now()) return json({ error: 'Este link expirou. Peça um novo a quem compartilhou.' }, 410);
      const [v] = await ler(`veiculos_leilao?id=eq.${c.veiculo_id}&select=${COLUNAS}&limit=1`);
      if (!v) return json({ error: 'Veículo não encontrado.' }, 404);
      // Contador de acessos: só rastro para a equipe saber se o link foi aberto — falha não trava a tela.
      sb(`veiculo_compartilhamento?token=eq.${token}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ acessos: (c.acessos || 0) + 1, ultimo_acesso_em: new Date().toISOString() }) })
        .catch((e) => console.error('[veiculo-compartilhado] acesso:', e?.message));
      return json({ ok: true, veiculo: sanear(v), expira_em: c.expira_em }, 200, { 'Cache-Control': 'no-store' });
    }

    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const user = await getUser(req);
    if (!user) return unauthorized();
    const [perfil] = await ler(`perfis?id=eq.${user.id}&select=role&limit=1`);
    if (!ROLES_EQUIPE.includes(perfil?.role)) return json({ error: 'Compartilhar é exclusivo da equipe.' }, 403);
    let body; try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
    const veiculoId = String(body?.veiculo_id || '');
    if (!UUID_RE.test(veiculoId)) return json({ error: 'veiculo_id obrigatório' }, 400);

    // Reaproveita o link vigente com folga (> 7 dias) — mandar o mesmo veículo a dois clientes não
    // multiplica tokens; perto de vencer, gera outro para o destinatário ter o mês inteiro.
    const folga = new Date(Date.now() + 7 * 86400000).toISOString();
    const [vigente] = await ler(`veiculo_compartilhamento?veiculo_id=eq.${veiculoId}&expira_em=gt.${folga}&select=token,expira_em&order=expira_em.desc&limit=1`);
    if (vigente) return json({ ok: true, token: vigente.token, expira_em: vigente.expira_em });

    const [existe] = await ler(`veiculos_leilao?id=eq.${veiculoId}&select=id&limit=1`);
    if (!existe) return json({ error: 'Veículo não encontrado' }, 404);
    const token = novoToken();
    const expira_em = new Date(Date.now() + VALIDADE_DIAS * 86400000).toISOString();
    const r = await sb('veiculo_compartilhamento', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ token, veiculo_id: veiculoId, criado_por: user.id, expira_em }) });
    const [ok] = r.ok ? await r.json().catch(() => []) : [];
    if (!ok) return json({ error: `Não gravei o link (HTTP ${r.status}).` }, 502);
    return json({ ok: true, token, expira_em });
  } catch (e) {
    console.error('[veiculo-compartilhado]', String(e?.message || e).slice(0, 200));
    return json({ error: 'Falha ao processar o link.' }, 500);
  }
}
