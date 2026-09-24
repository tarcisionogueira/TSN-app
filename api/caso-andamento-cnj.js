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
 *
 * 24/09 (tarde, dono: "algo compreensível para qualquer pessoa ler… trazer os próximos movimentos
 * relevantes"): (1) consulta SÓ o tribunal que o número indica — eram 5 de uma vez e o DataJud
 * recusou 4 com 429; (2) o erro técnico vira uma frase (`aviso`), o bruto fica em `erro` para a
 * equipe; (3) `resumo`: a IA lê movimentos + publicações e explica, sem juridiquês, o que
 * aconteceu DESDE A ARREMATAÇÃO e o que vem a seguir. Cache por (processo, hash do que foi lido)
 * em `processo_resumo_cache`: repetir a consulta sem novidade não paga IA de novo. O resumo
 * falhar nunca derruba a consulta — ele volta com o próprio `erro`.
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { createHash } from 'node:crypto';
import { getUser } from './_auth.js';
import { buscarProcessosCNJ, buscarDjen, tribunalDoNumeroCnj } from './_cnj.js';
import { anthropicFetch } from './_claude.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const MODELO_RESUMO = 'claude-haiku-4-5';

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  if (!r.ok) throw new Error(`supabase ${r.status} em ${path.split('?')[0]}`);
  return r.json();
}

// Justiça Estadual (J=8): o segmento TR do número CNJ é o tribunal — 01 AC … 27 TO.
const UF_POR_TR_ESTADUAL = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SE','SP','TO'];
// Justiça do Trabalho (J=5): o TR é o nº do TRT (24/09 — o arremate do dono é TRT5/BA; sem isto a
// consulta varria os ~60 tribunais do país). TRT2 e TRT15 são ambos SP.
const UF_POR_TRT = ['RJ','SP','MG','RS','BA','PE','CE','PA','PR','DF','AM','SC','PB','RO','SP','MA','ES','GO','AL','SE','RN','PI','MT','MS'];
export function ufDoNumeroCnj(numero) {
  const d = String(numero || '').replace(/\D/g, '');
  if (d.length !== 20) return null;
  const tr = parseInt(d.slice(14, 16), 10) - 1;
  if (d[13] === '8') return UF_POR_TR_ESTADUAL[tr] || null;
  if (d[13] === '5') return UF_POR_TRT[tr] || null;
  return null;
}

// O erro do DataJud chega como corpo de Elasticsearch — útil para a equipe investigar, ilegível
// para quem só quer saber do processo. Esta é a frase que vai para a tela.
export function avisoDataJud(erro) {
  const e = String(erro || '');
  if (!e) return null;
  if (/429|rejected_execution/i.test(e)) return 'O sistema do CNJ (DataJud) está sobrecarregado agora e recusou a consulta. Tente de novo em alguns minutos — as publicações do Diário Oficial abaixo já mostram o andamento.';
  if (/timeout|aborted|abort/i.test(e)) return 'O sistema do CNJ (DataJud) demorou demais para responder. Tente de novo em alguns minutos.';
  if (/CNJ_DATAJUD_KEY/i.test(e)) return 'A consulta ao CNJ está desligada neste ambiente (chave de acesso ausente).';
  if (/HTTP 5\d\d/i.test(e)) return 'O sistema do CNJ (DataJud) está fora do ar no momento. Tente mais tarde.';
  return 'Não foi possível consultar o CNJ (DataJud) agora. Tente de novo em alguns minutos.';
}

const SISTEMA_RESUMO = `Você explica andamento de processo judicial para quem ARREMATOU um imóvel em leilão judicial e não é advogado.
Escreva em português do Brasil simples, frases curtas, sem juridiquês. Quando um termo técnico for inevitável, explique entre parênteses em poucas palavras (ex.: "carta de arrematação (o documento que permite registrar o imóvel no seu nome)").
O foco é a ARREMATAÇÃO: o que aconteceu com ela e o que falta até o arrematante ter o imóvel registrado e a posse. Ignore o que não afeta o arrematante (cálculos entre as partes, intimações só entre credor e devedor, despachos de mero expediente) — a não ser que atrase ou ameace a arrematação.
Etapas típicas depois do leilão: auto de arrematação assinado; prazo para contestar a arrematação (embargos/impugnação); pagamento/depósito do lance e comissão; expedição da carta de arrematação e do mandado de imissão na posse; registro no cartório; desocupação/imissão na posse; eventual pagamento de dívidas do imóvel com o dinheiro do leilão.
Use SOMENTE fatos presentes nos textos. Nunca invente data, prazo, valor ou decisão. Se não houver nada relevante depois da arrematação, diga isso claramente. Se o texto não permitir saber algo, diga que não dá para saber pelos documentos publicados.
Responda APENAS com JSON: {"situacao":"1 a 2 frases: em que pé está a arrematação hoje","acontecimentos":[{"data":"AAAA-MM-DD","texto":"o que aconteceu, em linguagem simples"}],"proximos_passos":["o que deve acontecer a seguir, em ordem"],"acao_do_arrematante":"o que o arrematante precisa fazer agora, ou null se nada","alerta":"risco concreto para a arrematação (ex.: pedido para anular), ou null"}
"acontecimentos": no máximo 6, só os relevantes, do mais recente para o mais antigo.`;

