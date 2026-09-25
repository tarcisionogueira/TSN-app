/**
 * ORIGEM DA VENDA DO VEÍCULO PELO EDITAL — 25/09 (pedido do dono: "veja o edital, documento que o
 * leiloeiro forneça do evento, para confirmar as informações dos carros").
 *
 * `classificar_origem_veiculo()` lê o nome do leilão/comitente que a LISTAGEM traz. Onde a listagem
 * não diz quem vende (LJUD, SUPORTE, WEBLEILOES — 319 lotes sem origem em 25/09), o edital diz, e
 * onde a listagem diz, o edital confirma. Um edital vale para o EVENTO inteiro (no SUPERBID, o mesmo
 * PDF para até 102 lotes), então cada documento é baixado e lido UMA vez.
 *
 * Sinais do documento, em ordem de precedência (o primeiro que casar decide):
 *   patio        — CTB art. 328 / Lei 9.503, "veículos removidos/apreendidos", Detran, RENAJUD
 *   seguradora   — "salvado(s)", seguradora como comitente
 *   financeira   — alienação fiduciária, Decreto-Lei 911, busca e apreensão, retomada
 *   judicial     — vara, juiz(a) de direito, exequente/executado, processo judicial nº
 *   orgao_publico— Lei 14.133 / 8.666, prefeitura/município/governo como vendedor
 *   corporativo  — comitente empresa (Ltda, S/A) ou frota/desmobilização
 * Documento com sinais FORTES de duas categorias (edital de lotes mistos) → 'misto' → não aplica:
 * não sabe qual vale para cada lote (mesma guarda do local do pátio em local-e-area-do-documento.mjs).
 *
 * EM SECO por padrão (forma nº 10): imprime por documento o comitente, os sinais e o que mudaria.
 * Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY; EDITAL_LIMITE (documentos, padrão 300).
 */
import { carregarPDFParse } from '../api/_pdf-safe.js';

const SB_URL = process.env.VITE_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const LIMITE = Number(process.env.EDITAL_LIMITE || 300);
const MAX_BYTES = 15 * 1024 * 1024;
if (!SB_URL || !SB_KEY) { console.error('defina VITE_SUPABASE_URL e SUPABASE_SERVICE_KEY'); process.exit(1); }

