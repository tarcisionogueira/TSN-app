#!/usr/bin/env node
// FREIO DO CUSTO PAGO (decisão do dono 30/07): o cron da CI (Bright Data) vira REDE DE
// SEGURANÇA — só roda se o runner RESIDENCIAL (grátis) não coletar a fonte há N dias.
// Imprime `pular=1|0` no stdout (consumido via $GITHUB_OUTPUT no workflow); detalhes vão
// para o stderr. Em erro de rede/config, imprime pular=0 (fail-open: melhor pagar uma
// coleta do que ficar sem acervo).
//
// ─── POR QUE NÃO BASTA `coleta_cliente.ultima_em` (11/08) ─────────────────────────────────
// Até hoje este freio lia só o carimbo `ultima_em`. Mas o runner residencial chama
// `coleta_cliente_concluir` ao TERMINAR, tenha gravado 50 lotes ou zero — o carimbo prova
// que a janela fechou, não que a coleta funcionou. RJ Leilões está 100% atrás de Cloudflare
// (é POR ISSO que existe o caminho pago): a via residencial tentava, era barrada, gravava
// zero e carimbava; o freio lia o carimbo e desligava justamente a rede de segurança feita
// para esse caso. Resultado medido hoje: acervo RJLEILOES congelado em 5 lotes desde 30/07,
// 12 dias, com o cron pago pulando toda terça e nenhum alerta em lugar nenhum.
//
// Agora o freio confere o ACERVO: só pula se a coleta residencial estiver fresca E tiver de
// fato ESCRITO em alguma das fontes que ela alimenta (`coleta_cliente.fontes_acervo` — os
// nomes não batem: gate 'RJ' → acervo 'RJLEILOES', gate 'SOLEON' → 3 tenants). Sem prova de
// gravação, roda o pago. Fail-open segue valendo em toda dúvida.
const [fonte, diasArg] = process.argv.slice(2);
const dias = Number(diasArg) || 7;
const URL_BASE = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!fonte || !URL_BASE || !KEY) {
  console.error('[coleta-recente] uso: coleta-recente.mjs <FONTE> [dias] (+ env VITE_SUPABASE_URL/SUPABASE_SERVICE_KEY)');
  console.log('pular=0');
  process.exit(0);
}

const HDR = { apikey: KEY, Authorization: `Bearer ${KEY}` };
// `.ok` checado de propósito: sem isso um 4xx/5xx vira `[]` → "nunca coletou" → pular=0.
// Fail-open dá o resultado certo por acaso, mas silencia a falha; melhor dizê-la.
async function pega(path) {
  const r = await fetch(`${URL_BASE}/rest/v1/${path}`, { headers: HDR, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`supabase ${r.status} em ${path.split('?')[0]}`);
  return r.json();
}

try {
  const [row] = await pega(`coleta_cliente?fonte=eq.${encodeURIComponent(fonte)}&select=ultima_em,fontes_acervo&limit=1`);
  const t = row?.ultima_em ? Date.parse(row.ultima_em) : 0;
  const janelaMs = dias * 86400000;
  const carimboFresco = t > 0 && Date.now() - t < janelaMs;

  if (!carimboFresco) {
    console.error(`[coleta-recente] ${fonte}: última coleta residencial = ${row?.ultima_em || 'nunca'} → RODAR via Bright Data (rede de segurança)`);
    console.log('pular=0');
    process.exit(0);
  }

  // Carimbo fresco: agora exige a PROVA. Sem mapa de fontes não dá para provar nada —
  // fail-open (roda o pago) e diz o que falta, para o mapa ser preenchido.
  const alvos = Array.isArray(row?.fontes_acervo) ? row.fontes_acervo.filter(Boolean) : [];
  if (!alvos.length) {
    console.error(`[coleta-recente] ${fonte}: carimbo fresco (${row.ultima_em}) mas coleta_cliente.fontes_acervo está vazio — sem como conferir se GRAVOU. RODAR (fail-open). Preencha fontes_acervo p/ este gate.`);
    console.log('pular=0');
    process.exit(0);
  }

  const desde = new Date(Date.now() - janelaMs).toISOString();
  const lista = alvos.map(f => `"${f}"`).join(',');
  const escritos = await pega(
    `imoveis_leilao?select=fonte&fonte=in.(${encodeURIComponent(lista)})&atualizado_em=gte.${encodeURIComponent(desde)}&limit=1`,
  );
  const gravou = Array.isArray(escritos) && escritos.length > 0;

  if (gravou) {
    console.error(`[coleta-recente] ${fonte}: coleta residencial em ${row.ultima_em} GRAVOU em ${alvos.join('/')} → PULAR o cron pago (< ${dias} dias)`);
    console.log('pular=1');
  } else {
    console.error(`[coleta-recente] ${fonte}: carimbo fresco (${row.ultima_em}) mas NENHUM lote de ${alvos.join('/')} foi escrito em ${dias}d — a coleta residencial fechou a janela sem gravar. RODAR via Bright Data.`);
    console.log('pular=0');
  }
} catch (e) {
  console.error('[coleta-recente] erro (fail-open):', String(e?.message || e).slice(0, 120));
  console.log('pular=0');
}
