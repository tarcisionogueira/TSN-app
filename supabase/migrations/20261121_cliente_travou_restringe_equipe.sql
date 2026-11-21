-- cliente_travou devolvia nome/user_id/motivo de clientes para QUALQUER usuario logado
-- (authenticated tinha EXECUTE e o corpo nao checava papel). Achado na inspecao de 21/11.
-- Agora: so admin/equipe ou chamada de servidor (service_role, sem auth.uid()).
-- O GRANT a authenticated continua de proposito: o painel do admin (admin_precisa_de_voce)
-- chama com o JWT do proprio admin. Corpo da consulta inalterado.
-- Aplicada em producao em 21/11 via apply_migration (cliente_travou_restringe_equipe).
CREATE OR REPLACE FUNCTION public.cliente_travou(p_dias integer DEFAULT 7)
 RETURNS TABLE(motivo text, gravidade text, user_id uuid, nome text, role text, tentativas bigint, primeiro timestamp with time zone, ultimo timestamp with time zone, detalhe text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  if auth.uid() is not null and not (public.is_admin() or public.is_equipe()) then
    raise exception 'acesso restrito a equipe' using errcode = '42501';
  end if;

  return query
  with janela as (
    select greatest(now() - make_interval(days => greatest(1, p_dias)), timestamptz '2026-08-29') as de,
           timestamptz '2026-08-29' as nasce_gerar,
           timestamptz '2026-09-10' as nasce_sessao
  ),
  recusado as (
    select e.user_id, count(*) qtd, min(e.criado_em) de, max(e.criado_em) ate,
           string_agg(distinct substring(e.detalhe from 'recusado: (.*)$'), '; ') motivos
      from eventos_atividade e, janela j
     where e.criado_em >= j.de and e.tipo = 'analise_gerar'
       and e.detalhe like 'recusado:%'
       and e.detalhe not like '%cota%' and e.detalhe not like '%plano%'
       and e.user_id is not null
     group by 1
  ),
  sumiu as (
    select e.user_id, count(*) qtd, min(e.criado_em) de, max(e.criado_em) ate
      from eventos_atividade e, janela j
     where e.criado_em >= j.de and e.criado_em < now() - interval '30 minutes'
       and e.tipo = 'analise_gerar' and e.detalhe like 'iniciou%' and e.user_id is not null
       and not exists (
         select 1 from eventos_atividade f
          where f.user_id = e.user_id and f.tipo = 'analise_gerar'
            and (f.detalhe like 'concluiu%' or f.detalhe like 'falhou%' or f.detalhe like 'represado%')
            and f.criado_em between e.criado_em and e.criado_em + interval '30 minutes')
       and not exists (
         select 1 from analises_mercado a
          where a.user_id = e.user_id
            and a.created_at between e.criado_em - interval '2 minutes' and e.criado_em + interval '30 minutes')
     group by 1
  ),
  sessao as (
    select e.user_id, count(distinct e.criado_em) qtd, min(e.criado_em) de, max(e.criado_em) ate,
           string_agg(distinct e.alvo, ', ') alvos
      from eventos_atividade e, janela j
     where e.criado_em >= greatest(j.de, j.nasce_sessao)
       and e.tipo = 'sessao_expirada' and e.user_id is not null
     group by 1
  ),
  achados as (
    select 'clicou e a tela recusou'::text motivo, 'critico'::text gravidade, r.user_id,
           r.qtd, r.de, r.ate, coalesce(r.motivos,'(sem detalhe)') detalhe from recusado r
    union all
    select 'começou a gerar e sumiu', 'critico', s.user_id, s.qtd, s.de, s.ate,
           'nenhum desfecho no rastro e nenhuma linha em analises_mercado em 30 min' from sumiu s
    union all
    select 'sessão vencida repetida', case when x.qtd >= 3 then 'critico' else 'atencao' end,
           x.user_id, x.qtd, x.de, x.ate, coalesce(x.alvos,'') from sessao x
  )
  select a.motivo, a.gravidade, a.user_id,
         coalesce(p.nome,'(sem nome)') , coalesce(p.role,'(sem perfil)'),
         a.qtd, a.de, a.ate, a.detalhe
    from achados a left join perfis p on p.id = a.user_id
   where coalesce(p.role,'') <> 'admin'
  union all
  select '(sem cobertura)'::text, 'aviso'::text, null::uuid, '—'::text, '—'::text, 0::bigint,
         (select de from janela), (select nasce_gerar from janela),
         'a janela pedida começa antes de 29/08, quando o rastro `analise_gerar` passou a existir — o vazio antes dessa data não é ausência de casos'::text
   where (select now() - make_interval(days => greatest(1, p_dias)) < timestamptz '2026-08-29')
   order by 2, 6 desc;
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.cliente_travou(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cliente_travou(integer) TO authenticated, service_role;
