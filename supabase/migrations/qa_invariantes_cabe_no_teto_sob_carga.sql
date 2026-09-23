-- 23/09 — qa_invariantes() estourou o teto de 8s do PostgREST no monitor diário (22 e 23/09,
-- ok=false): ~3,3s em repouso, 8-9s às 15h10 UTC com coleta rodando. Dois desperdícios achados
-- medindo item a item (EXPLAIN ANALYZE):
--  (1) analises_datadas juntava `i.id::text = a.imovel_id::text` — o cast derruba o índice e
--      varria as 76.796 linhas de imoveis_leilao para achar 85 análises (~0,65s). Agora casa pela
--      PK (uuid), só quando imovel_id tem forma de uuid.
--  (2) praca2_antes_da_praca1 e praca_fim_antes_do_inicio varriam a tabela INTEIRA, inativos
--      incluídos: dois seq scans à toa E um número inflado (20 no painel × 4 ativos de verdade).
--      Passam a olhar só `ativo` — o que o cliente vê.
-- Reescrita a partir de pg_get_functiondef (regra do HANDOFF: não perder vigia), com trava.
do $mig$
declare d text := pg_get_functiondef('public.qa_invariantes'::regproc);
        antes int := (select count(*) from public.qa_invariantes());
begin
  if strpos(d, 'left join public.imoveis_leilao i on i.id::text = a.imovel_id::text') = 0 then raise exception 'ancora 1 nao achada'; end if;
  d := replace(d, 'left join public.imoveis_leilao i on i.id::text = a.imovel_id::text',
    'left join public.imoveis_leilao i on i.id = (case when a.imovel_id ~* ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'' then a.imovel_id::uuid end)');
  if strpos(d, E'from imoveis_leilao\n         where data_leilao ~ ''^\\d{4}-\\d{2}-\\d{2}'' and data_leilao_2 is not null') = 0 then raise exception 'ancora 2 nao achada'; end if;
  d := replace(d, E'from imoveis_leilao\n         where data_leilao ~ ''^\\d{4}-\\d{2}-\\d{2}'' and data_leilao_2 is not null',
                  E'from imoveis_leilao\n         where ativo and data_leilao ~ ''^\\d{4}-\\d{2}-\\d{2}'' and data_leilao_2 is not null');
  if strpos(d, E'from imoveis_leilao\n         where (praca1_fim is not null') = 0 then raise exception 'ancora 3 nao achada'; end if;
  d := replace(d, E'from imoveis_leilao\n         where (praca1_fim is not null',
                  E'from imoveis_leilao\n         where ativo and ((praca1_fim is not null');
  d := replace(d, 'or (praca2_fim is not null and data_leilao_2 is not null and praca2_fim < data_leilao_2)), 0)',
                  'or (praca2_fim is not null and data_leilao_2 is not null and praca2_fim < data_leilao_2))), 0)');
  execute d;
  if (select count(*) from public.qa_invariantes()) <> antes then raise exception 'numero de vigias mudou'; end if;
end $mig$;

-- (3) anexos_agg agregava os anexos dos 77 mil lotes (doc_arquivo() por linha) para um vigia que
--     só olha lotes ATIVOS. Restringe à mesma população.
do $mig2$
declare d text := pg_get_functiondef('public.qa_invariantes'::regproc);
        antes int := (select count(*) from public.qa_invariantes());
begin
  if strpos(d, E'from public.imovel_anexos a\n     group by a.imovel_id') = 0 then raise exception 'ancora anexos_agg nao achada'; end if;
  d := replace(d, E'from public.imovel_anexos a\n     group by a.imovel_id',
                  E'from public.imovel_anexos a\n     where exists (select 1 from public.imoveis_leilao il where il.id = a.imovel_id and il.ativo)\n     group by a.imovel_id');
  execute d;
  if (select count(*) from public.qa_invariantes()) <> antes then raise exception 'numero de vigias mudou'; end if;
end $mig2$;