async function resumirAndamento({ numero, contexto, movimentos, publicacoes }) {
  const chave = process.env.CLAUDE_KEY || process.env.ANTHROPIC_API_KEY;
  if (!chave) return { ok: false, erro: 'chave da IA ausente' };
  if (!movimentos.length && !publicacoes.length) return { ok: false, erro: 'nada para resumir (sem movimentos nem publicações)' };
  const entrada = {
    arrematacao: contexto,
    movimentos_datajud: movimentos.slice(0, 25).map(m => ({ data: m.data, descricao: m.descricao })),
    publicacoes_diario_oficial: publicacoes.slice(0, 10).map(p => ({ data: p.data_disponibilizacao, tipo: p.tipo_documento, orgao: p.orgao, texto: p.texto })),
  };
  const hash = createHash('sha256').update(MODELO_RESUMO + SISTEMA_RESUMO + JSON.stringify(entrada)).digest('hex').slice(0, 32);
  const numKey = String(numero).replace(/\D/g, '');

  try {
    const [c] = await sbGet(`processo_resumo_cache?numero_processo=eq.${numKey}&hash=eq.${hash}&select=resumo,criado_em`);
    if (c?.resumo) return { ok: true, ...c.resumo, gerado_em: c.criado_em, do_cache: true };
  } catch (e) {
    console.warn('[caso-andamento-cnj] cache ilegível, segue sem ele:', e.message);
  }

  let res;
  try {
    res = await anthropicFetch({
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODELO_RESUMO, max_tokens: 1500, system: SISTEMA_RESUMO, messages: [{ role: 'user', content: JSON.stringify(entrada) }] }),
    }, { retries: 1, timeoutMs: 30000, noFallback: true });
  } catch (e) {
    return { ok: false, erro: `rede: ${String(e?.message || e).slice(0, 120)}` };
  }
  if (!res.ok) return { ok: false, erro: `IA respondeu HTTP ${res.status}` };
  const data = await res.json().catch(() => null);
  if (!data) return { ok: false, erro: 'IA devolveu corpo não-JSON' };
  if (data.stop_reason === 'max_tokens') return { ok: false, erro: 'resumo cortado (max_tokens)' };
  if (data.stop_reason === 'refusal') return { ok: false, erro: 'IA recusou' };
  const texto = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  let r;
  try { r = JSON.parse(texto.slice(texto.indexOf('{'), texto.lastIndexOf('}') + 1)); }
  catch { return { ok: false, erro: 'IA devolveu JSON inválido' }; }
  const str = (x, n) => (typeof x === 'string' && x.trim() && x.trim().toLowerCase() !== 'null') ? x.trim().slice(0, n) : null;
  const resumo = {
    situacao: str(r?.situacao, 600),
    acontecimentos: (Array.isArray(r?.acontecimentos) ? r.acontecimentos : []).slice(0, 6)
      .map(a => ({ data: /^\d{4}-\d{2}-\d{2}$/.test(String(a?.data || '')) ? a.data : null, texto: str(a?.texto, 400) })).filter(a => a.texto),
    proximos_passos: (Array.isArray(r?.proximos_passos) ? r.proximos_passos : []).map(x => str(x, 300)).filter(Boolean).slice(0, 6),
    acao_do_arrematante: str(r?.acao_do_arrematante, 400),
    alerta: str(r?.alerta, 400),
  };
  if (!resumo.situacao) return { ok: false, erro: 'IA não disse a situação' };

  // Grava o cache; falhar aqui só custa uma chamada de IA na próxima consulta.
  const g = await fetch(`${SUPABASE_URL}/rest/v1/processo_resumo_cache`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ numero_processo: numKey, hash, resumo, modelo: MODELO_RESUMO }),
  }).catch(e => ({ ok: false, status: String(e?.message || e) }));
  if (!g.ok) console.warn('[caso-andamento-cnj] cache do resumo não gravou:', g.status);
  return { ok: true, ...resumo, gerado_em: new Date().toISOString(), do_cache: false };
}

