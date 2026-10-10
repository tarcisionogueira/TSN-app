/**
 * Scraper COMPREI (PGFN) — venda direta de imóveis da Fazenda Nacional, coletada NA FONTE (10/10).
 *
 * Até aqui o Comprei só entrava pela vitrine da Globo Leilões (~128 lotes, fonte GLOBOLEILOES,
 * enriquecidos pela API pública do anúncio — lib/comprei-pgfn.mjs). A API pública tem a LISTAGEM
 * nacional também, sem login e sem reCAPTCHA (o reCAPTCHA é só do /validador):
 *   GET /gateway/sdc/uf                                   → códigos numéricos das UFs (MG=60, ES=72…)
 *   GET /gateway/anuncio/publico?ufs=<códigos>&page=N&size=100   (sem `ufs` ou com sigla → 500)
 *   GET /gateway/anuncio/visitar/{id}                     → anúncio inteiro (cidade/UF, matrícula, ônus…)
 * Exigem `Origin: https://comprei.pgfn.gov.br` (403 com Origin de outro site). Medido em 10/10:
 * 575 anúncios no país, 6 páginas de 100.
 *
 * Via: fetch direto do runner; se o gov.br recusar, cai na via BANCO (`json_pedir`, pg_net, que manda
 * o Origin do Comprei). Grátis nas duas — roda diário.
 *
 * Dedup com a GLOBOLEILOES: cada corretor credenciado publica o SEU anúncio do mesmo bem (o link da
 * Globo tem outro id). Chave = matrícula + UF. A cópia da Globo de bem já coletado aqui vira
 * `suprimido_motivo = 'duplicata_comprei'` (aqui e no próprio scraper-globo.mjs ao regravar).
 *
 * Env: COMPREI_DRYRUN (default '1') · COMPREI_CONCORRENCIA (4) · COMPREI_MAX_PAGINAS (20).
 * Env infra: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { COMPREI_API, urlVisitarComprei, fichaComprei } from './lib/comprei-pgfn.mjs';
import { checarQualidade } from './lib/scraper-core.mjs';
import { inferirTipo } from './lib/leilaopro-parse.mjs';
import { viaBanco } from './lib/motor/fetch-fonte.mjs';
import { registrarSaude } from './_saude-fonte.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const supabase = createClient(SB_URL, SB_KEY);

const FONTE = 'COMPREI';
const DRYRUN = process.env.COMPREI_DRYRUN !== '0';
const CONC = Math.max(1, Number(process.env.COMPREI_CONCORRENCIA || 4));
const MAX_PAGINAS = Number(process.env.COMPREI_MAX_PAGINAS || 20);
const SITE = 'https://comprei.pgfn.gov.br';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Disjuntor: o direto falhou 2× → o resto da execução vai só pelo banco (não paga 30 s por chamada).
let falhasDireto = 0; const vias = { direto: 0, banco: 0 };
async function json(url) {
  let motivo = 'direto pulado';
  if (falhasDireto < 2) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'pt-BR,pt;q=0.9', Origin: SITE, Referer: `${SITE}/` }, signal: AbortSignal.timeout(30000) });
      if (r.ok) { vias.direto++; return await r.json(); }
      motivo = `HTTP ${r.status}`;
      if (r.status === 404) throw Object.assign(new Error(motivo), { definitivo: true });
    } catch (e) { if (e.definitivo) throw e; motivo = String(e?.message || e).slice(0, 60); }
    falhasDireto++;
  }
  const b = await viaBanco(url, { json: true });
  if (!b.html) throw new Error(`${motivo} · banco: ${b.motivo}`);
  vias.banco++;
  return JSON.parse(b.html);
}

// "28/11/2026 08:00:00" → ISO de Brasília
const dataBr = (s) => {
  const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4] || '12'}:${m[5] || '00'}:00-03:00` : null;
};
const textoHtml = (h) => String(h || '').replace(/<br\s*\/?>|<\/p>|<\/li>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
// Título do cadastro vem com sobra: "-CASA EM …--", "APTO …__"
const limparTitulo = (t) => String(t || '').replace(/^[\s\-_–]+|[\s\-_–]+$/g, '').replace(/\s+/g, ' ').trim();
const titleCase = (s) => String(s || '').toLowerCase().replace(/(^|\s|'|-)([a-zà-ú])/g, (_, a, b) => a + b.toUpperCase())
  .replace(/\b(De|Do|Da|Dos|Das|E)\b/g, (m) => m.toLowerCase()).replace(/^\w/, (c) => c.toUpperCase());
const semAcento = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
// `municipioNome` vem sem acento ("Lencois Paulista"); o título costuma trazer a grafia certa
// ("LENÇOIS PAULISTA/SP"). Usa a do título quando é a MESMA cidade sem acento; senão fica a da API.
function cidadeComAcento(cidade, titulo) {
  if (!cidade) return cidade;
  const alvo = semAcento(cidade); const n = alvo.split(' ').length;
  const pal = String(titulo || '').split(/[\s,/-]+/);
  for (let i = 0; i + n <= pal.length; i++) {
    const cand = pal.slice(i, i + n).join(' ');
    if (semAcento(cand) === alvo) return titleCase(cand);
  }
  return cidade;
}
const valor = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 1000 && n <= 500_000_000 ? Math.round(n * 100) / 100 : 0; };
const idImg = (x) => (x && typeof x === 'object' ? (x.id ?? x.idImagem ?? x.imagemId) : x);

async function enumerar() {
  const ufs = await json(`${COMPREI_API}/sdc/uf`);
  const codigos = (Array.isArray(ufs) ? ufs : ufs?.content || []).map((u) => u?.value ?? u?.id ?? u?.codigo).filter((c) => c != null);
  if (!codigos.length) throw new Error('lista de UFs vazia/ilegível');
  const itens = new Map(); let total = null;
  for (let p = 0; p < MAX_PAGINAS; p++) {
    const pg = await json(`${COMPREI_API}/anuncio/publico?ufs=${codigos.join(',')}&page=${p}&size=100`);
    if (!pg || !Array.isArray(pg.content)) throw new Error(`página ${p}: sem 'content' (API mudou?)`);
    total = pg.totalElements ?? total;
    for (const a of pg.content) if (a?.id) itens.set(String(a.id), a);
    if (pg.last || !pg.content.length) break;
    await sleep(300);
  }
  return { itens: [...itens.values()], total };
}

function montarRow(a, v) {
  const ficha = fichaComprei(v) || {};
  const titulo = limparTitulo(v.titulo || a.titulo) || `Imóvel PGFN ${a.id}`;
  const desc = textoHtml(v.descricao || a.descricao);
  const va = valor(v.valorAvaliacao ?? a.valorAvaliacao);
  const vm = valor(v.precoAtual ?? a.precoAtual) || valor(v.valorMinimo);
  const parcelas = Number(v.quantidadeMaximaDeParcelas) || 0;
  const condicoes = [
    'Venda direta da Procuradoria-Geral da Fazenda Nacional (Comprei).',
    valor(v.valorCompraImediata) ? `Compra imediata: R$ ${valor(v.valorCompraImediata).toLocaleString('pt-BR')}.` : null,
    parcelas > 1 ? `Parcelamento em até ${parcelas}x${v.percentualMinimoValorEntrada ? `, entrada mínima de ${v.percentualMinimoValorEntrada}%` : ''}${valor(v.valorMinimoParcela) || Number(v.valorMinimoParcela) ? `, parcela mínima R$ ${Number(v.valorMinimoParcela).toLocaleString('pt-BR')}` : ''}.` : null,
    v.nomeCorretor ? `Corretor/leiloeiro credenciado: ${String(v.nomeCorretor).trim()}${v.juntaLeiloeiro ? ` (${String(v.juntaLeiloeiro).trim()})` : ''}.` : null,
  ].filter(Boolean).join(' ');
  // Fallback de local: o `endereco` da listagem termina em "Cidade/UF" (sem acento: "Sao Jose Da Coroa Grande/PE").
  const cuLista = String(a.endereco || '').match(/-\s*([^-/]+)\/([A-Z]{2})\s*$/);
  const fotos = [...(a.imagensAnuncio || []), ...(v.fotosAnuncio || [])].map(idImg).filter((x) => x != null)
    .filter((x, k, arr) => arr.indexOf(x) === k);
  const foto = fotos.length ? `${COMPREI_API}/imagem/anuncio/${fotos[0]}` : null;
  const descricao = [desc, condicoes, ficha.bloco].filter(Boolean).join('\n\n').slice(0, 9000);
  return {
    fonte: FONTE, fonte_id: `comprei_${a.id}`,
    titulo: titleCase(titulo).replace(/([/-])([a-z]{2})\b(?=[^a-z]|$)/gi, (m, sep, uf) => (/^[A-Z]{2}$/i.test(uf) && m.length === 3 ? `${sep}${uf.toUpperCase()}` : m)).slice(0, 300),
    tipo: inferirTipo(titulo, desc.slice(0, 300)),
    modalidade: 'venda_direta',
    cidade: cidadeComAcento(v.municipioNome ? titleCase(String(v.municipioNome).trim()) : (cuLista ? titleCase(cuLista[1].trim()) : null), titulo),
    estado: v.ufSigla ? String(v.ufSigla).trim().toUpperCase() : (cuLista ? cuLista[2] : null),
    bairro: ficha.bairro || null, endereco: ficha.endereco || null, cep: ficha.cep || null,
    numero_matricula: ficha.numero_matricula || (String(a.matriculaBem || '').trim() || null),
    numero_processo: ficha.numero_processo || null,
    valor_avaliacao: va, valor_minimo: vm, area_m2: 0,
    descricao,
    url_lote: `${SITE}/anuncio/detalhe/${a.id}`, link_edital: `${SITE}/anuncio/detalhe/${a.id}`,
    link_foto: foto, fotos: fotos.slice(0, 20).map((i) => `${COMPREI_API}/imagem/anuncio/${i}`),
    leiloeiro: 'PGFN — Comprei',
    data_leilao: dataBr(v.prazoParaEncerramento), data_leilao_2: null,
    forma_pagamento: 'a_vista',
    ativo: !(v.bemVendido === true || a.bemVendido === true),
    suprimido_motivo: (v.bemVendido === true || a.bemVendido === true) ? 'vendido_na_fonte' : null,
    viavel: va > 0 ? (1 - vm / va) >= 0.3 : null,
    score_viabilidade: va > 0 ? Math.max(0, Math.min(100, Math.round((1 - vm / va) * 150))) : 30,
    desconto_percentual: va > 0 ? Math.round((1 - vm / va) * 100) : null,
    atualizado_em: new Date().toISOString(),
  };
}

async function gravar(rows) {
  let n = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const { data, error } = await supabase.from('imoveis_leilao').upsert(rows.slice(i, i + 200), { onConflict: 'fonte_id' }).select('fonte_id');
    if (error) throw new Error(`upsert: ${error.message}`);
    n += data?.length || 0;
  }
  return n;
}

async function varrerSumidos(vistos) {
  const { data: ativos, error } = await supabase.from('imoveis_leilao').select('fonte_id').eq('fonte', FONTE).eq('ativo', true);
  if (error) { console.error(`  varredura PULADA — acervo ativo ilegível (${error.message})`); return; }
  if (vistos.size < (ativos?.length || 0) * 0.5) { console.error(`  🛑 varredura PULADA — ${vistos.size} vistos de ${ativos.length} ativos (< 50%)`); return; }
  const sumidos = (ativos || []).map((r) => r.fonte_id).filter((id) => !vistos.has(id));
  if (!sumidos.length) { console.log('  varredura: nenhum sumido'); return; }
  const { data, error: e } = await supabase.from('imoveis_leilao').update({ ativo: false, suprimido_motivo: 'sumiu_da_fonte' })
    .eq('fonte', FONTE).eq('ativo', true).in('fonte_id', sumidos).select('fonte_id');
  if (e) console.error(`  erro ao desativar sumidos: ${e.message}`);
  else console.log(`  varredura: ${sumidos.length} fora do site · ${data?.length || 0} desativados (sumiu_da_fonte)`);
}

// A cópia da Globo do MESMO BEM sai do acervo ativo. Cada corretor credenciado publica o seu anúncio
// do bem (ids diferentes), então a chave é matrícula + UF — e só contra o que esta rodada GRAVOU ativo.
// A Globo aplica a mesma regra ao regravar (scraper-globo.mjs), senão reativaria a cópia todo dia.
async function suprimirCopiaGlobo(gravados) {
  const chave = (uf, mat) => `${String(uf || '').toUpperCase()}|${String(mat || '').replace(/\D/g, '')}`;
  const bens = new Set(gravados.filter((r) => r.numero_matricula).map((r) => chave(r.estado, r.numero_matricula)));
  const { data, error } = await supabase.from('imoveis_leilao').select('fonte_id, estado, numero_matricula')
    .eq('fonte', 'GLOBOLEILOES').eq('ativo', true).ilike('url_lote', '%comprei.pgfn.gov.br%');
  if (error) { console.error(`  dedup Globo PULADO — ${error.message}`); return; }
  const alvo = (data || []).filter((r) => r.numero_matricula && bens.has(chave(r.estado, r.numero_matricula))).map((r) => r.fonte_id);
  if (!alvo.length) { console.log(`  dedup Globo: nenhuma cópia ativa (${data?.length || 0} links do Comprei na Globo)`); return; }
  const { data: feitos, error: e } = await supabase.from('imoveis_leilao').update({ ativo: false, suprimido_motivo: 'duplicata_comprei' })
    .eq('fonte', 'GLOBOLEILOES').in('fonte_id', alvo).select('fonte_id');
  if (e) console.error(`  dedup Globo: erro ${e.message}`);
  else console.log(`  dedup Globo: ${alvo.length} de ${data.length} links do Comprei são bens já coletados · ${feitos?.length || 0} desativados (duplicata_comprei)`);
}

async function main() {
  console.log(`🏛️  COMPREI (PGFN) ${DRYRUN ? '[DRY-RUN]' : '[GRAVANDO]'}`);
  let lista;
  try { lista = await enumerar(); }
  catch (e) {
    const motivo = `enumeração falhou: ${String(e.message).slice(0, 120)}`;
    console.error(`  ${motivo}`);
    if (!DRYRUN) await registrarSaude(supabase, FONTE, [], 'api', { ok: false, vazio: false, enumerados: 0, motivo,
      metricas: { n: 0, uf_pct: 0, valor_pct: 0, link_pct: 0, foto_pct: 0 } });
    process.exitCode = 1; return;
  }
  const { itens, total } = lista;
  const completa = total != null && itens.length >= total;
  console.log(`  listagem: ${itens.length} anúncios${total != null ? ` de ${total}` : ''} ${completa ? '(completa)' : '(PARCIAL)'}`);

  const prontos = []; const cont = { falhas: 0, vendidos: 0, fora: {}, semLocal: 0 };
  let i = 0;
  async function trabalhador() {
    while (i < itens.length) {
      const a = itens[i++];
      if (a.bemVendido === true) { cont.vendidos++; continue; }
      let v;
      try { v = await json(urlVisitarComprei(a.id)); }
      catch (e) { cont.falhas++; if (cont.falhas <= 3) console.log(`  ${a.id}: anúncio não lido (${String(e.message).slice(0, 80)})`); continue; }
      const row = montarRow(a, v || {});
      if (!row.ativo) { cont.vendidos++; prontos.push(row); continue; }
      const q = checarQualidade(row, { estrito: false });
      if (q.descartar) { const k = q.faltando[0] || 'descartado'; cont.fora[k] = (cont.fora[k] || 0) + 1; continue; }
      if (!row.cidade || !row.estado) { cont.semLocal++; continue; }
      prontos.push(row);
    }
  }
  await Promise.all(Array.from({ length: CONC }, trabalhador));
  const ativos = prontos.filter((r) => r.ativo);
  const pct = (f) => Math.round((100 * ativos.filter(f).length) / Math.max(1, ativos.length));
  console.log(`  ${ativos.length} prontos · ${cont.vendidos} vendidos · fora: ${JSON.stringify(cont.fora)} · ${cont.semLocal} sem cidade/UF · ${cont.falhas} falhas de leitura`);
  console.log(`  vias: ${JSON.stringify(vias)} · foto ${pct((r) => r.link_foto)}% · matrícula ${pct((r) => r.numero_matricula)}% · data ${pct((r) => r.data_leilao)}% · avaliação ${pct((r) => r.valor_avaliacao > 0)}%`);
  const porUF = ativos.reduce((m, r) => ({ ...m, [r.estado]: (m[r.estado] || 0) + 1 }), {});
  console.log(`  por UF: ${JSON.stringify(porUF)}`);

  if (DRYRUN) {
    console.log(JSON.stringify(ativos.slice(0, 2).map((r) => ({ ...r, descricao: r.descricao.slice(0, 200) })), null, 2));
    console.log('\nPara gravar, rode com COMPREI_DRYRUN=0.');
    return;
  }
  if (!ativos.length) {
    await registrarSaude(supabase, FONTE, [], 'api', { ok: false, vazio: completa && !cont.falhas, enumerados: itens.length,
      metricas: { n: 0, uf_pct: 0, valor_pct: 0, link_pct: 0, foto_pct: 0 },
      motivo: cont.falhas ? `${cont.falhas} anúncios não lidos e nenhum pronto` : 'nenhum anúncio ativo' });
    if (cont.falhas) process.exitCode = 1;
    return;
  }
  const gravados = await gravar(prontos);
  console.log(`✅ ${gravados} anúncios gravados/atualizados.`);
  // Varredura só com a lista inteira E todos os anúncios lidos: falha de leitura não é "saiu do site".
  if (completa && !cont.falhas) await varrerSumidos(new Set(itens.filter((a) => a.bemVendido !== true).map((a) => `comprei_${a.id}`)));
  else console.log(`  varredura PULADA — ${completa ? `${cont.falhas} anúncios não lidos` : 'listagem parcial'}.`);
  await suprimirCopiaGlobo(ativos);
  await registrarSaude(supabase, FONTE, ativos, 'api', { enumerados: itens.length });
}

main().catch((e) => { console.error(e); process.exit(1); });
