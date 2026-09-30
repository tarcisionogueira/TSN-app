/**
 * LOCAL DO PÁTIO (veículos) E ÁREA (imóveis) A PARTIR DO DOCUMENTO — 24/09 (pedido do dono).
 *
 * Por que documento e não página: o recon da página do lote do Golden Lance (SUPORTE) mostrou
 * que ela NÃO diz onde o veículo está — o único endereço é o do leiloeiro, no rodapé
 * ("retirada no local", sem dizer qual). Quem diz é o edital. O mesmo vale para os ~580
 * imóveis ativos sem área que já têm matrícula/edital no nosso bucket.
 *
 * As guardas, porque edital com vários bens é a regra e não a exceção:
 *  · VEÍCULO: só lê cidade/UF numa janela em volta de "pátio / retirada / visitação /
 *    localizado / depósito", confere contra a lista do IBGE (`cidade_socio`) e só grava se
 *    houver UMA cidade distinta no documento inteiro. Duas cidades = edital de vários pátios
 *    → não sabe qual é deste lote → não grava.
 *  · IMÓVEL: matrícula primeiro (é do bem, não do leilão), edital depois. Área só com RÓTULO
 *    (construída/privativa/terreno/total) e só se houver UM valor distinto para o rótulo
 *    escolhido — averbação de ampliação ou edital com 5 lotes dão vários valores → não grava.
 *    Convenção da CEF: casa/apto = construída/privativa; terreno/rural = terreno.
 *  · Nunca sobrescreve: PATCH só onde ainda está vazio, com return=representation (forma nº 3).
 *
 * EM SECO por padrão (forma nº 10); DOC_APLICAR=1 grava. DOC_ALVO=veiculos|imoveis|ambos.
 * Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY; DOC_LIMITE (padrão 800).
 */
import { createHash } from 'node:crypto';
import { carregarPDFParse } from '../api/_pdf-safe.js';
import { isolarBlocoDoLote } from '../api/_edital-extrato.js';

const SB_URL = process.env.VITE_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const APLICAR = process.env.DOC_APLICAR === '1';
const ALVO = process.env.DOC_ALVO || 'ambos';
const LIMITE = Number(process.env.DOC_LIMITE || 800) || 800;
const MAX_BYTES = 15 * 1024 * 1024;
if (!SB_URL || !SB_KEY) { console.error('defina VITE_SUPABASE_URL e SUPABASE_SERVICE_KEY'); process.exit(1); }

async function sb(path, init = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) }, signal: AbortSignal.timeout(30000) });
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

const norm = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const PDFParse = await carregarPDFParse();
if (!PDFParse) { console.error('pdf-parse indisponível'); process.exit(1); }

// Texto por documento, em cache: o edital de um leilão de 103 lotes é o MESMO arquivo para todos.
const cacheTexto = new Map();
async function textoDe(fonteDoc) {
  if (cacheTexto.has(fonteDoc.chave)) return cacheTexto.get(fonteDoc.chave);
  let res;
  try {
    const r = fonteDoc.storage
      ? await fetch(`${SB_URL}/storage/v1/object/documentos/${fonteDoc.storage.split('/').map(encodeURIComponent).join('/')}`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, signal: AbortSignal.timeout(40000) })
      : await fetch(fonteDoc.url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(40000) });
    if (!r.ok) res = { erro: `http_${r.status}` };
    else {
      const buf = Buffer.from(await r.arrayBuffer());
      if (!buf.length || buf.length > MAX_BYTES) res = { erro: 'tamanho' };
      else if (buf.subarray(0, 5).toString() !== '%PDF-') res = { erro: 'nao_e_pdf' };
      else {
        const p = new PDFParse({ data: buf });
        try { res = { texto: String((await p.getText())?.text || '').replace(/\s+/g, ' ') }; }
        finally { await p.destroy().catch(() => {}); }
        if (res.texto.replace(/\s/g, '').length < 200) res = { erro: 'sem_camada_de_texto' };
      }
    }
  } catch (e) { res = { erro: `excecao:${String(e?.message || e).slice(0, 50)}` }; }
  cacheTexto.set(fonteDoc.chave, res);
  return res;
}

