/**
 * SDK OFICIAL DO MERCADO PAGO NO SERVIDOR — porta única (24/09, pedido do dono).
 *
 * A "Qualidade da integração" do MP pede o SDK de backend (ação recomendada, 5 pontos): as chamadas
 * passam a sair com os cabeçalhos de identificação do SDK (produto/rastreamento). Entra SÓ onde o MP
 * avalia — criar pagamento, link (preferência) e assinatura, e consultar pagamento/assinatura; buscas
 * e telas de admin seguem no fetch de sempre.
 *
 * Regras que NÃO mudaram com a troca (é a parte do dinheiro — o comportamento é o mesmo de antes):
 *   • a CHAVE DE IDEMPOTÊNCIA continua vindo de quem chama (determinística por cobrança) — o SDK
 *     geraria uma aleatória a cada chamada, o que derrotaria a proteção contra cobrança dupla;
 *   • `X-meli-session-id` (device ID) segue indo quando existe;
 *   • tempo limite 12 s por tentativa (o padrão do SDK é 60 s) e no máximo 1 nova tentativa, só em 429/5xx/rede —
 *     segura porque a chave de idempotência é a mesma;
 *   • erro volta como `Error` com a mesma mensagem que o fetch antigo montava (message → cause[0]
 *     .description → JSON), então nenhum chamador precisa mudar o tratamento. `status` e `causa`
 *     vêm junto para quem quiser.
 * Só roda no runtime Node (usa `crypto` e `process`) — por isso mp.js deixou o runtime edge.
 */
import { MercadoPagoConfig, Payment, Preference, PreApproval } from 'mercadopago';

const TIMEOUT_MS = 12000; // 2 tentativas × 12 s cabem nos 30 s de maxDuration das funções de pagamento

// CONFIG NOVA A CADA CHAMADA — não é descuido de performance. O SDK (3.6.1) GRAVA as opções da
// chamada na config compartilhada (`this.config.options = {...this.config.options, ...requestOptions}`
// em Payment/Preference/PreApproval). Com uma config única reaproveitada numa instância quente, o
// device ID de um cliente e a CHAVE DE IDEMPOTÊNCIA de uma cobrança vazariam para a próxima — e o MP
// devolveria o pagamento ANTERIOR em vez de criar o novo. Um objeto por chamada custa nada.
function mpCliente() {
  const token = (process.env.MP_ACCESS_TOKEN || '').trim();
  if (!token) throw new Error('MP_ACCESS_TOKEN não configurado');
  return new MercadoPagoConfig({ accessToken: token, options: { timeout: TIMEOUT_MS } });
}

function opcoes({ idempotencyKey, deviceId, escrita = false } = {}) {
  return {
    timeout: TIMEOUT_MS,
    maxRetries: 1,
    ...(escrita && idempotencyKey ? { idempotencyKey: String(idempotencyKey) } : {}), // sem cortar: a chave é a mesma de antes da troca
    ...(deviceId ? { meliSessionId: String(deviceId).slice(0, 200) } : {}),
  };
}

// Mesma mensagem que o fetch antigo produzia — os chamadores comparam/exibem esse texto.
function erroCompativel(e) {
  if (!e || typeof e !== 'object') return new Error(String(e));
  const causa = Array.isArray(e.causes) ? e.causes : (Array.isArray(e.cause) ? e.cause : []);
  const msg = e.message || causa?.[0]?.description || e.error || 'Erro MP';
  const out = new Error(msg);
  out.status = e.status || 0;
  out.causa = causa;
  out.sdk = e.name || 'MercadoPagoError';
  return out;
}

// O SDK acrescenta `api_response` à resposta; tira para não vazar para banco/logs como dado do MP.
const limpar = (r) => { if (r && typeof r === 'object') delete r.api_response; return r; };

async function chamar(fn) {
  try { return limpar(await fn()); } catch (e) { throw erroCompativel(e); }
}

export const mpSdk = {
  criarPagamento: (body, { idempotencyKey, deviceId } = {}) =>
    chamar(() => new Payment(mpCliente()).create({ body, requestOptions: opcoes({ idempotencyKey, deviceId, escrita: true }) })),
  obterPagamento: (id) =>
    chamar(() => new Payment(mpCliente()).get({ id: String(id), requestOptions: opcoes() })),
  criarPreferencia: (body, { idempotencyKey } = {}) =>
    chamar(() => new Preference(mpCliente()).create({ body, requestOptions: opcoes({ idempotencyKey, escrita: true }) })),
  criarAssinatura: (body, { idempotencyKey, deviceId } = {}) =>
    chamar(() => new PreApproval(mpCliente()).create({ body, requestOptions: opcoes({ idempotencyKey, deviceId, escrita: true }) })),
  obterAssinatura: (id) =>
    chamar(() => new PreApproval(mpCliente()).get({ id: String(id), requestOptions: opcoes() })),
};
