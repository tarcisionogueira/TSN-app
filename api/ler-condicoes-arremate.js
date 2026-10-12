/**
 * POST /api/ler-condicoes-arremate  { arrematado_id }
 *
 * Lê as condições de pagamento da arrematação DIRETO do documento do caso — carta de arrematação
 * (quando já expedida) ou auto de arrematação — e grava o cronograma em `arrematados.parcelamento`
 * (12/10, pedido do dono: "não devo precisar informar o índice; o auto e a carta informam").
 *
 * Grava junto a PROVA (`fonte_doc`: qual documento, trecho literal do índice e do pagamento), para
 * a equipe conferir com o PDF em vez de confiar no número. Não mexe em `valor_arrematacao` nem na
 * data: divergência entre o documento e o cadastro volta como AVISO, para alguém decidir.
 *
 * Por enquanto só equipe (admin/analista/consultor/advogado) — em validação.
 * Grava pela RPC `salvar_parcelamento_arremate` com o token do PRÓPRIO usuário (mesma checagem de
 * permissão e o mesmo `atualizado_por` de quando a equipe digita).
 */
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { getUser, getUserRoleById } from './_auth.js';
import { anthropicFetch } from './_claude.js';
import { assinarDocumento } from './_storage.js';
import { classificarDocumento, blocoParaIA } from './_doc-leitura.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const ANON_KEY     = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const CHAVE_IA     = process.env.CLAUDE_KEY || process.env.ANTHROPIC_API_KEY;
const MODELO       = 'claude-sonnet-4-6';
const EQUIPE       = ['admin', 'analista', 'consultor', 'advogado'];

const hdr = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: hdr, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`leitura ${path.split('?')[0]}: HTTP ${r.status}`);
  return r.json();
}

// Carta vence o auto (é posterior e definitiva); dentro do tipo, o mais recente. 'outro' só entra
// quando o NOME diz que é auto/carta (o upload do caso do Marcos chegou assim: "AUTO_POSITIVO").
function ordenarDocs(anexos) {
  const peso = (a) => (a.tipo === 'carta_arrematacao' ? 0 : a.tipo === 'auto_arrematacao' ? 1 : 2);
  return anexos
    .filter((a) => a.storage_path && (a.tipo !== 'outro' || /auto|carta|arremata/i.test(`${a.nome} ${a.descricao || ''}`)))
    .sort((x, y) => peso(x) - peso(y) || String(y.criado_em).localeCompare(String(x.criado_em)));
}