// ───────────────────────── VEÍCULOS: cidade do pátio ─────────────────────────
const UFS = 'AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO';
const RE_CIDADE_UF = new RegExp(`([A-Za-zÀ-ÿ'’. ]{3,45}?)\\s*(?:/|-|–|,)\\s*(${UFS})\\b`, 'g');
// 1º seco (24/09) com gatilhos soltos ("retirada", "depósito", "encontra-se", "localizado"):
// casou "auditório … localizado em Contagem", "depósito JUDICIAL" e "retirada de Restrição
// Financeira". Agora só frase que fala do LUGAR DO BEM.
const RE_GATILHO = /p[áa]tio|localiza[çc][ãa]o\s+do(?:s)?\s+(?:bem|bens|ve[íi]culos?|lotes?)|local\s+(?:de|da|para)\s+(?:retirada|visita[çc][ãa]o|vistoria)|retirada\s+d[oa]s?\s+(?:bem|bens|ve[íi]culos?|lotes?)|visita[çc][ãa]o\s+(?:d[oa]s?\s+(?:bem|bens|ve[íi]culos?|lotes?)|no|na|em|ser[áa])|encontra(?:m)?-se\s+(?:no|na|em|depositad|localizad|guardad|estacionad)|(?:depositad|guardad|estacionad|removid)[oa]s?\s+(?:no|na|em)\b/gi;
// Leilão de frota MUNICIPAL: o veículo está no município que vende (garagem da prefeitura).
const RE_PREFEITURA = /(?:prefeitura\s+municipal|munic[íi]pio)\s+de\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ'’ ]{2,40})\s*(?:[/–-]\s*|,\s*(?:estado\s+de\s+\S+\s*)?)?(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)?\b/gi;

function cidadesNoTexto(texto, ibge) {
  const achadas = new Map(); // chave norm|uf → { cidade, uf, trecho }
  for (const g of texto.matchAll(RE_GATILHO)) {
    const janela = texto.slice(Math.max(0, g.index - 40), g.index + 260);
    if (/audit[óo]rio|sede\s+d[oa]\s+leiloeir|escrit[óo]rio/i.test(janela)) continue; // endereço do LEILOEIRO, não do bem
    for (const m of janela.matchAll(RE_CIDADE_UF)) {
      const uf = m[2];
      // "Rua X, 170, Cidade Industrial, Contagem" → tenta os sufixos de 1 a 5 palavras e fica
      // com o MAIS LONGO que é município de verdade naquela UF ("São José dos Campos" > "Campos").
      const palavras = m[1].trim().split(/\s+/);
      let melhor = null;
      for (let k = 1; k <= Math.min(5, palavras.length); k++) {
        const cand = palavras.slice(-k).join(' ').replace(/^[^A-Za-zÀ-ÿ]+/, '');
        if (ibge.has(`${norm(cand)}|${uf}`)) melhor = cand;
      }
      if (melhor) achadas.set(`${norm(melhor)}|${uf}`, { cidade: melhor, uf, trecho: janela.slice(0, 160) });
    }
  }
  return [...achadas.values()];
}

function prefeituraDoTexto(texto, ibge, ufPadrao) {
  const achadas = new Map();
  for (const m of texto.matchAll(RE_PREFEITURA)) {
    const palavras = m[1].trim().split(/\s+/);
    for (let k = Math.min(5, palavras.length); k >= 1; k--) {
      const cand = palavras.slice(0, k).join(' ');
      // Sem UF escrita: só aceita nome de município que existe em UMA UF só (homônimos ficam fora).
      const ufs = m[2] ? [m[2].toUpperCase()] : ufPadrao ? [ufPadrao] : UFS.split('|');
      const achou = ufs.filter((u) => ibge.has(`${norm(cand)}|${u}`));
      const uf = achou.length === 1 ? achou[0] : null;
      if (uf) { achadas.set(`${norm(cand)}|${uf}`, { cidade: cand, uf, trecho: texto.slice(m.index, m.index + 160) }); break; }
    }
  }
  return [...achadas.values()];
}

const tituloCidade = (s) => s.toLowerCase().replace(/(^|\s)(\S)/g, (_, a, b) => a + b.toUpperCase())
  .replace(/\s(De|Da|Do|Das|Dos|E)\s/g, (m) => m.toLowerCase());

