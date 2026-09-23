-- 22/09: 20 lotes ZUK ativos (scrapeados entre 14/09 e 18/09, ANTES do fix de 19/09 que
-- passou a prefixar o tipo no título usando `tipo` quando o `title` do card vem sem a
-- palavra) ficaram com o título quebrado " em leilão - <endereço>..." (sem "Casa"/
-- "Apartamento"/etc na frente) e não foram re-raspados desde então pra herdar o conserto.
-- `tipo` já está correto nessas linhas (usado por outro seletor, independente do título) —
-- backfill direto usando ele como fonte do rótulo que falta no título.
update public.imoveis_leilao
   set titulo = (case tipo
                   when 'casa' then 'Casa'
                   when 'apartamento' then 'Apartamento'
                   when 'terreno' then 'Terreno'
                   when 'comercial' then 'Comercial'
                   when 'rural' then 'Rural'
                   else 'Imóvel'
                 end) || titulo
 where fonte = 'ZUK' and ativo and titulo ~ '^\s*em leilão';
