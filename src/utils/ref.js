// INDICAÇÃO DO PARCEIRO (?ref=) — armazenamento com JANELA de atribuição.
//
// Antes o código do parceiro ficava em sessionStorage: morria ao fechar a aba e "quebrava" se a
// pessoa demorasse para assinar (voltava horas/dias depois já sem vínculo). Resultado: dezenas de
// indicados ficaram sem parceiro (indicado_por NULL). Agora persiste em localStorage com timestamp
// e expira numa janela SAUDÁVEL — igual à lógica de afiliado da Livelo/Amazon: o lead pode navegar,
// sair e voltar dentro do prazo que a venda continua atribuída a quem indicou.
//
// LAST-TOUCH: cada captura renova o prazo; se a pessoa abrir o link de OUTRO parceiro, o mais
// recente vence (padrão de mercado — crédito para quem trouxe o lead por último).
//
// A JANELA de 30 dias cobre a venda consultiva de leilão (decisão leva dias). Ajuste aqui se quiser.
const KEY = 'tsn_ref_codigo';
export const JANELA_DIAS = 30;
const JANELA_MS = JANELA_DIAS * 24 * 60 * 60 * 1000;

// Salva a indicação (com carimbo de tempo). Renova o prazo a cada clique no link.
export function salvarRef(code) {
  if (!code) return;
  try { localStorage.setItem(KEY, JSON.stringify({ code: String(code), ts: Date.now() })); } catch { /* ignore */ }
}

// Lê a indicação vigente (dentro da janela). Retorna '' se ausente/expirada.
// Compat: aceita o valor ANTIGO (string simples em localStorage/sessionStorage) sem timestamp.
export function lerRef() {
  try {
    const raw = localStorage.getItem(KEY) || sessionStorage.getItem(KEY);
    if (!raw) return '';
    let code, ts;
    try { const o = JSON.parse(raw); code = o?.code; ts = o?.ts; } catch { code = raw; ts = null; }
    if (!code) return '';
    // Só expira quando HÁ timestamp; valor legado sem ts é aceito (melhor atribuir do que perder).
    if (ts && (Date.now() - Number(ts)) > JANELA_MS) { limparRef(); return ''; }
    return String(code);
  } catch { return ''; }
}

// Remove a indicação (após consumir no cadastro, ou quando expira).
export function limparRef() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}