async function veiculos(ibge) {
  const rows = (await todas('veiculos_leilao?ativo=eq.true&cidade=is.null&anexos=not.is.null&select=id,fonte,leiloeiro,anexos&order=id')).slice(0, LIMITE);
  const motivos = {}; let gravou = 0, achou = 0, amostras = 0;
  for (const v of rows) {
    const docs = (Array.isArray(v.anexos) ? v.anexos : []).filter((a) => /^https?:\/\/.+\.pdf(\?|$)/i.test(a?.url || ''))
      .sort((a, b) => (a.tipo === 'edital' ? -1 : 0) - (b.tipo === 'edital' ? -1 : 0)).slice(0, 3);
    if (!docs.length) { motivos.sem_pdf = (motivos.sem_pdf || 0) + 1; continue; }
    const todasCidades = new Map(); let lidos = 0, ultimoErro = null, prefeitura = null;
    for (const d of docs) {
      const r = await textoDe({ chave: d.url, url: d.url });
      if (r.erro) { ultimoErro = r.erro; continue; }
      lidos++;
      for (const c of cidadesNoTexto(r.texto, ibge)) todasCidades.set(`${norm(c.cidade)}|${c.uf}`, c);
      // Frota municipal: só vale sem frase de pátio e com UMA prefeitura no documento.
      // Só em leilão da ADMINISTRAÇÃO (Lei 14.133/8.666): em processo judicial "Município de X"
      // aparece como credor/interessado (2º seco: Rio Verde/GO numa lista de credores).
      const leilaoPublico = /14\.133|8\.666/.test(r.texto);
      if (!todasCidades.size && leilaoPublico) { const pf = prefeituraDoTexto(r.texto, ibge, null); if (pf.length === 1) prefeitura = pf[0]; else if (pf.length > 1) prefeitura = false; }
    }
    if (!todasCidades.size && prefeitura) todasCidades.set('pf', { ...prefeitura, trecho: `[prefeitura] ${prefeitura.trecho}` });
    const lista = [...todasCidades.values()];
    const motivo = !lidos ? `nao_lido:${ultimoErro}` : lista.length === 0 ? 'sem_cidade_no_doc' : lista.length > 1 ? 'varias_cidades' : null;
    if (motivo) {
      motivos[motivo.split(':')[0]] = (motivos[motivo.split(':')[0]] || 0) + 1;
      if (motivo === 'varias_cidades' && amostras++ < 6) console.log(`  [várias] ${v.leiloeiro}: ${lista.map((c) => `${c.cidade}/${c.uf}`).join(' · ')}`);
      continue;
    }
    const { cidade, uf, trecho } = lista[0];
    achou++;
    if (!APLICAR) { if (achou <= 30) console.log(`  [seco] ${v.leiloeiro} → ${tituloCidade(cidade)}/${uf}   «${trecho.replace(/\s+/g, ' ')}»`); continue; }
    const up = await sb(`veiculos_leilao?id=eq.${v.id}&cidade=is.null`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ cidade: tituloCidade(cidade), estado: uf }) })
      .catch((e) => { console.error(`  falhou ${v.id}: ${e.message}`); return null; });
    if (Array.isArray(up) && up.length === 1) gravou++;
  }
  console.log(`[veículos] ${APLICAR ? 'GRAVANDO' : 'EM SECO'} · ${rows.length} sem cidade com anexo · ${achou} com cidade única no documento · gravados ${gravou} · recusas ${JSON.stringify(motivos)}`);
}

// ───────────────────────── IMÓVEIS: área rotulada ─────────────────────────
const UNI = '(?:m²|m2|mts²|metros?\\s+quadrados?)';
const NUM = '(\\d{1,3}(?:\\.\\d{3})+(?:,\\d{1,4})?|\\d+(?:,\\d{1,4})?)';
const ROT = '(constru[íi]da|privativa|edificada|[úu]til|do\\s+terreno|de\\s+terreno|total)';
const paraNumero = (s) => Number(String(s).replace(/\./g, '').replace(',', '.'));
const classe = (r) => /constru|privativa|edificada|til/i.test(r) ? 'construida' : /terreno/i.test(r) ? 'terreno' : 'total';

