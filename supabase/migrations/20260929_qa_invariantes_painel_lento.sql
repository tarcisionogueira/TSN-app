-- ─────────────────────────────────────────────────────────────────────────────────────────
-- PAINEL DE INVARIANTES LENTO — 29/09/2026
-- `qa_invariante_caso_sem_analise_iniciada` levava 8,1 s dos 10,6 s de qa_invariantes() (acusando
-- `qa_invariantes_lenta` > 5 s): o join `i.id::text = c.imovel_id` converte a CHAVE do imóvel,
-- o índice da PK não serve, e cada caso varria imoveis_leilao inteira. Agora converte o lado do
-- caso (com guarda de formato: texto que não é UUID vira NULL, como o join antigo já tratava).
-- Conferido em seco: mesmo resultado (0 = 0), 2.310 ms → 2 ms.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.qa_invariante_caso_sem_analise_iniciada()
 returns bigint
 language sql
 stable
 set search_path to 'public'
as $function$
  select count(*)::bigint
    from public.casos c
    left join public.perfis p on p.id = c.cliente_id
    left join public.imoveis_leilao i
      on i.id = case when c.imovel_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                     then c.imovel_id::uuid end
   where c.status_etapa = 'analise_solicitada'
     and c.created_at < now() - interval '7 days'
     and coalesce(p.role, '') <> 'admin'
     and not exists (select 1 from public.analise_jobs j where j.caso_id = c.id)
     and not (
       coalesce(i.modalidade, '') !~* 'venda[_ -]?direta'
       and greatest(
             coalesce(nullif(left(coalesce(i.data_leilao,''),10),'')::date, '-infinity'::date),
             coalesce(i.data_leilao_2::date, '-infinity'::date),
             coalesce(i.data_fim::date,      '-infinity'::date),
             coalesce(i.praca1_fim::date,    '-infinity'::date),
             coalesce(i.praca2_fim::date,    '-infinity'::date)
           ) > '-infinity'::date
       and greatest(
             coalesce(nullif(left(coalesce(i.data_leilao,''),10),'')::date, '-infinity'::date),
             coalesce(i.data_leilao_2::date, '-infinity'::date),
             coalesce(i.data_fim::date,      '-infinity'::date),
             coalesce(i.praca1_fim::date,    '-infinity'::date),
             coalesce(i.praca2_fim::date,    '-infinity'::date)
           ) + interval '1 day' < now() at time zone 'America/Sao_Paulo'
     );
$function$;

-- `qa_invariante_praca_fim_sem_produtor` (2,0 s) contava imoveis_leilao INTEIRA só para saber se
-- havia mais de 1 linha com fim de praça. Parar na 2ª dá o mesmo veredito (<= 1) por construção.
create or replace function public.qa_invariante_praca_fim_sem_produtor()
 returns bigint
 language sql
 stable
 set search_path to 'public'
as $function$
  select case when (
    select count(*) from (select 1 from public.imoveis_leilao
     where praca1_fim is not null or praca2_fim is not null limit 2) x
  ) <= 1 then 1 else 0 end::bigint;
$function$;
