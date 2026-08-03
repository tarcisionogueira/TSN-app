/**
 * Backfill das fotos da Caixa para o Supabase Storage.
 *
 * POR QUÊ: a Caixa (venda-imoveis.caixa.gov.br) serve as fotos para IPs de datacenter
 * como o do GitHub Actions (Azure), mas RECUSA os IPs da Vercel (edge e node) — então o
 * nosso /api/img-proxy recebe 404 e a foto quebra no e-mail. Solução: baixar a foto aqui
 * (onde a Caixa atende) e hospedar no nosso Storage (CDN que o Gmail carrega direto).
 *
 * O QUE FAZ: para cada imóvel CEF cujo link_foto ainda aponta para a Caixa, baixa
 * F<num>21.jpg, sobe para o bucket público `imoveis-fotos` em cef/<fonte_id>.jpg e
 * atualiza link_foto para a URL pública do Storage. Idempotente e resumível (quem já
 * migrou tem link_foto no supabase e sai do filtro). Prioriza os atrativos (desconto>=40).
 *
 * Roda no GitHub Actions. Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = 'imoveis-fotos';
const CONCURRENCIA = Number(process.env.BACKFILL_CONCURRENCIA || 8);
const LIMITE = Number(process.env.BACKFILL_LIMITE || 0); // 0 = tudo
const SO_ATRATIVOS = process.env.BACKFILL_SO_ATRATIVOS === '1';
// RECHECK_NULOS: re-tenta os CEF com link_foto NULO (marcados "sem foto" numa run
// anterior). A Caixa publica fotos DEPOIS (comum em venda direta) — uma foto que não
// existia pode existir agora. Passe único e limitado (eles seguem nulos, então um
// while-loop os traria de volta pra sempre). Rode periodicamente p/ resgatar novas fotos.
const RECHECK_NULOS = process.env.RECHECK_NULOS === '1' || process.argv.includes('--recheck-nulos');

if (!SUPABASE_URL || !SERVICE_KEY) { console.error('env VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY ausente'); process.exit(1); }

const hdr = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
const REF = 'https://venda-imoveis.caixa.gov.br/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// fetch com retry/backoff para blips transitórios (5xx/429/rede). Um único 500 do
// PostgREST no select derrubava o backfill inteiro (a run travou em ~20k por causa
// disso). Cria um AbortSignal novo a cada tentativa (o signal é de uso único).
async function fetchRetry(url, { timeoutMs = 20000, ...opts } = {}, tentativas = 5) {
  let ultimoErro;
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
      // 4xx (exceto 429) é erro do request, não adianta repetir.
      if (r.ok || (r.status < 500 && r.status !== 429)) return r;
      ultimoErro = new Error(`HTTP ${r.status}`);
    } catch (e) { ultimoErro = e; }
    if (i < tentativas - 1) await new Promise(res => setTimeout(res, Math.min(1000 * 2 ** i, 15000)));
  }
  throw ultimoErro || new Error('falha após retries');
}

// Busca um lote de imóveis CEF ainda não migrados (link_foto na Caixa).
async function proximoLote(qtd) {
  const cond = SO_ATRATIVOS ? '&desconto_percentual=gte.40' : '';
  // Padrão: link_foto ainda na Caixa (não migrados). RECHECK_NULOS: link_foto nulo.
  const filtroFoto = RECHECK_NULOS ? '&link_foto=is.null' : '&link_foto=like.*venda-imoveis.caixa.gov.br*';
  const ordem = RECHECK_NULOS ? 'atualizado_em.desc' : 'desconto_percentual.desc.nullslast';
  const url = `${SUPABASE_URL}/rest/v1/imoveis_leilao`
    + `?select=id,fonte_id,link_foto&fonte=eq.CEF`
    + `${filtroFoto}${cond}`
    + `&order=${ordem}&limit=${qtd}`;
  const r = await fetchRetry(url, { headers: hdr, timeoutMs: 20000 });
  if (!r.ok) throw new Error(`select falhou: ${r.status}`);
  return r.json();
}

// Tenta os PADRÕES conhecidos de URL de foto da Caixa (mesma lista do /api/img-caixa).
// Antes só tentava F<num>21.jpg — venda direta e alguns imóveis publicam a foto em outro
// caminho, então caíam como "sem foto" mesmo TENDO foto no portal. Retorna o 1º que baixar.
function urlsFotoCaixa(num) {
  const B = 'https://venda-imoveis.caixa.gov.br';
  return [
    `${B}/fotos/F${num}21.jpg`,
    `${B}/fotos/F${num}1.jpg`,
    `${B}/fotos/F${num}.jpg`,
    `${B}/sistema/imgs/foto_imovel/${num}_1.jpg`,
    `${B}/sistema/imgs/foto_imovel/${num}.jpg`,
    `${B}/fotos/${num}_1.jpg`,
  ];
}
async function baixarFoto(num) {
  for (const url of urlsFotoCaixa(num)) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Referer: REF, Accept: 'image/*' }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) continue;
      const ct = r.headers.get('content-type') || '';
      if (!ct.startsWith('image/')) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 800) continue; // placeholder/erro
      return buf;
    } catch { /* tenta o próximo padrão */ }
  }
  return null;
}

