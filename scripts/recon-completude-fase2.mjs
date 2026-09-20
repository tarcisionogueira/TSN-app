#!/usr/bin/env node
/**
 * RECON DESCARTÁVEL (20/09) — fase 2 da auditoria de completude, autorizada pelo dono depois do
 * relatório inicial ("resolva os demais problemas"). Não grava nada no banco. Investiga, com
 * dado real, os pontos que a sessão anterior deixou como "precisa confirmar antes de codar":
 *
 *  A) PESTANA — o payload de /api/v2/lote?leilao=N tem campo de endereço/logradouro que o
 *     mapper não usa? (hoje `endereco: ''` hardcoded em mapLotePestana)
 *  B) BIASI/GRUPOLANCE/LEILAOBRASIL/HASTAPUBLICA — a página de DETALHE do lote (que estes
 *     scrapers nunca visitam) publica endereço de rua/logradouro?
 *  C) FERREIRALEIL — a regressão de data (~58%→2% desde 01/09): testa a hipótese "a data só
 *     aparece depois de JS rodar" usando Chromium real (fetchHeadless), não só o Web Unlocker.
 *  D) PECINI — janela maior de datas cruas (20 matches, 80 chars de contexto) pra achar a
 *     âncora real da praça, que a amostra de 6-10 matches da rodada anterior não pegou.
 *
 * Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY, BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE.
 */
import { decodificarEntidades } from '../api/_texto-imovel.js';
import { fetchHeadless, fecharHeadless } from './lib/fetch-residencial.mjs';
import { buscarViaBrightData, ErroBrightData } from '../api/_brightdata.js';

