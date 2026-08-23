// Escrita SEGURA no localStorage — nunca lança e, quando a cota estoura, faz FAXINA.
//
// Por que existe (23/08): um cliente real (Firefox) apareceu em `erros_cliente` com
// QuotaExceededError em /login, / e /minha-rede. O stack apontava para o chunk do
// AuthContext: quem lançava era a GRAVAÇÃO DA SESSÃO do Supabase (o SDK usa
// localStorage.setItem sem try/catch). O storage estava cheio porque os caches de
// conveniência guardam relatórios INTEIROS (bidpro_analises_*: 12 análises × 3 chaves,
// cada uma com o `result` completo) — e aí a escrita que importa (o token de auth)
// era a que quebrava.
//
// A regra da faxina: só apagamos o que é CACHE reconstruível do servidor ou de API
// pública (análises, perfil, IBGE, Overpass). NUNCA dado que só existe no navegador
// do usuário (tsn_favoritos, tsn_imoveis_v2, tsn_progresso, tsn_mkt, bp_orig, bp_aid).
// Perder cache custa uma releitura; perder dado do usuário custa o dado.

// Ordem de sacrifício: os maiores/mais frios primeiro.
const CHAVES_DESCARTAVEIS = [
  'bidpro_analises_v1',        // relatórios mercadológicos inteiros — o maior vilão
  'bidpro_analises_doc_v1',
  'bidpro_analises_laudo_v1',
  'ibge_cidades_brasil',       // lista nacional de municípios (recarrega do IBGE)
  'tsn_perfil_cache',          // cache do perfil (recarrega do banco no próximo load)
];
const PREFIXOS_DESCARTAVEIS = [
  'ibge_cidades_',             // cache de municípios por UF
  'bidpro_overpass_v1_',       // cache de POIs por UF
];

function limparCaches(chaveEmEscrita) {
  let apagou = false;
  try {
    for (const k of CHAVES_DESCARTAVEIS) {
      if (k !== chaveEmEscrita && localStorage.getItem(k) !== null) {
        localStorage.removeItem(k); apagou = true;
      }
    }
    // Chaves por prefixo: coleta primeiro, remove depois (remover durante a iteração
    // por índice pula itens).
    const alvos = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k !== chaveEmEscrita && PREFIXOS_DESCARTAVEIS.some(p => k.startsWith(p))) alvos.push(k);
    }
    for (const k of alvos) { localStorage.removeItem(k); apagou = true; }
  } catch { /* storage bloqueado: nada a limpar */ }
  return apagou;
}

// Grava e devolve true/false — nunca lança. Na cota cheia, limpa os caches e tenta
// UMA vez mais; se nem assim couber (valor maior que a cota, storage bloqueado),
// devolve false e o chamador decide (os call-sites atuais seguem sem persistir).
export function setItemSeguro(chave, valor) {
  try { localStorage.setItem(chave, valor); return true; } catch { /* cota/bloqueado */ }
  if (!limparCaches(chave)) return false;
  try { localStorage.setItem(chave, valor); return true; } catch { return false; }
}

// ─── Storage de AUTH para o cliente Supabase ─────────────────────────────────
// O SDK grava a sessão via localStorage cru; com a cota estourada isso LANÇA no meio
// do fluxo de login/refresh (o erro que chegou em erros_cliente). Aqui a sessão:
//   1º tenta o localStorage (com faxina de caches se precisar) — persiste entre abas;
//   2º cai para memória — o login sobrevive NESTA aba mesmo com storage cheio/bloqueado.
// A memória tem precedência na leitura quando existe: ela só é preenchida quando o
// localStorage falhou na escrita, ou seja, quando o que está lá é mais velho.
const memoria = new Map();

export const storageAuthSeguro = {
  getItem(chave) {
    if (memoria.has(chave)) return memoria.get(chave);
    try { return localStorage.getItem(chave); } catch { return null; }
  },
  setItem(chave, valor) {
    if (setItemSeguro(chave, valor)) memoria.delete(chave);
    else memoria.set(chave, valor);
  },
  removeItem(chave) {
    memoria.delete(chave);
    try { localStorage.removeItem(chave); } catch { /* ok */ }
  },
};