const SISTEMA = `Você lê autos e cartas de arrematação de leilão (judicial ou extrajudicial) e extrai SÓ as condições de pagamento do arrematante.
Responda apenas um JSON:
{"forma":"a_vista"|"parcelado"|null,
 "valor_arrematacao":number|null,
 "data_arrematacao":"AAAA-MM-DD"|null,
 "entrada_pct":number|null, "entrada_valor":number|null, "entrada_venc":"AAAA-MM-DD"|null,
 "parcelas":number|null, "valor_parcela":number|null, "primeira_venc":"AAAA-MM-DD"|null,
 "indice":string|null,
 "trecho_indice":string|null, "trecho_pagamento":string|null,
 "exequente":string|null, "executado":string|null, "trecho_partes":string|null,
 "documento_usado":number}
Regras:
- "indice" = o índice de correção das parcelas COMO ESCRITO no documento (ex.: "IPCA-E", "INPC", "SELIC", "tabela do TJBA"). Se o documento não menciona índice, null — NÃO deduza pelo tipo de processo.
- "trecho_indice" e "trecho_pagamento" = cópia LITERAL (até 300 caracteres) do trecho de onde saiu cada informação. Sem trecho, o campo correspondente é null.
- Datas que o documento dá como "30 dias após", "mesmo dia dos meses subsequentes" etc.: calcule a partir da data da arrematação e mantenha o trecho.
- "exequente" = o(s) reclamante(s)/exequente(s) e "executado" = o(s) reclamado(s)/executado(s), COMO ESCRITOS no documento (vários: separe por "; "). "trecho_partes" = cópia literal de onde saíram. Não constando, null.
- "documento_usado" = índice (0, 1…) do documento de onde saíram as condições.
- Na dúvida, null. Nunca invente.`;

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const dataOk = (s) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null);
const txt = (s, n) => (typeof s === 'string' && s.trim() && s.trim().toLowerCase() !== 'null' ? s.trim().slice(0, n) : null);

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }
  if (!CHAVE_IA) { res.status(500).json({ error: 'chave da IA ausente' }); return; }

  const user = await getUser(req);
  if (!user?.id) { res.status(401).json({ error: 'Faça login' }); return; }
  const role = await getUserRoleById(user.id);
  if (!EQUIPE.includes(role)) { res.status(403).json({ error: 'Recurso em validação — só equipe' }); return; }

  const arrId = String(req.body?.arrematado_id || '');
  if (!/^[0-9a-f-]{36}$/i.test(arrId)) { res.status(400).json({ error: 'arrematado_id inválido' }); return; }

  let arr, anexos;
  try {
    [arr] = await sbGet(`arrematados?id=eq.${arrId}&select=id,imovel_id,valor_arrematacao,data_arrematacao,parcelamento`);
    if (!arr) { res.status(404).json({ error: 'Arremate não encontrado' }); return; }
    if (!arr.imovel_id) { res.status(200).json({ ok: false, motivo: 'sem_documento', erro: 'Arremate sem imóvel vinculado — não há onde procurar o auto/carta.' }); return; }
    anexos = ordenarDocs(await sbGet(`imovel_anexos?imovel_id=eq.${arr.imovel_id}&tipo=in.(carta_arrematacao,auto_arrematacao,outro)&select=id,tipo,nome,descricao,storage_path,criado_em`));
  } catch (e) {
    console.error('[ler-condicoes-arremate] banco:', e.message);
    res.status(502).json({ error: `Não consegui ler o caso: ${e.message}` }); return;
  }
  if (!anexos.length) { res.status(200).json({ ok: false, motivo: 'sem_documento', erro: 'Nenhum auto ou carta de arrematação anexado ao caso.' }); return; }

  // Até 2 documentos (carta + auto, ou o auto + o "AUTO POSITIVO"): o 2º cobre o 1º ilegível.
  const lidos = [];
  const falhas = [];
  for (const a of anexos.slice(0, 2)) {
    const url = await assinarDocumento(a.storage_path, 300);
    if (!url) { falhas.push(`${a.nome}: não consegui assinar o arquivo`); continue; }
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) { falhas.push(`${a.nome}: HTTP ${r.status}`); continue; }
      const doc = classificarDocumento(Buffer.from(await r.arrayBuffer()), { contentType: r.headers.get('content-type') || '' });
      const bloco = blocoParaIA(doc, a.nome) || (doc.kind === 'texto' ? { type: 'text', text: doc.texto.slice(0, 60000) } : null);
      if (!bloco) { falhas.push(`${a.nome}: ${doc.motivo || 'formato não lido'}`); continue; }
      lidos.push({ anexo: a, bloco });
    } catch (e) { console.warn(`[ler-condicoes-arremate] ${a.nome}:`, e.message); falhas.push(`${a.nome}: ${e.message}`); }
  }
  if (!lidos.length) { res.status(200).json({ ok: false, motivo: 'ilegivel', erro: `Não consegui abrir os documentos: ${falhas.join(' · ')}` }); return; }

  const content = [];
  lidos.forEach((l, i) => { content.push({ type: 'text', text: `Documento ${i} — ${l.anexo.tipo} — ${l.anexo.nome}` }, l.bloco); });
  content.push({ type: 'text', text: `Cadastro atual: valor da arrematação ${arr.valor_arrematacao ?? 'não informado'}, data ${arr.data_arrematacao ?? 'não informada'}. Extraia as condições de pagamento.` });

  let ia;
  try {
    const r = await anthropicFetch({
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': CHAVE_IA, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODELO, max_tokens: 1200, system: SISTEMA, messages: [{ role: 'user', content }] }),
    }, { retries: 1, timeoutMs: 90000, noFallback: true });
    if (!r.ok) throw new Error(`IA respondeu HTTP ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
    const data = await r.json();
    if (data.stop_reason === 'max_tokens') throw new Error('resposta da IA cortada');
    const t = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    ia = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
  } catch (e) {
    console.error('[ler-condicoes-arremate] IA:', e.message);
    res.status(502).json({ error: `Falha ao ler o documento: ${e.message}` }); return;
  }

  const forma = ia?.forma === 'a_vista' || ia?.forma === 'parcelado' ? ia.forma : null;
  if (!forma) { res.status(200).json({ ok: false, motivo: 'sem_condicoes', erro: 'O documento não traz a forma de pagamento (à vista ou parcelado) de modo legível.', documentos: lidos.map((l) => l.anexo.nome) }); return; }

  const valorCad = Number(arr.valor_arrematacao) || null;
  const valorDoc = num(ia.valor_arrematacao);
  let entradaPct = num(ia.entrada_pct);
  if (entradaPct == null && num(ia.entrada_valor) && (valorDoc || valorCad)) entradaPct = Math.round((ia.entrada_valor / (valorDoc || valorCad)) * 10000) / 100;
  const parcelas = num(ia.parcelas) ? Math.round(ia.parcelas) : null;
  const usado = lidos[Number.isInteger(ia.documento_usado) && lidos[ia.documento_usado] ? ia.documento_usado : 0].anexo;
  const anterior = arr.parcelamento || {};

  const novo = forma === 'a_vista'
    ? { forma, entrada_venc: dataOk(ia.entrada_venc) || anterior.entrada_venc || null }
    : {
        forma,
        entrada_pct: entradaPct != null && entradaPct >= 0 && entradaPct <= 100 ? entradaPct : (anterior.entrada_pct ?? 25),
        entrada_venc: dataOk(ia.entrada_venc) || anterior.entrada_venc || null,
        parcelas: parcelas && parcelas >= 1 && parcelas <= 60 ? parcelas : (anterior.parcelas || 1),
        primeira_venc: dataOk(ia.primeira_venc) || anterior.primeira_venc || null,
      };
  novo.indice = txt(ia.indice, 80);
  novo.pagas = Array.isArray(anterior.pagas) ? anterior.pagas : [];
  novo.fonte_doc = {
    anexo_id: usado.id, tipo: usado.tipo, nome: String(usado.nome || '').slice(0, 120),
    trecho_indice: txt(ia.trecho_indice, 300), trecho_pagamento: txt(ia.trecho_pagamento, 300),
    exequente: txt(ia.exequente, 200), executado: txt(ia.executado, 200), trecho_partes: txt(ia.trecho_partes, 300),
    lido_em: new Date().toISOString(),
  };

  const avisos = [];
  if (valorDoc && valorCad && Math.abs(valorDoc - valorCad) > 1) avisos.push(`Valor no documento (${valorDoc.toLocaleString('pt-BR')}) difere do cadastro (${valorCad.toLocaleString('pt-BR')}) — o cronograma usa o do cadastro.`);
  const dataDoc = dataOk(ia.data_arrematacao);
  if (dataDoc && arr.data_arrematacao && dataDoc !== String(arr.data_arrematacao).slice(0, 10)) avisos.push(`Data da arrematação no documento (${dataDoc}) difere do cadastro (${arr.data_arrematacao}).`);
  if (!novo.indice) avisos.push('O documento não menciona índice de correção — confirme no edital ou com o jurídico.');
  if (num(ia.valor_parcela) && forma === 'parcelado' && valorCad) {
    const calc = (valorCad * (1 - novo.entrada_pct / 100)) / novo.parcelas;
    if (Math.abs(calc - ia.valor_parcela) / ia.valor_parcela > 0.02) avisos.push(`Parcela no documento R$ ${ia.valor_parcela.toLocaleString('pt-BR')} × calculada R$ ${calc.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} — confira entrada e nº de parcelas.`);
  }

  // Grava como o PRÓPRIO usuário (a RPC confere a permissão e carimba atualizado_por).
  const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
  const g = await fetch(`${SUPABASE_URL}/rest/v1/rpc/salvar_parcelamento_arremate`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_arrematado: arr.id, p_parcelamento: novo }),
    signal: AbortSignal.timeout(10000),
  });
  if (!g.ok) {
    const corpo = await g.text().catch(() => '');
    console.error('[ler-condicoes-arremate] gravar:', g.status, corpo.slice(0, 200));
    res.status(502).json({ error: `Li o documento mas não consegui gravar: ${corpo.slice(0, 160) || `HTTP ${g.status}`}`, lido: novo }); return;
  }
  const parcelamento = await g.json();
  res.status(200).json({ ok: true, parcelamento, avisos, falhas, documentos: lidos.map((l) => l.anexo.nome) });
}
