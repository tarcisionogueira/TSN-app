-- 22/10 (dono, print da busca): o MESMO imóvel aparecia 5× — "Edificação c/ 4.742,00m² - Terreno 8.850,00m² -
-- Salvador/BA", R$ 22.859.624,25, leilão 26/10 — porque no portal Leilões Judiciais (LJUD) cada leiloeiro do pool
-- publica o mesmo lote no PRÓPRIO leilão (100887…100891), com id de lote diferente. As dedups existentes exigem
-- matrícula (o LJUD não traz) ou comparam leiloeiros de FONTES diferentes.
--
-- CO-ANÚNCIO: mesma fonte, mesmo título, mesma descrição (400 primeiros caracteres), mesmo preço ao centavo, mesma
-- cidade e mesma data — E cada cópia de um leiloeiro DIFERENTE. A última trava é a que separa co-anúncio de unidades
-- distintas com anúncio padronizado (loteamento, boxes), que vêm do MESMO leiloeiro e ficam como estão.
-- Medido em 22/10: 8 grupos, 29 lotes, todos LJUD (Salvador, Feira de Santana, Fortaleza).

create or replace function public.preservar_supressao_gemeo()
 returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if old.suprimido_motivo in ('gemeo_hasta', 'gemeo_mesma_fonte', 'segunda_praca_em_outro_anuncio', 'relistado',
                              'gemeo_entre_leiloeiros', 'gemeo_ljud', 'gemeo_matricula', 'gemeo_coanuncio')
     and new.suprimido_motivo is not distinct from old.suprimido_motivo and new.ativo then
    new.ativo := false;
  end if;
  return new;
end $function$;

create or replace function public.gemeos_coanuncio_grupos()
 returns table(id uuid, fonte text, fonte_id text, ativo boolean, suprimido_motivo text, chave text, rn bigint)
 language sql stable set search_path to 'public', 'pg_temp' as $function$
  with base as materialized (
    select i.id, i.fonte, i.fonte_id, i.ativo, i.suprimido_motivo, i.criado_em, coalesce(i.leiloeiro, '') leiloeiro,
           coalesce(i.tem_edital_doc, false)::int + coalesce(i.tem_matricula_doc, false)::int docs,
           i.fonte || '|' || lower(regexp_replace(i.titulo, '\s+', ' ', 'g')) || '|'
             || md5(lower(regexp_replace(left(coalesce(i.descricao, ''), 400), '\s+', ' ', 'g'))) || '|'
             || i.valor_minimo::text || '|' || coalesce(i.cidade_norm, '') || '|' || coalesce(substring(i.data_leilao::text, 1, 10), '') chave
      from public.imoveis_leilao i
     where (i.ativo or i.suprimido_motivo = 'gemeo_coanuncio')
       and i.fonte not in ('CEF', 'caixa') and i.tipo is distinct from 'veiculo'
       and coalesce(i.valor_minimo, 0) > 0 and i.titulo is not null
  ),
  g as (
    select b.chave from base b group by b.chave
    having count(*) > 1 and count(distinct b.leiloeiro) = count(*)
  )
  select b.id, b.fonte, b.fonte_id, b.ativo, b.suprimido_motivo, b.chave,
         row_number() over (partition by b.chave order by b.docs desc, b.criado_em, b.fonte_id) rn
    from base b where b.chave in (select chave from g);
$function$;

-- SECURITY INVOKER: só o service role (cron) altera a tabela; anon/authenticated param na RLS.
create or replace function public.reconciliar_gemeos_coanuncio()
 returns jsonb language plpgsql set search_path to 'public', 'pg_temp' as $function$
declare v_sup int := 0; v_rea int := 0; v_grupos int := 0;
begin
  create temp table _gc on commit drop as select * from public.gemeos_coanuncio_grupos();
  select count(distinct chave) into v_grupos from _gc;
  update public.imoveis_leilao i set ativo = false, suprimido_motivo = 'gemeo_coanuncio'
    from _gc g where i.id = g.id and g.rn > 1 and i.ativo and i.suprimido_motivo is null;
  get diagnostics v_sup = row_count;
  update public.imoveis_leilao i set ativo = true, suprimido_motivo = null
   where i.suprimido_motivo = 'gemeo_coanuncio'
     and (i.data_leilao is null or i.data_leilao::text !~ '^\d{4}-\d{2}-\d{2}' or substring(i.data_leilao::text, 1, 10)::date >= current_date)
     and not exists (select 1 from _gc g where g.id = i.id and g.rn > 1);
  get diagnostics v_rea = row_count;
  return jsonb_build_object('grupos', v_grupos, 'suprimidos', v_sup, 'reativados', v_rea, 'em', now());
end $function$;

select public.reconciliar_gemeos_coanuncio();