function areasRotuladas(texto) {
  const out = [];
  // número ANTES do rótulo primeiro ("46,57 m² de área privativa"); depois rótulo → número.
  for (const m of texto.matchAll(new RegExp(`${NUM}\\s*${UNI}\\s*(?:\\(.{0,60}?\\))?\\s*de\\s+área\\s+${ROT}`, 'gi'))) out.push({ c: classe(m[2]), v: paraNumero(m[1]), i: m.index });
  for (const m of texto.matchAll(new RegExp(`área\\s+${ROT}[^\\d]{0,25}${NUM}\\s*${UNI}`, 'gi'))) out.push({ c: classe(m[1]), v: paraNumero(m[2]), i: m.index });
  return out.filter((a) => a.v >= 10 && a.v <= 500_000_000);
}

function areaDoDocumento(texto, tipoImovel, ehEdital) {
  // Edital que cita MAIS DE UMA matrícula é de vários bens: a área única rotulada nele é de UM
  // deles, não necessariamente deste (1º seco: o mesmo 59,55 m² caiu em terreno, rural e apto).
  if (ehEdital) {
    const mats = new Set([...texto.matchAll(/matr[íi]cula(?:s)?\s*(?:sob\s+)?(?:n[º°o.]*\s*)?(\d[\d.]{2,})/gi)].map((m) => m[1].replace(/\D/g, '')));
    if (mats.size > 1) return { area: 0, motivo: 'edital_varias_matriculas' };
  }
  const lista = areasRotuladas(texto);
  const distintos = (c) => [...new Set(lista.filter((a) => a.c === c).map((a) => a.v))];
  const ordem = /terreno|rural/i.test(tipoImovel || '') ? ['terreno', 'total'] : ['construida'];
  for (const c of ordem) {
    const d = distintos(c);
    if (d.length === 1) return { area: d[0], rotulo: c, trecho: texto.slice(Math.max(0, lista.find((a) => a.v === d[0]).i - 40), lista.find((a) => a.v === d[0]).i + 90) };
    if (d.length > 1) return { area: 0, motivo: `varios_${c}` };
  }
  return { area: 0, motivo: 'sem_area_rotulada' };
}

async function imoveis() {
  const anexos = await todas('imovel_anexos?storage_path=not.is.null&tipo=in.(matricula,edital)&select=imovel_id,tipo,storage_path&order=imovel_id');
  const porImovel = new Map();
  for (const a of anexos) (porImovel.get(a.imovel_id) || porImovel.set(a.imovel_id, []).get(a.imovel_id)).push(a);
  const alvo = (await todas('imoveis_leilao?ativo=eq.true&or=(area_m2.is.null,area_m2.eq.0)&tipo=neq.veiculo&select=id,fonte,tipo,titulo&order=id'))
    .filter((i) => porImovel.has(i.id)).slice(0, LIMITE);
  const motivos = {}; let achou = 0, gravou = 0;
  const usoDoTexto = new Map(); const candidatos = [];
  for (const im of alvo) {
    const docs = porImovel.get(im.id).sort((a, b) => (a.tipo === 'matricula' ? -1 : 1) - (b.tipo === 'matricula' ? -1 : 1)).slice(0, 3);
    let res = null, ultimo = 'nao_lido';
    for (const d of docs) {
      const r = await textoDe({ chave: `sb:${d.storage_path}`, storage: d.storage_path });
      if (r.erro) { ultimo = `nao_lido`; continue; }
      const h = createHash('sha1').update(r.texto).digest('hex');
      (usoDoTexto.get(h) || usoDoTexto.set(h, new Set()).get(h)).add(im.id);
      const a = areaDoDocumento(r.texto, im.tipo, d.tipo === 'edital');
      if (a.area) { res = { ...a, doc: d.tipo, h }; break; }
      ultimo = a.motivo;
    }
    const titulo = String(im.titulo || '');
    if (res && /\b(apartamento|apto|sala|kitnet|flat)\b/i.test(titulo) && res.area > 1000) { res = null; ultimo = 'apto_area_condominio'; }
    if (!res) { motivos[ultimo] = (motivos[ultimo] || 0) + 1; continue; }
    candidatos.push({ im, res });
  }
  // O MESMO texto lido para mais de um imóvel é documento do LEILÃO, não do bem → recusa todos.
  for (const { im, res } of candidatos) {
    if (usoDoTexto.get(res.h).size > 1) { motivos.documento_compartilhado = (motivos.documento_compartilhado || 0) + 1; continue; }
    achou++;
    if (!APLICAR) { if (achou <= 40) console.log(`  [seco] ${im.fonte}/${im.tipo} ${res.area} m² (${res.rotulo}, ${res.doc})  «${res.trecho.replace(/\s+/g, ' ')}»`); continue; }
    const up = await sb(`imoveis_leilao?id=eq.${im.id}&or=(area_m2.is.null,area_m2.eq.0)`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ area_m2: res.area }) })
      .catch((e) => { console.error(`  falhou ${im.id}: ${e.message}`); return null; });
    if (Array.isArray(up) && up.length === 1) gravou++;
  }
  console.log(`[imóveis] ${APLICAR ? 'GRAVANDO' : 'EM SECO'} · ${alvo.length} sem área com matrícula/edital no bucket · ${achou} com área única rotulada · gravados ${gravou} · recusas ${JSON.stringify(motivos)}`);
}

