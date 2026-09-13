#!/usr/bin/env node
/**
 * RECON EM LOTE — sinal de "vende veículo?" para as fontes que `capturarContatoSeAusente`
 * (scripts/_contato-leiloeiro.mjs) ainda não checou (13/09).
 *
 * Aquela função já roda em produção, mas só dispara dentro de `salvarEFinalizar` do
 * scraper-puppeteer.mjs — ou seja, só para fontes que (a) usam o motor genérico e (b)
 * salvaram pelo menos 1 item na rodada. Ficam de fora: as fontes com scraper PRÓPRIO
 * (scraper-soleon.mjs, scraper-gestao.mjs, scraper-pecini.mjs, hasta-parse.mjs,
 * nordeste-parse.mjs, leilaoindex-parse.mjs, scraper_vlance.py) e as que não coletaram
 * nada na janela recente (as bloqueadas por IP, ex.: FERREIRALEIL/GESTAOLEILOES/PECINI).
 *
 * Em vez de escrever uma detecção nova (risco de medir outra coisa — CLAUDE.md, forma
 * nº 10), reaproveita `detectarSegmentoVeiculos` e grava na MESMA tabela, pelo MESMO
 * contrato (`onConflict: fonte`) que a função de produção usa.
 *
 * Uso: node scripts/recon-segmento-veiculos-lote.mjs
 * Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY. Opcional: RECON_FONTES (csv "FONTE=origin").
 */
import { detectarSegmentoVeiculos } from './_contato-leiloeiro.mjs';

const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB || !KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

async function sbGet(caminho) {
  const r = await fetch(`${SB}/rest/v1/${caminho}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!r.ok) throw new Error(`PostgREST ${r.status}: ${(await r.text().catch(() => '')).slice(0, 150)}`);
  return r.json();
}

async function sbUpsert(tabela, linha) {
  const r = await fetch(`${SB}/rest/v1/${tabela}?on_conflict=fonte`, {
    method: 'POST',
    headers: {
      apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(linha),
  });
  if (!r.ok) throw new Error(`upsert ${tabela} falhou: HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 150)}`);
}

// Descobre a origem (protocolo+domínio) de cada fonte ainda não checada a partir de
// qualquer url_lote real já coletado — mesma técnica de `capturarContatoSeAusente`.
//
// UMA CONSULTA SÓ, com LIMIT global, não serve aqui: fontes gigantes (CEF sozinha tem
// ~19 mil url_lote) ocupam o limite inteiro antes da ordenação alfabética chegar às
// fontes de nome posterior — 1ª versão (13/09) devolveu só 6 de ~49 candidatas por
// isso (parou em "BIASI"), sem erro nenhum, com cara de "poucas fontes restam" (a
// forma nº 10 do CLAUDE.md: o número saiu plausível e media outra coisa). Corrigido
// consultando fonte por fonte, cada uma com seu próprio LIMIT 1 — não depende de
// quantas linhas as fontes anteriores (alfabeticamente) têm.
async function candidatos() {
  if (process.env.RECON_FONTES) {
    return process.env.RECON_FONTES.split(',').map(par => {
      const [fonte, origin] = par.split('=');
      return { fonte, origin };
    });
  }
  const jaChecadas = new Set((await sbGet('leiloeiro_segmento_veiculos?select=fonte')).map(r => r.fonte));
  // Lista canônica de fontes conhecidas — não `imoveis_leilao` direto: um `select=fonte`
  // sem filtro ali também tropeça no default LIMIT do PostgREST (1000), e CEF sozinha
  // (~19 mil linhas) pode preencher a página inteira antes de outra fonte aparecer.
  const todasFontes = [...new Set((await sbGet('leiloeiro_conhecimento?select=fonte&suspenso=eq.false')).map(r => r.fonte))];
  const faltantes = todasFontes.filter((f) => !jaChecadas.has(f));
  const out = [];
  for (const fonte of faltantes) {
    const [row] = await sbGet(
      `imoveis_leilao?select=url_lote&fonte=eq.${encodeURIComponent(fonte)}&url_lote=not.is.null&limit=1`
    );
    const url = row?.url_lote;
    if (!/^https?:\/\//i.test(url || '')) continue;
    try { out.push({ fonte, origin: new URL(url).origin }); } catch { /* padrao-ok: url_lote malformado, fonte fica sem candidato */ }
  }
  return out;
}

async function main() {
  const alvos = await candidatos();
  console.log(`Checando sinal de veículos em ${alvos.length} fonte(s) ainda não verificadas.\n`);
  let comSinal = 0, semSinal = 0, falharam = 0;
  for (const { fonte, origin } of alvos) {
    try {
      const res = await fetch(origin, {
        signal: AbortSignal.timeout(10_000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BidProBrasilBot/1.0)' },
      });
      if (!res.ok) { console.log(`  [${fonte}] HTTP ${res.status} em ${origin} — pulado`); falharam++; continue; }
      const html = await res.text();
      const segmento = detectarSegmentoVeiculos(html);
      await sbUpsert('leiloeiro_segmento_veiculos', {
        fonte, tem_sinal: !!segmento,
        url_segmento: segmento ? new URL(segmento.url, origin).href : null,
        texto_sinal: segmento?.texto || null,
        atualizado_em: new Date().toISOString(),
      });
      if (segmento) { console.log(`  🚗 [${fonte}] SINAL: "${segmento.texto}" → ${segmento.url}`); comSinal++; }
      else { console.log(`  — [${fonte}] sem sinal de veículo na home (${origin})`); semSinal++; }
    } catch (e) {
      console.log(`  [${fonte}] erro: ${String(e?.message || e).slice(0, 120)}`);
      falharam++;
    }
  }
  console.log(`\n✅ Concluído: ${comSinal} com sinal, ${semSinal} sem sinal, ${falharam} falharam/pularam (de ${alvos.length}).`);
}

main().catch((e) => { console.error('Recon falhou:', e?.message || e); process.exit(1); });
