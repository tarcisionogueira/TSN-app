-- Captura automática do e-mail do leiloeiro (11/09, pedido do dono): "ao rodar o scraper,
-- pegar o e-mail de contato do leiloeiro — isso deve ser automático". `origem` distingue o que
-- o SCRAPER capturou sozinho ('auto') do que um humano confirmou/corrigiu ('manual') — a
-- captura automática NUNCA pode sobrescrever uma correção manual (ver
-- scripts/_contato-leiloeiro.mjs: `capturarContatoSeAusente` checa isto antes de gravar).
alter table public.leiloeiro_contato
  add column if not exists origem text not null default 'manual' check (origem in ('auto', 'manual'));
