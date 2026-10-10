/**
 * Scraper GLOBOLEILOES — globoleiloes.com.br, pelo JSON da própria página (29/09). Parser puro em
 * lib/globo-json.mjs (ver lá o porquê: o coletor `dom` antigo achava 0 lote e tinha 6 gravados com
 * cidade/tipo errados; o site lista ~780 imóveis em 3 categorias).
 *
 * Listagem: /leiloes?category_id={1,2,3}&page=N (10 por página, JSON completo de cada lote).
 * Detalhe: só lotes PRÓPRIOS da Globo (url nula) — traz fotos, PDFs (matrícula, avaliação),
 * endereço e CEP. Lote de parceiro (Balbino, Bom Valor) aponta para o site do parceiro.
 * Acesso: fetch direto; se o runner levar 403, a mesma página pelo banco (pg_net, grátis).
 *
 * Env: GLOBO_DRYRUN (default '1') · GLOBO_MAX_DETALHE (400) · VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { FONTE, BASE, CATEGORIAS_IMOVEL, lerListagem, lerDetalhe, montarRowGlobo } from './lib/globo-json.mjs';
import { idAnuncioComprei, urlVisitarComprei, fichaComprei } from './lib/comprei-pgfn.mjs';
import { ehFracaoIdeal } from './lib/scraper-core.mjs';
import { viaBanco } from './lib/motor/fetch-fonte.mjs';
import { registrarSaude } from './_saude-fonte.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const supabase = createClient(SB_URL, SB_KEY);
const DRYRUN = process.env.GLOBO_DRYRUN !== '0';
const MAX_DETALHE = Number(process.env.GLOBO_MAX_DETALHE || 400);
const MAX_COMPREI = Number(process.env.GLOBO_MAX_COMPREI || 200);
const MAX_PAGINAS = 150;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let viaUsada = 'direto';
let diretoBarrado = false; // o runner levou 403 uma vez → o resto vai direto pelo banco (poupa ~30 s/página)

async function baixar(url) {
  let motivo = 'direto pulado (403 antes)';
  if (!diretoBarrado) try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9', Accept: 'text/html' }, signal: AbortSignal.timeout(30000) });
    if (r.ok) return await r.text();
    motivo = `HTTP ${r.status}`;
    if (r.status === 403) diretoBarrado = true;
  } catch (e) { motivo = String(e?.message || e).slice(0, 60); }
  const b = await viaBanco(url);
  if (b.html) { viaUsada = 'banco'; return b.html; }
  throw new Error(`${motivo} · banco: ${b.motivo}`);
}

async function enumerar() {
  const porId = new Map();
  let completa = true, motivo = null;
  for (const cat of CATEGORIAS_IMOVEL) {
    for (let pg = 1; pg <= MAX_PAGINAS; pg++) {
      let lst;
      try { lst = lerListagem(await baixar(`${BASE}/leiloes?category_id=${cat}&page=${pg}`)); }
      catch (e) { completa = false; motivo = `categoria ${cat} página ${pg}: ${String(e.message).slice(0, 80)}`; break; }
      if (!lst) { completa = false; motivo = `categoria ${cat} página ${pg}: sem JSON de lotes (layout mudou?)`; break; }
      for (const l of lst.lotes) porId.set(String(l.id), l);
      if (pg === 1) console.log(`  categoria ${cat}: ${lst.total} lotes em ${lst.ultima} página(s)`);
      if (pg >= lst.ultima || !lst.lotes.length) break;
      if (pg === MAX_PAGINAS) { completa = false; motivo = `teto de ${MAX_PAGINAS} páginas na categoria ${cat}`; }
      await sleep(300);
    }
    if (!completa) break;
  }
  return { lotes: [...porId.values()], completa, motivo };
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

// Upsert em GRUPOS de mesmo conjunto de colunas: num lote misto, o PostgREST grava NULL na coluna
// que falta — e apagaria foto/anexos de lote que não foi relido nesta rodada.
async function gravar(rows) {
  const grupos = new Map();
  for (const r of rows) { const k = Object.keys(r).sort().join(','); (grupos.get(k) || grupos.set(k, []).get(k)).push(r); }
  let n = 0;
  for (const g of grupos.values()) {
    for (let i = 0; i < g.length; i += 200) {
      const { data, error } = await supabase.from('imoveis_leilao').upsert(g.slice(i, i + 200), { onConflict: 'fonte_id' }).select('fonte_id');
      if (error) throw new Error(`upsert: ${error.message}`);
      n += data?.length || 0;
    }
  }
  return n;
}

async function main() {
  console.log(`${FONTE} ${DRYRUN ? '(DRY-RUN — não grava)' : '(GRAVANDO)'}`);
  const { lotes, completa, motivo } = await enumerar();
  console.log(`  enumerados ${lotes.length} (${completa ? 'lista completa' : `PARCIAL — ${motivo}`}) · via ${viaUsada}`);

  // Detalhe (fotos/PDFs/CEP) só de lote NOVO ou ainda sem foto: isso quase não muda, e ler os ~500
  // detalhes toda rodada custava ~20 min pela via banco (dry-run 29/09). Leitura falha → lê todos.
  // Paginado: o PostgREST corta em 1.000 linhas e o resto releria detalhe todo dia.
  const comFoto = new Set();
  for (let de = 0; ; de += 1000) {
    const { data, error: eJa } = await supabase.from('imoveis_leilao').select('fonte_id, anexos').eq('fonte', FONTE)
      .not('link_foto', 'is', null).order('fonte_id').range(de, de + 999);
    if (eJa) { comFoto.clear(); console.log(`  aviso: não li quem já tem foto (${eJa.message}) — lê o detalhe de todos`); break; }
    // Só pula quem tem foto E anexo (08/10, #177): o leiloeiro sobe a matrícula depois da 1ª
    // leitura, e "já tem foto" deixava o lote sem documento para sempre (medido: matrícula na
    // página, nada no banco). Lote sem anexo é minoria e volta à fila do teto MAX_DETALHE.
    for (const r of data || []) if (Array.isArray(r.anexos) && r.anexos.length) comFoto.add(r.fonte_id);
    if (!data || data.length < 1000) break;
  }
  const comprei = { lidos: 0, falhas: 0, semFicha: 0, vendidos: 0 };
  const prontos = []; let gravados = 0; let fracao = 0, semPraca = 0, semLocal = 0, detalhes = 0, semDetalhe = 0, pulados = 0;
  // Comprei (PGFN) é coletado NA ORIGEM desde 10/10 (scraper-comprei.mjs, fonte COMPREI). Cada corretor
  // credenciado publica o SEU anúncio do mesmo bem — o link da Globo tem outro id de anúncio, então a chave
  // é o BEM: matrícula + UF (111 de 128 casaram em 10/10). Bem que já está na COMPREI ativa sai daqui como
  // 'duplicata_comprei'; o resto (sem matrícula, fora da listagem pública) segue pela Globo.
  // Leitura falhou → não suprime nada (duplicar é o mal menor; sumir lote não).
  const chaveBem = (uf, mat) => `${String(uf || '').toUpperCase()}|${String(mat || '').replace(/\D/g, '')}`;
  const bensComprei = new Set();
  for (let de = 0; ; de += 1000) {
    const { data, error: eC } = await supabase.from('imoveis_leilao').select('estado, numero_matricula').eq('fonte', 'COMPREI')
      .eq('ativo', true).not('numero_matricula', 'is', null).order('fonte_id').range(de, de + 999);
    if (eC) { bensComprei.clear(); console.log(`  aviso: acervo COMPREI ilegível (${eC.message}) — nenhuma duplicata suprimida`); break; }
    for (const r of data || []) bensComprei.add(chaveBem(r.estado, r.numero_matricula));
    if (!data || data.length < 1000) break;
  }
  let dupComprei = 0;
  for (const l of lotes) {
    const previa = montarRowGlobo(l);
    if (ehFracaoIdeal(previa)) { fracao++; continue; }
    if (!previa.valor_minimo) { semPraca++; continue; }
    if (!previa.cidade || !previa.estado) { semLocal++; continue; }
    let det = null;
    if (!l.url && comFoto.has(previa.fonte_id)) pulados++;
    else if (!l.url && detalhes < MAX_DETALHE) {
      try { det = lerDetalhe(await baixar(previa.url_lote)); detalhes++; await sleep(250); }
      catch (e) { semDetalhe++; if (semDetalhe <= 3) console.log(`  ${previa.fonte_id}: detalhe não lido (${String(e.message).slice(0, 60)})`); }
    }
    const row = montarRowGlobo(l, det);
    // Venda direta da PGFN (Comprei, #185): o parceiro só manda o link; a API pública do anúncio
    // traz matrícula, cartório, processo, ônus, CEP e endereço. Sem arquivo (o Comprei não publica).
    const idComprei = idAnuncioComprei(row.url_lote);
    if (idComprei && comprei.lidos < MAX_COMPREI) {
      try {
        const ficha = fichaComprei(JSON.parse(await baixar(urlVisitarComprei(idComprei))));
        comprei.lidos++;
        if (ficha) {
          if (ficha.endereco && !row.endereco) row.endereco = ficha.endereco;
          if (ficha.bairro && !row.bairro) row.bairro = ficha.bairro;
          if (ficha.cep) row.cep = ficha.cep;
          if (ficha.numero_matricula) row.numero_matricula = ficha.numero_matricula;
          if (ficha.numero_processo) row.numero_processo = ficha.numero_processo;
          if (ficha.bloco && !row.descricao.includes('Dados do Comprei')) row.descricao = `${row.descricao}\n\n${ficha.bloco}`.slice(0, 9000);
          if (ficha.vendido) { row.ativo = false; row.suprimido_motivo = 'vendido_na_fonte'; comprei.vendidos++; }
          else if (ficha.numero_matricula && bensComprei.has(chaveBem(row.estado, ficha.numero_matricula))) {
            row.ativo = false; row.suprimido_motivo = 'duplicata_comprei'; dupComprei++;
          }
        } else comprei.semFicha++;
        await sleep(150);
      } catch (e) { comprei.falhas++; if (comprei.falhas <= 3) console.log(`  ${row.fonte_id}: Comprei não lido (${String(e.message).slice(0, 60)})`); }
    }
    prontos.push(row);
    // Grava em BLOCOS durante o laço (revisão 29/09): na 1ª rodada são ~400 detalhes pela via banco
    // (~20 min) e o job tem teto de 55 — gravar só no fim era perder tudo no corte e repetir o
    // mesmo trabalho no dia seguinte, para sempre. Assim cada bloco gravado já tira lote da fila.
    if (!DRYRUN && prontos.length - gravados >= 100) gravados += await gravar(prontos.slice(gravados));
  }
  const porLeiloeiro = prontos.reduce((m, r) => ({ ...m, [r.leiloeiro]: (m[r.leiloeiro] || 0) + 1 }), {});
  const pct = (f) => Math.round((100 * prontos.filter(f).length) / Math.max(1, prontos.length));
  if (comprei.lidos || comprei.falhas) console.log(`  Comprei (PGFN): ${comprei.lidos} anúncios lidos · ${comprei.semFicha} sem ficha · ${comprei.vendidos} vendidos · ${comprei.falhas} falhas`);
  console.log(`  ${prontos.length} prontos · ${fracao} fração ideal (fora) · ${semPraca} sem praça vigente · ${semLocal} sem cidade/UF · detalhe lido em ${detalhes} (${semDetalhe} falhas, ${pulados} já com foto)`);
  console.log(`  por leiloeiro: ${JSON.stringify(porLeiloeiro)} · foto ${pct((r) => r.link_foto)}% · área ${pct((r) => r.area_m2 > 0)}% · anexos ${pct((r) => r.anexos?.length)}%`);

  if (DRYRUN) {
    console.log(JSON.stringify(prontos.slice(0, 3).map((r) => ({ ...r, descricao: r.descricao.slice(0, 100) })), null, 2));
    console.log('\nPara gravar, rode com GLOBO_DRYRUN=0.');
    return;
  }
  if (!prontos.length) {
    await registrarSaude(supabase, FONTE, [], 'inertia-json', { ok: false, vazio: completa, enumerados: lotes.length,
      metricas: { n: 0, uf_pct: 0, valor_pct: 0, link_pct: 0, foto_pct: 0 },
      motivo: completa ? 'site sem imóvel com praça vigente' : `enumeração falhou (${motivo})` });
    if (!completa) process.exitCode = 1;
    return;
  }
  if (prontos.length > gravados) gravados += await gravar(prontos.slice(gravados));
  console.log(`✅ ${gravados} imóveis gravados/atualizados.`);
  if (dupComprei) console.log(`  ${dupComprei} anúncios do Comprei já coletados na origem (fonte COMPREI) → duplicata_comprei`);
  if (completa) await varrerSumidos(new Set(prontos.map((r) => r.fonte_id)));
  else console.log('  varredura PULADA — enumeração parcial.');
  await registrarSaude(supabase, FONTE, prontos, 'inertia-json', { enumerados: lotes.length });
}

main().catch((e) => { console.error(e); process.exit(1); });
