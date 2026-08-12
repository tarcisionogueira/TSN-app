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
          (select count(distinct anon_id) from public.eventos_atividade
            where user_id is null and criado_em > corte and tipo = 'api_erro') as tomou_erro,
          -- ponte pré-login: o mesmo navegador aparece depois COM user_id
          (select count(distinct anon_id) from public.eventos_atividade
            where user_id is not null and anon_id is not null and criado_em > corte) as virou_conta
      )
      select to_jsonb(passo) from passo),
    'origens', coalesce((
      select jsonb_agg(x) from (
        -- NULL aqui é "não medido", NÃO é "veio direto": a origem só passou a ser coletada
        -- em 12/08, e só nas páginas públicas. Rotular tudo como direto faria o painel dizer
        -- que SEO e anúncio não trazem ninguém — conclusão oposta à realidade, e cara.
        select coalesce(nullif(detalhe,''), '(não medido)') as origem, count(distinct anon_id) as pessoas
          from public.eventos_atividade
         where user_id is null and tipo = 'pageview' and criado_em > corte
         group by 1 order by 2 desc limit 8) x), '[]'::jsonb),
    'paginas', coalesce((
      select jsonb_agg(x) from (
        select rota, count(distinct anon_id) as pessoas
          from public.eventos_atividade
         where user_id is null and tipo = 'pageview' and criado_em > corte
         group by 1 order by 2 desc limit 10) x), '[]'::jsonb),
    'barreiras', coalesce((
      select jsonb_agg(x) from (
        select alvo, left(coalesce(detalhe,''), 120) as motivo,
               count(*) as vezes, count(distinct anon_id) as pessoas
          from public.eventos_atividade
         where user_id is null and tipo = 'api_erro' and criado_em > corte
         group by 1, 2 order by 4 desc, 3 desc limit 10) x), '[]'::jsonb),
    'gerado_em', now());
end;
$$;

revoke execute on function public.funil_publico(integer) from public, anon;
grant  execute on function public.funil_publico(integer) to authenticated, service_role;