// ───────────── IMÓVEIS: área no BLOCO DO LOTE do edital do CDN (29/09) ─────────────
// BIASI: 290 lotes sem área, 19 editais distintos (um deles com 185 lotes). A leitura acima
// recusa edital de vários bens — com razão, a área única dele é de UM bem. Aqui o edital é
// fatiado por "Lote N" e só o bloco que contém o VALOR deste lote (avaliação ou lance mínimo,
// `isolarBlocoDoLote`) é lido. Guarda extra: se o valor aparece em MAIS DE UM bloco, não sabe
// qual é → não grava. DOC_FONTE (padrão BIASI) limita a fonte.
const fmtBr = (v) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function blocosComValor(texto, valores) {
  const marcas = [...texto.matchAll(/\bLotes?\s*(?:n[ºo°.]?)?\s*:?\s*\d+\b/gi)];
  const alvo = valores.map(Number).filter((v) => v > 0).map(fmtBr);
  let n = 0;
  for (let i = 0; i < marcas.length; i++) {
    const bloco = texto.slice(marcas[i].index, i + 1 < marcas.length ? marcas[i + 1].index : texto.length);
    if (alvo.some((v) => bloco.includes(v))) n++;
  }
  return n;
}
async function editaisCdn() {
  const fonte = encodeURIComponent(process.env.DOC_FONTE || 'BIASI');
  const alvo = (await todas(`imoveis_leilao?ativo=eq.true&fonte=eq.${fonte}&or=(area_m2.is.null,area_m2.eq.0)&select=id,fonte,tipo,titulo,valor_minimo,valor_avaliacao,anexos&order=id`)).slice(0, LIMITE);
  const motivos = {}; let achou = 0, gravou = 0; const diag = new Set();
  const conta = (m) => { motivos[m] = (motivos[m] || 0) + 1; };
  for (const im of alvo) {
    const eds = (Array.isArray(im.anexos) ? im.anexos : []).filter((a) => a?.tipo === 'edital' && /^https?:\/\/.+\.pdf(\?|$)/i.test(a?.url || ''));
    if (!eds.length) { conta('sem_edital_pdf'); continue; }
    let res = null, ultimo = 'nao_lido';
    for (const d of eds.slice(0, 2)) {
      const r = await textoDe({ chave: d.url, url: d.url });
      if (r.erro) { ultimo = `nao_lido_${r.erro}`; continue; }
      if (!APLICAR && !diag.has(d.url) && diag.size < 3) {
        diag.add(d.url);
        const marcas = [...r.texto.matchAll(/\bLotes?\s*(?:n[ºo°.]?)?\s*:?\s*\d+\b/gi)].length;
        const i = r.texto.search(/\bLote\s*(?:n[ºo°.]?)?\s*:?\s*0*1\b/i);
        console.log(`  [diag] ${d.url} · ${r.texto.length} chars · ${marcas} marcas de lote\n         «${r.texto.slice(Math.max(0, i), Math.max(0, i) + 700)}»`);
      }
      const valores = [im.valor_avaliacao, im.valor_minimo];
      const bloco = isolarBlocoDoLote(r.texto, { valorMinimo: im.valor_minimo, valorAvaliacao: im.valor_avaliacao });
      if (!bloco) {
        // Edital de UM lote só (loteanexo): sem marcas repetidas, o documento inteiro é do bem.
        const marcas = [...r.texto.matchAll(/\bLotes?\s*(?:n[ºo°.]?)?\s*:?\s*\d+\b/gi)].length;
        if (marcas >= 2) { ultimo = 'bloco_nao_isolado'; continue; }
        const a = areaDoDocumento(r.texto, im.tipo, true);
        if (a.area) { res = { ...a, doc: 'edital_unico' }; break; }
        ultimo = a.motivo; continue;
      }
      if (blocosComValor(r.texto, valores) > 1) { ultimo = 'valor_em_varios_blocos'; continue; }
      const a = areaDoDocumento(bloco, im.tipo, false);
      if (a.area) { res = { ...a, doc: 'bloco_do_lote' }; break; }
      ultimo = a.motivo;
    }
    if (res && /\b(apartamento|apto|sala|kitnet|flat)\b/i.test(im.titulo || '') && res.area > 1000) { res = null; ultimo = 'apto_area_condominio'; }
    if (!res) { conta(ultimo); continue; }
    achou++;
    if (!APLICAR) { if (achou <= 40) console.log(`  [seco] ${im.tipo} ${res.area} m² (${res.rotulo}, ${res.doc}) — ${String(im.titulo).slice(0, 60)}  «${res.trecho.replace(/\s+/g, ' ')}»`); continue; }
    const up = await sb(`imoveis_leilao?id=eq.${im.id}&or=(area_m2.is.null,area_m2.eq.0)`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ area_m2: res.area }) })
      .catch((e) => { console.error(`  falhou ${im.id}: ${e.message}`); return null; });
    if (Array.isArray(up) && up.length === 1) gravou++;
  }
  console.log(`[editais_cdn ${fonte}] ${APLICAR ? 'GRAVANDO' : 'EM SECO'} · ${alvo.length} sem área · ${cacheTexto.size} documentos lidos · ${achou} com área no bloco do lote · gravados ${gravou} · recusas ${JSON.stringify(motivos)}`);
}

