// ZERO DECLARADO PELO PRÓPRIO SITE (28–29/09). "Enumerou 0" pode ser parser quebrado ou leiloeiro
// entre leilões — só o texto da página separa os dois. Quando o site AFIRMA que não há lote
// ("NENHUM LOTE ENCONTRADO NO MOMENTO"), o zero é resposta, e o motivo "site declara…" faz
// fonte_regressao_suspeita() não acusar `zerou` (fonte_regressao_zero_declarado_pelo_site.sql).
// Um regex só, usado pelo SOLEON e pelo motor genérico, para os dois nunca discordarem.
export const RE_VAZIO_DECLARADO = /nenhum\s+lote\s+encontrado|nenhum\s+im[óo]vel\s+encontrado|n[ãa]o\s+h[áa]\s+lotes?\s+dispon[íi]veis/i;

// O prefixo "site declara" é o contrato com a função SQL (ilike 'site declara%'): não mudar.
export const MOTIVO_VAZIO_DECLARADO = 'site declara "nenhum lote encontrado" — leiloeiro sem lote publicado (não é regressão)';

export const siteDeclaraVazio = (html) => RE_VAZIO_DECLARADO.test(String(html || '').replace(/<[^>]+>/g, ' '));