// CAMINHO CANÔNICO: `cef/<fonte_id>.jpg` — o MESMO que o scraper diário usa
// (scripts/scraper.js, api/scraper-caixa.js, scripts/foto-cef.mjs).
//
// POR QUE MUDOU: este backfill gravava em `caixa/F<num>21.jpg`, um segundo caminho para a
// MESMA foto do MESMO imóvel. O efeito era um pingue-pongue diário: o scraper subia em
// `cef/…` e apontava o link_foto para lá; o backfill subia em `caixa/…` e movia o link; no
// dia seguinte o scraper trazia de volta — e a cada troca o arquivo do outro lado ficava
// ÓRFÃO. Medido em 03/08: 21.418 fotos órfãs (1,1 GB) e o faxineiro diário apagando 1.500/dia
// enquanto ~1.150 nasciam — saldo de só 342/dia, enxugando gelo. Com o caminho único, o
// upsert sobrescreve no lugar e a órfã deixa de ser criada.
async function subirStorage(fonteId, buf) {
  const path = `cef/${fonteId}.jpg`;
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { ...hdr, 'Content-Type': 'image/jpeg', 'x-upsert': 'true', 'Cache-Control': '2592000' },
    body: buf,
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok && r.status !== 409) throw new Error(`upload ${r.status}: ${(await r.text()).slice(0, 120)}`);
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

async function atualizarLink(id, publicUrl) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/imoveis_leilao?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...hdr, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ link_foto: publicUrl }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`patch ${r.status}`);
}

// Processa 1 imóvel: baixa → sobe → atualiza. Retorna 'ok' | 'sem_foto' | 'erro'.
async function processar(im) {
  const num = String(im.fonte_id || '').replace(/^(caixa_|cef_)/, '');
  if (!/^\d+$/.test(num)) return 'erro';
  try {
    const buf = await baixarFoto(num);
    if (!buf) { // Caixa não tem a foto: zera p/ sair do filtro e não repetir eternamente.
      await atualizarLink(im.id, null).catch(() => {});
      return 'sem_foto';
    }
    // Sobe pelo fonte_id (chave canônica), não pelo número — ver subirStorage().
    const publicUrl = await subirStorage(im.fonte_id, buf);
    await atualizarLink(im.id, publicUrl);
    return 'ok';
  } catch (e) {
    console.error(`  erro ${im.id} (F${num}21):`, String(e.message).slice(0, 100));
    return 'erro';
  }
}

// Pool de concorrência simples.
async function emLotes(itens, n, fn) {
  const res = []; let i = 0;
  const worker = async () => { while (i < itens.length) { const k = i++; res[k] = await fn(itens[k]); } };
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, worker));
  return res;
}

(async () => {
  console.log(`Backfill fotos Caixa → Storage (${RECHECK_NULOS ? 're-check de link_foto NULO' : 'não migrados'}; concorrência ${CONCURRENCIA}${SO_ATRATIVOS ? ', só atrativos' : ''}${LIMITE ? `, limite ${LIMITE}` : ''})`);
  let ok = 0, semFoto = 0, erro = 0, processados = 0;
  const t0 = Date.now();
  try {
    if (RECHECK_NULOS) {
      // Passe ÚNICO: os nulos são poucos e PERMANECEM nulos quando a Caixa segue sem foto —
      // um while-loop os traria de volta pra sempre. Uma varredura por execução (o teto
      // limita o custo); as que ganharam foto viram URL do Storage e saem do conjunto.
      const teto = LIMITE || 5000;
      const lote = await proximoLote(teto);
      console.log(`… ${lote.length} CEF com link_foto nulo p/ re-checar`);
      const r = await emLotes(lote, CONCURRENCIA, processar);
      for (const x of r) { if (x === 'ok') ok++; else if (x === 'sem_foto') semFoto++; else erro++; }
      processados = lote.length;
    } else {
      while (true) {
        const restante = LIMITE ? Math.min(500, LIMITE - processados) : 500;
        if (restante <= 0) break;
        const lote = await proximoLote(restante);
        if (!lote.length) break;
        const r = await emLotes(lote, CONCURRENCIA, processar);
        for (const x of r) { if (x === 'ok') ok++; else if (x === 'sem_foto') semFoto++; else erro++; }
        processados += lote.length;
        const dt = ((Date.now() - t0) / 1000).toFixed(0);
        console.log(`… ${processados} processados | ok=${ok} sem_foto=${semFoto} erro=${erro} | ${dt}s`);
        if (LIMITE && processados >= LIMITE) break;
      }
    }
  } catch (e) {
    // ENDURECIMENTO: um erro do SELECT (ex.: HTTP 500 transitório do PostgREST — comum sob
    // throttle de plano) NÃO deve derrubar o job com alarme falso. Loga, preserva o parcial
    // e sai GRACIOSO (exit 0). A próxima execução retoma de onde parou (idempotente).
    console.error(`\n⚠️ Backfill interrompido por erro transitório (parcial preservado): ${String(e?.message || e).slice(0, 160)}`);
    console.log(`Parcial: ${ok} migradas, ${semFoto} sem foto, ${erro} erros, ${processados} processados.`);
    process.exitCode = 0;
    return;
  }
  console.log(`\n✅ Concluído: ${ok} migradas, ${semFoto} sem foto na Caixa, ${erro} erros.`);
})();
