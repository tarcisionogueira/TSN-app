-- ─────────────────────────────────────────────────────────────────────────────
-- FUNIL PÚBLICO — o que acontece com quem AINDA NÃO é cliente. (12/08, pedido do dono)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- POR QUE EXISTE: o dado do visitante anônimo já era coletado, mas ninguém o LIA. O defeito
-- de hoje — uma pessoa tentando criar conta cinco vezes e desistindo — só apareceu porque o
-- dono pediu para olhar o Cliente 360 no fim do dia. Achado por acaso não é processo.
--
-- Esta RPC responde, numa consulta, as perguntas que importam para trazer gente:
--   · de onde vêm (host do referrer — Google, direto, indicação)
--   · quantos passam de cada degrau: chegou → viu acervo → viu planos → foi ao cadastro →
--     tentou → conseguiu
--   · onde MORREM, com o motivo escrito (a mensagem de erro que a pessoa viu)
--
-- LEITURA HONESTA DOS NÚMEROS: `virou_conta` conta o `anon_id` que depois aparece logado —
-- é a ponte pré-login do Cliente 360. Quem trocou de navegador entre a visita e o cadastro
-- não é contado, então este número é PISO, não total.
create or replace function public.funil_publico(p_dias integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_role text;
  corte timestamptz := now() - (greatest(p_dias, 1) || ' days')::interval;
begin
  select role into v_role from public.perfis where id = auth.uid();
  if coalesce(v_role,'') not in ('admin','analista') then raise exception 'apenas admin'; end if;

  return jsonb_build_object(
    'dias', greatest(p_dias, 1),
    'degraus', (
      with anon as (
        select distinct anon_id from public.eventos_atividade
         where user_id is null and anon_id is not null and criado_em > corte
      ),
      virou as (   -- ponte pré-login: o mesmo navegador aparece depois COM user_id
        select distinct anon_id from public.eventos_atividade
         where user_id is not null and anon_id is not null and criado_em > corte
      ),
      com_erro as (
        select distinct anon_id from public.eventos_atividade
         where user_id is null and tipo='api_erro' and criado_em > corte
      ),
      passo as (
        select
          (select count(*) from anon) as visitantes,
          (select count(distinct anon_id) from public.eventos_atividade
            where user_id is null and criado_em > corte and rota like '/leiloes%') as viu_acervo,
          (select count(distinct anon_id) from public.eventos_atividade
            where user_id is null and criado_em > corte and rota = '/planos') as viu_planos,
          (select count(distinct anon_id) from public.eventos_atividade
            where user_id is null and criado_em > corte and rota = '/login') as foi_ao_cadastro,
          (select count(distinct anon_id) from public.eventos_atividade
            where user_id is null and criado_em > corte and tipo = 'submit' and rota = '/login') as tentou,
          (select count(*) from virou) as virou_conta,
          (select count(*) from com_erro) as tomou_erro,
          -- O NÚMERO QUE IMPORTA: tomou erro E nunca virou conta. Sem ele, `tomou_erro` é lido
          -- como perda — e não é. Medido em 12/08: 10 erraram em 30 dias e 8 entraram assim
          -- mesmo (a maioria por "Email not confirmed", que é a pessoa tentando logar antes de
          -- clicar no link do e-mail: transitório). Perda real = 2.
          (select count(*) from com_erro c
            where not exists (select 1 from virou v where v.anon_id = c.anon_id)) as desistiu_apos_erro
      )
      select to_jsonb(passo) from passo),
    -- ORIGEM POR CAMPANHA: sai de `visita_origem` (gclid/UTM do primeiro toque). Cada linha
    -- traz quantos CHEGARAM e quantos viraram CONTA — que é o que responde "esta campanha vale
    -- o que custa". O fallback '(não medido)' cobre a visita anterior a 12/08, quando a query
    -- string era descartada em todo o caminho; chamar aquilo de tráfego direto seria mentira.
    'origens', coalesce((
      select jsonb_agg(to_jsonb(g) order by g.pessoas desc) from (
        select coalesce(
                 case when o.gclid is not null or o.gbraid is not null or o.wbraid is not null
                        then coalesce('Google Ads · ' || nullif(o.utm_campaign,''), 'Google Ads')
                      when nullif(o.utm_source,'') is not null
                        then o.utm_source || coalesce(' · ' || nullif(o.utm_campaign,''), '')
                      when nullif(o.referrer_host,'') is not null then o.referrer_host
                 end, '(não medido)') as origem,
               count(distinct a.anon_id) as pessoas,
               count(distinct a.anon_id) filter (
                 where exists (select 1 from public.eventos_atividade v
                                where v.anon_id = a.anon_id and v.user_id is not null)) as viraram_conta
          from (select distinct anon_id from public.eventos_atividade
                 where user_id is null and anon_id is not null and criado_em > corte) a
          left join public.visita_origem o on o.anon_id = a.anon_id
         group by 1 order by 2 desc limit 10) g), '[]'::jsonb),
    'paginas', coalesce((
      select jsonb_agg(x) from (
        select rota, count(distinct anon_id) as pessoas
          from public.eventos_atividade
         where user_id is null and tipo = 'pageview' and criado_em > corte
         group by 1 order by 2 desc limit 10) x), '[]'::jsonb),
    'barreiras', coalesce((
      select jsonb_agg(to_jsonb(g) order by g.perdeu desc, g.pessoas desc)
        from (
          select case when e.alvo = 'cadastro_falha' then 'Criar conta'
                      when e.alvo = 'login_falha'    then 'Entrar'
                      else 'Uso do site' end                          as etapa,
                 left(coalesce(e.detalhe,''), 120)                    as motivo,
                 count(*)                                             as vezes,
                 count(distinct e.anon_id)                            as pessoas,
                 -- PERDA REAL desta barreira: das que a tomaram, quantas nunca viraram conta.
                 count(distinct e.anon_id) filter (
                    where not exists (select 1 from public.eventos_atividade v
                                       where v.anon_id = e.anon_id and v.user_id is not null)) as perdeu
            from public.eventos_atividade e
           where e.user_id is null and e.tipo = 'api_erro' and e.criado_em > corte
           group by 1, 2) g), '[]'::jsonb),
    'gerado_em', now());
end;
$$;

revoke execute on function public.funil_publico(integer) from public, anon;
grant  execute on function public.funil_publico(integer) to authenticated, service_role;
