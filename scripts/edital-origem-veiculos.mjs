/**
 * ORIGEM DA VENDA DO VEÍCULO PELO EDITAL — 25/09 (pedido do dono: "veja o edital, documento que o
 * leiloeiro forneça do evento, para confirmar as informações dos carros").
 *
 * `classificar_origem_veiculo()` lê o nome do leilão/comitente que a LISTAGEM traz. Onde a listagem
 * não diz quem vende (LJUD, SUPORTE, WEBLEILOES — 319 lotes sem origem em 25/09), o edital diz, e
 * onde a listagem diz, o edital confirma. Um edital vale para o EVENTO inteiro (no SUPERBID, o mesmo
 * PDF para até 102 lotes), então cada documento é baixado e lido UMA vez.
 *
 * Regra: a 1ª página do edital diz quem vende (ver REGRAS abaixo). O edital só PREENCHE o que a
 * listagem deixou em nao_identificado — o gatilho `trg_veiculo_origem_venda` decide.
 *
 * EM SECO por padrão (forma nº 10): imprime por documento a origem, o trecho que decidiu e o que
 * mudaria. EDITAL_GRAVAR=1 grava `origem_edital`/`comitente_edital` (o gatilho decide a origem).
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

// REGRA PELO CABEÇALHO (25/09, caminho 1 do dono). O 1º seco contou palavras no documento
// INTEIRO e errou pelo texto-padrão (LJUD cita "juiz" em cláusula; um RENAJUD no rodapé virava
// pátio). O recon do trecho (recon-edital-trecho-lote.mjs) mostrou que QUEM VENDE está na 1ª
// página: "PODER JUDICIÁRIO … 6ª VARA", "TRIBUNAL REGIONAL DO TRABALHO", "O MUNICÍPIO DE …
// Lei 14.133", "Ministério da Justiça … tráfico", "COMITENTE(S) VENDEDOR(ES) … LTDA". Só o
// cabeçalho entra; a 1ª regra que casar decide. "Ministério da Fazenda" fica de fora (é o CNPJ da
// empresa, "inscrita no CNPJ do Ministério da Fazenda", não quem vende).
const CAB = 3500;
const REGRAS = [
  ['judicial', /poder judici[áa]rio|\b\d+\s*[ªºa]\s*vara\b|tribunal (?:regional|de justi[çc]a)|hasta p[úu]blica|divis[ãa]o de execu[çc][ãa]o|\bexequente\b|ju[íi]za? de direito|execu[çc][ãa]o fiscal/i],
  // "DETRAN" sozinho não decide: a cláusula-padrão "exigências do DETRAN quanto a plaquetas"
  // aparece em edital de todo tipo (seco de 25/09: 4 lotes). Vale o DETRAN como quem vende.
  ['patio', /(?:comitente|vendedor|alienante)[^.]{0,60}\bdetran\b|\bdetran\b[^.]{0,40}(?:torna p[úu]blico|faz saber)|\bciretran\b|pol[íi]cia rodovi[áa]ria|ve[íi]culos? (?:removid|recolhid|apreendid)|recolhid[oa]s? (?:ao|em) p[áa]tio|\brenajud\b/i],
  ['seguradora', /\bsegurador[a]\b|\bsalvados?\b/i],
  ['financeira', /aliena[çc][ãa]o fiduci[áa]ria|decreto[-\s]lei\s*n?[º°o.]*\s*911|busca e apreens[ãa]o|arrendamento mercantil/i],
  ['orgao_publico', /munic[íi]pio de|prefeitura municipal|lei (?:federal )?n?[º°o.]*\s*(?:14\.?133|8\.?666)|minist[ée]rio d[aoe](?! fazenda)|governo do estado|secretaria (?:de|da|do|municipal|estadual)|processo sei\b|leil[ãa]o p[úu]blico n/i],
  ['corporativo', /comitente(?:\(s\)|s)?\s*vendedor(?:\(es\)|es|a)?[^.]{0,160}\b(?:ltda|s\.?\/?a\.?|eireli)\b/i],
];
// Documento que não é edital do evento (política de privacidade da MEGA grudada em 58 lotes;
// modelo de declaração da LJUD) — não decide nada.
const RE_NAO_EDITAL = /lgpd|lei geral de prote[çc][ãa]o de dados|tratamento de dados pessoais|modelo de declara[çc][ãa]o/i;
const RE_COMITENTE = /comitente(?:\(s\)|s)?(?:\s*vendedor(?:\(es\)|es|a)?)?\s*[:\-–]?\s*([^.;]{3,120})/i;

function classificarDoc(texto) {
  const cab = texto.slice(0, CAB);
  if (RE_NAO_EDITAL.test(cab.slice(0, 1500))) return { origem: null, motivo: 'nao_e_edital_do_evento' };
  for (const [k, re] of REGRAS) {
    const m = cab.match(re);
    if (m) return { origem: k, sinal: cab.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60).trim(), comitente: (cab.match(RE_COMITENTE)?.[1] || '').trim().slice(0, 120) || null };
  }
  return { origem: null, motivo: 'sem_sinal_no_cabecalho' };
}
const GRAVAR = process.env.EDITAL_GRAVAR === '1';

const veiculos = await todas('veiculos_leilao?ativo=eq.true&anexos=not.is.null&select=id,fonte,origem_venda,anexos');
const porDoc = new Map();
for (const v of veiculos) for (const a of (v.anexos || [])) {
  if (!ehEdital(a)) continue;
  if (!porDoc.has(a.url)) porDoc.set(a.url, { url: a.url, fonte: v.fonte, lotes: [] });
  porDoc.get(a.url).lotes.push({ id: v.id, origem: v.origem_venda });
}
const docs = [...porDoc.values()].sort((a, b) => b.lotes.length - a.lotes.length).slice(0, LIMITE);
console.log(`=== edital-origem-veiculos (${GRAVAR ? 'GRAVANDO' : 'EM SECO'}) · ${docs.length} documento(s) de ${porDoc.size}, ${veiculos.length} veículos com anexo ===`);

const resumo = { lidos: 0, erro: {}, porOrigem: {}, lotesPreenchidos: 0, lotesConfirmados: 0, lotesDivergentes: 0, gravados: 0 };
const aGravar = []; // { id, origem_edital, comitente_edital }
for (const d of docs) {
  const { texto, erro } = await textoDe(d.url);
  if (!texto) { resumo.erro[erro] = (resumo.erro[erro] || 0) + 1; continue; }
  resumo.lidos++;
  const c = classificarDoc(texto);
  const chave = c.origem || c.motivo;
  resumo.porOrigem[chave] = (resumo.porOrigem[chave] || 0) + d.lotes.length;
  const atual = {};
  for (const l of d.lotes) atual[l.origem] = (atual[l.origem] || 0) + 1;
  if (c.origem) for (const l of d.lotes) {
    if (l.origem === c.origem) resumo.lotesConfirmados++;
    else if (l.origem === 'nao_identificado') resumo.lotesPreenchidos++;
    else resumo.lotesDivergentes++;
    aGravar.push({ id: l.id, origem_edital: c.origem, comitente_edital: c.comitente || null });
  }
  console.log(`  ${d.fonte} · ${d.lotes.length} lote(s) · edital → ${chave} · hoje ${JSON.stringify(atual)}${c.sinal ? ` · "${c.sinal.replace(/\s+/g, ' ').slice(0, 170)}"` : ''}`);
}
console.log(`\n[resumo] ${JSON.stringify(resumo)}`);

// GRAVA SÓ `origem_edital` (e o comitente). Quem decide `origem_venda` é o gatilho: o edital
// preenche o que a listagem deixou em nao_identificado e NÃO sobrescreve o que ela já sabia.
if (GRAVAR && aGravar.length) {
  for (let i = 0; i < aGravar.length; i += 1) {
    const g = aGravar[i];
    const r = await fetch(`${SB_URL}/rest/v1/veiculos_leilao?id=eq.${g.id}`, {
      method: 'PATCH',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ origem_edital: g.origem_edital, comitente_edital: g.comitente_edital }),
    });
    const corpo = r.ok ? await r.json() : null;
    if (!r.ok) { console.error(`  ✗ gravar ${g.id}: HTTP ${r.status} ${(await r.text()).slice(0, 120)}`); continue; }
    if (Array.isArray(corpo) && corpo.length) resumo.gravados++;
  }
  console.log(`[gravados] ${resumo.gravados} de ${aGravar.length}`);
} else if (!GRAVAR) console.log('(EM SECO — EDITAL_GRAVAR=1 grava)');
