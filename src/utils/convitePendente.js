// CONVITE PENDENTE (equipe e cliente) — armazenamento com JANELA, igual ao `?ref=`.
//
// Por que existe (07/08): os dois tokens de convite viviam em `sessionStorage`, que NÃO
// sobrevive ao link de confirmação de e-mail — ele abre numa ABA NOVA (ou em outro
// aparelho, quando a pessoa lê o e-mail no celular). O resgate roda no `SIGNED_IN` do
// AuthContext, que nessa aba encontrava `null`: `usar_convite_equipe` nunca era chamado, o
// convidado entrava como EXPLORADOR e nada na tela explicava o porquê. Pior, o convite
// continuava `ativo`/`usado_em is null` no painel, então nem rastro sobrava para o admin.
//
// Esta é exatamente a lição que `src/utils/ref.js` já documenta ("dezenas de indicados
// ficaram sem parceiro") e que nunca foi propagada para os convites. Mesmo remédio:
// localStorage + carimbo de tempo + janela de validade.
//
// JANELA de 30 dias: acompanha `convites_equipe.expira_em` (validade obrigatória) com folga.
// O uso único e a expiração REAIS continuam sendo garantidos no RPC — aqui é só o
// transporte entre a aba do cadastro e a aba do e-mail.
export const JANELA_DIAS = 30;
const JANELA_MS = JANELA_DIAS * 24 * 60 * 60 * 1000;

export const CHAVE_EQUIPE = 'tsn_convite_equipe';
export const CHAVE_CLIENTE = 'tsn_convite_codigo';
// PLANO ESCOLHIDO antes do cadastro (item 7 de docs/BUGS_ABERTOS_2026-08-07.md). Mesma
// doença dos convites: a tela promete "após o login você será direcionado para o pagamento",
// mas o link de confirmação abre em OUTRA aba/aparelho e o sessionStorage vem vazio — a
// pessoa cai na home como explorador e a intenção de compra evapora no caminho mais comum
// do funil. Guardado aqui pela mesma janela.
export const CHAVE_PLANO = 'tsn_plano_pendente';

// Guarda o token com carimbo de tempo. NÃO normaliza a caixa: o token de equipe é um
// `crypto.randomUUID()` (minúsculo) e o RPC compara com igualdade sensível a caixa
// (`c.token = p_token`) — qualquer conversão aqui inviabiliza o resgate.
export function salvarConvite(chave, token) {
  if (!chave || !token) return;
  try { localStorage.setItem(chave, JSON.stringify({ token: String(token), ts: Date.now() })); } catch { /* ignore */ }
}

// Lê o token vigente (dentro da janela). Retorna '' se ausente/expirado.
// Compat: aceita o valor ANTIGO (string simples, em localStorage OU sessionStorage) — quem
// estava no meio de um cadastro quando isto subiu não pode perder o convite.
export function lerConvite(chave) {
  if (!chave) return '';
  try {
    const raw = localStorage.getItem(chave) || sessionStorage.getItem(chave);
    if (!raw) return '';
    let token, ts;
    try { const o = JSON.parse(raw); token = o?.token; ts = o?.ts; } catch { token = raw; ts = null; }
    if (!token) return '';
    // Só expira quando HÁ timestamp; valor legado sem ts é aceito (melhor resgatar do que perder).
    if (ts && (Date.now() - Number(ts)) > JANELA_MS) { limparConvite(chave); return ''; }
    return String(token);
  } catch { return ''; }
}

// Remove o token — após resgate com desfecho, ou quando expira.
export function limparConvite(chave) {
  if (!chave) return;
  try { localStorage.removeItem(chave); } catch { /* ignore */ }
  try { sessionStorage.removeItem(chave); } catch { /* ignore */ }
}
