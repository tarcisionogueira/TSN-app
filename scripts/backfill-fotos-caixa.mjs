/**
 * Backfill das fotos da Caixa para o Supabase Storage.
 *
 * POR QUÊ: a Caixa (venda-imoveis.caixa.gov.br) serve as fotos para IPs de datacenter
 * como o do GitHub Actions (Azure), mas RECUSA os IPs da Vercel (edge e node) — então o
 * nosso /api/img-proxy recebe 404 e a foto quebra no e-mail. Solução: baixar a foto aqui
 * (onde a Caixa atende) e hospedar no nosso Storage (CDN que o Gmail carrega direto).
 *
 * O QUE FAZ: para cada imóvel CEF cujo link_foto ainda aponta para a Caixa, baixa
 * F<num>21.jpg, sobe para o bucket público `imoveis-fotos` em caixa/F<num>21.jpg e
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

if (!SUPABASE_URL || !SERVICE_KEY) { console.error('env VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY ausente'); process.exit(1); }

const hdr = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
const REF = 'https://venda-imoveis.caixa.gov.br/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// Busca um lote de imóveis CEF ainda não migrados (link_foto na Caixa).
async function proximoLote(qtd) {
  const cond = SO_ATRATIVOS ? '&desconto_percentual=gte.40' : '';
  const url = `${SUPABASE_URL}/rest/v1/imoveis_leilao`
    + `?select=id,fonte_id,link_foto&fonte=eq.CEF`
    + `&link_foto=like.*venda-imoveis.caixa.gov.br*${cond}`
    + `&order=desconto_percentual.desc.nullslast&limit=${qtd}`;
  const r = await fetch(url, { headers: hdr, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`select falhou: ${r.status}`);
  return r.json();
}

async function baixarFoto(num) {
  const url = `https://venda-imoveis.caixa.gov.br/fotos/F${num}21.jpg`;
  const r = await fetch(url, { headers: { 'User-Agent': UA, Referer: REF, Accept: 'image/*' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) return null;
  const ct = r.headers.get('content-type') || '';
  if (!ct.startsWith('image/')) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 800) return null; // placeholder/erro
  return buf;
}

async function subirStorage(num, buf) {
  const path = `caixa/F${num}21.jpg`;
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
    const publicUrl = await subirStorage(num, buf);
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
  console.log(`Backfill fotos Caixa → Storage (concorrência ${CONCURRENCIA}${SO_ATRATIVOS ? ', só atrativos' : ''}${LIMITE ? `, limite ${LIMITE}` : ''})`);
  let ok = 0, semFoto = 0, erro = 0, processados = 0;
  const t0 = Date.now();
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
  console.log(`\n✅ Concluído: ${ok} migradas, ${semFoto} sem foto na Caixa, ${erro} erros.`);
})();