// ───────────── IMÓVEIS: área na PÁGINA DO LOTE (29/09) ─────────────
// BIASI: o edital é genérico (condições do banco, sem descrição de lote) — a área mora na página
// /sale/detail ("Área(s): 72 m² de área construída…"). O enriquecimento diário do coletor já lê
// essa página, mas com teto de 120 lotes/8 min não alcança o acervo (74 de 364 com área). Esta
// passada lê só os lotes SEM área, com o mesmo extrator ANCORADO (permitirSolta: false — página
// inteira nunca aceita m² solto, ver api/_texto-imovel.js).
async function paginaLote() {
  const { extrairAreaM2, decodificarEntidades } = await import('../api/_texto-imovel.js');
  const fonte = encodeURIComponent(process.env.DOC_FONTE || 'BIASI');
  const alvo = (await todas(`imoveis_leilao?ativo=eq.true&fonte=eq.${fonte}&or=(area_m2.is.null,area_m2.eq.0)&url_lote=not.is.null&select=id,tipo,titulo,url_lote&order=id`)).slice(0, LIMITE);
  const motivos = {}; let achou = 0, gravou = 0, bloqueiosSeguidos = 0;
  const conta = (m) => { motivos[m] = (motivos[m] || 0) + 1; };
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  // 1º seco (29/09): sem pausa, a BIASI devolveu 403 a partir do ~50º acesso (240 de 290). Pausa
  // SEMPRE (seco também), uma retentativa após 20 s no 403, e para se o bloqueio persistir.
  const baixar = () => fetch(im_url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124', 'Accept-Language': 'pt-BR' }, signal: AbortSignal.timeout(25000) });
  let im_url = '';
  for (const im of alvo) {
    if (bloqueiosSeguidos >= 5) { conta('parou_bloqueio'); continue; }
    let html = '';
    im_url = im.url_lote;
    await espera(1500);
    try {
      let r = await baixar();
      if (r.status === 403 || r.status === 429) { await espera(20000); r = await baixar(); }
      if (!r.ok) { conta(`http_${r.status}`); if (r.status === 403 || r.status === 429) bloqueiosSeguidos++; continue; }
      bloqueiosSeguidos = 0;
      html = await r.text();
    } catch (e) { conta(`rede:${String(e?.message || e).slice(0, 30)}`); continue; }
    const texto = decodificarEntidades(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
    if (texto.length < 500) { conta('pagina_vazia'); continue; }
    const area = extrairAreaM2(texto, { permitirSolta: false });
    if (!(area > 0)) { conta('sem_area_rotulada'); continue; }
    if (/\b(apartamento|apto|sala|kitnet|flat)\b/i.test(im.titulo || '') && area > 1000) { conta('apto_area_condominio'); continue; }
    achou++;
    if (!APLICAR) {
      if (achou <= 40) { const i = texto.search(/Área\(s\)|Área\s+(?:Privativa|Terreno|Constru)/i); console.log(`  [seco] ${im.tipo} ${area} m² — ${String(im.titulo).slice(0, 60)}  «${texto.slice(Math.max(0, i), Math.max(0, i) + 140)}»`); }
      continue;
    }
    const up = await sb(`imoveis_leilao?id=eq.${im.id}&or=(area_m2.is.null,area_m2.eq.0)`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ area_m2: area }) })
      .catch((e) => { console.error(`  falhou ${im.id}: ${e.message}`); return null; });
    if (Array.isArray(up) && up.length === 1) gravou++;
  }
  console.log(`[pagina_lote ${fonte}] ${APLICAR ? 'GRAVANDO' : 'EM SECO'} · ${alvo.length} sem área · ${achou} com área rotulada na página · gravados ${gravou} · recusas ${JSON.stringify(motivos)}`);
}

