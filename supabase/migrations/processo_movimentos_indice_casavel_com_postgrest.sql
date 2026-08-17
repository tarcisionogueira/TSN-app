-- ─────────────────────────────────────────────────────────────────────────────────────────
-- cnj-monitor: o índice existia, e mesmo assim o ON CONFLICT não achava — 17/08/2026
--
-- Erro em produção, 5 execuções entre 16 e 17/08:
--   [cnj-monitor] série NÃO gravada 00001448420228260104 400 {"code":"42P10",
--   "message":"there is no unique or exclusion constraint matching the ON CONFLICT specification"}
--
-- O índice ESTAVA lá, e correto na intenção:
--   processo_movimentos_unico ON (numero_processo, data, COALESCE(codigo,-1), COALESCE(descricao,''))
--
-- Mas ele é um índice de EXPRESSÃO, e `api/cnj-monitor-cron.js:43` pede
--   ?on_conflict=numero_processo,data,codigo,descricao
-- que é uma lista de COLUNAS. O Postgres não casa lista de colunas com índice construído sobre
-- expressões — nem tenta. Então o upsert falha por inteiro e nenhuma movimentação é gravada.
--
-- O detalhe que fazia isso passar despercebido: o `COALESCE` não estava lá por capricho. Sem
-- ele, `codigo`/`descricao` nulos não deduplicariam, porque em índice único NULL nunca é igual
-- a NULL — a mesma movimentação entraria repetida a cada varredura. A escolha era certa; o que
-- faltou foi perceber que ela tornava o índice inalcançável pelo PostgREST.
--
-- O Postgres 15+ resolve exatamente este caso com `NULLS NOT DISTINCT`: o índice volta a ser
-- de COLUNAS SIMPLES (casável pelo on_conflict) e ainda assim trata NULL = NULL na
-- deduplicação. Este banco roda 17.6, então é só usar.
--
-- Ganho lateral: some a aresta do COALESCE, em que um `codigo` REAL de valor -1 colidiria com
-- um `codigo` nulo, porque os dois viravam -1 no índice.
--
-- LIÇÃO: "o índice existe" não é a mesma pergunta que "o ON CONFLICT alcança este índice".
-- Vale para toda tabela que o PostgREST escreve com resolution=ignore-duplicates/merge-duplicates.
-- ─────────────────────────────────────────────────────────────────────────────────────────

create unique index if not exists processo_movimentos_unico_cols
  on public.processo_movimentos (numero_processo, data, codigo, descricao)
  nulls not distinct;

drop index if exists public.processo_movimentos_unico;

comment on index public.processo_movimentos_unico_cols is
  'Único por (numero_processo, data, codigo, descricao) com NULLS NOT DISTINCT. Precisa ser de COLUNAS SIMPLES: api/cnj-monitor-cron.js faz upsert via PostgREST com ?on_conflict=<colunas>, que NÃO casa com índice de expressão (era o erro 42P10 de 16-17/08). Ao alterar, mantenha a lista igual à do on_conflict no código.';
