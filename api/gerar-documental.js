// Geração da ANÁLISE DOCUMENTAL + PROCESSO NO SERVIDOR (persistente).
// Lê edital, matrícula e demais anexos do lote (via Bright Data quando o host
// bloqueia o servidor), extrai ônus/gravames/débitos/ocupação e CONSULTA o CNJ.
// O cliente dispara e pode FECHAR a aba: a função Vercel continua e grava em
// `analises_documental`. Espelha a mecânica de gerar-analise.js (mercadológico).
//
// ESCOPO: documental/jurídico (leitura dos documentos + processo). A viabilidade
// financeira e o mercado ficam no relatório MERCADOLÓGICO (gerar-analise.js).
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { getUser } from './_auth.js';
import { fetchViaBrightData } from './_brightdata.js';
import { capturarDocsLoginOnDemand, temLoginParaFonte } from './_leiloeiro-auth.js';
import { anthropicFetch } from './_claude.js';
import { custoRespostaClaude } from './_uso.js';
import { buscarProcessosCNJ } from './_cnj.js';
import { aprenderNaEmissao, vicioRegen } from './_aprendizado.js';
import { consultarComunicaDJEN, consultarCNDT, consultarCNIB, consultarProtestos } from './_laudo-fontes.js';
import { consultarCertidoesFiscais } from './_certidoes-fontes.js';
import { geocodificarCascata, coordValida, rankNivel } from './_geo.js';
import { urlDocumento } from './_storage.js';
import { hostExternoSeguro } from './_allowed-hosts.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CLAUDE_KEY   = process.env.CLAUDE_KEY;
const MODEL = 'claude-sonnet-4-6';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Custo REAL (micro-USD) acumulado da geração ATUAL (Node serverless = 1 req/instância →
// seguro resetar por request). Usado p/ cobrar CRÉDITO quando a cota mensal do plano acaba.
let _custoMicroReq = 0;

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}
// O agente que aprende com os relatórios SINALIZA anomalias (ex.: CNJ sem retorno) para a
// verificação de saúde — sem custo, sem gerar relatório. Idempotente por (tipo, imóvel).
async function registrarAnomalia(tipo, fonte, imovelId, campo, detalhe) {
  try {
    await sb('rpc/registrar_anomalia_relatorio', {
      method: 'POST',
      body: JSON.stringify({ p_tipo: tipo, p_fonte: fonte || '', p_imovel_id: String(imovelId || ''), p_campo: campo || '', p_detalhe: detalhe || '' }),
    });
  } catch { /* nunca bloqueia o relatório */ }
}
async function upsertDoc(row) {
  await sb('analises_documental?on_conflict=user_id,imovel_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
  });
}

// ── Cache de documentos no bucket privado `documentos` ──────────────────────
// O servidor recebe 403 nos PDFs da Caixa (IP de datacenter) e cai no Bright Data
// (IP residencial), que tem TETO SEMANAL. Cachear o PDF baixado evita re-baixar
// nas re-gerações e no laudo de viabilidade — economiza Bright Data. A retenção
// (5d sem reunião / 30d com reunião / permanente se arrematou) é do cron.
const BUCKET = 'documentos';
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s || '');
function storage(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/storage/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, ...(opts.headers || {}) },
  });
}
// matrícula resiliente ao rótulo cru do scraper: forma correta, ACENTUADA-QUEBRADA
// por charset (mojibake "matrãâ­cula" com soft-hyphen), SEM acento colada ("matrcula")
// e ABREVIADA ("matr-15964"). O SUPERBID gravava a matrícula como anexo genérico —
// sem isto ela caía para o fim da fila de leitura (prioridade de 'anexo') e o GATE
// dizia "matrícula faltando" mesmo com o PDF já no nosso acervo.
const RE_MATRICULA_ROTULO = /matr[a-zà-ÿ­]{0,4}cula|\bmatr[\s._:­-]+\d{2,}/i;
function tipoDoRotulo(rotulo) {
  const r = String(rotulo || '').toLowerCase();
  const ehMatricula = RE_MATRICULA_ROTULO.test(r);
  if (ehMatricula && r.includes('registr')) return 'matricula_registrada';
  if (ehMatricula) return 'matricula';
  if (r.includes('edital')) return 'edital';
  if (r.includes('regras')) return 'regras_venda';
  if (r.includes('carta') && r.includes('arremat')) return 'carta_arrematacao';
  if (r.includes('auto') && r.includes('arremat')) return 'auto_arrematacao';
  if (r.includes('contrato') && (r.includes('banc') || r.includes('financ') || r.includes('caixa') || r.includes('cef'))) return 'contrato_banco';
  if (r.includes('escritura') || r.includes('lavratura')) return 'escritura';
  return null; // anexos genéricos não entram no cache por tipo
}
// Documentos já ARMAZENADOS deste imóvel (manual do analista ou cache anterior).
async function mapaCache(imovelId) {
  try {
    const rows = await (await sb(`imovel_anexos?imovel_id=eq.${encodeURIComponent(imovelId)}&storage_path=not.is.null&select=tipo,storage_path&limit=10`)).json();
    const m = {};
    for (const x of (Array.isArray(rows) ? rows : [])) if (x?.tipo && !m[x.tipo]) m[x.tipo] = x;
    return m;
  } catch { return {}; }
}
async function lerDocDoBucket(storagePath) {
  try {
    const sign = await storage(`object/sign/${BUCKET}/${storagePath}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 600 }),
    });
    if (!sign.ok) return null;
    const { signedURL } = await sign.json().catch(() => ({}));
    if (!signedURL) return null;
    const r = await fetch(`${SUPABASE_URL}/storage/v1${signedURL}`, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) return null;
    return { kind: 'pdf', base64: buf.toString('base64') };
  } catch { return null; }
}
// Salva o PDF baixado no bucket (só se AINDA não houver doc armazenado do tipo —
// nunca sobrescreve um upload manual do analista). Best-effort: nunca trava o laudo.
async function salvarDocBucket(imovelId, tipo, rotulo, origemUrl, base64, dataLeilaoIso) {
  try {
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length || buffer.length > 20 * 1024 * 1024) return;
    const storagePath = `casos/${imovelId}/${Date.now()}_${tipo}.pdf`;
    const up = await storage(`object/${BUCKET}/${storagePath}`, {
      method: 'POST', headers: { 'Content-Type': 'application/pdf', 'x-upsert': 'true' }, body: buffer,
    });
    if (!up.ok) return;
    let url = '';
    try {
      const s = await storage(`object/sign/${BUCKET}/${storagePath}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 3600 }) });
      if (s.ok) { const { signedURL } = await s.json().catch(() => ({})); if (signedURL) url = `${SUPABASE_URL}/storage/v1${signedURL}`; }
    } catch { /* url fica '' — os leitores assinam sob demanda pelo storage_path */ }
    const payload = {
      imovel_id: imovelId, tipo, nome: `${rotulo}.pdf`.replace(/[^a-zA-Z0-9._-]/g, '_'),
      url, storage_path: storagePath, origem_url: origemUrl || null,
      data_leilao: dataLeilaoIso ? String(dataLeilaoIso).slice(0, 10) : null,
      arrematado: false, tamanho_kb: Math.round(buffer.length / 1024),
    };
    await sb('imovel_anexos', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(payload) });
  } catch { /* cache best-effort */ }
}

// Valida o nº de processo no padrão CNJ pelo DÍGITO VERIFICADOR (Res. CNJ 65/2008,
// mód-97 ISO 7064). Anti-golpe: número forjado/digitado errado quase nunca fecha o DV.
function cnjValido(numero) {
  const d = String(numero || '').replace(/\D/g, '');
  if (d.length !== 20) return false;
  try {
    const base = BigInt(d.slice(0, 7) + d.slice(9, 13) + d.slice(13, 20) + '00');
    return (98n - (base % 97n)) === BigInt(d.slice(7, 9));
  } catch { return false; }
}