// ───────────────────────── VEÍCULOS: motor pelo documento (30/09, item 8) ─────────────────────────
// Guarda SÓ o trecho que fala do motor em `motor_doc_texto`; quem decide funciona/não funciona é a
// função do BANCO (`motor_nao_funciona_do_documento`, no gatilho) — uma regra só, evidência auditável.
// Documento de VÁRIOS lotes (usado por 2+ veículos, ou com 2+ marcas "Lote N") só vale pelo BLOCO
// deste lote (isolarBlocoDoLote, casado pelo valor); sem bloco, não usa — "motor queimado" pode ser
// do vizinho. Lê cada lote UMA vez (`motor_doc_em`); nada lido (HTTP/escaneado) = tenta de novo depois.
const RE_MOTOR_JANELA = /motor|funcionament|n[ãa]o\s+(?:liga|pega|d[áa]\s+partida)|liga\s+e\s+anda|anda\s+e\s+liga/gi;
function trechosDoMotor(texto) {
  const faixas = [];
  for (const m of texto.matchAll(RE_MOTOR_JANELA)) {
    // Definição de CATEGORIA no edital do DETRAN ("Sucatas aproveitáveis com motor inservível —
    // diferem das…") casaria "não funciona" em qualquer lote: plural genérico antes = não é o bem.
    if (/sucatas\b/i.test(texto.slice(Math.max(0, m.index - 60), m.index))) continue;
    const ini = Math.max(0, m.index - 120), fim = Math.min(texto.length, m.index + 160);
    if (faixas.length && ini <= faixas[faixas.length - 1][1]) faixas[faixas.length - 1][1] = fim; else faixas.push([ini, fim]);
  }
  return faixas.map(([a, b]) => texto.slice(a, b)).join(' … ').slice(0, 1500);
}
async function motor() {
  const ativos = await todas('veiculos_leilao?ativo=eq.true&anexos=not.is.null&select=id,fonte,titulo,anexos,valor_minimo,valor_avaliacao,motor_status,motor_doc_em&order=id');
  const usos = new Map();
  for (const v of ativos) for (const a of Array.isArray(v.anexos) ? v.anexos : []) if (a?.url) usos.set(a.url, (usos.get(a.url) || 0) + 1);
  const rows = ativos.filter((v) => !v.motor_status && !v.motor_doc_em).slice(0, LIMITE);
  const motivos = {}; const conta = (k) => { motivos[k] = (motivos[k] || 0) + 1; };
  const porFonte = {}; let gravou = 0, comTrecho = 0, amostras = 0;
  for (const v of rows) {
    const docs = (Array.isArray(v.anexos) ? v.anexos : []).filter((a) => /^https?:\/\/[^<>\s]+\.pdf(\?|$)/i.test(a?.url || '')).slice(0, 4);
    if (!docs.length) { conta('sem_pdf'); continue; }
    const pedacos = []; let lidos = 0, barrados = 0;
    for (const d of docs) {
      const r = await textoDe({ chave: d.url, url: d.url });
      if (r.erro) { conta(`doc_${r.erro.split(':')[0]}`); if (/^http_4/.test(r.erro)) barrados++; continue; }
      lidos++;
      const variosLotes = (usos.get(d.url) || 0) > 1 || (r.texto.match(/\bLotes?\s*(?:n[ºo°.]?)?\s*:?\s*\d+\b/gi) || []).length >= 2;
      const base = variosLotes ? isolarBlocoDoLote(r.texto, { valorMinimo: v.valor_minimo, valorAvaliacao: v.valor_avaliacao }) : r.texto;
      if (!base) { conta('doc_de_varios_lotes_sem_bloco'); continue; }
      // Laudo de penhora com 2+ veículos e sem marca "Lote N" (seco 30/09: Fiesta + outro no mesmo
      // auto): mais de UMA placa no texto usado = não dá para saber de qual é a frase.
      const placas = new Set([...base.matchAll(/\b([A-Z]{3})[\s-]?(\d[A-Z0-9]\d{2})\b/g)].map((x) => x[1] + x[2]));
      if (placas.size > 1) { conta('doc_de_varios_veiculos'); continue; }
      const t = trechosDoMotor(base);
      if (t) pedacos.push(t);
    }
    // Nada lido: erro transitório (rede, 5xx) tenta de novo; se TODOS os docs deram 4xx (CDN que
    // barra o runner — 730 no 1º seco, quase todos SUPERBID), marca como tentado sem trecho: o lote
    // segue "não informado" (verdade) e para de ocupar a fila de toda rodada à frente dos outros.
    if (!lidos && barrados < docs.length) continue;
    const trecho = pedacos.join(' … ').slice(0, 2000) || null;
    const pf = (porFonte[v.fonte] ??= { lidos: 0, com_trecho: 0, funciona: 0, nao_funciona: 0 }); pf.lidos++;
    if (trecho) {
      comTrecho++; pf.com_trecho++;
      if (!APLICAR) {
        // Seco: o veredito vem do PRÓPRIO banco (mesma função do gatilho), não de uma cópia aqui.
        // Do documento só vale NÃO FUNCIONA por frase forte (seco 30/09: "funciona" em laudo era
        // metodologia do avaliador, checklist sem resposta, som do veículo em funcionamento…).
        const st = await sb('rpc/motor_nao_funciona_do_documento', { method: 'POST', body: JSON.stringify({ p: trecho }) }).catch(() => null);
        if (st) pf[st]++;
        if (st && amostras++ < 40) console.log(`  [seco] ${v.fonte} ${st} — ${String(v.titulo).slice(0, 50)}  «${trecho.slice(0, 220)}»`);
      }
    }
    if (!APLICAR) continue;
    const up = await sb(`veiculos_leilao?id=eq.${v.id}&motor_doc_em=is.null`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ motor_doc_texto: trecho, motor_doc_em: new Date().toISOString() }) })
      .catch((e) => { console.error(`  falhou ${v.id}: ${e.message}`); return null; });
    if (Array.isArray(up) && up.length === 1) { gravou++; if (up[0].motor_status) pf[up[0].motor_status]++; }
  }
  console.log(`[motor] ${APLICAR ? 'GRAVANDO' : 'EM SECO'} · ${rows.length} sem motor e não lidos · ${comTrecho} com trecho de motor no doc · gravados ${gravou}`);
  console.log(`  por fonte: ${JSON.stringify(porFonte)}`);
  console.log(`  recusas/erros: ${JSON.stringify(motivos)} · ${cacheTexto.size} documentos distintos lidos`);
}

if (ALVO === 'motor') { await motor(); process.exit(0); }
if (ALVO === 'pagina_lote') { await paginaLote(); process.exit(0); }
if (ALVO === 'editais_cdn') { await editaisCdn(); process.exit(0); }
if (ALVO !== 'imoveis') {
  const ibge = new Set((await todas('cidade_socio?nivel=eq.cidade&select=cidade_norm,uf&order=cidade_norm')).map((c) => `${c.cidade_norm}|${c.uf}`));
  if (ibge.size < 5000) { console.error(`lista do IBGE incompleta (${ibge.size}) — sem ela a guarda de cidade não vale`); process.exit(2); }
  await veiculos(ibge);
}
if (ALVO !== 'veiculos') await imoveis();
