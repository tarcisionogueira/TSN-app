// CLI de GATE para o runner residencial — reusa o gate coleta_cliente (2x/semana + trava anti-overlap
// de 15 min + coordenação entre máquinas). Evita que o mesmo IP residencial raspe a mesma fonte em
// paralelo/duplicado (o que dispararia bloqueio anti-bot).
//
// Uso no wrapper:
//   node coleta-gate.mjs claim <FONTE>     # exit 0 = pode rodar; exit 3 = não é a hora/está travado
//   node coleta-gate.mjs concluir <FONTE>  # marca sucesso (fecha a janela de ~2x/semana)
//
// Env: VITE_SUPABASE_URL (ou SUPABASE_URL), SUPABASE_SERVICE_KEY.
const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const [, , acao, fonte] = process.argv;

if (!SB_URL || !SB_KEY) { console.error('[gate] faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(2); }
if (!acao || !fonte) { console.error('[gate] uso: coleta-gate.mjs claim|concluir <FONTE>'); process.exit(2); }

const rpc = (fn, args) => fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
  method: 'POST',
  headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(args),
});

try {
  if (acao === 'claim') {
    const r = await rpc('coleta_cliente_claim', { p_fonte: fonte });
    // "Não consegui perguntar" não é "a resposta foi não" (29/08). Um HTTP ruim caía na MESMA
    // frase de fonte fora de janela, e banco fora do ar viraria uma rodada inteira "pulando".
    if (!r.ok) {
      console.error(`[gate] ${fonte}: NÃO CONSEGUI CONSULTAR o gate (HTTP ${r.status}) — pulando por precaução, mas isto NÃO é "fora da janela".`);
      process.exit(5);
    }
    const liberado = (await r.json().catch(() => false)) === true;
    if (liberado) { console.log(`[gate] ${fonte}: liberado (é a hora)`); process.exit(0); }
    // FONTE NÃO REGISTRADA É PULADA PARA SEMPRE, e dizia a mesma coisa que fonte em janela
    // (29/08, achado no log do dono): `coleta_cliente_claim` faz `if not found then return
    // false`, então quem esqueceu de inserir a linha vê "NÃO é a hora" todo dia, no meio de
    // linhas idênticas de fontes saudáveis, e conclui que o gate está trabalhando. Foi o que
    // aconteceu com a VENDASGOV no mesmo dia em que ela entrou no runner. Uma leitura a mais,
    // só no caminho da recusa, transforma silêncio permanente em erro visível.
    const ex = await fetch(`${SB_URL}/rest/v1/coleta_cliente?fonte=eq.${encodeURIComponent(fonte)}&select=fonte,ativo`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
    const linhas = ex.ok ? await ex.json().catch(() => null) : null;
    if (Array.isArray(linhas) && linhas.length === 0) {
      console.error(`[gate] ${fonte}: NÃO EXISTE em coleta_cliente — seria pulada PARA SEMPRE. `
        + `Registre a fonte (insert em coleta_cliente com fontes_acervo) antes de esperar coleta.`);
      process.exit(6);
    }
    if (Array.isArray(linhas) && linhas.length && linhas[0].ativo === false) {
      console.log(`[gate] ${fonte}: DESATIVADA em coleta_cliente (ativo=false) — pulando de propósito.`);
      process.exit(3);
    }
    console.log(`[gate] ${fonte}: NÃO é a hora (2x/semana) ou já em curso — pulando`);
    process.exit(3);
  } else if (acao === 'concluir') {
    // O carimbo agora EXIGE PROVA no acervo (ver migração coleta_gate_concluir_exige_prova.sql):
    // a RPC devolve `carimbado:false / motivo:'sem_gravacao'` quando o scraper saiu com 0 sem
    // ter gravado nada. Antes isso era um `void` que ninguém lia — e foi assim que o RJ ficou
    // 12 dias congelado com o freio de custo bloqueando a única via que funcionava.
    const r = await rpc('coleta_cliente_concluir', { p_fonte: fonte });
    if (!r.ok) {
      console.error(`[gate] ${fonte}: RPC concluir falhou (HTTP ${r.status}) — NÃO carimbado`);
      process.exit(4);
    }
    const j = await r.json().catch(() => null);
    if (j?.carimbado === true) {
      console.log(`[gate] ${fonte}: concluído (${j.linhas} linha(s) no acervo · janela fechada)`);
      process.exit(0);
    }
    console.error(`[gate] ${fonte}: NÃO carimbado — ${j?.motivo || 'resposta inesperada'}. `
      + 'O scraper terminou sem gravar no acervo; a janela segue aberta para nova tentativa.');
    process.exit(4);
  }
  console.error(`[gate] ação desconhecida: ${acao}`);
  process.exit(2);
} catch (e) {
  console.error('[gate] erro:', e?.message || e);
  process.exit(2);
}