export default async function handler(req, res) {
  const enviar = (o, s = 200) => res.status(s).json(o);
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  const user = await getUser(req);
  if (!user) return enviar({ error: 'Não autenticado' }, 401);

  let perfil;
  try { [perfil] = await sbGet(`perfis?id=eq.${user.id}&select=role`); }
  catch (e) { return enviar({ error: `não consegui verificar o perfil: ${e.message}` }, 502); }
  if (!['admin', 'analista', 'consultor', 'advogado'].includes(perfil?.role)) return enviar({ error: 'Apenas a equipe' }, 403);

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { return enviar({ error: 'JSON inválido' }, 400); } }
  const casoId = String(b?.caso_id || '');
  const arrematadoId = String(b?.arrematado_id || '');
  const UUID = /^[0-9a-f-]{36}$/i;
  if (!UUID.test(casoId) && !UUID.test(arrematadoId)) return enviar({ error: 'informe caso_id ou arrematado_id' }, 400);
  const dono = UUID.test(arrematadoId)
    ? { col: 'arrematado_id', id: arrematadoId, tabela: 'arrematados', campos: 'imovel_id,titulo,cidade,estado,valor_arrematacao,data_arrematacao' }
    : { col: 'caso_id', id: casoId, tabela: 'casos', campos: 'imovel_id,imovel_endereco,imovel_valor,arrematado_em,posse_em' };

  let numero = String(b?.numero_processo || '').trim();
  let origemNumero = numero ? 'informado' : null;
  let registro;
  try {
    [registro] = await sbGet(`${dono.tabela}?id=eq.${dono.id}&select=${dono.campos}`);
    if (!registro) return enviar({ error: 'registro não encontrado' }, 404);
    if (!numero) {
      const [ult] = await sbGet(`caso_andamentos?${dono.col}=eq.${dono.id}&numero_processo=not.is.null&select=numero_processo&order=criado_em.desc&limit=1`);
      if (ult?.numero_processo) { numero = ult.numero_processo; origemNumero = 'registrado no andamento'; }
    }
    if (!numero && UUID.test(String(registro.imovel_id || ''))) {
      const [lote] = await sbGet(`imoveis_leilao?id=eq.${registro.imovel_id}&select=numero_processo`);
      if (lote?.numero_processo) { numero = lote.numero_processo; origemNumero = 'do lote arrematado'; }
    }
  } catch (e) {
    return enviar({ error: `não consegui ler o registro: ${e.message}` }, 502);
  }
  if (!numero) return enviar({ error: 'sem número de processo — informe o número CNJ do processo', precisa_numero: true }, 422);

  const exato = tribunalDoNumeroCnj(numero);
  const uf = exato ? null : ufDoNumeroCnj(numero);
  const [cnj, djen] = await Promise.all([
    buscarProcessosCNJ({ numero_processo: numero, uf, nacional: !exato && !uf, tribunais: exato ? [exato] : null })
      .catch(e => ({ processos: [], erros: [String(e?.message || e)] })),
    buscarDjen({ numero_processo: numero, maxTexto: 3000 }).catch(e => ({ erro: String(e?.message || e) })),
  ]);

  const processo = (cnj.processos || [])[0] || null;
  const erroCnj = !processo && (cnj.erros || []).length ? cnj.erros.join(' | ') : null;
  const movimentos = processo ? (processo.movimentos || []).map(m => ({ data: m.data, descricao: m.descricao, codigo: m.codigo })) : [];
  const publicacoes = djen.erro ? [] : (djen.publicacoes || []);

  const contexto = dono.tabela === 'arrematados'
    ? { imovel: registro.titulo, cidade: [registro.cidade, registro.estado].filter(Boolean).join('/'), data_arrematacao: registro.data_arrematacao, valor: registro.valor_arrematacao }
    : { imovel: registro.imovel_endereco, data_arrematacao: registro.arrematado_em ? String(registro.arrematado_em).slice(0, 10) : null, valor: registro.imovel_valor, posse_em: registro.posse_em };
  const resumo = await resumirAndamento({ numero, contexto, movimentos, publicacoes })
    .catch(e => ({ ok: false, erro: String(e?.message || e) }));

  return enviar({
    numero_processo: numero,
    origem_numero: origemNumero,
    resumo,
    datajud: {
      ok: !!processo || !(cnj.erros || []).length,
      erro: erroCnj,
      aviso: avisoDataJud(erroCnj),
      tribunais: cnj.tribunais_consultados || [],
      processo: processo && {
        tribunal: processo.tribunal, classe: processo.classe, orgao: processo.orgao, grau: processo.grau,
        fase: processo.fase, ultima_atualizacao: processo.ultima_atualizacao, movimentos,
      },
    },
    djen: djen.erro
      ? { ok: false, erro: djen.erro, publicacoes: [] }
      : { ok: true, erro: null, publicacoes: publicacoes.map(p => ({ ...p, texto: String(p.texto || '').slice(0, 1200) })), observacao: djen.observacao || null },
  });
}
