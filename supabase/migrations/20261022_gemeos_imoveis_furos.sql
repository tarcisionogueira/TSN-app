-- 22/10 (dono: "verifique se o mesmo [repetição] acontece com imóveis"). Dois furos na dedup que já existia:
--
-- (1) VLANCE × LJUD: 69 lotes VLANCE ATIVOS com suprimido_motivo = 'gemeo_ljud'. O coletor da VLANCE regrava
--     ativo = true a cada rodada; o gatilho preservar_supressao_gemeo não conhecia 'gemeo_ljud', e o
--     reconciliador só suprime quem tem motivo NULO — então o gêmeo voltava à vitrine e nunca mais saía.
--
-- (2) MESMA MATRÍCULA EM LEILOEIROS DIFERENTES: reconciliar_gemeos_entre_leiloeiros agrupa por cidade+preço+
--     área e DESCARTA o grupo inteiro quando há conflito de matrícula — CALIL × LEILOFY tinham 4 lotes vizinhos
--     de 1.000 m² ao mesmo preço (matrículas 21570/21598/21607/21608), e o conflito entre os vizinhos escondia
--     os 4 pares. Aqui a chave é a própria matrícula (estado + cidade + nº), com as mesmas travas: preço
--     compatível (até 2,05×, praça), área compatível (5%) e no máximo um nº de processo. Medido: 19 grupos.

create or replace function public.preservar_supressao_gemeo()
 returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if old.suprimido_motivo in ('gemeo_hasta', 'gemeo_mesma_fonte', 'segunda_praca_em_outro_anuncio', 'relistado',
                              'gemeo_entre_leiloeiros', 'gemeo_ljud', 'gemeo_matricula')
     and new.suprimido_motivo is not distinct from old.suprimido_motivo and new.ativo then
    new.ativo := false;
  end if;
  return new;
end $function$;

create or replace function public.reconciliar_gemeos_vlance_ljud()
 returns jsonb language sql security definer set search_path to 'public', 'pg_temp' as $function$
  with ljud as materialized (
    select substring(fonte_id from '^ljud_(\d+)$') as lote
      from public.imoveis_leilao where fonte = 'LJUD' and ativo
  ),
  sup as (
    update public.imoveis_leilao v
       set ativo = false, suprimido_motivo = 'gemeo_ljud'
     where v.fonte = 'VLANCE' and v.ativo and (v.suprimido_motivo is null or v.suprimido_motivo = 'gemeo_ljud')
       and substring(v.fonte_id from '_(\d+)$') in (select lote from ljud where lote is not null)
    returning 1
  ),
  rea as (
    update public.imoveis_leilao v
       set ativo = true, suprimido_motivo = null
     where v.fonte = 'VLANCE' and v.suprimido_motivo = 'gemeo_ljud' and not v.ativo
       and substring(v.fonte_id from '_(\d+)$') not in (select lote from ljud where lote is not null)
       and (v.data_leilao is null or v.data_leilao !~ '^\d{4}-\d{2}-\d{2}'
            or substring(v.data_leilao, 1, 10)::date >= current_date)
    returning 1
  )
  select jsonb_build_object('suprimidos', (select count(*) from sup), 'reativados', (select count(*) from rea), 'em', now());
$function$;

create or replace function public.gemeos_matricula_grupos()
 returns table(id uuid, fonte text, fonte_id text, ativo boolean, suprimido_motivo text, chave text, rn bigint)
 language sql stable set search_path to 'public', 'pg_temp' as $function$
  with base as materialized (
    select i.id, i.fonte, i.fonte_id, i.ativo, i.suprimido_motivo, i.data_fim, i.criado_em, i.valor_minimo::numeric vm,
           nullif(i.area_m2, 0)::numeric area,
           nullif(regexp_replace(coalesce(i.numero_processo, ''), '\D', '', 'g'), '') proc,
           (i.data_fim is null or i.data_fim >= (now() at time zone 'America/Sao_Paulo')::date) vivo,
           coalesce(i.tem_edital_doc, false)::int + coalesce(i.tem_matricula_doc, false)::int docs,
           i.estado || '|' || i.cidade_norm || '|' || ltrim(regexp_replace(i.numero_matricula, '\D', '', 'g'), '0') chave
      from public.imoveis_leilao i
     where (i.ativo or i.suprimido_motivo = 'gemeo_matricula')
       and i.fonte not in ('CEF', 'caixa', 'HASTA', 'EDITAL_DJEN') and i.tipo is distinct from 'veiculo'
       and i.cidade_norm is not null and i.estado is not null and coalesce(i.valor_minimo, 0) > 1000
       and length(ltrim(regexp_replace(coalesce(i.numero_matricula, ''), '\D', '', 'g'), '0')) >= 3
       -- matrícula que é DATA ou ANO não identifica o bem (mesmo filtro de gemeos_mesma_fonte_grupos)
       and regexp_replace(i.numero_matricula, '\D', '', 'g') !~ '^(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])(19|20)\d\d$'
       and regexp_replace(i.numero_matricula, '\D', '', 'g') !~ '^(19|20)\d\d$'
  ),
  g as (
    select b.chave from base b group by b.chave
    having count(distinct b.fonte) > 1 and max(b.vm) <= min(b.vm) * 2.05
       and coalesce(max(b.area) <= min(b.area) * 1.05, true)
       and count(distinct b.proc) <= 1
  )
  select b.id, b.fonte, b.fonte_id, b.ativo, b.suprimido_motivo, b.chave,
         row_number() over (partition by b.chave order by b.vivo desc, b.data_fim nulls last, b.docs desc, b.criado_em, b.id) rn
    from base b where b.chave in (select chave from g);
$function$;

create or replace function public.reconciliar_gemeos_matricula()
 returns jsonb language plpgsql set search_path to 'public', 'pg_temp' as $function$
declare v_sup int := 0; v_rea int := 0; v_grupos int := 0;
begin
  create temp table _gm on commit drop as select * from public.gemeos_matricula_grupos();
  select count(distinct chave) into v_grupos from _gm;
  update public.imoveis_leilao i set ativo = false, suprimido_motivo = 'gemeo_matricula'
    from _gm g where i.id = g.id and g.rn > 1 and i.ativo and i.suprimido_motivo is null;
  get diagnostics v_sup = row_count;
  update public.imoveis_leilao i set ativo = true, suprimido_motivo = null
   where i.suprimido_motivo = 'gemeo_matricula'
     and (i.data_fim is null or i.data_fim >= (now() at time zone 'America/Sao_Paulo')::date)
     and not exists (select 1 from _gm g where g.id = i.id and g.rn > 1);
  get diagnostics v_rea = row_count;
  return jsonb_build_object('grupos', v_grupos, 'suprimidos', v_sup, 'reativados', v_rea, 'em', now());
end $function$;

-- aplica já (a ordem importa: VLANCE×LJUD primeiro, para o gêmeo VLANCE não disputar o grupo por matrícula)
select public.reconciliar_gemeos_vlance_ljud();
select public.reconciliar_gemeos_matricula();
