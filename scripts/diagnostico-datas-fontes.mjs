#!/usr/bin/env node
/**
 * DIAGNÓSTICO — por que estas fontes não têm data de leilão? (23/08/2026)
 *
 * Achado do dia: ~1.010 lotes ATIVOS de leiloeiro (GRUPOLANCE 449, BIASI 304,
 * VIP 87, WEBLEILOES 67, SUPORTE 62, GESTAOLEILOES 40) aparecem para o cliente
 * SEM data de leilão. Causa já corrigida em `enriquecer-datas-cron`: a recusa de
 * orçamento do Bright Data era lida como "visitei e não achei" (forma #5), então
 * cada rodada carimbava 5 lotes sem tê-los lido.
 *
 * Este script responde a pergunta SEGUINTE, que o conserto sozinho não responde:
 * quando a página for lida, o extrator ACHA a data? Para cada fonte, pega uma
 * amostra de lotes sem data, busca a página DIRETO (sem gastar Bright Data) e
 * roda o MESMO `extrairDatasLeilao` que a produção usa — nada de olhômetro.
 *
 * Saída por lote: via (direct/erro), se o extrator achou início/fim, e as datas
 * cruas com contexto que existem na página (para ver o que o extrator perdeu).
 *
 * Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY. Opcional: DIAG_POR_FONTE (3).
 */
import { extrairDatasLeilao } from '../api/enriquecer-lote.js';

const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const POR_FONTE = parseInt(process.env.DIAG_POR_FONTE || '3', 10);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

if (!SB || !KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

const FONTES = (process.env.DIAG_FONTES || 'GRUPOLANCE,BIASI,VIP,WEBLEILOES,SUPORTE,GESTAOLEILOES').split(',');

async function sbGet(caminho) {
  const r = await fetch(`${SB}/rest/v1/${caminho}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!r.ok) throw new Error(`PostgREST ${r.status}: ${(await r.text().catch(() => '')).slice(0, 150)}`);
  return r.json();
}

// Datas cruas COM contexto — mostra o que a página diz, para comparar com o que o
// extrator devolveu. É o que separa "a página não publica data" de "publica e nós
// não lemos": dois problemas com consertos completamente diferentes.
function datasComContexto(html) {
  const texto = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const achadas = [];
  const re = /(\d{2})\/(\d{2})\/(\d{4})(?:[^0-9]{0,12}(\d{1,2})[:h](\d{2}))?/g;
  let m;
  while ((m = re.exec(texto)) && achadas.length < 8) {
    const antes = texto.slice(Math.max(0, m.index - 60), m.index).trim().slice(-55);
    achadas.push(`"${antes}" → ${m[0]}`);
  }
  return achadas;
}

async function main() {
  for (const fonte of FONTES) {
    const lotes = await sbGet(
      `imoveis_leilao?select=id,fonte,url_lote,link_edital,titulo` +
      `&ativo=eq.true&fonte=eq.${encodeURIComponent(fonte)}` +
      `&data_leilao=is.null&data_leilao_2=is.null&data_fim=is.null` +
      `&modalidade=not.ilike.*venda*direta*&limit=${POR_FONTE}`);
    console.log(`\n===== ${fonte} (${lotes.length} amostrados) =====`);
    for (const l of lotes) {
      const alvo = l.url_lote || l.link_edital;
      let html = '', via = 'direct', http = 0;
      try {
        const r = await fetch(alvo, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
        http = r.status;
        if (r.ok) html = await r.text();
        else via = `http_${r.status}`;
      } catch (e) { via = `erro_${String(e?.name || e).slice(0, 20)}`; }

      if (!html) { console.log(`  [${via}] ${alvo}`); continue; }
      const { inicio, fim, encerradaEm } = extrairDatasLeilao(html);
      const cruas = datasComContexto(html);
      console.log(`  [ok ${http} ${html.length}b] ${alvo}`);
      console.log(`     extrator: inicio=${inicio || '-'} fim=${fim || '-'} encerrada=${encerradaEm || '-'}`);
      console.log(`     na pagina: ${cruas.length ? cruas.join(' | ') : '(NENHUMA data dd/mm/aaaa no HTML — página JS ou sem data publicada)'}`);
      await new Promise(r => setTimeout(r, 800));
    }
  }
}

main().catch(e => { console.error('[diagnostico-datas] FALHOU:', e?.message || e); process.exit(1); });
