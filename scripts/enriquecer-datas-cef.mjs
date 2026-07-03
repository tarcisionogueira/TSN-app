#!/usr/bin/env node
/**
 * Enriquecimento de DATAS da Caixa (CEF) — ROTA 2, no runner do GitHub (grátis).
 *
 * Filosofia de coleta: cada fonte precisa de VÁRIAS ROTAS para a informação não
 * faltar. Para a data da Caixa:
 *   1) CSV em massa (scraper-caixa.js, coluna 13) — a Caixa costuma deixar vazio;
 *   2) ESTA página de detalhe pelo runner do GitHub (o IP da Vercel é bloqueado,
 *      o do runner costuma passar) — cobre o grosso de graça;
 *   3) Bright Data sob demanda (enriquecer-lote.js) — quando o cliente abre.
 *
 * Venda direta é venda contínua (sem data de leilão) e é ignorada de propósito.
 *
 * Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY. Opcional: CEF_DATAS_LIMITE.
 */
const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const LIMITE = parseInt(process.env.CEF_DATAS_LIMITE || '6000', 10);
const CONC = 8;
const DEADLINE = Date.now() + 70 * 60 * 1000; // para antes do timeout de 90 min da Action
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

if (!SB || !KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

function sb(path, opts = {}) {
  return fetch(`${SB}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

// Extrai a data do próximo leilão/licitação do HTML (mesma lógica de enriquecer-lote).
function extrairDataLeilaoHTML(html) {
  if (!html) return null;
  const txt = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ');
  const re = /(?:leil[ãa]o|pra[çc]a|encerra|licita[çc][ãa]o|data)[^0-9]{0,40}(\d{2})\/(\d{2})\/(\d{2,4})/gi;
  const ontem = Date.now() - 86400000;
  const limite = Date.now() + 400 * 86400000;
  const futuras = [];
  let m;
  while ((m = re.exec(txt))) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    const t = Date.parse(`${y}-${m[2]}-${m[1]}`);
    if (!isNaN(t) && t >= ontem && t < limite) futuras.push(t);
  }
  if (!futuras.length) return null;
  return new Date(Math.min(...futuras)).toISOString().slice(0, 10);
}

async function main() {
  const filtro = [
    'fonte=eq.CEF', 'ativo=eq.true', 'data_leilao=is.null',
    'modalidade=not.ilike.*venda*direta*',
    'link_edital=not.is.null',
    'select=id,link_edital,url_lote',
    'order=enriquecido_em.asc.nullsfirst',
    `limit=${LIMITE}`,
  ].join('&');

  const cands = await (await sb(`imoveis_leilao?${filtro}`)).json().catch(() => []);
  if (!Array.isArray(cands) || !cands.length) { console.log('CEF: sem candidatos sem data.'); return; }
  console.log(`CEF sem data (não venda direta): ${cands.length} candidatos · limite ${LIMITE}`);

  let ok = 0, semData = 0, falha = 0, feitos = 0, bloqueio = 0;
  for (let i = 0; i < cands.length && Date.now() < DEADLINE; i += CONC) {
    const lote = cands.slice(i, i + CONC);
    await Promise.all(lote.map(async (im) => {
      const url = im.url_lote || im.link_edital;
      const patch = { enriquecido_em: new Date().toISOString() };
      try {
        const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' }, signal: AbortSignal.timeout(12000) });
        if (r.ok) {
          const d = extrairDataLeilaoHTML(await r.text());
          if (d) { patch.data_leilao = d; ok++; } else semData++;
        } else { falha++; if (r.status === 403 || r.status === 429) bloqueio++; }
      } catch { falha++; }
      feitos++;
      await sb(`imoveis_leilao?id=eq.${encodeURIComponent(im.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) }).catch(() => {});
    }));
    if ((i / CONC) % 25 === 0) console.log(`  ${feitos}/${cands.length} · datas ${ok} · sem-data ${semData} · falha ${falha}`);
    // Se a Caixa estiver bloqueando o runner (muitos 403/429 logo de início), aborta cedo.
    if (feitos >= 40 && bloqueio / feitos > 0.7) { console.log('⚠️ Caixa parece bloquear o runner (muitos 403/429). Abortando — rota 2 indisponível.'); break; }
    await new Promise(r => setTimeout(r, 200));
  }
  console.log(`FIM CEF datas: preenchidas ${ok} · sem-data-na-pagina ${semData} · falha ${falha} · processados ${feitos}`);
}

main().catch(e => { console.error(e); process.exit(1); });
