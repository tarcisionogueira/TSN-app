-- qa_invariantes() PASSOU DE 5 s (alarme `qa_invariantes_lenta`: 7.216 ms em 01/10, 8.338 em 29/09).
-- Medido 02/10 com EXPLAIN ANALYZE no corpo da função (cada InitPlan = uma invariante):
--
-- 1. `proximidades_vazio_falso` — 3.217 ms frio. Varria os 26,7 mil ativos pelo índice de `ativo` e lia
--    o `pontos_proximos` (jsonb grande, TOAST) de cada um só para descartar 26.641. Dois índices
--    parciais deixam a pergunta respondida pelo índice (index-only): 15 ms, mesmo resultado (49).
-- 2. `area_truncada_no_milhar` — 436 ms. Compilava um regex DIFERENTE por linha (o padrão leva a área).
--    `strpos(texto, '.' || área)` é condição NECESSÁRIA do mesmo regex (ele exige `\d{1,2}\.` + os 3
--    dígitos): corta antes, regex só onde pode casar. 104 ms, mesmo resultado.
-- 3. `veiculo_cidade_fora_do_ibge` — seq scan de 13,8 mil veículos por 16 linhas: índice parcial.
--
-- Total da função, cache quente: ~7,2 s → ~3,8 s. O resto está espalhado (selo de documento ~0,8 s,
-- leilão vencido ~0,36 s, fora_do_acervo ~0,4 s — regex por linha, sem atalho barato e honesto).

create index if not exists imoveis_leilao_prox_vazio_idx
  on public.imoveis_leilao (cidade, estado) where ativo and pontos_proximos = '{}'::jsonb;
create index if not exists imoveis_leilao_prox_mapeado_idx
  on public.imoveis_leilao (cidade, estado) where ativo and pontos_proximos is not null and pontos_proximos <> '{}'::jsonb;
create index if not exists veiculos_leilao_fora_ibge_idx
  on public.veiculos_leilao (id) where ativo and local_ibge = false;

-- Patch cirúrgico no corpo vigente (a função tem ~90 invariantes; reescrevê-la inteira aqui criaria uma
-- segunda cópia para divergir). Idempotente; falha alto se o trecho mudou.
do $$
declare d text; velho text; novo text;
begin
  d := pg_get_functiondef('public.qa_invariantes'::regproc);
  if position('strpos(coalesce(titulo' in d) > 0 then return; end if;
  velho := E'where ativo and coalesce(area_m2,0) > 0 and area_m2 < 1000\n            and (coalesce(titulo,'''')';
  novo  := E'where ativo and coalesce(area_m2,0) > 0 and area_m2 < 1000\n            and strpos(coalesce(titulo,'''') || '' '' || coalesce(descricao,''''), ''.'' || to_char(floor(area_m2)::int, ''FM000'')) > 0\n            and (coalesce(titulo,'''')';
  if position(velho in d) = 0 then raise exception 'qa_invariantes: trecho de area_truncada_no_milhar nao encontrado'; end if;
  execute replace(d, velho, novo);
end $$;
