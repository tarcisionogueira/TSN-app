-- 16/11 (#421) — A RETENÇÃO NÃO APAGA RELATÓRIO DE CLIENTE ASSESSORADO. limpar_analises_orfas expirava por data da praça
-- toda análise não marcada como arrematada — inclusive as de quem tem contrato de assessoria, que o dono precisa guardar
-- para prestação de contas (o retrato da oportunidade já ficava fora da retenção; os relatórios não). Medido em 16/11:
-- 6 clientes protegidos, 8 mercadológicos e 5 documentais; nenhum vencido ainda — corrigido antes do primeiro.
-- Protegido = papel assessorado/assessorado_anual OU cliente de algum caso pós-arremate (casos.cliente_id).
create or replace function public.analise_retencao_protegida(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfis where id = p_user_id and role in ('assessorado', 'assessorado_anual'))
      or exists (select 1 from casos where cliente_id = p_user_id)
$$;
revoke all on function public.analise_retencao_protegida(uuid) from public, anon, authenticated;
grant execute on function public.analise_retencao_protegida(uuid) to service_role;

CREATE OR REPLACE FUNCTION public.limpar_analises_orfas(p_dias integer DEFAULT 15, p_dias_sem_data integer DEFAULT 60)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  janela     interval := (p_dias || ' days')::interval;
  janela_sem interval := (p_dias_sem_data || ' days')::interval;
  r jsonb;
begin
  with linhas as (
    select user_id, imovel_id, data_leilao, created_at, arrematado from public.analises_mercado
    union all
    select user_id, imovel_id, data_leilao, created_at, arrematado from public.analises_documental
    union all
    select user_id, imovel_id, data_leilao, created_at, arrematado from public.analises_laudo
  ),
  agg as (
    select user_id, imovel_id,
           max(data_leilao)   as praca_analise,
           min(created_at)    as criada_em,
           bool_or(arrematado) as arrematado
      from linhas group by 1, 2
  ),
  comp as (
    select g.*,
           i.ativo as imovel_ativo,
           (select max(x) from (values
              ((nullif(i.data_leilao, ''))::timestamptz),
              (i.data_leilao_2),
              (i.data_fim::timestamptz + interval '1 day' - interval '1 second')
            ) v(x)) as praca_acervo
      from agg g
      left join public.imoveis_leilao i on i.id = (case when g.imovel_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then g.imovel_id::text::uuid end)
  ),
  alvo as (
    select user_id, imovel_id,
           greatest(coalesce(praca_acervo, '-infinity'::timestamptz),
                    coalesce(praca_analise, '-infinity'::timestamptz)) as ultima_praca,
           criada_em, imovel_ativo, arrematado
      from comp
  ),
  exp as (
    select user_id, imovel_id from alvo
     where not coalesce(arrematado, false)
       -- 16/11 (#421): relatório de cliente com assessoria (ou caso pós-arremate) é prestação de contas — não expira.
       and not public.analise_retencao_protegida(user_id)
       and criada_em < now() - janela
       and (
         (ultima_praca > '-infinity'::timestamptz and ultima_praca < now() - janela)
         or (ultima_praca = '-infinity'::timestamptz
             and criada_em < now() - janela_sem
             and coalesce(imovel_ativo, false) = false)
       )
  ),
  dm as (delete from public.analises_mercado    a using exp e where a.user_id = e.user_id and a.imovel_id = e.imovel_id returning 1),
  dd as (delete from public.analises_documental a using exp e where a.user_id = e.user_id and a.imovel_id = e.imovel_id returning 1),
  dl as (delete from public.analises_laudo      a using exp e where a.user_id = e.user_id and a.imovel_id = e.imovel_id returning 1)
  select jsonb_build_object(
           'imoveis',    (select count(*) from exp),
           'mercado',    (select count(*) from dm),
           'documental', (select count(*) from dd),
           'laudo',      (select count(*) from dl))
    into r;
  return r;
end;
$function$;

-- O invariante que vigia a retenção (analise_vencida_nao_limpa) passa a ignorar os protegidos — senão acusaria como
-- "retenção parada" justamente o que ela agora guarda de propósito.
do $mig$
declare d text := pg_get_functiondef('public.qa_invariantes'::regproc);
        velho text := $v$(select count(*) from analises_datadas
         where not coalesce(arrematado, false)
           and criada_em < now() - interval '17 days'$v$;
begin
  if position('analise_retencao_protegida' in d) > 0 then return; end if;
  if position(velho in d) = 0 then raise exception 'trecho de analise_vencida_nao_limpa não encontrado — revisar a migração'; end if;
  d := replace(d, velho, velho || $add$
           and not public.analise_retencao_protegida(user_id)$add$);
  execute d;
end $mig$;