const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB || !KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sbGet(caminho) {
  const r = await fetch(`${SB}/rest/v1/${caminho}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!r.ok) throw new Error(`PostgREST ${r.status}: ${(await r.text().catch(() => '')).slice(0, 150)}`);
  return r.json();
}

async function fetchDireto(url, { timeoutMs = 20000, headers = {} } = {}) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/json,*/*', ...headers }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    const txt = await r.text().catch(() => '');
    return { status: r.status, ok: r.ok, body: txt };
  } catch (e) { return { status: 0, ok: false, body: '', erro: String(e?.message || e).slice(0, 120) }; }
}

function textoPlano(html) {
  return decodificarEntidades(String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// Regex de logradouro comum em endereço BR: Rua/Av/Avenida/Travessa/Alameda/Rodovia/Estrada + nome + (nº opcional)
const RE_LOGRADOURO = /\b(Rua|Av\.?|Avenida|Travessa|Alameda|Rodovia|Estrada|Pra[çc]a|Rod\.)\s+[A-Za-zÀ-ÿ0-9'.\- ]{3,60}(?:,?\s*n?[ºo°]?\s*\d{1,5})?/i;

async function main() {
  console.log('\n===== A) PESTANA — payload bruto da API /api/v2/lote (campos de endereço?) =====');
  try {
    const rLeilao = await fetchDireto('https://www.pestanaleiloes.com.br/api/v2/leilao', { headers: { Accept: 'application/json' } });
    console.log(`  /api/v2/leilao → status ${rLeilao.status}, ${rLeilao.body.length} bytes`);
    if (rLeilao.ok) {
      const leiloes = JSON.parse(rLeilao.body);
      const ativo = (Array.isArray(leiloes) ? leiloes : []).find(l => l && l.id);
      if (ativo) {
        const rLote = await fetchDireto(`https://www.pestanaleiloes.com.br/api/v2/lote?leilao=${ativo.id}&page=1&qtd=5`, { headers: { Accept: 'application/json' } });
        console.log(`  /api/v2/lote?leilao=${ativo.id} → status ${rLote.status}, ${rLote.body.length} bytes`);
        if (rLote.ok) {
          const lotes = JSON.parse(rLote.body);
          const lote0 = (Array.isArray(lotes) ? lotes : lotes.data || lotes.items || [])[0];
          if (lote0) {
            console.log('  chaves do LOTE:', Object.keys(lote0).join(', '));
            const bem = (lote0.bens || [])[0];
            if (bem) {
              console.log('  chaves do BEM:', Object.keys(bem).join(', '));
              console.log('  BEM completo (JSON):', JSON.stringify(bem).slice(0, 3000));
            }
          } else console.log('  (lista de lotes vazia)');
        }
      }
    }
  } catch (e) { console.log('  ERRO:', String(e?.message || e).slice(0, 200)); }

  console.log('\n===== B) Página de DETALHE — endereço/logradouro presente? =====');
  const fontes = [
    { fonte: 'BIASI', limit: 3 },
    { fonte: 'GRUPOLANCE', limit: 3 },
    { fonte: 'LEILAOBRASIL', limit: 3 },
    { fonte: 'HASTAPUBLICA', limit: 3 },
  ];
  for (const { fonte, limit } of fontes) {
    const rows = await sbGet(`imoveis_leilao?select=fonte_id,url_lote,titulo&ativo=eq.true&fonte=eq.${fonte}&order=atualizado_em.desc&limit=${limit}`);
    for (const row of rows) {
      const r = await fetchDireto(row.url_lote);
      if (!r.ok) { console.log(`  [${fonte}] ${row.url_lote} → HTTP ${r.status} ${r.erro || ''}`); continue; }
      const txt = textoPlano(r.body);
      const m = txt.match(RE_LOGRADOURO);
      console.log(`  [${fonte}] ${row.fonte_id} (${r.body.length}b) — logradouro achado: ${m ? `"${m[0]}"` : '(NENHUM)'}"`);
      if (m) console.log(`     contexto: "...${txt.slice(Math.max(0, m.index - 40), m.index + 120)}..."`);
      await sleep(400);
    }
  }

  console.log('\n===== C) FERREIRALEIL — Chromium real (fetchHeadless), testa hipótese JS =====');
  const ferreira = await sbGet(`imoveis_leilao?select=fonte_id,url_lote&ativo=eq.true&fonte=eq.FERREIRALEIL&data_leilao=is.null&order=atualizado_em.desc&limit=3`);
  for (const row of ferreira) {
    const html = await fetchHeadless(row.url_lote, { timeoutMs: 45000, esperaMs: 5000 });
    if (!html) { console.log(`  [FERREIRALEIL headless] ${row.url_lote} → null (falhou)`); continue; }
    const txt = textoPlano(html);
    const datas = [...txt.matchAll(/(\d{1,2})\/([A-Za-zç]{3}|\d{2})\/(\d{4})/g)].slice(0, 8).map(m => m[0]);
    console.log(`  [FERREIRALEIL headless] ${row.fonte_id} (${html.length}b) — datas achadas: ${datas.length ? datas.join(', ') : '(NENHUMA mesmo com JS rodando)'}`);
    // Também procura texto de "praça"/"leilão" com data por perto, igual ao extrator real.
    const anc = txt.match(/(?:leil[ãa]o|pra[çc]a|encerr)[^\d]{0,60}(\d{2}\/\d{2}\/\d{4})/i);
    console.log(`     âncora leilão/praça/encerr: ${anc ? anc[0] : '(nenhuma)'}`);
    await sleep(1000);
  }
  await fecharHeadless();

  console.log('\n===== D) PECINI — janela maior de datas cruas (20 matches, mais contexto) =====');
  const pecini = await sbGet(`imoveis_leilao?select=fonte_id,url_lote&ativo=eq.true&fonte=eq.PECINI&data_leilao=is.null&order=atualizado_em.desc&limit=3`);
  for (const row of pecini) {
    const r = await fetchDireto(row.url_lote);
    let body = r.body;
    if (!r.ok) {
      console.log(`  [PECINI] direto=${r.status} → tentando Bright Data...`);
      try {
        const bd = await buscarViaBrightData(row.url_lote, { proposito: 'pecini', timeoutMs: 60000, exigirOk: false });
        if (!bd || !bd.ok) { console.log(`  [PECINI] ${row.fonte_id} → BD também falhou`); continue; }
        body = await bd.text();
      } catch (e) {
        console.log(`  [PECINI] ${row.fonte_id} → BD exceção: ${e instanceof ErroBrightData ? e.motivo : String(e?.message || e).slice(0, 100)}`);
        continue;
      }
    }
    const txt = textoPlano(body);
    const re = /(\d{2})\/(\d{2})\/(\d{4})/g;
    const achados = [];
    let m;
    while ((m = re.exec(txt)) && achados.length < 20) {
      const antes = txt.slice(Math.max(0, m.index - 70), m.index).trim().slice(-65);
      achados.push(`"${antes}" → ${m[0]}`);
    }
    console.log(`  [PECINI] ${row.fonte_id} (${body.length}b): ${achados.length} datas`);
    achados.forEach(a => console.log('     ' + a));
    await sleep(500);
  }
}

main().catch(e => { console.error('[recon-completude-fase2] FALHOU:', e?.message || e); process.exit(1); });
