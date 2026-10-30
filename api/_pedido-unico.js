/**
 * Comando chega UMA vez (30/10, dono: "deve registrar apenas 1x o comando para não enviar vários").
 *
 * A tela (src/utils/apiCall.js) manda em todo POST/PUT/PATCH/DELETE um `x-pedido-id` sorteado por
 * chamada. Aqui ele é anotado em `pedidos_unicos` antes de a rota agir; se o MESMO id chegar de
 * novo, é repetição da rede ou do navegador — não um clique novo — e a rota responde 409 sem refazer.
 * Caso real que motivou: um clique em "Enviar" virou dois pedidos ao /api/email-caixa, 16 s de
 * diferença; o primeiro mandou o e-mail, o segundo chegou ao Resend como envio novo.
 *
 * Clique duplo e clique repetido enquanto espera são barrados ANTES, na tela (trava de clique em
 * src/utils/cliqueUnico.js e pedido idêntico em voo no apiCall). Isto aqui é a última barreira.
 *
 * FALHA ABERTA, de propósito: se a anotação não der (banco fora, tabela sumida), a rota segue e o
 * motivo vai para o log. Barrar pagamento e envio do sistema inteiro porque a trava de repetição
 * caiu seria trocar um defeito raro por um apagão — as travas da tela continuam valendo.
 * Sem cabeçalho (cron, webhook, chamada que não veio do apiCall) não há o que conferir: segue.
 */
const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

export const CORPO_REPETIDO = {
  error: 'Este comando já foi recebido e não foi executado de novo. Aguarde e confira o resultado na tela antes de tentar outra vez.',
  repetido: true,
};

function cabecalho(req, nome) {
  const h = req?.headers;
  if (!h) return '';
  return String((typeof h.get === 'function' ? h.get(nome) : h[nome]) || '');
}

function limparAntigos() {
  const limite = new Date(Date.now() - 2 * 86400000).toISOString();
  fetch(`${SB_URL}/rest/v1/pedidos_unicos?criado_em=lt.${limite}`, {
    method: 'DELETE', headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: 'return=minimal' },
  }).catch((e) => console.warn('[pedido-unico] limpeza falhou:', String(e?.message || e).slice(0, 120)));
}

/** true = este pedido JÁ chegou antes (responda 409 com CORPO_REPETIDO e não faça nada). */
export async function pedidoRepetido(req, rota) {
  const metodo = String(req?.method || '').toUpperCase();
  if (!metodo || metodo === 'GET' || metodo === 'HEAD' || metodo === 'OPTIONS') return false;
  const id = cabecalho(req, 'x-pedido-id');
  if (!/^[A-Za-z0-9-]{16,64}$/.test(id) || !SB_URL || !SB_KEY) return false;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/pedidos_unicos`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ chave: id, rota: String(rota).slice(0, 80) }),
      signal: AbortSignal.timeout(3000),
    });
    if (r.status === 409) { console.warn('[pedido-unico] repetido barrado:', rota, id.slice(0, 8)); return true; }
    if (!r.ok) console.error('[pedido-unico] anotação falhou HTTP', r.status, `em ${rota} — seguindo (falha aberta)`);
  } catch (e) {
    console.error('[pedido-unico] anotação falhou:', String(e?.message || e).slice(0, 120), `em ${rota} — seguindo (falha aberta)`);
  }
  if (Math.random() < 0.02) limparAntigos();
  return false;
}

/** Resposta pronta para rotas Edge / Web (Request → Response). */
export function respostaRepetido() {
  return new Response(JSON.stringify(CORPO_REPETIDO), { status: 409, headers: { 'Content-Type': 'application/json' } });
}
