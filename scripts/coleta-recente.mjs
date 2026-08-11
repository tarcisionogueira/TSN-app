#!/usr/bin/env node
// FREIO DO CUSTO PAGO (decisão do dono 30/07): o cron da CI (Bright Data) é REDE DE SEGURANÇA —
// só roda se a fonte já não estiver fresca por conta do runner RESIDENCIAL (grátis).
//
// ─── A FONTE DA VERDADE MUDOU (11/08) — e o motivo é um bug real, medido ─────────────────────
// Até aqui o freio olhava `coleta_cliente.ultima_em`, o CARIMBO que o runner residencial grava
// ao terminar. Mas o `rodar()` do `runner-residencial.sh` chama `concluir` sempre que o comando
// sai com **exit 0** — e sair com 0 não é a mesma coisa que ter gravado imóvel.
//
// O RJ Leilões é 100% Cloudflare (é por isso que existe a versão paga via Bright Data). O
// scraper residencial roda, não passa, sai com 0 mesmo assim, e o gate carimba "coletei".
// Medido hoje: carimbo de 10/08, acervo de 30/07 — **10,3 dias de defasagem**. Como o
// residencial reexecuta a cada 72h, ele renovava o carimbo ANTES dos 7 dias do freio expirarem:
// o cron pago ficava bloqueado para sempre e o acervo congelava. Um deadlock — e, pior, ele
// atingia exatamente a fonte que MAIS precisa do caminho pago, porque é a que o grátis não
// consegue coletar.
//
// Agora a pergunta é a certa: **o ACERVO está fresco?** É o que o freio existe para proteger
// (não pagar quando o dado já está bom), e é imune a qualquer sucesso falso do runner. Se o
// residencial coletar de verdade, o acervo fica fresco e o freio pega — o comportamento
// desejado é preservado, sem depender de ninguém carimbar direito.
//
// Uso: coleta-recente.mjs <FONTE_DO_GATE> [dias]   → imprime `pular=1|0` no stdout.
// Em erro de rede/config: `pular=0` (fail-open — melhor pagar uma coleta do que ficar sem acervo).

// O nome no gate nem sempre é o nome no acervo: um gate pode cobrir VÁRIAS fontes (o SOLEON
// serve CALIL, VEGAS e TORRES3). Só é considerado fresco quando **todas** as fontes daquele
// gate estão frescas — senão o freio bloquearia a coleta das que ficaram para trás por causa
// das que deram certo. É o caso real do SOLEON: VEGAS coletou hoje, TORRES3 está com 7 dias.
//
// O mapa vem de `coleta_cliente.fontes_acervo` (mesma coluna que a RPC do gate usa) — era
// uma tabela hardcoded aqui, e duas cópias da mesma verdade divergem no dia em que alguém
// integra um leiloeiro novo e só atualiza uma delas. O fallback abaixo mantém o script útil
// se a leitura falhar, mas o banco manda.
const ACERVO_FALLBACK = {
  RJ: ['RJLEILOES'],
  PECINI: ['PECINI'],
  GESTAO: ['GESTAOLEILOES'],
  SOLEON: ['CALIL', 'VEGAS', 'TORRES3'],
};

const [fonte, diasArg] = process.argv.slice(2);
const dias = Number(diasArg) || 7;
const URL_BASE = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;

if (!fonte || !URL_BASE || !KEY) {
  console.error('[coleta-recente] uso: coleta-recente.mjs <FONTE> [dias] (+ env VITE_SUPABASE_URL/SUPABASE_SERVICE_KEY)');
  console.log('pular=0');
  process.exit(0);
}

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const corte = Date.now() - dias * 86400000;

async function acervosDoGate() {
  try {
    const r = await fetch(
      `${URL_BASE}/rest/v1/coleta_cliente?fonte=eq.${encodeURIComponent(fonte)}&select=fontes_acervo`,
      { headers, signal: AbortSignal.timeout(15000) },
    );
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const [linha] = await r.json();
    const lista = Array.isArray(linha?.fontes_acervo) ? linha.fontes_acervo.filter(Boolean) : [];
    if (lista.length) return lista;
  } catch (e) {
    console.error(`[coleta-recente] não li fontes_acervo (${String(e?.message || e).slice(0, 80)}) — usando fallback local`);
  }
  return ACERVO_FALLBACK[fonte] || [fonte];
}

try {
  const acervos = await acervosDoGate();
  const idades = [];
  for (const nome of acervos) {
    const r = await fetch(
      `${URL_BASE}/rest/v1/imoveis_leilao?fonte=eq.${encodeURIComponent(nome)}&ativo=eq.true`
      + '&select=atualizado_em&order=atualizado_em.desc&limit=1',
      { headers, signal: AbortSignal.timeout(15000) },
    );
    // Falha de leitura NÃO é "acervo velho" nem "acervo fresco": é desconhecido. Fail-open,
    // como o resto deste script — o pior caso é pagar uma coleta a mais, e isso é barato
    // perto de deixar o acervo congelar sem ninguém perceber.
    if (!r.ok) throw new Error(`HTTP ${r.status} lendo ${nome}`);
    const [linha] = await r.json();
    const t = linha?.atualizado_em ? Date.parse(linha.atualizado_em) : 0;
    idades.push({ nome, t, fresco: t > 0 && t > corte });
  }

  // Fresco de verdade = TODAS as fontes do gate frescas.
  const fresco = idades.length > 0 && idades.every((a) => a.fresco);
  const detalhe = idades
    .map((a) => `${a.nome}=${a.t ? new Date(a.t).toISOString().slice(0, 10) : 'nunca'}${a.fresco ? '' : ' (VELHO)'}`)
    .join(', ');
  console.error(`[coleta-recente] ${fonte}: acervo → ${detalhe} → ${fresco ? `PULAR o cron pago (tudo < ${dias} dias)` : 'RODAR via Bright Data (rede de segurança)'}`);
  console.log(`pular=${fresco ? 1 : 0}`);
} catch (e) {
  console.error('[coleta-recente] erro (fail-open):', String(e?.message || e).slice(0, 160));
  console.log('pular=0');
}
