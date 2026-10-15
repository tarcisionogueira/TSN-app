/**
 * /api/caso-documentos-cron — a IA lê os anexos dos e-mails de cada caso e organiza (15/10, pedido do dono).
 *
 * "Separando os documentos pessoais e os documentos da arrematação; a IA deve ler os anexos para organizar."
 * Para cada anexo JÁ ARQUIVADO no nosso storage (email_caixa.anexos[i].arquivo, gravado pelo
 * arquivar-anexos-email-cron) de e-mail ligado a caso, ainda sem linha em caso_documentos: baixa o arquivo,
 * converte com o leitor do documental (_doc-blocos.js: PDF, foto, Word, ZIP) e pede à IA grupo (pessoal /
 * arrematação / outro), tipo, título, resumo, data e de quem é. Grava em caso_documentos apontando para o
 * MESMO arquivo (sem cópia).
 *
 * Arquivo que não abre ou passa do teto de tamanho é classificado só pelo NOME, com lido=false — nunca
 * some calado. Falha da IA não grava: o anexo volta na próxima rodada. `?seco=1` mostra sem gravar.
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { isCronAuthorized } from './_auth.js';
import { anthropicFetch } from './_claude.js';
import { blocosDoArquivo } from './_doc-blocos.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CLAUDE_KEY   = (process.env.CLAUDE_KEY || process.env.ANTHROPIC_API_KEY || '').trim();
const BASE         = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const hdr = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
const sb  = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...hdr, ...(opts.headers || {}) } });
const MAX_POR_RODADA = 8;
const MAX_BYTES = 12 * 1024 * 1024; // acima disso, só pelo nome (PDF de edital com centenas de páginas)
const RE_IMAGEM_DE_ASSINATURA = /^image\d*\.(png|jpe?g|gif)$/i;
const GRUPOS = ['pessoal', 'arrematacao', 'outro'];

async function ler(path) {
  const r = await sb(path);
  if (!r.ok) throw new Error(`leitura ${path.split('?')[0]} HTTP ${r.status}`);
  return r.json();
}

const SISTEMA = `Você organiza a pasta de um cliente que arrematou um imóvel em leilão. Recebe UM documento (anexo de e-mail) e o contexto do caso. Classifique e responda SOMENTE com JSON válido:
{"grupo":"pessoal|arrematacao|outro","tipo":"rg|cnh|cpf|comprovante_residencia|certidao_casamento|certidao_nascimento|procuracao|edital|matricula|auto_arrematacao|carta_arrematacao|guia_deposito|itbi|iptu|decisao_judicial|exigencia_cartorio|notificacao|comprovante_pagamento|parecer_juridico|laudo|contrato|outro","titulo":"nome curto e claro do documento","resumo":"1-2 frases com o que o documento diz de relevante","data_documento":"AAAA-MM-DD ou null","pessoa":"nome da pessoa a quem o documento pessoal pertence, ou null"}
Regras: "pessoal" = documento de identificação ou da vida civil/endereço/renda de uma pessoa (RG, CNH, CPF, certidões, comprovante de residência). "arrematacao" = tudo do imóvel, do leilão, do processo, do cartório, de impostos e pagamentos da operação (procuração para a operação também é arrematação). "outro" = assinatura de e-mail, logo, imagem sem conteúdo. Nunca invente dados; o que não estiver no documento fica null.`;

function lerJSON(txt) {
  const ini = txt.indexOf('{'), fim = txt.lastIndexOf('}');
  if (ini < 0 || fim < 0) return null;
  try { return JSON.parse(txt.slice(ini, fim + 1)); } catch { return null; }
}

async function classificar(blocos, { nome, contexto }) {
  if (!CLAUDE_KEY) return null;
  const content = [...blocos, { type: 'text', text: `Arquivo: ${nome}\nContexto do caso: ${contexto}\nClassifique este documento.` }];
  const r = await anthropicFetch({
    method: 'POST',
    headers: { 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 600, system: SISTEMA, messages: [{ role: 'user', content }] }),
  }, { retries: 2, timeoutMs: 90000 });
  // anthropicFetch devolve o Response não-ok sem lançar: sem checar, um 429 viraria "sem classificação".
  if (!r.ok) { console.error(`[caso-documentos] IA HTTP ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`); return null; }
  const d = await r.json();
  const txt = (d?.content || []).filter((b) => b?.type === 'text').map((b) => b.text).join('');
  return lerJSON(txt);
}

async function handler(req) {
  if (!isCronAuthorized(req)) return new Response(JSON.stringify({ error: 'não autorizado' }), { status: 401 });
  const seco = new URL(req.url, BASE).searchParams.get('seco') === '1';
  const res = { seco, classificados: 0, so_pelo_nome: 0, falhas: 0, pendentes: 0, itens: [] };
  try {
    // E-mails ligados a caso com algum anexo arquivado (os mais recentes primeiro).
    const msgs = await ler('email_caixa?caso_id=not.is.null&anexos=neq.[]&pasta=neq.spam&select=id,caso_id,anexos,assunto&order=criado_em.desc&limit=200');
    const candidatos = [];
    for (const m of msgs) (m.anexos || []).forEach((a, idx) => {
      if (a?.arquivo && !RE_IMAGEM_DE_ASSINATURA.test(a?.nome || '')) candidatos.push({ m, a, idx });
    });
    const paths = [...new Set(candidatos.map((c) => c.a.arquivo))];
    const feitos = new Set();
    for (let i = 0; i < paths.length; i += 50) {
      const lote = paths.slice(i, i + 50).map((p) => `"${p.replace(/"/g, '')}"`).join(',');
      for (const f of await ler(`caso_documentos?storage_path=in.(${lote})&select=storage_path`)) feitos.add(f.storage_path);
    }
    const fila = [];
    const vistos = new Set();
    for (const c of candidatos) if (!feitos.has(c.a.arquivo) && !vistos.has(c.a.arquivo)) { vistos.add(c.a.arquivo); fila.push(c); }
    res.pendentes = Math.max(0, fila.length - MAX_POR_RODADA);

    const contextos = new Map();
    for (const { m, a, idx } of fila.slice(0, MAX_POR_RODADA)) {
      if (!contextos.has(m.caso_id)) {
        const [c] = await ler(`casos?id=eq.${m.caso_id}&select=imovel_endereco,cliente_id`);
        const [cli] = c ? await ler(`perfis?id=eq.${c.cliente_id}&select=nome`) : [null];
        contextos.set(m.caso_id, `cliente ${cli?.nome || '?'}; imóvel ${c?.imovel_endereco || '?'}; e-mail "${m.assunto || ''}"`);
      }
      let blocos = [];
      let lido = true;
      const tam = Number(a.tamanho) || 0;
      if (tam > MAX_BYTES) lido = false;
      else {
        const r = await fetch(`${SUPABASE_URL}/storage/v1/object/documentos/${a.arquivo}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
        if (!r.ok) { res.falhas++; res.itens.push({ nome: a.nome, erro: `storage HTTP ${r.status}` }); continue; }
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > MAX_BYTES) lido = false;
        else {
          const lidoArq = await blocosDoArquivo(buf, { nome: a.nome, contentType: a.content_type || '' });
          blocos = lidoArq.blocos;
          if (!blocos.length) { lido = false; console.warn(`[caso-documentos] ${a.nome}: ${lidoArq.falhas.join('; ')}`); }
        }
      }
      const cl = await classificar(blocos, { nome: a.nome, contexto: contextos.get(m.caso_id) });
      if (!cl) { res.falhas++; res.itens.push({ nome: a.nome, erro: 'IA indisponível ou fora do formato' }); continue; }
      const linha = {
        caso_id: m.caso_id, email_id: m.id, anexo_idx: idx, nome: a.nome, storage_path: a.arquivo,
        grupo: GRUPOS.includes(cl.grupo) ? cl.grupo : 'outro', tipo: cl.tipo || null,
        titulo: cl.titulo || a.nome, resumo: cl.resumo || null,
        data_documento: /^\d{4}-\d{2}-\d{2}$/.test(cl.data_documento || '') ? cl.data_documento : null,
        pessoa: cl.pessoa || null, lido, provedor: 'claude-haiku-4-5',
      };
      res.itens.push({ nome: a.nome, grupo: linha.grupo, tipo: linha.tipo, titulo: linha.titulo, lido });
      if (!lido) res.so_pelo_nome++;
      if (seco) continue;
      const ins = await sb('caso_documentos?on_conflict=storage_path', { method: 'POST', headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' }, body: JSON.stringify(linha) });
      if (!ins.ok) { res.falhas++; console.error(`[caso-documentos] gravar ${a.nome}: HTTP ${ins.status} ${(await ins.text().catch(() => '')).slice(0, 200)}`); continue; }
      res.classificados++;
    }
  } catch (e) {
    console.error('[caso-documentos] falhou:', e?.message);
    return new Response(JSON.stringify({ ok: false, erro: e?.message, ...res }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  console.log('[caso-documentos]', JSON.stringify({ classificados: res.classificados, falhas: res.falhas, pendentes: res.pendentes }));
  return new Response(JSON.stringify({ ok: true, ...res }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export const GET = handler;
export const POST = handler;