// HTML → texto puro (sem <script>/<style>/tags): retrato SEGURO do que o portal
// público devolveu, para embutir no comprovante sem executar nada.
function textoDeHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ').trim();
}
const escHtml = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Salva o COMPROVANTE de uma consulta pública e devolve uma URL assinada. ANTES
// guardávamos o HTML CRU do portal (SPA/JSF com captcha) e o front injetava um <base>
// no domínio do órgão para renderizar — o que fazia o portal RE-HIDRATAR AO VIVO e
// mostrar a TELA DE DIGITAÇÃO em vez da prova. Agora geramos um comprovante PRÓPRIO da
// BidPro: página estática, SEM script e SEM <base>, com o RESULTADO da consulta + um
// retrato em texto do retorno do portal (transparência). meta = { chave, titulo,
// portalUrl }; fonte = objeto da consulta (resumo/dados/comprovanteHtml).
async function salvarComprovante(imovelId, meta, fonte) {
  try {
    const capturado = textoDeHtml(fonte?.comprovanteHtml || '').slice(0, 6000);
    if (capturado.length < 40) return null; // shell vazio → nada a comprovar
    const quando = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const resumo = fonte?.resumo || fonte?.situacao || 'Consulta realizada';
    const alerta = /⚠️|positiv|encontrad|possui|constam?\b|indisponibil|protestad|d[ée]bito/i.test(resumo) && !/sem\s|nada\s+consta|n[ãa]o\s|negativa/i.test(resumo);
    const cor = alerta ? '#b91c1c' : '#047857';
    const titulo = meta?.titulo || 'Consulta pública';
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Comprovante — ${escHtml(titulo)}</title></head>`
      + `<body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f1f5f9;color:#0f172a;"><div style="max-width:760px;margin:0 auto;padding:24px;">`
      + `<div style="background:#0f2f6b;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;"><div style="font-size:12px;opacity:.85;letter-spacing:.5px;">BIDPRO BRASIL · COMPROVANTE DE CONSULTA</div><div style="font-size:19px;font-weight:800;margin-top:2px;">${escHtml(titulo)}</div></div>`
      + `<div style="background:#fff;padding:20px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;">`
      + `<div style="font-size:15px;font-weight:800;color:${cor};">${escHtml(resumo)}</div>`
      + `<div style="font-size:12.5px;color:#64748b;margin-top:6px;">Consulta automática realizada pela plataforma em ${escHtml(quando)} (horário de Brasília).</div>`
      + `<div style="margin:16px 0;height:1px;background:#e2e8f0;"></div>`
      + `<details><summary style="cursor:pointer;font-size:12.5px;font-weight:700;color:#334155;">Ver o retorno do portal público (transparência)</summary>`
      + `<pre style="white-space:pre-wrap;word-break:break-word;font-size:11px;color:#475569;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-top:10px;max-height:360px;overflow:auto;">${escHtml(capturado)}</pre></details>`
      + (meta?.portalUrl ? `<div style="font-size:11.5px;color:#94a3b8;margin-top:16px;">Para emitir a certidão OFICIAL (com validade jurídica; exige o preenchimento e o captcha do próprio órgão), acesse o portal público: <a href="${escHtml(meta.portalUrl)}" target="_blank" rel="noopener noreferrer" style="color:#1e40af;">${escHtml(meta.portalUrl)}</a></div>` : '')
      + `</div><div style="text-align:center;font-size:10.5px;color:#94a3b8;margin-top:14px;">Documento gerado automaticamente pela BidPro Brasil. Não substitui a certidão oficial do órgão.</div>`
      + `</div></body></html>`;
    const buffer = Buffer.from(html.slice(0, 2_000_000), 'utf8');
    const storagePath = `comprovantes/${imovelId}/${Date.now()}_${String(meta?.chave || 'fonte').replace(/[^a-z0-9]/gi, '')}.html`;
    const up = await storage(`object/${BUCKET}/${storagePath}`, { method: 'POST', headers: { 'Content-Type': 'text/html; charset=utf-8', 'x-upsert': 'true' }, body: buffer });
    if (!up.ok) return null;
    const sg = await storage(`object/sign/${BUCKET}/${storagePath}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 60 * 60 * 24 * 180 }) });
    if (!sg.ok) return null;
    const { signedURL } = await sg.json().catch(() => ({}));
    return signedURL ? `${SUPABASE_URL}/storage/v1${signedURL}` : null;
  } catch { return null; }
}

function extractText(data) {
  if (!data?.content) return '';
  return data.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
}
// Fecha strings/colchetes/chaves abertos e limpa tokens pendentes no fim de um
// JSON TRUNCADO. Crucial no documental: a resposta longa da IA às vezes estoura o
// max_tokens e vem cortada; sem isto, o JSON incompleto era descartado (parsed={})
// e o laudo REAL era perdido, caindo no texto "preliminar". Aqui recuperamos o
// parecer e todos os campos que já haviam sido emitidos antes do corte.
function fecharJSONtruncado(frag) {
  let out = frag, inStr = false, esc = false;
  const st = [];
  for (let k = 0; k < out.length; k++) {
    const ch = out[k];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') st.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') st.pop();
  }
  if (inStr) out += '"';                 // fecha string aberta
  out = out.replace(/\\+$/, '');         // barra de escape solta
  out = out.replace(/[\s,]+$/, '');      // vírgula/espaço pendente
  out = out.replace(/:\s*$/, ': null');  // "campo": <sem valor>
  out = out.replace(/,\s*"[^"]*"\s*$/, ''); // ,"chaveIncompleta
  out = out.replace(/[\s,]+$/, '');
  while (st.length) out += st.pop();     // fecha ] e }
  return out;
}
function parseJSON(text) {
  if (!text) return null;
  const clean = text.trim();
  try { return JSON.parse(clean); } catch {}
  const md = clean.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (md) { try { return JSON.parse(md[1].trim()); } catch {} }
  const obj = clean.match(/\{[\s\S]*\}/);
  if (obj) { try { return JSON.parse(obj[0]); } catch {} }
  // Recuperação de JSON truncado (resposta cortada no max_tokens).
  const i = clean.indexOf('{');
  if (i >= 0) {
    const s = clean.slice(i).replace(/```/g, '');
    try { return JSON.parse(fecharJSONtruncado(s)); } catch {}
    for (const m of ['"', '}', ']']) {
      const p = s.lastIndexOf(m);
      if (p > 0) { try { return JSON.parse(fecharJSONtruncado(s.slice(0, p + 1))); } catch {} }
    }
  }
  return null;
}
async function anthropic(payload, fetchOpts) {
  const headers = { 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
  const r = await anthropicFetch({ method: 'POST', headers, body: JSON.stringify(payload) }, fetchOpts);
  // FALHA-ALTO: erro NÃO-retryável do Anthropic (400/401/404/beta) não pode virar {} silencioso
  // (parse do corpo de erro → laudo documental "vazio/concluído"). Loga e propaga p/ o handler
  // gravar status=erro e o self-heal (documental-retry-cron) re-tentar. Mesma correção da /analise.
  if (!r.ok) {
    let corpo = ''; try { corpo = JSON.stringify(await r.clone().json()); } catch { try { corpo = await r.text(); } catch { /* corpo indisponível */ } }
    console.error('[anthropic:documental] HTTP', r.status, String(corpo).slice(0, 600));
    throw new Error(`anthropic_http_${r.status}`);
  }
  const j = await r.json();
  try { _custoMicroReq += custoRespostaClaude(payload?.model, j?.usage); } catch { /* medição nunca quebra a geração */ }
  return j;
}

// Documentos ESTÁTICOS da Caixa (venda-imoveis.caixa.gov.br). O portal grava no
// banco links de página (matricula.asp / detalhe-imovel.asp) que NÃO são o arquivo
// — a matrícula e as regras reais são PDFs estáticos. Sem isto, imóvel da Caixa
// chegava à IA sem NENHUM documento legível → laudo bloqueado. O IP de datacenter
// recebe 403 nesses PDFs, mas o lerDoc cai no Bright Data (IP residencial) e lê.
const ehCaixa = (fonte) => /caixa|cef/i.test(fonte || '');
function caixaMatriculaUrl({ fonte, estado, fonteId } = {}) {
  if (!ehCaixa(fonte)) return null;
  const num = String(fonteId || '').replace(/\D/g, '');
  const uf = String(estado || '').trim().toUpperCase();
  if (!num || uf.length !== 2) return null;
  return `https://venda-imoveis.caixa.gov.br/editais/matricula/${uf}/${num}.pdf`;
}
function caixaRegrasVendaUrl({ fonte } = {}) {
  if (!ehCaixa(fonte)) return null;
  return 'https://venda-imoveis.caixa.gov.br/editais/regras-VOL/comocomprar.pdf';
}

// Dispara JÁ a Action de captura (em vez de esperar o cron de 10/15 min). Assim a
// captura por navegador roda em ~1 min e a próxima geração lê os documentos.
// Fire-and-forget: nunca bloqueia nem falha a resposta.
async function dispararCaptura(arquivoWorkflow) {
  const token = process.env.GITHUB_ACTIONS_TOKEN;
  if (!token) return false;
  try {
    const r = await fetch(`https://api.github.com/repos/tarcisionogueira/TSN-app/actions/workflows/${arquivoWorkflow}/dispatches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main' }),
    });
    return r.ok;
  } catch { return false; }
}

// Fetch com anti-SSRF em CADA salto de redirect: valida o host inicial E o de cada
// Location (redirect:'manual'), impedindo que uma URL "externa segura" redirecione
// para um endereço interno/metadados (169.254.169.254, localhost, rede interna).
async function fetchAntiSSRF(url, opts, maxHops = 3) {
  let atual = url;
  for (let i = 0; i <= maxHops; i++) {
    if (!hostExternoSeguro(atual)) return null;
    const resp = await fetch(atual, { ...opts, redirect: 'manual' });
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get('location');
      if (!loc) return resp; // sem Location legível → o chamador trata como falha (não-ok)
      try { atual = new URL(loc, atual).toString(); } catch { return null; }
      continue;
    }
    return resp;
  }
  return null; // excedeu o limite de saltos
}

// Lê um documento do lote: PDF → base64 (bloco document); HTML/texto → texto
// limpo. Tenta fetch direto e cai no Bright Data quando o host bloqueia o servidor.
async function lerDoc(url, deadline) {
  // Anti-SSRF: URLs de documento vêm do banco E do body do cliente (urlMatricula/
  // urlEdital/urlRegras) — bloqueia destinos internos/metadados, permite CDN público.
  if (!hostExternoSeguro(url) || Date.now() > deadline) return null;
  const h = { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'pt-BR,pt;q=0.9' };
  const ehPdfUrl = /\.pdf(\?|#|$)/i.test(url);

  // Extrai um documento útil de UMA resposta (fetch direto OU Bright Data). Só aceita
  // PDF de verdade quando a URL é .pdf — assim o HTML de negação da Caixa (200) NÃO
  // vira "texto lixo" que faz a IA dizer que não leu nada.
  const extrair = async (resp) => {
    if (!resp || !resp.ok) return null;
    const ct = resp.headers.get('content-type') || '';
    const buf = Buffer.from(await resp.arrayBuffer().catch(() => new ArrayBuffer(0)));
    if (!buf.length) return null;
    const ehPdf = /pdf/i.test(ct) || buf.slice(0, 5).toString('latin1') === '%PDF-';
    if (ehPdf) { if (buf.length > 6_500_000) return null; return { kind: 'pdf', base64: buf.toString('base64'), url }; }
    if (ehPdfUrl) return null; // .pdf que não veio PDF = bloqueio/HTML → falha desta tentativa
    const txt = buf.toString('utf8').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (txt.length < 80) return null;
    return { kind: 'text', text: txt.slice(0, 12000), url };
  };

  // 1) fetch direto (grátis). 2) Bright Data (IP residencial) — fura o 403 da Caixa
  // nos PDFs. Aceita o 1º que render um documento válido; para .pdf, o direto que
  // trouxer HTML de negação é descartado e o Bright Data assume.
  let doc = null;
  try { doc = await extrair(await fetchAntiSSRF(url, { headers: h, signal: AbortSignal.timeout(12000) })); } catch { doc = null; }
  if (doc) { console.log(`[lerDoc] direto OK (${doc.kind}) ${url}`); return doc; }
  if (Date.now() > deadline) return null;
  // Bright Data: manda cabeçalhos que a Caixa espera (senão devolve HTML de negação
  // em vez do PDF). Loga o status para diagnóstico (token x bloqueio da fonte).
  const ehCaixaUrl = /venda-imoveis\.caixa\.gov\.br/i.test(url);
  const bdHeaders = ehCaixaUrl
    ? { 'User-Agent': UA, Referer: 'https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp', Accept: 'application/pdf,application/octet-stream,*/*' }
    : { 'User-Agent': UA, Accept: '*/*' };
  try {
    const bd = await fetchViaBrightData(url, { headers: bdHeaders });
    if (bd) {
      const bdClone = bd.clone();
      console.log(`[lerDoc] brightdata resp status=${bd.status} ct=${bd.headers.get('content-type') || ''} ${url}`);
      doc = await extrair(bd);
      if (!doc) {
        const snippet = (await bdClone.text().catch(() => '')).slice(0, 300).replace(/\s+/g, ' ');
        console.log(`[lerDoc] brightdata body[0..300]: ${snippet}`);
      }
    } else console.log(`[lerDoc] brightdata indisponível (token/zone ausente ou teto) ${url}`);
  } catch (e) { console.warn(`[lerDoc] brightdata erro ${e?.message} ${url}`); doc = null; }
  console.log(`[lerDoc] brightdata ${doc ? 'OK ('+doc.kind+')' : 'FALHOU'} ${url}`);
  return doc;
}

const promptDocumental = (im, temProc) => `Você é advogado especialista em leilões de imóveis. Analise os DOCUMENTOS anexados (edital, matrícula e demais anexos do lote)${temProc ? ' e os PROCESSOS consultados no CNJ' : ''} e produza uma ANÁLISE DOCUMENTAL E JURÍDICA do imóvel:
- Tipo: ${im.tipo || 'imóvel'} — ${im.endereco || ''}, ${im.cidade || ''}/${im.estado || ''}
- Modalidade: ${im.modalidade || 'não informada'}

ESCOPO: leitura dos documentos e situação processual. NÃO faça análise de mercado/preço/viabilidade financeira (isso é do relatório MERCADOLÓGICO).

CRUZAMENTO DE DOCUMENTOS (assertividade — o objetivo é GARANTIR A SEGURANÇA DA ARREMATAÇÃO): use TODOS os documentos anexados EM CONJUNTO, nunca isoladamente. Analise CADA anexo individualmente e depois CRUZE as informações entre eles, apontando CONVERGÊNCIAS e DIVERGÊNCIAS relevantes (ex.: valor ou área do edital diferente da matrícula; ocupação declarada no edital que não bate com o registro; débito citado num documento e ausente no outro; parte/CPF do executado no auto de penhora diferente do proprietário da matrícula). Havendo divergência, indique qual fonte prevalece (em regra: a matrícula do cartório para a situação registrária; o edital para as condições da venda) e registre o conflito em "riscos" (severidade conforme as regras abaixo) e em "lacunas". Quanto mais documentos cruzados, mais assertivo o parecer.

LEILÃO JUDICIAL COM MÚLTIPLOS ANEXOS (análise apurada): no leilão judicial é comum haver, além da matrícula e do edital, vários anexos — auto/laudo de AVALIAÇÃO, auto de PENHORA, DECISÃO/despacho que designou a hasta, certidões (ônus, distribuidores, negativas), ata da praça anterior, matrícula atualizada e petições. LEIA e CRUZE todos os que estiverem anexados. Verifique especificamente, para dar segurança à arrematação: (a) se o EXECUTADO/proprietário é o mesmo em matrícula, penhora e edital; (b) se o BEM penhorado/avaliado é exatamente o mesmo imóvel da matrícula (número, área, confrontações); (c) se há recurso/embargos ou ação anulatória do próprio leilão pendente; (d) se a penhora e as indisponibilidades estão averbadas e serão levantadas com a carta de arrematação; (e) se o valor da avaliação e o lance mínimo do edital são coerentes com o auto de avaliação. Sinalize QUALQUER incoerência entre os anexos. A AUSÊNCIA de um anexo esperado é DILIGÊNCIA PENDENTE (lacuna), não um bloqueio.

LEILÃO EXTRAJUDICIAL (Lei 9.514/97, alienação fiduciária — típico Caixa/bancos): aqui NÃO há processo judicial prévio, então a segurança depende de verificar CONTESTAÇÕES do ex-mutuário e o estado dos gravames. Avalie e destaque, sempre em linguagem para leigos: (a) EX-MUTUÁRIO ACIONOU O BANCO/CREDOR? Verifique, pelo nome do ex-mutuário no CNJ (andamentos consultados), se há AÇÃO contra o credor fiduciário questionando a consolidação da propriedade ou o leilão — ação ANULATÓRIA/DECLARATÓRIA, REVISIONAL do contrato, CONSIGNAÇÃO em pagamento (tentativa de quitar a dívida) ou pedido de LIMINAR suspendendo a venda. Uma ação dessas EM CURSO, sobretudo com liminar, é risco relevante (a arrematação pode ser suspensa/anulada) — classifique conforme o risco concreto e explique o que significa. Se NÃO localizar ação, registre como diligência: "não localizamos ação do ex-mutuário contra o banco nas bases públicas, confirmar antes do lance". (b) OUTRAS PENHORAS/GRAVAMES na matrícula além da alienação fiduciária do leilão: há OUTRA penhora, arresto, indisponibilidade, hipoteca de terceiro ou usufruto? Para CADA uma, informe QUEM é o credor/beneficiário, se está ATIVA ou já baixada, e se será extinta com a arrematação ou se ACOMPANHA o imóvel (explique a diferença em palavras simples). (c) Prazos do ex-mutuário (purgação da mora / direito de preferência) e se já se esgotaram. Coloque cada verificação pendente em "lacunas" e cite na seção de situação registrária/processual do parecer.

NÃO CONFUNDA ITEM NORMAL DE LEILÃO COM IMPEDIMENTO: penhora/execução que originou a hasta, hipoteca, alienação fiduciária, indisponibilidades/bloqueios da execução e o status "ocupado" são ESPERADOS no leilão e a lei os resolve com a arrematação — NÃO os trate como impedimento à compra (siga as REGRAS ESTRITAS de classificação abaixo). O cruzamento serve para confirmar que esses itens se resolvem, não para reprovar a operação por causa deles. ATENÇÃO à diferença: a penhora/alienação que ORIGINOU o leilão se resolve; mas OUTRA penhora de credor diverso, ou uma AÇÃO do executado/ex-mutuário questionando o próprio leilão, NÃO são rotina — são pontos de atenção reais a destacar.

Avalie e descreva: ônus reais, gravames, hipotecas, penhoras, arrestos, indisponibilidades, usufruto, alienação fiduciária; ocupação (ocupado/desocupado/posseiro/locado) e quem responde pela desocupação; débitos discriminados (IPTU, condomínio, taxas) e DE QUEM é a responsabilidade após a arrematação (conforme o edital); condições do edital (forma de pagamento, prazos, comissão, AJG); restrições registrárias; e a situação do(s) processo(s).

REGISTRO DO IMÓVEL: extraia do CABEÇALHO da matrícula o CARTÓRIO/SERVENTIA de Registro de Imóveis (com o número do Ofício, ex.: "1º Ofício de Registro de Imóveis"), a COMARCA/município do registro e o número da MATRÍCULA. Esses dados constam no topo de toda matrícula. Preencha "cartorio", "comarca" e "numeroMatricula" em "extracao" quando constarem; se não houver matrícula legível, deixe vazio (não invente).

COERÊNCIA — MATRÍCULA LIDA vs. CERTIDÃO ATUALIZADA (leia com atenção, evita contradição no laudo): é MUITO comum o edital vir num PDF ÚNICO que reúne edital + auto de avaliação + a TRANSCRIÇÃO da matrícula + análise processual. Se você conseguiu extrair da matrícula a cadeia dominial e os registros/averbações (R-/Av-), ônus, gravames (hipoteca, alienação fiduciária, penhoras) — então você LEU a matrícula. NÃO escreva que "não foi possível ler a matrícula" ou que "há apenas os dados do edital" quando você acabou de listar os ônus e a cadeia dela: isso se contradiz com a própria análise. Marque "documentosAnalisados.matricula" = true nesse caso. A recomendação de obter a "certidão de ônus reais ATUALIZADA no CRI" é uma DILIGÊNCIA PADRÃO de pré-lance (confirmar averbações recentes posteriores à emissão do documento) e deve ser redigida assim — como um "a confirmar" normal, severidade "informativo"/"alerta" —, JAMAIS como falha de leitura ou motivo para laudo inconclusivo. Só afirme que a matrícula não foi lida quando REALMENTE não houver conteúdo registrário legível (nenhum R-/Av-, nenhum ônus, nenhuma cadeia).

IDENTIFICAÇÃO DO PROPRIETÁRIO/DEVEDOR (CRÍTICO — não podemos ERRAR a propriedade do imóvel executado; é o que dispara as consultas de certidões e é o núcleo do vício de propriedade): a matrícula SEMPRE qualifica as partes. VARRA a matrícula do FIM para o começo (do registro/averbação MAIS RECENTE para o mais antigo) e identifique quem é o PROPRIETÁRIO ATUAL / executado / ex-mutuário. EXTRAIA em "executadoNome" o nome e em "executadoDoc" o CPF/CNPJ (SÓ DÍGITOS) DESSA pessoa.
ATENÇÃO — NÃO CONFUNDA com a INCORPORADORA/CONSTRUTORA: em prédios/condomínios, a primeira proprietária que aparece na matrícula (registro R-1, quem INCORPOROU/CONSTRUIU o empreendimento, tipicamente uma "... INCORPORADORA", "... CONSTRUTORA", "... EMPREENDIMENTOS", "... SPE" com CNPJ) É a proprietária ORIGINÁRIA e quase NUNCA é o executado. O executado é o ADQUIRENTE (comprador da unidade, em regra pessoa física com CPF) cujo imóvel foi retomado. Só use a incorporadora/construtora se ela AINDA for, comprovadamente, a proprietária ATUAL (nenhuma venda posterior na cadeia). Na dúvida entre a construtora (R-1) e um adquirente posterior, PREFIRA o adquirente mais recente.
Em leilão EXTRAJUDICIAL da Caixa (alienação fiduciária, Lei 9.514), o executado é o EX-MUTUÁRIO/fiduciante (pessoa física, CPF) cujo imóvel foi consolidado em favor do credor — o CPF dele consta na qualificação do contrato/registro de alienação fiduciária. NÃO deixe "executadoDoc" vazio se houver o CPF/CNPJ do proprietário atual legível; só deixe vazio se realmente não constar. Se você tiver DÚVIDA sobre quem é o proprietário atual (cadeia ilegível/incompleta), registre isso como RISCO de "vício/incerteza de propriedade" (severidade "alerta") e como lacuna, em vez de chutar a incorporadora.

DADOS-CHAVE DA MATRÍCULA (quando constarem — preencha em "extracao"; se não constar, deixe vazio, NÃO invente):
- "dataConsolidacao": data da CONSOLIDAÇÃO DA PROPRIEDADE em nome do credor fiduciário (típico de alienação fiduciária/Lei 9.514, na averbação "Av-"), formato AAAA-MM-DD. É determinante para os prazos do ex-mutuário — capture se houver.
- "indisponibilidadePenhora": há INDISPONIBILIDADE, PENHORA, ARRESTO ou bloqueio ATIVO na matrícula? Responda "sim", "nao" ou "nao_consta".
- "condominioNome" e "condominioCnpj": nome do condomínio e CNPJ, se o imóvel for em condomínio (útil para levantar o débito condominial).
- ÁREA (METRAGEM) — base do valor de mercado, extraia com atenção da MATRÍCULA (fonte de verdade) e confira com o edital/laudo:
  • "areaPrivativaM2": ÁREA PRIVATIVA (apartamento/flat/sala) ou ÁREA CONSTRUÍDA (casa), em m², SÓ O NÚMERO. A matrícula descreve o imóvel com essa área ("área privativa de X m²", "área real privativa", "área construída de Y m²"). É a base da avaliação mercadológica. NÃO confunda com a área TOTAL (privativa + comum) nem com a área do TERRENO/lote/fração ideal — usar a total infla o valor por m². Se o edital divergir da matrícula, PREVALECE a matrícula.
  • "areaTotalM2": área total (privativa + comum), se constar. "areaTerrenoM2": área do terreno/lote (o terreno em si, não a fração ideal), se constar. Terreno excedente pode agregar valor, mas é modelado à parte, nunca multiplicando o R$/m² pela área total.
  • Se a área não constar de forma legível, deixe 0 — NÃO invente.

CUSTOS DO EDITAL (importantes p/ a projeção financeira): capture a comissão do leiloeiro e, SE HOUVER, a TAXA ADMINISTRATIVA do leilão/portal (percentual sobre a arrematação, ALÉM da comissão do leiloeiro — comum na Superbid) em "taxaAdministrativaPercentual", e eventuais DESPESAS ADMINISTRATIVAS de valor fixo em "despesasAdministrativas". Se o edital não mencionar, deixe 0.

REGRA IMPORTANTE: se algum dado (ex.: débitos, ônus, ocupação) NÃO estiver discriminado nos documentos disponíveis, NÃO invente — sinalize como "não consta na documentação analisada" e indique ONDE confirmar (certidão de débitos na Prefeitura; declaração de débitos com a administradora/síndico; matrícula atualizada no Cartório de Registro de Imóveis; cláusulas do edital; SPU para laudêmio/foro).

CLASSIFICAÇÃO DE RISCO — REGRAS ESTRITAS (evite alarmismo; leilão de imóvel tem particularidades legais que o comprador leigo desconhece):
- AUSÊNCIA DE INFORMAÇÃO NÃO É RISCO BLOQUEANTE. Quando um dado não consta nos documentos, é DILIGÊNCIA PENDENTE — severidade "informativo" (no máximo "alerta"), NUNCA "bloqueante". Falta de documento é "a confirmar", não "operação inviável".
- ITENS COMUNS E ESPERADOS EM LEILÃO, que a LEI resolve e NÃO impedem a arrematação (classifique "informativo" ou "alerta", sempre com a nota legal — jamais "bloqueante"):
  • Penhora/execução que originou o leilão: é o que levou o bem à hasta; baixada com a arrematação.
  • Hipoteca: EXTINGUE-SE com a arrematação (art. 1.499, VI, CC; art. 903 CPC) — o arrematante recebe livre do gravame.
  • Indisponibilidades/bloqueios da execução (BACENJUD/RENAJUD/CNIB): levantados na expedição da carta de arrematação.
  • Ocupação (devedor/terceiro): o juízo garante a IMISSÃO DE POSSE ao arrematante no leilão judicial — é questão de PRAZO e CUSTO, não impedimento.
- "BLOQUEANTE" é reservado a RISCO CONCRETO E COMPROVADO nos documentos que realmente inviabiliza: cláusula real de inalienabilidade, indisponibilidade que NÃO se resolve com a arrematação, ação anulatória do próprio leilão em curso, vício grave no edital, bem de família com impedimento específico. NA DÚVIDA, use "alerta", não "bloqueante".
- Se NÃO houver documento legível, NÃO produza um laudo marcando tudo como "não consta/bloqueante" — apenas registre que os documentos precisam ser obtidos (nível de risco "amarelo", não "vermelho").

VALORES A LEVANTAR (OBRIGATÓRIO sinalizar como pendência/diligência quando não vierem discriminados em R$ nos documentos):
- LAUDÊMIO E FORO/PENSÃO: se a matrícula/edital indicar imóvel FOREIRO, AFORADO, terreno de MARINHA ou da UNIÃO/SPU, avise que há laudêmio (≈5%) e foro a pagar e que o VALOR PRECISA SER LEVANTADO na SPU/SPUnet antes do lance.
- DÉBITOS CONDOMINIAIS: se houver condomínio e o valor do débito não estiver discriminado, avise que o débito condominial precisa ser levantado com a administradora/síndico (pode ser propter rem — acompanha o imóvel).
- IPTU/TAXAS: se o IPTU/taxas em aberto não estiverem discriminados, avise que precisam ser levantados na Prefeitura.
Coloque cada um desses como item em "lacunas" e cite na seção DÉBITOS E RESPONSABILIDADES do parecer.

OCUPAÇÃO POR PESSOA VULNERÁVEL (risco de desocupação — avaliar SEMPRE, em TODO imóvel, independentemente do status de ocupação declarado, e com atenção redobrada em leilão EXTRAJUDICIAL da Lei 9.514/97, onde não há processo judicial prévio):
- O status "ocupado/desocupado" do edital NÃO é confiável: é comum o imóvel dito "desocupado" ter moradores e o dito "ocupado" estar vazio. Portanto NUNCA descarte o risco de vulnerabilidade só porque o edital diz "desocupado" — a verificação em campo é indispensável em qualquer caso.
- A presença de IDOSO (Estatuto do Idoso, Lei 10.741/03), PESSOA COM DEFICIÊNCIA, CRIANÇA/ADOLESCENTE ou pessoa em vulnerabilidade social no imóvel é o principal fator de RESISTÊNCIA e ATRASO na imissão de posse/desocupação (liminares humanitárias, atuação do Ministério Público/Defensoria, repercussão social). Classifique como "alerta" (é questão de prazo/custo/estratégia, NUNCA "bloqueante").
- NÃO é possível — nem lícito — confirmar isso remotamente por dados de saúde: o cadastro do SUS/CNS é DADO PESSOAL SENSÍVEL protegido pela LGPD (art. 11), de acesso restrito ao sistema de saúde. NÃO afirme ter consultado essa base, NÃO invente idade/condição do ocupante.
- Em TODO imóvel, registre em "riscos" o item de possível vulnerabilidade na ocupação (severidade "alerta") e recomende as diligências LÍCITAS de verificação: (a) consulta processual pública — se for leilão JUDICIAL, checar no processo o marcador de PRIORIDADE DE TRAMITAÇÃO (idoso/PcD/doença grave), que é público; (b) visita ao imóvel e diligência de vizinhança (imprescindível — o status do edital não substitui); (c) leitura atenta do edital/auto de constatação, que às vezes descreve os ocupantes. Cite isso na seção OCUPAÇÃO E POSSE do parecer.

RAIO-X JURÍDICO (preencha o objeto "raioX" a partir da matrícula, do edital e do CNJ. Quando um item NÃO constar nos documentos, deixe vazio/zero — NÃO invente):
1) CADEIA DOMINIAL: sequência de proprietários e atos da matrícula (registros "R-" e averbações "Av-"), com data e evento (compra e venda, doação, penhora, baixa de ônus...). Do mais recente ao mais antigo, no máximo 10.
2) CERTIDÕES RECOMENDADAS: as que o arrematante deve obter antes do lance, com órgão e por quê (ônus reais atualizada no CRI; distribuidores cível/trabalhista/federal do executado p/ checar fraude à execução; CND de IPTU; declaração de débitos do condomínio). "online": true quando é emitida grátis pela internet.
3) FRAUDE À EXECUÇÃO/CONTRA CREDORES: cruzando o executado com o CNJ, o risco de a arrematação ser anulada (transmissão do bem após o início da ação; outras execuções contra o devedor). risco "nenhum|baixo|medio|alto" + motivo curto.
4) OCUPAÇÃO DETALHADA: tipo, direitos do ocupante (ex.: locatário com preferência), procedimento e prazo/custo estimado de desocupação.
5) DIREITO DE PREFERÊNCIA/ADJUDICAÇÃO DE TERCEIROS: condômino, locatário, credor hipotecário/fiduciário, confrontante (rural). Liste os titulares.
6) DÉBITOS PROPTER REM × PESSOAIS: separe o que ACOMPANHA o imóvel (IPTU, condomínio, taxas) do que é pessoal do devedor. Estime o total que o ARREMATANTE assume em R$; se não der, marque aLevantar=true.
7) CRONOGRAMA DO LEILÃO: 1ª e 2ª praça, prazo de pagamento e prazo de embargos/recursos, conforme o edital.