async function sb(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, signal: AbortSignal.timeout(30000) });
  const t = await r.text();
  if (!r.ok) throw new Error(`supabase ${r.status} em ${path.split('?')[0]}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}
async function todas(path) {
  const out = [];
  for (let de = 0; ; de += 1000) {
    const pag = await sb(`${path}&limit=1000&offset=${de}`);
    out.push(...pag);
    if (pag.length < 1000) return out;
  }
}

const PDFParse = await carregarPDFParse();
if (!PDFParse) { console.error('pdf-parse indisponível'); process.exit(1); }

// PDFs institucionais do SUPERBID grudados em 512 lotes cada (privacidade, cookies…) — não são do evento.
const RE_LIXO = /politicas-institucionais|aviso-de-privacidade|cookies|termos-de-uso|MAISATIVO-RELATORIO|Politica_de_Privacidade|modelo-de-proposta/i;
const ehEdital = (a) => a?.url && !RE_LIXO.test(a.url) && (a.tipo === 'edital' || /\/event\/\d+\/attachment\//.test(a.url) || /sl-doc/.test(a.url) || /edital/i.test(a.nome || ''));

async function textoDe(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(40000) });
    if (!r.ok) return { erro: `http_${r.status}` };
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > MAX_BYTES) return { erro: 'tamanho' };
    if (buf.subarray(0, 5).toString() !== '%PDF-') return { erro: 'nao_e_pdf' };
    const p = new PDFParse({ data: buf });
    try {
      const texto = String((await p.getText())?.text || '').replace(/\s+/g, ' ');
      return texto.replace(/\s/g, '').length < 200 ? { erro: 'sem_camada_de_texto' } : { texto };
    } finally { await p.destroy().catch(() => {}); }
  } catch (e) { return { erro: `excecao:${String(e?.message || e).slice(0, 60)}` }; }
}

const SINAIS = [
  ['patio', /art(?:igo)?\.?\s*328|lei\s*n?[º°o.]*\s*9\.?503|ve[íi]culos?\s+(?:removidos|apreendidos|recolhidos)|recolhid[oa]s?\s+ao\s+p[áa]tio|\bdetran\b|\brenajud\b|\bciretran\b/gi],
  ['seguradora', /\bsalvados?\b|\bsegurador[a]\b|\bseguros\s+s\.?\/?a\b/gi],
  ['financeira', /aliena[çc][ãa]o\s+fiduci[áa]ria|decreto[-\s]lei\s*n?[º°o.]*\s*911|busca\s+e\s+apreens[ãa]o|\bretomad[oa]s?\b|\bleasing\b|arrendamento\s+mercantil/gi],
  ['judicial', /\b\d+\s*[ªºa]?\s*vara\b|ju[íi]za?\s+de\s+direito|\bexequente\b|\bexecutad[oa]\b|processo\s+(?:judicial\s+)?n?[º°o.]*\s*\d{5,}/gi],
  ['orgao_publico', /lei\s*(?:federal\s*)?n?[º°o.]*\s*(?:14\.?133|8\.?666)|prefeitura\s+municipal\s+de|governo\s+do\s+estado|bens?\s+inserv[íi]ve(?:l|is)/gi],
  ['corporativo', /comitente[^.;]{0,90}\b(?:ltda|s\.?\/?a\.?|eireli)\b|renova[çc][ãa]o\s+de\s+frota|desmobiliza[çc][ãa]o|\bfrota\s+pr[óo]pria\b/gi],
];
const RE_COMITENTE = /(comitente(?:\s+vendedor)?|vendedor(?:a)?|propriet[áa]ri[oa]\s+do[s]?\s+bens?)\s*[:\-–]?\s*([^.;]{3,110})/i;

function classificarDoc(texto) {
  const hits = Object.fromEntries(SINAIS.map(([k, re]) => [k, (texto.match(re) || []).length]));
  const fortes = Object.entries(hits).filter(([, n]) => n >= 2).map(([k]) => k);
  const primeiro = SINAIS.find(([k]) => hits[k] > 0)?.[0] || null;
  // Mais de uma categoria forte, sem ser o par esperado (pátio cita órgão público; judicial cita
  // financeira em busca e apreensão) → documento de lotes mistos.
  const par = new Set(fortes);
  const conviventes = (a, b) => par.has(a) && par.has(b) && par.size === 2;
  const misto = fortes.length >= 2 && !conviventes('patio', 'orgao_publico') && !conviventes('financeira', 'judicial');
  return { hits, origem: misto ? 'misto' : primeiro, comitente: (texto.match(RE_COMITENTE)?.[2] || '').trim().slice(0, 110) };
}

const veiculos = await todas('veiculos_leilao?ativo=eq.true&anexos=not.is.null&select=id,fonte,origem_venda,anexos');
const porDoc = new Map();
for (const v of veiculos) for (const a of (v.anexos || [])) {
  if (!ehEdital(a)) continue;
  if (!porDoc.has(a.url)) porDoc.set(a.url, { url: a.url, fonte: v.fonte, lotes: [] });
  porDoc.get(a.url).lotes.push({ id: v.id, origem: v.origem_venda });
}
const docs = [...porDoc.values()].sort((a, b) => b.lotes.length - a.lotes.length).slice(0, LIMITE);
console.log(`=== edital-origem-veiculos (EM SECO) · ${docs.length} documento(s) de ${porDoc.size}, ${veiculos.length} veículos com anexo ===`);

const resumo = { lidos: 0, erro: {}, porOrigem: {}, lotesMudariam: 0, lotesConfirmados: 0, lotesPreenchidos: 0, lotesDivergentes: 0 };
for (const d of docs) {
  const { texto, erro } = await textoDe(d.url);
  if (!texto) { resumo.erro[erro] = (resumo.erro[erro] || 0) + 1; console.log(`  ✗ ${d.fonte} ${erro} (${d.lotes.length} lotes) ${d.url.slice(0, 90)}`); continue; }
  resumo.lidos++;
  const c = classificarDoc(texto);
  resumo.porOrigem[c.origem || 'sem_sinal'] = (resumo.porOrigem[c.origem || 'sem_sinal'] || 0) + d.lotes.length;
  const atual = {};
  for (const l of d.lotes) atual[l.origem] = (atual[l.origem] || 0) + 1;
  if (c.origem && c.origem !== 'misto') for (const l of d.lotes) {
    if (l.origem === c.origem) resumo.lotesConfirmados++;
    else if (l.origem === 'nao_identificado') { resumo.lotesPreenchidos++; resumo.lotesMudariam++; }
    else { resumo.lotesDivergentes++; resumo.lotesMudariam++; }
  }
  console.log(`  ${d.fonte} · ${d.lotes.length} lote(s) · edital → ${c.origem || 'sem_sinal'} · hoje ${JSON.stringify(atual)} · sinais ${JSON.stringify(c.hits)}${c.comitente ? ` · comitente: "${c.comitente}"` : ''}`);
}
console.log(`\n[resumo] ${JSON.stringify(resumo)}`);
