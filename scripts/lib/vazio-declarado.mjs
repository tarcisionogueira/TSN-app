// ZERO DECLARADO PELO PRÓPRIO SITE (28–29/09). "Enumerou 0" pode ser parser quebrado ou leiloeiro
// entre leilões — só o texto da página separa os dois. Quando o site AFIRMA que não há lote
// ("NENHUM LOTE ENCONTRADO NO MOMENTO"), o zero é resposta, e o motivo "site declara…" faz
// fonte_regressao_suspeita() não acusar `zerou` (fonte_regressao_zero_declarado_pelo_site.sql).
// Um regex só, usado pelo SOLEON e pelo motor genérico, para os dois nunca discordarem.
export const RE_VAZIO_DECLARADO = /nenhum\s+lote\s+encontrado|nenhum\s+im[óo]vel\s+encontrado|n[ãa]o\s+h[áa]\s+lotes?\s+dispon[íi]veis/i;

// O prefixo "site declara" é o contrato com a função SQL (ilike 'site declara%'): não mudar.
export const MOTIVO_VAZIO_DECLARADO = 'site declara "nenhum lote encontrado" — leiloeiro sem lote publicado (não é regressão)';

// Só o texto VISÍVEL conta (revisão 29/09): string de i18n em <script> ou o <template> do estado
// vazio existem mesmo com a página cheia de lote — casar com eles transformava parser quebrado em
// "site declara vazio" e calava o alarme `zerou`. E página com preço (R$ 1.234) não está vazia:
// na dúvida o alarme dispara, que é o lado seguro.
export const siteDeclaraVazio = (html) => {
  const visivel = String(html || '')
    .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return RE_VAZIO_DECLARADO.test(visivel) && !/R\$\s*\d/.test(visivel);
};