Retorne APENAS este JSON (sem markdown). IMPORTANTE: emita os campos NA ORDEM ABAIXO — "extracao", "parecer" e "riscos" são os mais importantes e vêm PRIMEIRO; o "raioX" (enriquecimento) vem por último. Seja objetivo para o JSON caber na resposta:
{
  "extracao": { "numeroMatricula": "", "cartorio": "(nome do Cartório/Serventia de Registro de Imóveis onde a matrícula está registrada — inclua o Ofício, ex.: '2º Ofício de Registro de Imóveis'; extraia do CABEÇALHO da matrícula, se constar)", "comarca": "(comarca/município do registro de imóveis, do cabeçalho da matrícula, se constar)", "areaPrivativaM2": 0, "areaTotalM2": 0, "areaTerrenoM2": 0, "numeroEdital": "", "numeroProcesso": "(número do processo judicial no padrão CNJ, se constar no EDITAL ou na matrícula/averbações — extraia do texto; senão vazio)", "executadoNome": "(nome do executado/devedor/ex-mutuário/proprietário atual — varra a matrícula e o edital; preencha sempre que houver)", "executadoDoc": "(CPF ou CNPJ do executado/devedor/ex-mutuário/proprietário, SÓ dígitos — extraia da qualificação nos registros da matrícula; preencha sempre que houver qualquer um legível)", "dataConsolidacao": "(AAAA-MM-DD da consolidação da propriedade pelo credor fiduciário, se constar; senão vazio)", "indisponibilidadePenhora": "sim|nao|nao_consta", "condominioNome": "", "condominioCnpj": "", "enderecoImovel": "(logradouro e NÚMERO do imóvel objeto da matrícula, ex.: 'Rua das Flores, 123' ou 'Avenida Brasil, 456, apto 72'; a matrícula SEMPRE descreve o imóvel com o endereço completo — extraia da descrição do imóvel; inclua o número quando constar; se não houver número, traga o logradouro; NÃO invente)", "bairroImovel": "(bairro do imóvel, se constar)", "municipioImovel": "(município/CIDADE onde o IMÓVEL está localizado, conforme a DESCRIÇÃO DO IMÓVEL na matrícula — é a cidade do imóvel, NÃO a comarca do registro nem o endereço de qualquer pessoa; extraia com atenção; senão vazio)", "ufImovel": "(UF do imóvel, 2 letras maiúsculas, se constar)", "cepImovel": "(CEP do imóvel, só dígitos, se constar)", "origem": "judicial|extrajudicial", "dataLeilao": "AAAA-MM-DD (data do leilão/praça OU prazo final das propostas na licitação/venda — o que constar no edital; senão vazio)", "ocupacao": "", "responsavelDesocupacao": "", "debitosDiscriminados": [{"tipo":"","valor":0,"responsavel":"","constaNaDoc":true}], "responsabilidadeDebitos": "", "formaPagamento": "", "comissaoLeiloeiro": "", "taxaAdministrativaPercentual": 0, "despesasAdministrativas": 0 },
  "parecer": "Parecer documental/jurídico em português formal, texto simples (sem markdown/asteriscos e SEM travessão '—'; use vírgula, ponto ou dois-pontos, pois o travessão dá cara de texto de IA), estruturado com '§ SEÇÃO:'. LINGUAGEM PARA LEIGO (obrigatório): escreva para QUALQUER pessoa sem formação jurídica entender; frases curtas e, sempre que usar um termo técnico inevitável (ex.: propter rem, usufruto, penhora, hipoteca, alienação fiduciária, imissão de posse, indisponibilidade), explique em 3 a 6 palavras entre parênteses o que significa. FORMATO CHECKLIST (obrigatório — o relatório é a RESPOSTA do checklist jurídico de arrematação, item a item, NÃO um texto corrido): em cada seção, responda CADA item do checklist iniciando a linha com o RÓTULO do item seguido de dois-pontos e a resposta objetiva, e DISCORRA em 1 a 3 frases o que aquilo significa e o impacto para o arrematante. Se o dado não constar nos documentos, responda 'não consta na documentação analisada' e diga ONDE confirmar (nunca invente). Use EXATAMENTE estas seções e rótulos: § SEÇÃO: 1. IDENTIFICAÇÃO BÁSICA (Nº do Processo: ...; Vara/Tribunal: ...; Partes (Exequente vs. Executado): ...; Nº da Matrícula: ...; Nº do Edital: ...); § SEÇÃO: 2. ANÁLISE DAS REGRAS (EDITAL) (Forma de Pagamento: à vista/parcelado, prazos e condições; Comissão do Leiloeiro: percentual e prazo; Estado de Ocupação (declarado no edital): ...; Venda Ad Corpus: sim/não e o que significa; Responsabilidade por Débitos: arrematante assume os propter rem OU são sub-rogados no preço, citando o texto do edital); § SEÇÃO: 3. ANÁLISE DA PROPRIEDADE (MATRÍCULA) (Titularidade: o executado é o proprietário atual da matrícula?; Penhoras Concorrentes: outras penhoras (trabalhista/fiscal) com preferência de crédito?; Hipotecas/Alienação Fiduciária: há credor fiduciário/hipotecário e ele foi intimado?; Gravames Sérios: indisponibilidade, inalienabilidade, usufruto, locação com cláusula de vigência?; Descrição do Imóvel: área/vagas conferem com laudo e edital?); § SEÇÃO: 4. ANÁLISE PROCESSUAL (RISCO DE ANULAÇÃO)${temProc ? ' (com base no CNJ consultado)' : ''} (Citação do Executado: válida?; Intimação sobre o Leilão: o executado foi intimado?; Intimação do Cônjuge: quando o regime de bens exigir; Recursos Pendentes: embargos/agravo/ação anulatória que afetem o leilão?; Efeito Suspensivo: há decisão suspendendo o leilão?; Atualização da Avaliação: risco de 'preço vil'?; Preço Mínimo: a 2ª praça respeita o mínimo legal, art. 891 CPC?; em leilão extrajudicial da Lei 9.514, informe se há AÇÃO do ex-mutuário contra o credor); § SEÇÃO: 5. ANÁLISE DE CUSTOS E RESPONSABILIDADES (Débitos de IPTU e Condomínio: valor e de quem é a responsabilidade após a arrematação; Hierarquia de Pagamento: em sub-rogação, o valor cobre o credor principal E os propter rem?; Custos e Prazo de Desocupação: se ocupado, estimativa de tempo/custo da imissão na posse); § SEÇÃO: 6. PARECER FINAL DO JURÍDICO (Pontos de Atenção (Red Flags): vícios que podem gerar nulidade; Nível de Risco da Operação: Baixo/Médio/Alto; Ações Pós-Arremate Requeridas: ex. baixa de penhoras, mandado de imissão na posse; Recomendação: RECOMENDO a arrematação / RECOMENDO com ressalvas / NÃO RECOMENDO, com a justificativa objetiva). As certidões recomendadas vão no campo 'raioX.certidoesRecomendadas' (renderizadas ao final do relatório), não repita a lista dentro do parecer.",
  "riscos": [{"categoria":"","descricao":"","severidade":"bloqueante|alerta|informativo","constaNaDoc":true}],
  "nivelRisco": "verde|amarelo|vermelho",
  "documentosAnalisados": { "matricula": false, "edital": false, "laudo": false, "_obs": "marque TRUE apenas o documento que você DE FATO leu no conteúdo anexado: matrícula = certidão do registro de imóveis (cadeia dominial, registros R-/Av-); edital = edital/regulamento do leilão (condições, praças, comissão) OU, em venda direta, as regras da venda; laudo = laudo de avaliação. Não marque true por inferência — só se o documento estava entre os anexos lidos." },
  "lacunas": ["dados que NÃO constam na documentação e onde confirmar"],
  "raioX": {
    "cadeiaDominial": [{"ato":"","data":"AAAA-MM-DD","evento":"","parte":""}],
    "certidoesRecomendadas": [{"nome":"","orgao":"","online":false,"motivo":""}],
    "fraudeExecucao": {"risco":"nenhum|baixo|medio|alto","motivo":""},
    "ocupacaoDetalhe": {"tipo":"desocupado|proprietario|locatario|posseiro|comodato|invasao|nao_consta","direitos":"","procedimentoDesocupacao":"","prazoMeses":0,"custoEstimado":0},
    "direitoPreferencia": {"existe":false,"titulares":[]},
    "debitos": {"totalAssumidoArrematante":0,"propterRem":[],"pessoais":[],"aLevantar":true},
    "cronogramaLeilao": {"primeiraPraca":"","segundaPraca":"","prazoPagamento":"","prazoEmbargos":""}
  }
}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  // RETENTATIVA AUTOMÁTICA (documental-retry-cron): reprocessa laudos que saíram
  // PRELIMINARES, de hora em hora até 48h, dando ao Claude um novo ciclo com
  // orçamento fresco. Autentica pelo CRON_SECRET (não passa por getUser nem cota).
  const isCron = !!process.env.CRON_SECRET && req.headers['x-cron-secret'] === process.env.CRON_SECRET;

  let user;
  if (isCron) {
    if (!req.body?.paraUserId) { res.status(400).json({ error: 'paraUserId obrigatório no cron' }); return; }
    user = { id: String(req.body.paraUserId) };
  } else {
    user = await getUser(req);
    if (!user) { res.status(401).json({ error: 'Não autenticado' }); return; }
    // Análise documental e jurídica NÃO pertence ao Explorador (só a partir do
    // Investidor Pro). Bloqueia no servidor — à prova de burla pela API.
    try {
      const [perfil] = await (await sb(`perfis?id=eq.${user.id}&select=role&limit=1`)).json();
      if (!perfil || perfil.role === 'explorador' || perfil.role == null) {
        res.status(402).json({ error: 'A análise documental e jurídica está disponível a partir do plano Investidor Pro.', upgrade: true });
        return;
      }
    } catch {
      // Fail-closed: se a checagem de plano falhar (Supabase indisponível/erro), NÃO
      // libera a análise paga — retorna erro retornável em vez de conceder acesso.
      res.status(503).json({ error: 'Não foi possível validar seu plano agora. Tente novamente em instantes.' });
      return;
    }
  }
  if (!CLAUDE_KEY) { res.status(500).json({ error: 'CLAUDE_KEY ausente' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }

  const body = req.body || {};
  const { imovelId, titulo, cidade, estado, imovel } = body;
  if (!imovelId) { res.status(400).json({ error: 'imovelId obrigatório' }); return; }

  // Geração EM NOME DE (admin/analista ao atribuir arremate manual): grava sob o
  // cliente e não cobra cota (atribuição administrativa gratuita).
  let ownerId = user.id, onBehalf = false;
  if (body.paraUserId && body.paraUserId !== user.id) {
    try {
      const [p] = await (await sb(`perfis?id=eq.${user.id}&select=role&limit=1`)).json();
      if (p && (p.role === 'admin' || p.role === 'analista')) { ownerId = String(body.paraUserId); onBehalf = true; }
    } catch { /* mantém o próprio */ }
  }

  // ── Cota documental NO SERVIDOR (anti-abuso do custo de IA) ─────────────────
  // Mesmo padrão do mercadológico (gerar-analise): cobra só em análise NOVA deste
  // imóvel; re-gerar/atualizar o mesmo não recobra. Explorador já foi barrado
  // acima; admin é ilimitado na RPC. O limite por plano vem de limite_ia (banco).
  let cota = null; // hoisted p/ permitir estorno no catch se a geração falhar
  let cobrarCredito = false; // cota mensal esgotada → esta geração será cobrada do crédito
  try {
    const jaFeita = await (await sb(`analises_documental?user_id=eq.${ownerId}&imovel_id=eq.${encodeURIComponent(String(imovelId))}&status=eq.concluida&select=imovel_id&limit=1`)).json();
    const isNovo = !(Array.isArray(jaFeita) && jaFeita.length);
    if (isNovo && !onBehalf) {
      const rc = await sb('rpc/consumir_documental_por', { method: 'POST', body: JSON.stringify({ p_user_id: user.id }) });
      cota = await rc.json().catch(() => null);
      if (cota && cota.ok === false) {
        // Cota MENSAL esgotada num plano que TEM documental → tenta crédito. 'sem_documental'
        // é exclusão de plano (explorador/consultor) → não vende avulso, pede upgrade.
        if (cota.erro === 'limite_mensal') {
          const EST_DOCUMENTAL_MICRO = 500000; // ~US$0,50 (PDFs + CNJ; conservador)
          const pode = await sb('rpc/pode_debitar', { method: 'POST', body: JSON.stringify({ p_user_id: user.id, p_custo_micro_estimado: EST_DOCUMENTAL_MICRO }) });
          if ((await pode.json().catch(() => false)) === true) {
            cobrarCredito = true;
          } else {
            res.status(402).json({ error: 'Sua cota mensal de análises documentais acabou. Recarregue créditos para gerar análises adicionais.', motivo: 'sem_credito', cota });
            return;
          }
        } else {
          const msg = cota.erro === 'sem_documental' ? 'A análise documental e jurídica não está incluída no seu plano.'
            : 'Cota de análises documentais indisponível.';
          res.status(402).json({ error: msg, cota });
          return;
        }
      }
    }
  } catch { /* checagem de cota nunca bloqueia quem tem direito */ }
  _custoMicroReq = 0; // zera o acumulador de custo desta geração (cobrança por crédito)

  // Carrega os documentos do lote do banco (fonte da verdade).
  let row = null;
  try {
    const [r] = await (await sb(`imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}&select=tipo,endereco,cidade,estado,modalidade,fonte,fonte_id,link_edital,link_matricula,link_regras_venda,anexos,numero_processo,ficha_cef,data_leilao,area_m2,valor_avaliacao,matricula_checada_em&limit=1`)).json();
    row = r || null;
  } catch { /* segue com o que veio no body */ }

  const im = {
    tipo: imovel?.tipo || row?.tipo, endereco: imovel?.endereco || row?.endereco,
    cidade: cidade || imovel?.cidade || row?.cidade, estado: estado || imovel?.estado || row?.estado,
    modalidade: imovel?.modalidade || row?.modalidade,
  };
  const dataLeilao = (() => {
    const raw = imovel?.dataLeilao || null;
    return raw && !isNaN(Date.parse(raw)) ? new Date(raw).toISOString() : null;
  })();

  const base = { user_id: ownerId, imovel_id: String(imovelId), titulo: titulo || im.endereco || null, cidade: im.cidade || null, estado: im.estado || null, imovel: imovel || null, inputs: body.inputs || null, data_leilao: dataLeilao };
  await upsertDoc({ ...base, status: 'gerando', erro: null, result: null });

  // Orçamento da fase de COLETA (leitura de docs + CNJ): capado em 165s para SOBRAR
  // tempo para a IA (extração) + consultas de fontes + gravação, tudo dentro do
  // maxDuration de 300s. Antes eram 250s aqui e a chamada de IA depois estourava.
  const deadline = Date.now() + 165000;
  // Orçamento MAIOR para os fallbacks pós-extração (passe focado de CPF + CNJ por
  // número/parte): são curtos e rodam DEPOIS da coleta; usam a folga até ~275s.
  const hardDeadline = Date.now() + 275000;
  // DEADLINE HARD do handler inteiro (< maxDuration 300s): se qualquer etapa travar/
  // re-tentar além disso, perdemos a corrida e gravamos 'erro' — a linha NUNCA fica
  // presa em 'gerando' (mesmo problema que travou o mercadológico do Igor).
  const DEADLINE_MS = 285000;
  const prazo = new Promise((_, rej) => setTimeout(() => rej(new Error('tempo_limite')), DEADLINE_MS));
  try {
    const result = await Promise.race([prazo, (async () => {
    // 1) Reúne os documentos. ORDEM IMPORTA: os arquivos JÁ GUARDADos no nosso storage
    //    (imovel_anexos — captura por navegador OU upload manual) vêm PRIMEIRO. São
    //    URLs assinadas, de leitura direta e confiável. As URLs cruas da Caixa vêm por
    //    último (falham por sessão e QUEIMAVAM o tempo da coleta antes de chegar no
    //    arquivo que já temos — era por isso que pedia anexo mesmo com a matrícula pronta).
    const anexos = Array.isArray(row?.anexos) ? row.anexos : [];
    const urls = [];
    const ehPagina = (u) => /matricula\.asp|detalhe-imovel\.asp/i.test(u || '');
    // tipo: conhecido do anexo (a.tipo) OU inferido do rótulo. Alimenta o GATE que
    // exige matrícula E edital (não basta um anexo genérico qualquer).
    // O scrape marca MUITA coisa como tipo 'anexo' (genérico), inclusive matrículas cujo
    // nome veio quebrado ("matrãâ­cula") ou abreviado ("matr-15964"). Um 'anexo' genérico
    // NÃO pode ofuscar o que o rótulo revela: se o nome infere um tipo específico, ele
    // vence — senão a matrícula ficava com prioridade de anexo (fim da fila) e o GATE a
    // dava como faltando. Tipo específico já vindo do anexo (laudo/edital…) é preservado.
    const add = (u, rotulo, tipo) => {
      if (!(u && /^https?:\/\//.test(u) && !ehPagina(u) && !urls.find(x => x.url === u))) return;
      const inferido = tipoDoRotulo(rotulo);
      const t = (tipo && tipo !== 'anexo') ? tipo : (inferido || tipo || null);
      urls.push({ url: u, rotulo, tipo: t });
    };
    // 1º: anexos guardados no storage (capturados por navegador ou enviados pela equipe).
    try {
      const manuais = await (await sb(`imovel_anexos?imovel_id=eq.${encodeURIComponent(String(imovelId))}&order=criado_em.desc&select=tipo,nome,url,storage_path&limit=10`)).json();
      // Assina SOB DEMANDA pelo storage_path: o `url` gravado é signed de 1h e
      // EXPIRA — servi-lo direto fazia a IA falhar em ler a NOSSA cópia e cair no
      // re-download da fonte volátil (desperdício + menos confiável). urlDocumento
      // re-assina a cópia que já temos (economia) e cai no url legado só sem path.
      for (const a of (Array.isArray(manuais) ? manuais : [])) add(await urlDocumento(a), a.nome || (a.tipo ? a.tipo[0].toUpperCase() + a.tipo.slice(1) : 'Anexo'), a.tipo);
    } catch { /* segue com os do lote */ }
    // 2º: anexos capturados no scrape (jsonb do lote). Leilão JUDICIAL costuma ter
    // MUITOS anexos (auto de penhora/avaliação, laudo, decisão, certidões, ata) —
    // ampliamos o teto de candidatos para não descartar peça relevante antes da
    // leitura (a leitura em si continua limitada pelo cap + deadline abaixo).
    // "extraJUDICIAL" contém "judicial" — exige o guard p/ não tratar extrajudicial
    // (Caixa/Lei 9.514, poucos anexos) como judicial e ler peças a mais (custo IA).
    const ehJudicial = /judicial/i.test(String(row?.modalidade || '')) && !/extra/i.test(String(row?.modalidade || ''));
    const capCandidatos = ehJudicial ? 16 : 7;
    for (const a of anexos) { if (urls.length >= capCandidatos) break; add(a.url, a.nome || 'Anexo', a.tipo); }
    // 3º: URLs do cliente + os PDFs estáticos da Caixa (fallback quando não há arquivo guardado).
    const cxFonte = { fonte: row?.fonte, estado: row?.estado || estado, fonteId: row?.fonte_id };
    add(body?.urlMatricula, 'Matrícula');
    add(caixaMatriculaUrl(cxFonte), 'Matrícula (Caixa)');
    add(row?.link_matricula, 'Matrícula');
    // FALLBACK DE LOGIN ON-DEMAND (qualquer leiloeiro): se ainda não temos a matrícula,
    // loga com e-mail/senha da fonte e captura a URL do doc — só nesta análise, nada em
    // massa. Cada leiloeiro tem seu molde em api/_leiloeiro-auth.js (ZUK, Grupo Lance…);
    // fontes sem molde retornam null e a análise segue normal. Credenciais <FONTE>_*.
    if (!body?.urlMatricula && !row?.link_matricula) {
      try {
        const dd = await capturarDocsLoginOnDemand(row?.fonte, row?.link_edital || row?.url_lote, deadline);
        if (dd?.matricula) add(dd.matricula, 'Matrícula');
        if (dd?.laudo) add(dd.laudo, 'Laudo de avaliação');
        if (dd?.edital) add(dd.edital, 'Edital');
        for (const a of (dd?.anexos || [])) add(a.url, a.nome || 'Anexo', a.tipo);
      } catch { /* login on-demand nunca derruba a análise */ }
    }
    add(row?.link_edital || body?.urlEdital, 'Edital');
    add(body?.urlRegras, 'Regras de venda');
    add(caixaRegrasVendaUrl(cxFonte), 'Regras de venda (Caixa)');
    add(row?.link_regras_venda, 'Regras de venda');

    // Cache-first: documentos já armazenados deste imóvel (poupa Bright Data).
    const podeCache = isUuid(String(imovelId));
    const cache = podeCache ? await mapaCache(String(imovelId)) : {};
    // Tipos que JÁ temos guardados no bucket ANTES desta geração — usado para o
    // aprendizado persistente (se tínhamos o arquivo mas a leitura voltou 0, é bug
    // de leitura, não "doc ainda não capturado").
    const tiposGuardados = Object.values(cache).filter((c) => c?.storage_path).map((c) => c.tipo);
    const blocos = [];
    const lidos = [];
    // Cap de leitura adaptativo: judicial lê mais peças (até 8) para o cruzamento
    // apurado exigido nesses casos; o deadline continua protegendo o tempo total.
    const capLeitura = ehJudicial ? 8 : 6;
    // Prioriza as peças centrais na ordem de leitura (o cap acima é limitado):
    // matrícula e edital primeiro. Sem isto, fontes com muitos anexos do mesmo tipo
    // (ex.: o Zuk publica vários links de edital) empurram a matrícula para fora do cap.
    const prioTipo = { matricula_registrada: 0, matricula: 0, edital: 1, auto_arrematacao: 2, carta_arrematacao: 2, escritura: 2, contrato_banco: 2, regras_venda: 3, regras: 3, laudo: 4, proposta: 5, anexo: 6 };
    urls.sort((a, b) => (prioTipo[a.tipo] ?? 5) - (prioTipo[b.tipo] ?? 5));
    for (const u of urls) {
      if (blocos.length >= capLeitura || Date.now() > deadline) break; // limita custo/payload (deadline protege o tempo)
      // Prefere o TIPO do anexo (vindo do banco, confiável) para achar a cópia no
      // bucket; só cai no rótulo quando o tipo é genérico. Sem isto, um rótulo que
      // não inferia o tipo furava o cache e caía na URL (que expirava) → doc não lido.
      const tipoDoc = (u.tipo && u.tipo !== 'anexo') ? u.tipo : tipoDoRotulo(u.rotulo);
      let doc = null, deCache = false;
      // 1) Se já temos o PDF no bucket (manual do analista ou cache anterior), lê de lá.
      if (podeCache && tipoDoc && cache[tipoDoc]?.storage_path) {
        doc = await lerDocDoBucket(cache[tipoDoc].storage_path);
        if (doc) deCache = true;
      }
      // 2) Senão, lê da fonte (fetch direto → Bright Data) e GUARDA para a próxima.
      if (!doc) {
        doc = await lerDoc(u.url, deadline);
        if (doc?.kind === 'pdf' && doc.base64 && podeCache && tipoDoc && !cache[tipoDoc] && Date.now() < deadline) {
          cache[tipoDoc] = { tipo: tipoDoc }; // evita salvar 2× o mesmo tipo neste run
          await salvarDocBucket(String(imovelId), tipoDoc, u.rotulo, u.url, doc.base64, dataLeilao);
        }
      }
      if (!doc) continue;
      lidos.push({ rotulo: u.rotulo, url: u.url, kind: doc.kind, cache: deCache, tipo: u.tipo || tipoDoc });
      if (doc.kind === 'pdf') blocos.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: doc.base64 }, title: u.rotulo });
      else blocos.push({ type: 'text', text: `=== ${u.rotulo} (${u.url}) ===\n${doc.text}` });
    }
    // Texto colado manualmente (inclusão manual / fallback).
    if (body?.textoEdital) blocos.push({ type: 'text', text: `=== EDITAL (texto informado) ===\n${String(body.textoEdital).slice(0, 12000)}` });
    if (body?.textoMatricula) blocos.push({ type: 'text', text: `=== MATRÍCULA (texto informado) ===\n${String(body.textoMatricula).slice(0, 12000)}` });

    // GATE: a análise jurídica EXIGE a MATRÍCULA E o EDITAL (as duas peças centrais).
    // Um anexo genérico ou só uma delas NÃO basta — sem a matrícula não há CPF do
    // proprietário/executado nem cadeia/ônus; sem o edital não há as condições da venda.
    // Se faltar QUALQUER uma, NÃO geramos o laudo (que sairia inconclusivo, "não
    // identifiquei o CPF/não li o documento"): pedimos/obtemos APENAS a(s) que falta(m).
    // Falta de leitura é diligência pendente, não risco jurídico.
    const ehVendaDiretaSem = /venda_direta/i.test(String(row?.modalidade || ''));
    const tipoLido = (l) => l.tipo || tipoDoRotulo(l.rotulo);
    const temMatriculaPre = !!body?.textoMatricula || lidos.some(l => tipoLido(l) === 'matricula');
    // Em venda direta o "edital" é o documento de REGRAS DA VENDA; nos demais, o edital.
    const temEditalPre = !!body?.textoEdital || lidos.some(l => ['edital', 'regras_venda'].includes(tipoLido(l)));
    const faltandoPre = [];
    if (!temMatriculaPre) faltandoPre.push('matricula');
    if (!temEditalPre) faltandoPre.push(ehVendaDiretaSem ? 'regras_venda' : 'edital');
    // Só BLOQUEIA de saída quando NADA legível foi obtido (nem texto colado). Se lemos
    // ALGUM documento, deixamos a IA processar: ela confirma em documentosAnalisados o
    // que DE FATO leu (mais confiável que o tipo do anexo, que às vezes vem opaco), e o
    // GATE PÓS-GERAÇÃO (abaixo) pede o que faltar. Assim não bloqueamos à toa uma
    // matrícula presente mas mal-rotulada, nem geramos laudo sem os dois documentos.
    const temTextoColado = !!(body?.textoEdital || body?.textoMatricula);
    if (lidos.length === 0 && !temTextoColado) {
      // Leiloeiro INTEGRADO (Caixa): a matrícula/edital só saem por navegador real
      // (sessão). Em vez de pedir anexo manual, ENFILEIRA a captura automática (job
      // que roda a cada 10-15 min baixa os PDFs via navegador e guarda no storage; a
      // próxima geração lê de lá e completa o que falta). Só cai no anexo manual se
      // não for integrado.
      const ehCaixaFonte = /caixa|cef/i.test(row?.fonte || '');
      const temPaginaLote = /^https?:\/\//i.test(String(row?.link_edital || '')) || /^https?:\/\//i.test(String(row?.link_regras_venda || ''));
      let enfileirado = false;
      if (ehCaixaFonte) {
        const hdniip = (String(row?.link_matricula || '').match(/hdniip=(\d+)/) || [])[1] || String(row?.fonte_id || '').replace(/\D/g, '');
        if (hdniip) {
          try {
            await sb('cef_matricula_fila?on_conflict=imovel_id', {
              method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
              body: JSON.stringify({ imovel_id: String(imovelId), hdniip, status: 'pendente' }),
            });
            enfileirado = true;
            await dispararCaptura('matricula-cef.yml'); // dispara agora (não espera o cron)
          } catch { /* segue com a mensagem */ }
        }
      } else if (temPaginaLote) {
        try {
          await sb('documentos_fila?on_conflict=imovel_id', {
            method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify({ imovel_id: String(imovelId), status: 'pendente' }),
          });
          enfileirado = true;
          await dispararCaptura('captura-documentos.yml'); // dispara agora
        } catch { /* segue com a mensagem */ }
      }
      const faltandoInicial = faltandoPre.length ? faltandoPre : ['matricula', ehVendaDiretaSem ? 'regras_venda' : 'edital'];
      const nomeDoc = (t) => t === 'matricula' ? 'a matrícula' : t === 'regras_venda' ? 'as regras da venda' : 'o edital';
      const faltaTxt = faltandoInicial.map(nomeDoc).join(' e ');
      const jaTemTxt = lidos.length ? `Já temos ${lidos.map(l => l.rotulo).join(', ')}. ` : '';
      // Matrícula login-gated (ZUK/GRUPOLANCE) ou já negative-cached → NÃO promete "sai
      // sozinha" (a captura genérica pula essas fontes e não há re-disparo do laudo).
      const matriculaNaoAutoResolve = faltandoInicial.includes('matricula') && !ehCaixaFonte
        && (temLoginParaFonte(row?.fonte) || !!row?.matricula_checada_em);
      const emCaptura = enfileirado && !matriculaNaoAutoResolve;
      const semDocs = {
        precisaDocumentos: true,
        integrado: (ehCaixaFonte || temPaginaLote) && !matriculaNaoAutoResolve,
        emCaptura,
        faltando: faltandoInicial,
        paginaLeiloeiro: [row?.link_edital, row?.link_regras_venda].find(u => /^https?:\/\//i.test(u || '')) || null,
        documentosLidos: lidos.map(l => ({ rotulo: l.rotulo, tipo: tipoLido(l) })),
        motivo: emCaptura
          ? `A análise jurídica exige a matrícula e o edital. ${jaTemTxt}Estamos baixando ${faltaTxt} automaticamente${ehCaixaFonte ? ' direto da Caixa' : ''} (leiloeiro integrado): leva cerca de 1 minuto e a análise é gerada sozinha assim que chegar. Se preferir na hora, anexe ${faltaTxt} (PDF).`
          : matriculaNaoAutoResolve
            ? `Este leiloeiro não publica a matrícula on-line (ela sai por acesso restrito). ${jaTemTxt}Anexe ${faltaTxt} (PDF) — que você baixa na página do lote/leiloeiro — para gerar a análise agora.`
            : `A análise jurídica exige a matrícula e o edital. ${jaTemTxt}Anexe ${faltaTxt} (PDF) para gerar a análise.`,
      };
      // RAIZ do "Preparando documentos…" preso: sem regen_motivo, o regenerar-relatorios-cron
      // NUNCA reprocessava este estado — então, quando a matrícula chegava (ou a captura falhava),
      // nada regerava o laudo. Marcamos 'matricula_nao_lida' SÓ quando a captura pode se resolver
      // sozinha (emCaptura): aí o cron re-roda a geração e, com a matrícula já baixada, emite o
      // laudo completo e o vício some. Quando NÃO auto-resolve (anexar manual), fica null (estado
      // final — sem gastar IA à toa).
      await upsertDoc({ ...base, status: 'concluida', erro: null, result: semDocs, regen_motivo: emCaptura ? 'matricula_nao_lida' : null });
      // APRENDIZADO PERSISTENTE (sobrevive à regeração, que sobrescreve o result):
      // se TÍNHAMOS o(s) documento(s) no bucket e a leitura voltou 0, é falha de
      // LEITURA (arquivo ilegível/assinatura, não "doc ainda não capturado"). Registra
      // a anomalia idempotente p/ a saúde investigar — o dono quer manter esse log.
      if (!lidos.length && tiposGuardados.length) {
        registrarAnomalia('doc_guardado_nao_lido', row?.fonte, imovelId, 'documentos',
          `Documento(s) no bucket (${tiposGuardados.join(', ')}) não lidos na geração — verificar arquivo/assinatura.`).catch(() => {});
      }
      if (cota && cota.ok && cota.tipo) {
        try { await sb('rpc/estornar_documental_por', { method: 'POST', body: JSON.stringify({ p_user_id: user.id, p_tipo: cota.tipo }) }); } catch { /* estorno best-effort */ }
      }
      return semDocs;
    }

    // 2) Consulta o CNJ (quando há processo e UF). Modalidade judicial prioriza.
    const procNum = body?.processoNumero || row?.numero_processo || null;
    const procNome = body?.processoNome || null;
    let cnj = null;
    if ((procNum || procNome) && im.estado && Date.now() < deadline) {
      try { cnj = await buscarProcessosCNJ({ numero_processo: procNum || undefined, nome_parte: procNome || undefined, uf: im.estado }); }
      catch { /* CNJ pode estar indisponível */ }
    }

    // 3) Monta a mensagem para o Claude (documentos + resumo do CNJ).
    const temProc = !!(cnj && cnj.total);
    const content = [...blocos];
    if (temProc) {
      const resumoProc = cnj.processos.slice(0, 8).map(p => `- ${p.numero} (${p.tribunal || ''}) classe ${p.classe || '-'} | riscos: ${(p.riscos || []).map(r => r.categoria).join(', ') || 'nenhum'}`).join('\n');
      content.push({ type: 'text', text: `=== PROCESSOS CNJ (${cnj.total}) ===\nParecer automático: ${cnj.parecer?.texto || ''}\n${resumoProc}` });
    }
    // ANTIFRAUDE (anti-golpe de leilão): duas defesas — PROCEDÊNCIA (o lote veio de um
    // leiloeiro/fonte que integramos e monitoramos) e EXISTÊNCIA DO PROCESSO (nº CNJ com
    // dígito verificador válido + confirmado no DataJud). Busca o registro da fonte uma
    // vez (reaproveitado no result/checklist) e dá a dica de procedência ao parecer.
    let fonteInfo = null;
    try {
      const [lc] = await (await sb(`leiloeiro_conhecimento?fonte=eq.${encodeURIComponent(String(row?.fonte || ''))}&select=fonte,plataforma,custo,qualidade&limit=1`)).json();
      fonteInfo = lc || null;
    } catch { /* best-effort */ }
    const procDigitsPre = String(procNum || '').replace(/\D/g, '');
    if (row?.fonte || procDigitsPre.length === 20) {
      const antifraudeHint = [
        'VERIFICAÇÃO DE PROCEDÊNCIA (anti-golpe — comente no parecer SE algo não fechar):',
        row?.fonte ? `- Origem do lote: ${row.fonte}${fonteInfo ? ` (${fonteInfo.plataforma || 'plataforma integrada'}), fonte reconhecida e monitorada pela BidPro.` : ', fonte NÃO reconhecida pela plataforma — trate a idoneidade do leiloeiro como diligência a confirmar (registro na Junta Comercial e no tribunal).'}` : '',
        procDigitsPre.length === 20 ? `- Processo ${procDigitsPre}: dígito verificador CNJ ${cnjValido(procDigitsPre) ? 'VÁLIDO' : 'INVÁLIDO (número possivelmente incorreto ou forjado)'}; DataJud ${temProc ? 'CONFIRMOU o processo' : 'NÃO localizou o processo (confirmar no tribunal antes do lance)'}.` : '',
      ].filter(Boolean).join('\n');
      content.push({ type: 'text', text: antifraudeHint });
    }
    if (!content.length) content.push({ type: 'text', text: 'Nenhum documento pôde ser lido automaticamente. Produza a análise possível e detalhe em "lacunas" o que precisa ser obtido e onde.' });
    content.push({ type: 'text', text: promptDocumental(im, temProc) });

    // APRENDIZADO: incorpora as correções que os advogados fizeram em devolutivas
    // anteriores (tabela juridico_aprendizado, alimentada por inbound-juridico),
    // para o parecer evitar repetir os mesmos erros. Loop de melhoria contínua —
    // sem devolutivas ainda, é no-op; vai ficando mais preciso com o uso.
    let aprendizados = '';
    try {
      const licoes = await (await sb('juridico_aprendizado?select=campo,valor_ia,valor_advogado,observacao&order=criado_em.desc&limit=40')).json();
      if (Array.isArray(licoes)) {
        const linhas = licoes
          .filter(l => l && (l.campo || l.observacao || l.valor_advogado))
          .slice(0, 30)
          .map(l => `- ${l.campo ? l.campo + ': ' : ''}o sistema indicou "${String(l.valor_ia || '—').slice(0, 120)}", o advogado corrigiu para "${String(l.valor_advogado || '—').slice(0, 120)}"${l.observacao ? ` — ${String(l.observacao).slice(0, 200)}` : ''}`);
        if (linhas.length) aprendizados = `\n\nAPRENDIZADOS COM ADVOGADOS (correções reais de devolutivas anteriores — aplique estas lições e NÃO repita os mesmos erros):\n${linhas.join('\n')}`;
      }
    } catch { /* aprendizado é best-effort, nunca trava o parecer */ }

    // A chamada principal NUNCA pode derrubar o laudo. Em leilão JUDICIAL lemos até
    // 8 anexos grandes → a chamada pode estourar o timeout e o AbortError ("This
    // operation was aborted") vinha à tona, matando o relatório inteiro. Aqui ela é
    // isolada: se falhar/expirar, seguimos com os FALLBACKS (extração focada de CPF,
    // CNJ por processo/parte, certidões, parecer sintetizado) e emitimos um laudo
    // preliminar útil — nunca um erro cru. O timeout é dimensionado pela folga
    // restante (2 tentativas), deixando ~60s garantidos para os fallbacks rodarem.
    // UMA tentativa LONGA em vez de duas curtas: as matrículas da Caixa são PDFs
    // ESCANEADOS (visão) e demoram — com 2×100s ambas abortavam e o laudo caía no
    // fallback ("Análise preliminar"). Damos quase todo o orçamento restante a uma
    // única chamada (deixando ~45s p/ os fallbacks e a folga do deadline de 285s).
    const orcamentoIA = Math.max(90000, hardDeadline - Date.now() - 45000);
    let data = null;
    try {
      data = await anthropic({
        model: MODEL, max_tokens: 7000,
        system: 'Você é advogado especialista em leilões de imóveis. Análise documental e processual — sem análise de mercado/preço. Não invente dados ausentes: sinalize lacunas e onde confirmar. Retorne apenas JSON válido.' + aprendizados,
        messages: [{ role: 'user', content }],
      }, { retries: 0, timeoutMs: orcamentoIA, noFallback: true });
    } catch (e) {
      console.warn(`[documental] chamada principal indisponível (${e?.message}) — seguindo com extração focada + fallbacks`);
      data = null;
    }
    const rawTxt = data ? extractText(data) : '';
    const parsed = parseJSON(rawTxt) || {};
    // Observabilidade: se a IA truncou (max_tokens) ou o parse não achou parecer,
    // registra — é o sintoma que fazia o laudo cair no texto "preliminar".
    if (data?.stop_reason === 'max_tokens' || (rawTxt && !parsed.parecer)) {
      console.warn(`[documental] stop_reason=${data?.stop_reason || '?'} len=${rawTxt.length} parecer=${parsed.parecer ? 'ok' : 'VAZIO'} riscos=${Array.isArray(parsed.riscos) ? parsed.riscos.length : 'n/a'} lidos=${lidos.length}`);
    }

    // SALVAGUARDA anti-alarmismo (reforça o prompt): ausência de informação e itens
    // ROTINEIROS de leilão (penhora/execução, hipoteca que se extingue, bloqueios
    // da execução, ocupação com imissão garantida) NÃO podem sair como "bloqueante".
    // Rebaixa para "alerta" — o bloqueante fica só para risco concreto e comprovado.
    if (Array.isArray(parsed.riscos)) {
      const rotineiro = /penhora|execu[çc]|hipotec|indisponibil|bacenjud|renajud|arresto|ocupa|imiss|bloqueio/i;
      // DIVERGÊNCIA DE IDENTIDADE DO IMÓVEL não é RISCO JURÍDICO: quando os documentos descrevem
      // um imóvel DIFERENTE do informado p/ análise (endereço/município/lote trocado — ex.: a
      // matrícula é de Feira de Santana e o cadastro dizia Alagoinhas), é um problema de DADO. O
      // certo é REGERAR o relatório com os dados corretos, não "reprovar" por risco jurídico. Tira
      // esses itens de `riscos` (p/ não derrubar o score, não virar bloqueante nem o banner de risco)
      // e os encaminha para o canal de DIVERGÊNCIA — a tela oferece regerar (dono pediu).
      const ehDivergencia = (t) => /diverg[êe]nci|(?:endere[çc]o|munic[íi]pio|cidade|bairro|logradouro|im[óo]vel|bem|lote|matr[íi]cula)[^.]{0,60}(?:diferente|divergente|distint|divers|trocad|n[ãa]o (?:corresponde|confere|bate|coincide|[ée] o mesmo))|n[ãa]o (?:[ée]|se trata d)o mesmo (?:im[óo]vel|bem|lote)|confus[ãa]o[^.]{0,20}lote|erro[^.]{0,20}identifica[çc]|identifica[çc][ãa]o[^.]{0,40}(?:diferente|divergente|incorret)/i.test(t);
      const divergencias = [];
      parsed.riscos = parsed.riscos.filter((r) => {
        const txt = `${r?.categoria || ''} ${r?.descricao || ''}`;
        if (ehDivergencia(txt)) { divergencias.push({ titulo: r?.categoria || 'Divergência de identificação do imóvel', descricao: String(r?.descricao || txt).trim() }); return false; }
        return true;
      });
      if (divergencias.length) parsed._divergenciasDoc = divergencias;
      for (const r of parsed.riscos) {
        if (!r || r.severidade !== 'bloqueante') continue;
        const txt = `${r.categoria || ''} ${r.descricao || ''}`;
        const ausente = r.constaNaDoc === false || /n[ãa]o consta|a confirmar|n[ãa]o (?:foi|puderam|p[ôo]de)/i.test(txt);
        if (ausente || rotineiro.test(txt)) r.severidade = 'alerta';
      }
      // Coerência: sem bloqueante real, não classifica como "vermelho".
      if (!parsed.riscos.some(r => r?.severidade === 'bloqueante') && parsed.nivelRisco === 'vermelho') {
        parsed.nivelRisco = 'amarelo';
      }
    }

    // ── Fontes externas do laudo (best-effort — NUNCA travam o parecer) ─────────
    // Com base no processo e no CPF/CNPJ do executado que a IA extraiu: andamentos
    // (DJEN/Comunica CNJ), débitos trabalhistas (CNDT), protestos (CENPROT) e
    // certidões fiscais (Receita/PGFN/FGTS). Viram uma seção do laudo do cliente —
    // o mesmo conjunto que o fluxo de Caso já usava.
    const ex = parsed.extracao || (parsed.extracao = {});
    let execDoc = String(ex.executadoDoc || '').replace(/\D/g, '');
    // Valida o dígito verificador antes de disparar as certidões: um número mal
    // lido (OCR) com 11/14 dígitos passaria no comprimento e geraria "nada consta"
    // FALSO. Só consulta CNDT/CNIB/CENPROT/fiscais com CPF/CNPJ realmente válido.
    const cpfValido = (c) => {
      if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false;
      let s = 0; for (let i = 0; i < 9; i++) s += +c[i] * (10 - i);
      let d1 = (s * 10) % 11; if (d1 === 10) d1 = 0; if (d1 !== +c[9]) return false;
      s = 0; for (let i = 0; i < 10; i++) s += +c[i] * (11 - i);
      let d2 = (s * 10) % 11; if (d2 === 10) d2 = 0; return d2 === +c[10];
    };
    const cnpjValido = (c) => {
      if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
      const dv = (base) => { let s = 0, p = base.length - 7; for (let i = 0; i < base.length; i++) { s += +base[i] * p--; if (p < 2) p = 9; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
      return dv(c.slice(0, 12)) === +c[12] && dv(c.slice(0, 13)) === +c[13];
    };
    let docOk = (execDoc.length === 11 && cpfValido(execDoc)) || (execDoc.length === 14 && cnpjValido(execDoc));
    let execNome = String(ex.executadoNome || '').trim();

    // GEOCODIFICAÇÃO on-demand: se a MATRÍCULA revelou o endereço e o imóvel não
    // tinha (ex.: LJUD, que caem no centroide da cidade), grava e re-enfileira o
    // geocoder (geocod_nivel='refazer' → api/geocodificar.js reprocessa no nível de
    // rua). Corrige o mapa para casos como este assim que o cliente pede o laudo.
    try {
      const endMat = String(ex.enderecoImovel || '').trim();
      const baiMat = String(ex.bairroImovel || '').trim();
      const cepMat = String(ex.cepImovel || '').replace(/\D/g, '');
      if (endMat && endMat.length >= 5 && !String(im.endereco || '').trim()) {
        const patch = { endereco: endMat.slice(0, 200), geocod_nivel: 'refazer' };
        if (baiMat) patch.bairro = baiMat.slice(0, 120);
        if (cepMat.length === 8) patch.cep = cepMat;
        await sb(`imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}`, {
          method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch),
        }).catch(() => {});
        console.log(`[documental] endereço da matrícula → imóvel ${imovelId}: ${endMat}${baiMat ? ' · ' + baiMat : ''} (geocod refazer)`);
      }
    } catch { /* nunca trava o laudo */ }

    // ── FALLBACK 1: PASSE DE EXTRAÇÃO FOCADO ───────────────────────────────────
    // O passe geral (que produz o parecer inteiro) às vezes NÃO captura o CPF/nome/
    // processo da matrícula — aí certidões e CNJ não rodam e o relatório sai "vazio".
    // Quando não temos CPF válido e HÁ documentos lidos, roda um passe curto e focado
    // SÓ nesses 3 campos, com os documentos de identificação (matrícula/edital), que
    // costuma resgatar (menos distração + instrução p/ ler imagem escaneada).
    if (!docOk && Date.now() < hardDeadline) {
      const docsIdent = blocos.filter(b => b.type === 'document' || /matr[íi]cula|edital/i.test(b.title || ''));
      if (docsIdent.length) {
        try {
          const fdata = await anthropic({
            model: MODEL, max_tokens: 400,
            system: 'Você é um EXTRATOR de dados de documentos de imóvel. Leia com MÁXIMA atenção, INCLUSIVE páginas escaneadas/em imagem. A matrícula qualifica as partes com CPF (pessoa física) ou CNPJ (pessoa jurídica) nos registros (R-) e averbações (Av-). Retorne SOMENTE JSON.',
            messages: [{ role: 'user', content: [
              ...docsIdent,
              { type: 'text', text: 'Identifique o PROPRIETÁRIO ATUAL / executado / ex-mutuário do imóvel (a pessoa cujo imóvel está sendo levado a leilão). Varra a matrícula do registro/averbação MAIS RECENTE para o mais antigo e pegue o dono ATUAL. NÃO confunda com a INCORPORADORA/CONSTRUTORA que aparece como primeira proprietária (R-1, quem construiu o prédio — em regra "... INCORPORADORA/CONSTRUTORA/EMPREENDIMENTOS/SPE" com CNPJ): essa NÃO é o executado, a menos que ainda seja a dona atual. Em alienação fiduciária da Caixa (Lei 9.514), o executado é o EX-MUTUÁRIO (pessoa física, CPF). Extraia o NOME e o CPF/CNPJ DESSE proprietário atual e o NÚMERO DO PROCESSO judicial (padrão CNJ), se houver. NÃO invente: se não achar com segurança, deixe vazio. Retorne SOMENTE: {"executadoNome":"","executadoDoc":"(só dígitos)","numeroProcesso":""}' },
            ] }],
          }, { retries: 1, timeoutMs: 60000, noFallback: true });
          const fx2 = parseJSON(extractText(fdata)) || {};
          const doc2 = String(fx2.executadoDoc || '').replace(/\D/g, '');
          if (!execNome && fx2.executadoNome) { execNome = String(fx2.executadoNome).trim(); ex.executadoNome = execNome; }
          if (!ex.numeroProcesso && fx2.numeroProcesso) ex.numeroProcesso = String(fx2.numeroProcesso).trim();
          if ((doc2.length === 11 && cpfValido(doc2)) || (doc2.length === 14 && cnpjValido(doc2))) {
            execDoc = doc2; ex.executadoDoc = doc2; docOk = true;
          }
        } catch { /* passe focado é best-effort, nunca trava o parecer */ }
      }
    }

    // Se não localizamos processo por NÚMERO, busca no CNJ pelo NOME da parte
    // (executado/devedor/ex-mutuário/proprietário extraído dos documentos). Muitos
    // leilões — sobretudo extrajudiciais da Caixa — não trazem o nº do processo, mas
    // trazem o nome do devedor na matrícula; assim ainda encontramos execuções contra
    // ele (fraude à execução, outras penhoras) que o nº sozinho não acharia.
    // FALLBACK 2: nº de processo lido dos documentos (edital/matrícula) dispara a
    // consulta CNJ por NÚMERO — a 1ª consulta (antes da IA) só via o nº do scraper.
    const numExtr = String(ex.numeroProcesso || '').replace(/\D/g, '');
    if ((!cnj || !cnj.total) && numExtr.length >= 15 && numExtr !== String(procNum || '').replace(/\D/g, '') && im.estado && Date.now() < hardDeadline) {
      try { const porNum = await buscarProcessosCNJ({ numero_processo: ex.numeroProcesso, uf: im.estado }); if (porNum && porNum.total) cnj = porNum; }
      catch { /* CNJ por número extraído é best-effort */ }
    }
    let cnjViaNome = false;
    if ((!cnj || !cnj.total) && execNome.length >= 6 && im.estado) {
      try {
        const porNome = await buscarProcessosCNJ({ nome_parte: execNome, uf: im.estado });
        cnjViaNome = true;
        if (porNome && porNome.total) cnj = porNome;
      } catch { /* CNJ por nome é best-effort */ }
    }

    // FALLBACK 3: docs → CNJ → CPF da PARTE. Se ainda não temos CPF válido mas o
    // processo achado qualifica o executado (polo passivo), usa o CPF/CNPJ dele para
    // rodar as certidões. Só o POLO PASSIVO (executado/devedor) — nunca o exequente
    // (banco/Caixa), senão consultaríamos as dívidas do credor por engano.
    if (!docOk && cnj?.processos?.length) {
      const partes = cnj.processos.flatMap(p => p.partes || []);
      const passivo = partes.find(p => {
        const d = String(p.documento || '').replace(/\D/g, '');
        const okd = (d.length === 11 && cpfValido(d)) || (d.length === 14 && cnpjValido(d));
        return okd && /passiv|execu|r[ée]u|devedor|requerid/i.test(String(p.tipo || ''));
      });
      if (passivo) {
        execDoc = String(passivo.documento).replace(/\D/g, ''); ex.executadoDoc = execDoc; docOk = true;
        if (!execNome && passivo.nome) { execNome = passivo.nome; ex.executadoNome = passivo.nome; }
      }
    }
    // Anomalia (aprendizado) — INTEGRAÇÃO do CNJ: só sinaliza quando tínhamos um nº de
    // processo CONCRETO (do lote ou extraído dos docs) e mesmo assim a consulta voltou
    // VAZIA — aí sim é suspeito (nº malformado, token/fonte do CNJ fora do ar). Sem nº
    // concreto, vazio é ESPERADO e não é falha: extrajudicial (Lei 9.514, sem processo
    // judicial prévio) não tem processo — e `/judicial/i` casava "extraJUDICIAL",
    // gerando anomalia em TODO relatório extrajudicial; busca por NOME que não acha
    // nada é título limpo (boa notícia), não erro de integração.
    const numConcretoCNJ = String(procNum || ex.numeroProcesso || '').replace(/\D/g, '');
    if (numConcretoCNJ.length >= 15 && !(cnj && cnj.total)) {
      registrarAnomalia('cnj_vazio', row?.fonte, imovelId, 'cnj', `CNJ sem retorno p/ processo ${numConcretoCNJ} (modalidade=${im.modalidade || '?'}).`).catch(() => {});
    }
    const procFontes = procNum || ex.numeroProcesso || (cnj?.processos?.[0]?.numero) || null;

    // Fecha a verificação ANTIFRAUDE com o número mais completo (inclui o extraído pela
    // IA). Vira campo do result + riscos determinísticos que já entram na contagem de
    // pontos de atenção e no parecer — o cliente vê o alerta de golpe em destaque.
    const procAF = String(procFontes || '').replace(/\D/g, '');
    const temNumCNJ = procAF.length === 20;
    const dvOk = temNumCNJ ? cnjValido(procAF) : null;
    const ehExtrajudicial = /extrajud|9\.?514|consolida|fiduci/i.test(String(im.modalidade || row?.modalidade || ''));
    const riscosAntifraude = [];
    if (row?.fonte && !fonteInfo) riscosAntifraude.push({ categoria: 'Procedência do leiloeiro', severidade: 'alerta', descricao: `A origem do lote ("${row.fonte}") não está na base de leiloeiros integrados e monitorados da plataforma. Confirme a idoneidade do leiloeiro (registro na Junta Comercial/JUCESP e no tribunal) antes de qualquer lance ou pagamento.`, constaNaDoc: false });
    if (temNumCNJ && dvOk === false) riscosAntifraude.push({ categoria: 'Número do processo', severidade: 'alerta', descricao: `O número do processo informado (${procAF}) não passou na validação do dígito verificador do padrão CNJ. Pode estar digitado errado ou ser inválido: confirme o número real no tribunal antes de prosseguir.`, constaNaDoc: false });
    if (temNumCNJ && dvOk && cnj && !temProc) riscosAntifraude.push({ categoria: 'Existência do processo', severidade: 'alerta', descricao: `O processo tem número válido, mas não foi localizado no DataJud (CNJ). Pode ser defasagem do sistema, mas também é sinal de alerta: confirme a existência do processo no tribunal antes do lance.`, constaNaDoc: false });
    const antifraude = {
      fonte: row?.fonte || null,
      fonteReconhecida: row?.fonte ? !!fonteInfo : null,
      plataforma: fonteInfo?.plataforma || null,
      processoNumero: temNumCNJ ? procAF : null,
      processoDvCNJValido: dvOk,
      processoConfirmadoDataJud: temNumCNJ ? temProc : null,
      extrajudicialSemProcesso: ehExtrajudicial && !temNumCNJ,
      alertas: riscosAntifraude.map(r => r.descricao),
      verificadoEm: new Date().toISOString(),
    };
    let fontesTxt = '', fontesExternas = null;
    try {
      const [djen, cndt, cnib, prot, cert] = await Promise.all([
        procFontes ? consultarComunicaDJEN(procFontes).catch(() => null) : null,
        docOk ? consultarCNDT(execDoc).catch(() => null) : null,
        docOk ? consultarCNIB(execDoc).catch(() => null) : null,
        docOk ? consultarProtestos(execDoc).catch(() => null) : null,
        docOk ? consultarCertidoesFiscais(execDoc).catch(() => null) : null,
      ]);
      fontesExternas = { djen, cndt, cnib, protestos: prot, certidoes: cert };
      // Comprovantes: gera um comprovante PRÓPRIO (estático, sem script) de cada fonte
      // e guarda só a URL (a prova que o cliente abre). Nunca deixa o HTML cru no result
      // nem linka o portal ao vivo (era a causa da "tela de digitação").
      const COMPROV_META = {
        cndt:      { chave: 'cndt',    titulo: 'Débitos Trabalhistas (CNDT / TST)',  portalUrl: 'https://cndt-certidao.tst.jus.br/inicio.faces' },
        cnib:      { chave: 'cnib',    titulo: 'Indisponibilidade de Bens (CNIB)',    portalUrl: 'https://www.indisponibilidade.org.br/' },
        protestos: { chave: 'cenprot', titulo: 'Protestos em Cartório (CENPROT)',     portalUrl: 'https://resolve.cenprot.org.br/' },
      };
      for (const [k, f] of Object.entries(fontesExternas)) {
        if (f && f.comprovanteHtml) {
          const meta = COMPROV_META[k] || { chave: k, titulo: 'Consulta pública', portalUrl: null };
          try { const cu = await salvarComprovante(String(imovelId), meta, f); if (cu) f.comprovanteUrl = cu; } catch { /* best-effort */ }
          delete f.comprovanteHtml;
        }
      }
      const linhas = [];
      if (djen?.ok) linhas.push(`• Andamentos (DJEN/Comunica CNJ): ${djen.resumo}`);
      if (cndt?.ok) linhas.push(`• Débitos trabalhistas (CNDT): ${cndt.resumo}`);
      if (cnib?.ok) linhas.push(`• Indisponibilidade de bens (CNIB): ${cnib.resumo}`);
      if (prot?.ok) linhas.push(`• Protestos (CENPROT): ${prot.resumo}`);
      if (cert?.resumo) linhas.push(`• Certidões fiscais (Receita/PGFN/FGTS): ${cert.resumo}`);
      if (!docOk) {
        // Diligência ACIONÁVEL: diz ONDE obter a matrícula com a qualificação (CPF).
        const fc = row?.ficha_cef || {};
        const ondeObter = (fc.oficio || fc.comarca || fc.matricula)
          ? ` Obtenha a matrícula atualizada${fc.oficio ? ` no ${String(fc.oficio).replace(/^0+/, '') || fc.oficio}º Ofício de Registro de Imóveis` : ''}${fc.comarca ? ` da comarca de ${fc.comarca}` : ''}${fc.matricula ? `, matrícula nº ${fc.matricula}` : ''} — ela traz o CPF/CNPJ do proprietário/executado.`
          : ' Obtenha a matrícula atualizada no Cartório de Registro de Imóveis com a qualificação completa das partes (CPF/CNPJ).';
        linhas.push(`• CPF/CNPJ do executado/proprietário não localizado nos documentos${execNome ? ` (parte identificada: ${execNome})` : ''} — certidões por documento (CNDT/CNIB/CENPROT/fiscais) não realizadas.${ondeObter}`);
      }
      if (linhas.length) fontesTxt = `\n\n§ SEÇÃO: CERTIDÕES E FONTES EXTERNAS\n\n${linhas.join('\n')}\n\nConsultas públicas automáticas — confirme em certidão oficial atualizada antes do lance.`;
    } catch { /* fontes externas nunca derrubam o laudo */ }

    // Checklist de evolução: o que já foi consultado e o que ficou PENDENTE (fonte
    // instável/CAPTCHA) — deixa o relatório transparente e justifica o prazo p/ liberar.
    const fx = fontesExternas || {};
    // Mensagem HONESTA por fonte: não afirmamos "CAPTCHA" nem prometemos retry
    // automático que não está ligado no fluxo documental. Quando a consulta pública
    // não sai, dizemos isso e apontamos ONDE confirmar manualmente.
    // Mensagem HONESTA sem empurrar o cliente para o site do órgão: quando a fonte
    // pública não conclui sozinha, a verificação entra na validação do analista/
    // jurídico (nunca "consulte manualmente em X").
    const stItem = (label, fonte, naMsg) => {
      if (!fonte) return { label, status: 'na', detalhe: naMsg };
      if (fonte.ok) return { label, status: 'feito', detalhe: fonte.resumo || fonte.situacao || 'Consultado', comprovante: fonte.comprovanteUrl || null };
      if (fonte.diligencia) return { label, status: 'diligencia', detalhe: fonte.erro || 'Verificação incluída na validação do analista e do jurídico antes do lance.' };
      if (fonte.instavel) return { label, status: 'pendente', detalhe: 'Fonte pública indisponível no momento — o sistema reprocessa automaticamente e o jurídico valida antes do lance.' };
      return { label, status: 'na', detalhe: `${fonte.erro || 'Não foi possível consultar automaticamente'}.` };
    };
    const checklist = [
      { label: 'Procedência do lote (leiloeiro/fonte)',
        status: antifraude.fonteReconhecida ? 'feito' : (row?.fonte ? 'diligencia' : 'na'),
        detalhe: antifraude.fonteReconhecida
          ? `Origem: ${row.fonte}${antifraude.plataforma ? ` (${antifraude.plataforma})` : ''} — leiloeiro/fonte integrado e monitorado pela plataforma.`
          : (row?.fonte ? `Origem "${row.fonte}" não reconhecida — confirmar a idoneidade do leiloeiro antes do lance.` : 'Origem do lote não informada.') },
      { label: 'Documentos do lote (matrícula/edital/regras)',
        status: lidos.length ? 'feito' : (urls.length ? 'pendente' : 'na'),
        detalhe: lidos.length
          ? `${lidos.length} documento(s) lido(s): ${lidos.map(l => l.rotulo).join(', ')}`
          : (urls.length ? 'Documentos localizados, mas a fonte não liberou a leitura agora — nova tentativa em breve.' : 'Nenhum documento vinculado ao lote.') },
      { label: 'Processo judicial (CNJ/DataJud)',
        status: (cnj && cnj.total) ? 'feito' : (procFontes ? 'pendente' : 'na'),
        detalhe: (cnj && cnj.total)
          ? `${cnj.total} processo(s)${cnjViaNome ? ' (busca pelo nome da parte)' : ''} · ${(cnj.tribunais_consultados || []).join(', ') || 'tribunais consultados'}`
          : (procFontes ? 'Aguardando o DataJud (pode ter lag).'
            : (cnjViaNome ? `Nenhum processo localizado no CNJ para "${execNome}".` : 'Sem nº de processo nem nome da parte nos documentos para consultar.')) },
      stItem('Andamentos processuais (DJEN/Comunica CNJ)', fx.djen, 'Sem nº de processo para consultar.', 'comunica.pje.jus.br (Comunica CNJ) com o nº do processo'),
      stItem('Débitos trabalhistas (CNDT/BNDT)', fx.cndt, 'Sem CPF/CNPJ do executado nos documentos.', 'cndt.tst.jus.br'),
      stItem('Indisponibilidade de bens (CNIB)', fx.cnib, 'Sem CPF/CNPJ do executado nos documentos.', 'indisponibilidade.org.br'),
      stItem('Protestos em cartório (CENPROT)', fx.protestos, 'Sem CPF/CNPJ do executado nos documentos.', 'o CENPROT do estado (ex.: protesto.com.br)'),
      { label: 'Certidões fiscais (Receita/PGFN/FGTS)',
        status: fx.certidoes?.resumo ? 'feito' : (docOk ? 'pendente' : 'na'),
        detalhe: fx.certidoes?.resumo || (docOk ? 'Aguardando as fontes fiscais.' : 'Sem CPF/CNPJ do executado nos documentos.'),
        comprovante: fx.certidoes?.comprovanteUrl || null },
    ];
    const pendencias = checklist.filter(c => c.status === 'pendente').length;

    // Lembrete fixo (não-IA): análise preliminar; próximo passo é o analista e,
    // com aprovação, o laudo jurídico definitivo por advogado.
    const AVISO_DOCUMENTAL = '\n\n§ SEÇÃO: LEMBRETE E PRÓXIMO PASSO\nEsta análise documental e processual é gerada com apoio de inteligência artificial, a partir dos documentos disponíveis e de consultas públicas — pode conter imprecisões e não substitui a análise de um profissional. Recomendamos AGENDAR uma conversa com um analista para revisar o caso; uma vez aprovado, o caso é encaminhado ao JURÍDICO para emissão do LAUDO DEFINITIVO por advogado.';

    // LGPD: mascara o CPF do executado/ex-mutuário no resultado exibido (só os
    // dígitos do meio ficam visíveis). O documento cheio já foi usado nas consultas
    // acima (CNJ/certidões) e NÃO é exibido — diferencial nosso frente a quem vaza
    // o CPF completo de terceiros no relatório.
    if (parsed.extracao && parsed.extracao.executadoDoc) {
      const d = String(parsed.extracao.executadoDoc).replace(/\D/g, '');
      parsed.extracao.executadoDoc = d.length === 11 ? `•••.${d.slice(3, 6)}.${d.slice(6, 9)}-••`
        : d.length === 14 ? `••.${d.slice(2, 5)}.${d.slice(5, 8)}/••••-••` : null;
    }
    // Pontos de atenção (resumo escaneável no topo, com contagem por severidade).
    // Os riscos ANTIFRAUDE (procedência/processo) entram na frente da lista da IA.
    const rlist = [...riscosAntifraude, ...(Array.isArray(parsed.riscos) ? parsed.riscos : [])];
    const pontosAtencao = {
      total: rlist.length,
      altos: rlist.filter(r => r?.severidade === 'bloqueante').length,
      medios: rlist.filter(r => r?.severidade === 'alerta').length,
    };

    // FALLBACK 4: NUNCA emitir parecer vazio. Se a IA não devolveu texto (JSON falhou
    // ou veio curto), sintetiza um parecer preliminar determinístico com o que temos —
    // documentos lidos, dados do registro e diligências pendentes — em vez de um card
    // em branco que quebra a confiança do cliente.
    // PRELIMINAR = a IA não devolveu um parecer real (leitura não concluída / JSON
    // vazio). Marcamos explicitamente para a tela mostrar "ANÁLISE PRELIMINAR" no
    // lugar de um veredito confiante (aprovado/reprovado) que não temos base para dar.
    // Lote da Caixa cuja MATRÍCULA (documento central) não foi lida: um parecer da
    // Caixa SEM a matrícula não é confiável. Marcamos PRELIMINAR (o cron horário
    // re-gera) e garantimos a captura enfileirada (job a cada 10 min baixa a matrícula).
    // Se a captura já ESGOTOU as tentativas ('parcial' = matrícula indisponível), não
    // insistimos como preliminar — seguimos com o que há + diligência.
    const ehCaixaDoc = /caixa|cef/i.test(row?.fonte || '');
    const leuMatricula = lidos.some(l => tipoLido(l) === 'matricula') || !!body?.textoMatricula;
    let matriculaFaltaCaixa = false;
    if (ehCaixaDoc && !leuMatricula) {
      let filaStatus = null;
      try {
        const [f] = await (await sb(`cef_matricula_fila?imovel_id=eq.${encodeURIComponent(String(imovelId))}&select=status&limit=1`)).json();
        filaStatus = f?.status || null;
      } catch { /* sem fila conhecida */ }
      if (filaStatus !== 'parcial') {
        matriculaFaltaCaixa = true;
        const hdniip = (String(row?.link_matricula || '').match(/hdniip=(\d+)/) || [])[1] || String(row?.fonte_id || '').replace(/\D/g, '');
        try {
          if (!filaStatus && hdniip) {
            await sb('cef_matricula_fila?on_conflict=imovel_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify({ imovel_id: String(imovelId), hdniip, status: 'pendente' }) });
          } else if (filaStatus === 'ok') {
            // Estava 'ok' sem matrícula (captura antiga só pegou regras/edital) →
            // reabre p/ nova tentativa (mantém tentativas p/ convergir a 'parcial').
            await sb(`cef_matricula_fila?imovel_id=eq.${encodeURIComponent(String(imovelId))}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'pendente' }) });
          }
        } catch { /* best-effort */ }
      }
    }

    const preliminar = String(parsed.parecer || '').trim().length < 120 || matriculaFaltaCaixa;
    let parecerBase = String(parsed.parecer || '').trim();
    if (parecerBase.length < 120) {
      const exx = parsed.extracao || {};
      const docsNomes = lidos.map(l => l.rotulo).filter(Boolean).join(', ') || 'os documentos disponíveis';
      const p = ['§ SEÇÃO: RESUMO', `Análise preliminar gerada a partir de ${docsNomes}.`];
      if (exx.numeroMatricula || exx.cartorio || exx.comarca) {
        p.push('§ SEÇÃO: REGISTRO DO IMÓVEL', `Matrícula ${exx.numeroMatricula || '(número a confirmar)'}${exx.cartorio ? `, ${exx.cartorio}` : ''}${exx.comarca ? `, comarca de ${exx.comarca}` : ''}.`);
      }
      p.push('§ SEÇÃO: DILIGÊNCIAS PENDENTES', !docOk
        ? 'Não foi possível extrair o CPF/CNPJ do proprietário/executado dos documentos disponíveis, então as certidões pessoais (trabalhista, indisponibilidade, protestos e fiscais) ainda não foram feitas. Veja abaixo onde obter a matrícula com a qualificação das partes.'
        : 'As consultas foram feitas com base no CPF/CNPJ identificado; confira os apontamentos na seção de certidões abaixo.');
      p.push('Recomendamos revisar este caso com um analista antes de dar o lance.');
      parecerBase = p.join('\n\n');
    }

    // DOCUMENTOS FALTANTES (para a tela pedir só o que falta). Usa a confirmação da
    // IA (documentosAnalisados) — que reconhece o doc mesmo quando o tipo do anexo
    // ficou 'outro' (URL opaca, ex.: SUPERBID) — combinada com o tipo já classificado.
    const da = parsed.documentosAnalisados || {};
    const isVendaDiretaDoc = /venda_direta/i.test(String(row?.modalidade || ''));
    const leuEdital = !!da.edital || lidos.some(l => ['edital', 'regras_venda'].includes(tipoLido(l))) || !!body?.textoEdital;
    const leuMatriculaFinal = !!da.matricula || leuMatricula;
    const faltando = [];
    if (!leuMatriculaFinal) faltando.push('matricula');
    if (!leuEdital) faltando.push(isVendaDiretaDoc ? 'regras_venda' : 'edital');
    // Link da página do lote no leiloeiro (para o cliente buscar o doc que falta).
    const paginaLeiloeiro = [row?.link_edital, row?.link_regras_venda].find(u => /^https?:\/\//i.test(u || '')) || null;

    // TRAVA PÓS-GERAÇÃO: a análise jurídica SÓ é entregue com a MATRÍCULA e o EDITAL
    // efetivamente LIDOS. Se a IA não confirmou a leitura de uma delas (nem por tipo do
    // anexo), NÃO devolvemos um laudo inconclusivo ("não identifiquei o CPF/não li o
    // documento"): pedimos APENAS a(s) que falta(m) e enfileiramos a captura automática.
    if (faltando.length) {
      const ehCaixaFonte = /caixa|cef/i.test(row?.fonte || '');
      const temPaginaLote = /^https?:\/\//i.test(String(row?.link_edital || '')) || /^https?:\/\//i.test(String(row?.link_regras_venda || ''));
      // A captura da matrícula Caixa já foi enfileirada acima (matriculaFaltaCaixa).
      // Para os demais integrados, enfileira a captura genérica por navegador.
      let enfileirado = matriculaFaltaCaixa;
      if (!ehCaixaFonte && temPaginaLote) {
        try {
          await sb('documentos_fila?on_conflict=imovel_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ imovel_id: String(imovelId), status: 'pendente' }) });
          enfileirado = true;
          await dispararCaptura('captura-documentos.yml');
        } catch { /* segue com a mensagem */ }
      }
      // A matrícula NÃO chega sozinha por aqui quando é login-gated (ZUK/GRUPOLANCE — a
      // captura genérica dispara mas PULA essas fontes) OU já foi negative-cached (checamos e
      // a fonte não publica). Sem re-disparo do laudo, prometer "sai sozinha" trava o usuário
      // no "Preparando os documentos…" para sempre. Nesses casos: mensagem HONESTA + anexo
      // manual (que funciona na hora). Caixa segue com captura automática (pipeline próprio).
      const matriculaNaoAutoResolve = faltando.includes('matricula') && !ehCaixaFonte
        && (temLoginParaFonte(row?.fonte) || !!row?.matricula_checada_em);
      const emCaptura = enfileirado && !matriculaNaoAutoResolve;
      const nomeDoc = (t) => t === 'matricula' ? 'a matrícula' : t === 'regras_venda' ? 'as regras da venda' : 'o edital';
      const faltaTxt = faltando.map(nomeDoc).join(' e ');
      const jaTemTxt = lidos.length ? `Já lemos ${lidos.map(l => l.rotulo).join(', ')}. ` : '';
      const semDocs = {
        precisaDocumentos: true,
        integrado: (ehCaixaFonte || temPaginaLote) && !matriculaNaoAutoResolve,
        emCaptura,
        faltando,
        paginaLeiloeiro,
        documentosLidos: lidos.map(l => ({ rotulo: l.rotulo, tipo: tipoLido(l) })),
        motivo: emCaptura
          ? `A análise jurídica só é gerada com a matrícula e o edital lidos. ${jaTemTxt}Estamos obtendo ${faltaTxt} automaticamente${ehCaixaFonte ? ' direto da Caixa' : ''}: leva cerca de 1 minuto e a análise sai sozinha quando chegar. Se preferir na hora, anexe ${faltaTxt} (PDF).`
          : matriculaNaoAutoResolve
            ? `Este leiloeiro não publica a matrícula on-line (ela sai por acesso restrito). ${jaTemTxt}Anexe ${faltaTxt} (PDF) — que você baixa na página do lote/leiloeiro — para gerar a análise agora.`
            : `A análise jurídica só é gerada com a matrícula e o edital lidos. ${jaTemTxt}Anexe ${faltaTxt} (PDF) para gerar a análise.`,
      };
      // RAIZ do "Preparando documentos…" preso: sem regen_motivo, o regenerar-relatorios-cron
      // NUNCA reprocessava este estado — então, quando a matrícula chegava (ou a captura falhava),
      // nada regerava o laudo. Marcamos 'matricula_nao_lida' SÓ quando a captura pode se resolver
      // sozinha (emCaptura): aí o cron re-roda a geração e, com a matrícula já baixada, emite o
      // laudo completo e o vício some. Quando NÃO auto-resolve (anexar manual), fica null (estado
      // final — sem gastar IA à toa).
      await upsertDoc({ ...base, status: 'concluida', erro: null, result: semDocs, regen_motivo: emCaptura ? 'matricula_nao_lida' : null });
      // APRENDIZADO PERSISTENTE (sobrevive à regeração, que sobrescreve o result):
      // se TÍNHAMOS o(s) documento(s) no bucket e a leitura voltou 0, é falha de
      // LEITURA (arquivo ilegível/assinatura, não "doc ainda não capturado"). Registra
      // a anomalia idempotente p/ a saúde investigar — o dono quer manter esse log.
      if (!lidos.length && tiposGuardados.length) {
        registrarAnomalia('doc_guardado_nao_lido', row?.fonte, imovelId, 'documentos',
          `Documento(s) no bucket (${tiposGuardados.join(', ')}) não lidos na geração — verificar arquivo/assinatura.`).catch(() => {});
      }
      if (cota && cota.ok && cota.tipo) {
        try { await sb('rpc/estornar_documental_por', { method: 'POST', body: JSON.stringify({ p_user_id: user.id, p_tipo: cota.tipo }) }); } catch { /* estorno best-effort */ }
      }
      return semDocs;
    }

    const result = {
      extracao: parsed.extracao || null,
      riscos: rlist,
      antifraude,
      pontosAtencao,
      faltando,
      paginaLeiloeiro,
      lacunas: parsed.lacunas || [],
      nivelRisco: parsed.nivelRisco || (temProc ? cnj.parecer?.nivel : null) || 'amarelo',
      diligenciaPendente: !docOk,
      preliminar,
      parecer: parecerBase + fontesTxt + AVISO_DOCUMENTAL,
      cnj: cnj ? { total: cnj.total, parecer: cnj.parecer, processos: cnj.processos?.slice(0, 12) || [], tribunais: cnj.tribunais_consultados } : null,
      fontesExternas,
      documentosLidos: lidos,
      checklist,
      pendencias,
      raioX: parsed.raioX || null,
      // Divergência de IDENTIDADE do imóvel (docs descrevem outro imóvel) — NÃO é risco jurídico;
      // a tela mostra um aviso próprio e oferece regerar com os dados corretos.
      divergenciasImovel: parsed._divergenciasDoc || [],
      geradoEm: new Date().toISOString(),
    };
    // APRENDER NA EMISSÃO (durável, sem IA) + apontar regeração se houver vício.
    const qualDoc = {
      matricula_nao_lida: !da.matricula,
      edital_nao_lido: !da.edital,
      cnj_nao_consultado: !!(procNum || procNome) && !temProc,
      modalidade_indefinida: !im.modalidade,
    };
    await upsertDoc({ ...base, status: 'concluida', erro: null, result, regen_motivo: vicioRegen(qualDoc), regen_em: new Date().toISOString() });
    // Cobra o CRÉDITO quando esta geração usou crédito (cota mensal esgotada). Só aqui, no
    // sucesso REAL (com laudo) — os caminhos de "faltam documentos" estornam a cota e não
    // cobram. Débito = custo real medido × multiplicador; nunca negativa (já pré-autorizado).
    if (cobrarCredito) {
      try {
        const dc = await sb('rpc/debitar_credito', { method: 'POST', body: JSON.stringify({
          p_user_id: user.id, p_func: 'documental', p_custo_micro: Math.round(_custoMicroReq),
          p_justificativa: `Análise documental e jurídica — ${im.cidade || ''}/${im.estado || ''}`, p_referencia: String(imovelId),
        }) });
        cota = { ...(cota || {}), credito: await dc.json().catch(() => null) };
      } catch { /* débito best-effort: não trava a entrega do laudo já pronto */ }
    }
    await aprenderNaEmissao(sb, { agente: 'documental', imovel: { id: imovelId, cidade: row?.cidade, estado: row?.estado, tipo: row?.tipo, modalidade: im.modalidade },
      corpus: { tem_cnj: temProc, n_processos: cnj?.total || 0, matricula_lida: !!da.matricula, edital_lido: !!da.edital, n_riscos: (result.riscos || []).length },
      qualidade: qualDoc });

    // Alimenta a camada JURÍDICO do Score BidPro no acervo (antes ficava 0/acervo:
    // só o fluxo staff gravava). Deriva 0–100 do nível de risco + severidade dos
    // riscos encontrados. score_financeiro já é preenchido por backfill determinístico.
    try {
      const risc = Array.isArray(result.riscos) ? result.riscos : [];
      const bloqueantes = risc.filter(r => r?.severidade === 'bloqueante').length;
      const alertas     = risc.filter(r => r?.severidade === 'alerta').length;
      const baseJur = result.nivelRisco === 'verde' ? 85 : result.nivelRisco === 'vermelho' ? 30 : 55;
      const scoreJuridico = Math.max(0, Math.min(100, Math.round(baseJur - bloqueantes * 10 - alertas * 4)));
      await sb(`imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ score_juridico: scoreJuridico, score_calculado_em: new Date().toISOString() }),
      });
    } catch { /* não bloqueia o laudo */ }

    // Ficha do imóvel (cartório/ofício, comarca, matrícula, ocupação) lida da
    // matrícula/edital pela IA — disponibiliza na TELA DO IMÓVEL para todo lote
    // judicial/extrajudicial, sem custo extra (mesma leitura do laudo). Faz MERGE
    // com a ficha existente (ex.: a que o cron da Caixa capturou) e nunca apaga.
    try {
      const ex = parsed.extracao || {};
      const extra = {};
      const setStr = (k, v) => { const s = String(v || '').trim(); if (s && !/^(n[ãa]o consta|n\/a|-|vazio)$/i.test(s)) extra[k] = s; };
      setStr('cartorio', ex.cartorio);
      setStr('comarca', ex.comarca);
      setStr('matricula', ex.numeroMatricula);
      if (ex.ocupacao) setStr('ocupacao', ex.ocupacao);
      // Dados-chave da matrícula (inspirado no que os concorrentes destacam).
      setStr('dataConsolidacao', ex.dataConsolidacao);
      setStr('condominioNome', ex.condominioNome);
      setStr('condominioCnpj', ex.condominioCnpj);
      if (ex.indisponibilidadePenhora && ex.indisponibilidadePenhora !== 'nao_consta') extra.indisponibilidadePenhora = ex.indisponibilidadePenhora;
      if (Object.keys(extra).length) {
        const fichaMerged = { ...(row?.ficha_cef && typeof row.ficha_cef === 'object' ? row.ficha_cef : {}), ...extra };
        await sb(`imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}`, {
          method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ficha_cef: fichaMerged }),
        });
      }
    } catch { /* não bloqueia o laudo */ }

    // MAPA EXATO a partir da MATRÍCULA: o endereço exato do imóvel só consta na
    // matrícula (o anúncio de leilão costuma trazer só cidade/UF). A IA já leu a
    // matrícula para o laudo — aproveitamos o endereço extraído para: (1) gravar o
    // endereço/bairro/CEP no imóvel; (2) geocodificar para nível 'endereço' (o pino
    // exato no mapa). Best-effort: nunca bloqueia o laudo; se faltar tempo, só grava
    // o endereço e o /geocodificar-imovel refina depois (ao abrir a tela).
    try {
      const ex = parsed.extracao || {};
      const via = String(ex.enderecoImovel || '').replace(/\s+/g, ' ').trim();
      const temVia = via.length > 5 && /(rua|r\.|av|avenida|travessa|tv\.|alameda|al\.|estrada|estr\.|rodovia|rod\.|pra[çc]a|largo|quadra|lote|via|rma)\b/i.test(via);
      const muniMat = String(ex.municipioImovel || '').replace(/\s+/g, ' ').trim();
      const ufMat = String(ex.ufImovel || '').trim().toUpperCase();
      const normC = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const [imGeo] = await (await sb(`imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}&select=id,endereco,bairro,cidade,estado,latitude,longitude,geocod_nivel,cep&limit=1`)).json();
      // A matrícula é a FONTE DE VERDADE do endereço. Corrige a CIDADE quando o município do
      // IMÓVEL (da descrição da matrícula) diverge do gravado — na inclusão/atribuição manual, o
      // endereço do COMPRADOR (comprovante) às vezes era digitado no lugar do imóvel, gerando
      // pesquisa de mercado na cidade ERRADA. Também deixa o endereço da matrícula sobrescrever um
      // endereço numerado quando a cidade diverge (senão o guarda antigo travava a correção).
      const cidadeDivergente = !!imGeo && muniMat.length >= 3 && /^[A-Z]{2}$/.test(ufMat) && normC(muniMat) !== normC(imGeo.cidade);
      const atualSemNum = !(String(imGeo?.endereco || '').match(/\d/));
      if (imGeo && temVia && (atualSemNum || cidadeDivergente)) {
        const bairro = String(ex.bairroImovel || (cidadeDivergente ? '' : imGeo.bairro) || '').trim();
        const cep = (String(ex.cepImovel || '').replace(/\D/g, '').slice(0, 8)) || (cidadeDivergente ? null : imGeo.cep) || null;
        const patch = { endereco: via, ...(bairro ? { bairro } : {}), ...(cep ? { cep } : {}) };
        if (cidadeDivergente) {
          patch.cidade = muniMat; patch.estado = ufMat;
          // cidade mudou → zera geocode/proximidades (estavam na cidade errada); re-geocodifica.
          Object.assign(patch, { latitude: null, longitude: null, geocod_nivel: null, pontos_proximos: null, proximidades_em: null });
          console.log(`[documental] CIDADE corrigida pela matrícula → imóvel ${imovelId}: "${imGeo.cidade}/${imGeo.estado}" → "${muniMat}/${ufMat}" (regenerar o mercadológico: a pesquisa anterior usou a cidade errada)`);
        }
        const nivelAtual = cidadeDivergente ? null : (imGeo.geocod_nivel || (imGeo.latitude ? 'cidade' : null));
        if (Date.now() < hardDeadline - 14000 && rankNivel(nivelAtual) < rankNivel('endereco')) {
          let coords = null;
          try { coords = await geocodificarCascata({ ...imGeo, ...patch, endereco: via, bairro, cep }, { sleepMs: 0, deadline: Date.now() + 10000 }); } catch { /* */ }
          if (coords && coordValida(coords.lat, coords.lng, patch.estado || imGeo.estado, patch.cidade || imGeo.cidade) && rankNivel(coords.nivel) > rankNivel(nivelAtual)) {
            Object.assign(patch, { latitude: coords.lat, longitude: coords.lng, geocod_nivel: coords.nivel, pontos_proximos: null, proximidades_em: null });
          }
        }
        await sb(`imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}`, {
          method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch),
        });
      }
    } catch { /* geo pela matrícula é best-effort */ }

    // Guarda o nº do PROCESSO (CNJ) extraído quando o imóvel não tem — é a CHAVE FORTE p/ cruzar
    // com o edital do DJEN (editais_enriquecer_acervo) e preencher avaliação/área/endereço que
    // faltam, DE GRAÇA. Assim "edital + leiloeiro + DJEN" se completam pela chave do processo.
    try {
      const proc = String(parsed.extracao?.numeroProcesso || '').trim();
      if (/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/.test(proc)) {
        const [imP] = await (await sb(`imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}&select=numero_processo&limit=1`)).json();
        if (imP && !String(imP.numero_processo || '').trim()) {
          await sb(`imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}`, {
            method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ numero_processo: proc }),
          }).catch(() => {});
        }
      }
    } catch { /* captura do processo é best-effort */ }

    // Raio-X jurídico COMPACTO na TELA DO IMÓVEL (selos + campos): persiste um
    // resumo do raioX no imóvel para a ficha exibir sem reabrir o laudo. Custo
    // zero (mesma leitura). Sobrescreve com o dado mais recente da análise.
    try {
      const rx = parsed.raioX || {};
      const oc = rx.ocupacaoDetalhe || {};
      const fj = {
        nivelRisco: result.nivelRisco || null,
        fraudeExecucao: rx.fraudeExecucao?.risco && rx.fraudeExecucao.risco !== 'nenhum' ? rx.fraudeExecucao.risco : null,
        direitoPreferencia: !!(rx.direitoPreferencia?.existe),
        ocupacaoTipo: oc.tipo && oc.tipo !== 'nao_consta' ? oc.tipo : null,
        desocupacaoPrazoMeses: Number(oc.prazoMeses) || null,
        desocupacaoCusto: Number(oc.custoEstimado) || null,
        debitosAssumidos: Number(rx.debitos?.totalAssumidoArrematante) || null,
        debitosALevantar: !!(rx.debitos?.aLevantar),
        proprietariosNaCadeia: Array.isArray(rx.cadeiaDominial) ? rx.cadeiaDominial.filter(a => a && (a.parte || a.evento)).length : 0,
        primeiraPraca: rx.cronogramaLeilao?.primeiraPraca || null,
        segundaPraca: rx.cronogramaLeilao?.segundaPraca || null,
        prazoPagamento: rx.cronogramaLeilao?.prazoPagamento || null,
        certidoesPendentes: Array.isArray(rx.certidoesRecomendadas) ? rx.certidoesRecomendadas.length : 0,
        areaPrivativaM2: Number(parsed.extracao?.areaPrivativaM2) || null,
        areaTotalM2: Number(parsed.extracao?.areaTotalM2) || null,
        areaTerrenoM2: Number(parsed.extracao?.areaTerrenoM2) || null,
        atualizadoEm: new Date().toISOString(),
      };
      await sb(`imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ficha_juridica: fj }),
      });
    } catch { /* não bloqueia o laudo */ }

    // Data do leilão/prazo de propostas: a lista em massa da Caixa vem SEM data para
    // licitação/judicial/venda direta — mas o edital tem. Se a IA extraiu e o imóvel
    // está sem data, grava no imóvel (mantém a base fiel à fonte, sem sobrescrever).
    try {
      const dRaw = String(parsed.extracao?.dataLeilao || '').trim();
      const mIso = dRaw.match(/(\d{4})-(\d{2})-(\d{2})/);
      const mBr = dRaw.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      const iso = mIso ? `${mIso[1]}-${mIso[2]}-${mIso[3]}` : mBr ? `${mBr[3]}-${mBr[2]}-${mBr[1]}` : null;
      if (iso && !row?.data_leilao) {
        await sb(`imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}`, {
          method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ data_leilao: iso }),
        });
      }
    } catch { /* não bloqueia o laudo */ }

    // ÁREA PRIVATIVA da MATRÍCULA/EDITAL = base AUTORITATIVA do valor de mercado. O site do
    // leiloeiro às vezes traz a área TOTAL/terreno (ex.: ZUK caía no fallback total) e inflava o
    // mercadológico. A matrícula qualifica a área privativa/construída — quando a extração traz
    // uma privativa plausível e MATERIALMENTE diferente da atual, corrige imoveis_leilao.area_m2
    // (que o mercadológico usa como base). Coerência: se houver avaliação, só aceita a nova área
    // se aproximar o R$/m² implícito de um patamar plausível (evita OCR ruim piorar o dado).
    try {
      const aPriv = Number(parsed.extracao?.areaPrivativaM2) || 0;
      if (aPriv >= 5 && aPriv <= 100000) {
        const atual = Number(row?.area_m2) || 0;
        const difMaterial = atual <= 0 || Math.abs(aPriv - atual) / Math.max(atual, aPriv) > 0.03;
        // Se temos avaliação, a área da matrícula não pode gerar um R$/m² absurdo (proteção
        // contra número mal lido): aceita quando 200 <= avaliação/área <= 200000 R$/m².
        const aval = Number(row?.valor_avaliacao) || 0;
        const m2Novo = aval > 0 ? aval / aPriv : 0;
        const coerente = aval <= 0 || (m2Novo >= 200 && m2Novo <= 200000);
        if (difMaterial && coerente) {
          await sb(`imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}`, {
            method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ area_m2: aPriv }),
          }).catch(() => {});
          console.log(`[documental] área privativa da matrícula/edital → imóvel ${imovelId}: ${atual || '—'} → ${aPriv} m² (base do mercadológico corrigida)`);
        }
      }
    } catch { /* não bloqueia o laudo */ }

    // ITEM 2 — CORREÇÃO COM IMPACTO: se a matrícula/edital corrige um dado que o MERCADOLÓGICO
    // já usou (cidade, metragem), NÃO regera em silêncio — registra a correção + o IMPACTO na
    // análise de mercado p/ a tela OFERECER regerar ao usuário (o dono pediu: informar o impacto
    // e dar a opção). A proveniência vem da matrícula/edital (lidos por IA acima).
    try {
      const ex = parsed.extracao || {};
      const muni = String(ex.municipioImovel || '').trim();
      const uf = String(ex.ufImovel || '').trim().toUpperCase();
      const aPriv = Number(ex.areaPrivativaM2) || 0;
      const normC = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      let merc = null;
      try { [merc] = await (await sb(`analises_mercado?imovel_id=eq.${encodeURIComponent(String(imovelId))}&status=eq.concluida&select=id,imovel,created_at&order=created_at.desc&limit=1`)).json(); } catch { /* sem mercadológico ainda */ }
      if (merc) {
        const usouCidade = String(merc.imovel?.cidade || '').trim();
        const usouArea = Number(merc.imovel?.areaM2 || merc.imovel?.area_m2) || 0;
        const correcoes = [];
        if (muni.length >= 3 && /^[A-Z]{2}$/.test(uf) && usouCidade && normC(muni) !== normC(usouCidade)) {
          correcoes.push({ campo: 'cidade', de: usouCidade, para: `${muni}/${uf}`,
            impacto: `A pesquisa de mercado foi feita em ${usouCidade}, mas a matrícula indica que o imóvel fica em ${muni}/${uf}. Isso muda os comparáveis e o valor de mercado — recomenda-se regerar o relatório.` });
        }
        if (aPriv >= 5 && aPriv <= 100000 && usouArea > 0 && Math.abs(aPriv - usouArea) / Math.max(aPriv, usouArea) > 0.05) {
          correcoes.push({ campo: 'metragem', de: `${usouArea} m²`, para: `${aPriv} m²`,
            impacto: `A metragem usada foi ${usouArea} m², mas a matrícula indica ${aPriv} m². O valor de mercado é calculado por R$/m² × área — o valor estimado muda proporcionalmente.` });
        }
        if (correcoes.length) {
          result.correcoesMercado = correcoes; // devolve à tela p/ oferecer regerar na hora
          await sb(`analises_mercado?id=eq.${encodeURIComponent(merc.id)}`, {
            method: 'PATCH', headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ correcoes_sugeridas: { detectado_em: new Date().toISOString(), fonte: 'documental', correcoes } }),
          }).catch(() => {});
        }
      }
    } catch { /* detecção de impacto é best-effort, nunca bloqueia o laudo */ }

    return result;
    })()]);

    res.status(200).json({ ok: true, result });
  } catch (e) {
    const timeout = String(e?.message) === 'tempo_limite' || /abort|timed? *out|timeout/i.test(String(e?.message));
    const msg = timeout ? 'A geração excedeu o tempo limite do servidor. Costuma ser temporário: tente novamente.' : String(e?.message || e);
    await upsertDoc({ ...base, status: 'erro', erro: msg });
    // Estorna a cota consumida (não cobra por análise que falhou).
    if (cota && cota.ok && cota.tipo) {
      try { await sb('rpc/estornar_documental_por', { method: 'POST', body: JSON.stringify({ p_user_id: user.id, p_tipo: cota.tipo }) }); } catch { /* estorno best-effort */ }
    }
    res.status(timeout ? 504 : 500).json({ error: timeout ? 'Tempo limite ao gerar a análise documental' : 'Falha ao gerar a análise documental', detalhe: msg });
  }
}
