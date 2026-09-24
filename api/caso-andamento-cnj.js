/**
 * POST /api/caso-andamento-cnj   (EQUIPE: admin/analista/consultor/advogado — 24/09)
 * Consulta SOB DEMANDA o andamento do processo de um caso OU de um arrematado (tela "Arremate
 * atribuído", pedido do dono 24/09 — era só admin e só caso de manhã): movimentações no DataJud (CNJ) e
 * publicações no DJEN. Não grava etapa sozinho — devolve a lista para o dono escolher o que
 * registrar em `caso_andamentos` (a tela grava direto, RLS admin-only).
 *
 * Body: { caso_id | arrematado_id, numero_processo? }
 *   numero_processo informado → é usado (e lembrado: o front grava junto com a etapa).
 *   Sem ele → o mais recente registrado em caso_andamentos; depois o do lote
 *   (imoveis_leilao.numero_processo via casos.imovel_id).
 *
 * Cada fonte volta com o seu erro próprio: "o CNJ não respondeu" NUNCA vira "nenhuma
 * movimentação" (pergunta de revisão do CLAUDE.md — vazio é resposta ou falha?).
 */
export const config = { runtime: 'edge' };

import { getAuthUser } from './_auth.js';
import { buscarProcessosCNJ, buscarDjen } from './_cnj.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

function json(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } }); }
async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  if (!r.ok) throw new Error(`supabase ${r.status} em ${path.split('?')[0]}`);
  return r.json();
}

// Justiça Estadual (J=8): o segmento TR do número CNJ é o tribunal — 01 AC … 27 TO.
const UF_POR_TR_ESTADUAL = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SE','SP','TO'];
export function ufDoNumeroCnj(numero) {
  const d = String(numero || '').replace(/\D/g, '');
  if (d.length !== 20 || d[13] !== '8') return null;
  return UF_POR_TR_ESTADUAL[parseInt(d.slice(14, 16), 10) - 1] || null;
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const user = await getAuthUser(req);
  if (!user) return json({ error: 'Não autenticado' }, 401);

  let perfil;
  try { [perfil] = await sbGet(`perfis?id=eq.${user.id}&select=role`); }
  catch (e) { return json({ error: `não consegui verificar o perfil: ${e.message}` }, 502); }
  if (!['admin', 'analista', 'consultor', 'advogado'].includes(perfil?.role)) return json({ error: 'Apenas a equipe' }, 403);

  let b; try { b = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const casoId = String(b?.caso_id || '');
  const arrematadoId = String(b?.arrematado_id || '');
  const UUID = /^[0-9a-f-]{36}$/i;
  if (!UUID.test(casoId) && !UUID.test(arrematadoId)) return json({ error: 'informe caso_id ou arrematado_id' }, 400);
  const dono = UUID.test(arrematadoId) ? { col: 'arrematado_id', id: arrematadoId, tabela: 'arrematados' } : { col: 'caso_id', id: casoId, tabela: 'casos' };

  let numero = String(b?.numero_processo || '').trim();
  let origemNumero = numero ? 'informado' : null;
  try {
    if (!numero) {
      const [ult] = await sbGet(`caso_andamentos?${dono.col}=eq.${dono.id}&numero_processo=not.is.null&select=numero_processo&order=criado_em.desc&limit=1`);
      if (ult?.numero_processo) { numero = ult.numero_processo; origemNumero = 'registrado no andamento'; }
    }
    if (!numero) {
      const [caso] = await sbGet(`${dono.tabela}?id=eq.${dono.id}&select=imovel_id`);
      if (!caso) return json({ error: 'registro não encontrado' }, 404);
      if (/^[0-9a-f-]{36}$/i.test(String(caso.imovel_id || ''))) {
        const [lote] = await sbGet(`imoveis_leilao?id=eq.${caso.imovel_id}&select=numero_processo`);
        if (lote?.numero_processo) { numero = lote.numero_processo; origemNumero = 'do lote arrematado'; }
      }
    }
  } catch (e) {
    return json({ error: `não consegui ler o registro: ${e.message}` }, 502);
  }
  if (!numero) return json({ error: 'sem número de processo — informe o número CNJ do processo', precisa_numero: true }, 422);

  const uf = ufDoNumeroCnj(numero);
  const [cnj, djen] = await Promise.all([
    buscarProcessosCNJ({ numero_processo: numero, uf, nacional: !uf }).catch(e => ({ processos: [], erros: [String(e?.message || e)] })),
    buscarDjen({ numero_processo: numero }).catch(e => ({ erro: String(e?.message || e) })),
  ]);

  const processo = (cnj.processos || [])[0] || null;
  return json({
    numero_processo: numero,
    origem_numero: origemNumero,
    datajud: {
      ok: !!processo || !(cnj.erros || []).length,
      erro: !processo && (cnj.erros || []).length ? cnj.erros.join(' | ') : null,
      tribunais: cnj.tribunais_consultados || [],
      processo: processo && {
        tribunal: processo.tribunal, classe: processo.classe, orgao: processo.orgao, grau: processo.grau,
        fase: processo.fase, ultima_atualizacao: processo.ultima_atualizacao,
        movimentos: (processo.movimentos || []).map(m => ({ data: m.data, descricao: m.descricao, codigo: m.codigo })),
      },
    },
    djen: djen.erro
      ? { ok: false, erro: djen.erro, publicacoes: [] }
      : { ok: true, erro: null, publicacoes: djen.publicacoes || [], observacao: djen.observacao || null },
  });
}
