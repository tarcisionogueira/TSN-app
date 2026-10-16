-- lote_sem_area_nem_matricula (16/10): 449 > 400 — mas o número media OUTRA coisa (forma nº 10).
-- "sem matrícula" era `link_matricula is null and anexos::text !~* 'matricula'`: ignora a matrícula
-- guardada em imovel_anexos. 104 dos 110 BIASI do total TÊM matrícula (tem_matricula_doc) — a área é
-- recuperável lendo o documento, que é justamente o que o invariante diz não existir. Mesma correção
-- da régua de inventário de 05/10: usa o SELO, que olha o arquivo de verdade.
-- O salto 402 → 449 em um dia foi o RJLEILOES voltando a coletar (39 lotes novos sem área no anúncio).
do $$
declare d text := pg_get_functiondef('public.qa_invariantes'::regproc);
declare velho text := $v$(select count(*) from imoveis_leilao where ativo and coalesce(area_m2,0)=0
          and link_matricula is null and anexos::text !~* 'matricula'), 400),$v$;
declare novo text := $v$(select count(*) from imoveis_leilao where ativo and coalesce(area_m2,0)=0
          and not coalesce(tem_matricula_doc, false)
          and link_matricula is null and anexos::text !~* 'matricula'), 400),$v$;
begin
  if position(velho in d) = 0 then raise exception 'trecho de lote_sem_area_nem_matricula não encontrado'; end if;
  execute replace(d, velho, novo);
end $$;
