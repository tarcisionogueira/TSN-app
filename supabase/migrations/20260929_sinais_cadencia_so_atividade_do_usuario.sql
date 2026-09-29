-- ─────────────────────────────────────────────────────────────────────────────────────────
-- CADÊNCIA: "ÚLTIMA ATIVIDADE" SÓ CONTA O QUE O USUÁRIO FEZ — 29/09/2026
--
-- `alertas_sinais_lote` usava max(eventos_atividade.criado_em) sem filtro, e a tabela também
-- recebe eventos gerados pelo SERVIDOR: `lancamento_email` (registro de e-mail que NÓS
-- enviamos) e `meta_lead` (evento de conversão do cadastro). Efeito: mandar e-mail fazia a
-- pessoa parecer "ativa", e "ativa" recebe quinzenal em vez de mensal (api/_cadencia.js) — o
-- envio alimentava a própria frequência. Caso-motivo: conta que NUNCA logou recebendo como
-- ativa por causa dos e-mails de lançamento (forma nº 10: media a nossa atividade e reportava
-- como a do cliente). Medido no dia: 12 de 80 gratuitos "ativos" só tinham evento de sistema.
-- Separador: evento vindo do navegador sempre traz `rota`; os do servidor, nunca.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.alertas_sinais_lote(p_user_ids uuid[])
 returns table(user_id uuid, ultima_atividade timestamp with time zone, ultimo_clique timestamp with time zone, imediatos_7d integer, enviados_ult7 integer, abertos_ult7 integer)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with ids as (select unnest(p_user_ids) as uid)
  select ids.uid,
    (select max(e.criado_em) from public.eventos_atividade e
      where e.user_id = ids.uid and e.criado_em > now() - interval '90 days'
        and e.rota is not null),
    (select max(l.clicado_em) from public.emails_log l
      where l.user_id = ids.uid and l.clicado_em is not null),
    (select count(*)::int from public.emails_log l
      where l.user_id = ids.uid and l.tipo = 'oportunidade_imediata' and l.enviado_em > now() - interval '7 days'),
    coalesce(u.env, 0), coalesce(u.abr, 0)
  from ids
  left join lateral (
    select count(*)::int env, count(x.aberto_em)::int abr from (
      select l.aberto_em from public.emails_log l
       where l.user_id = ids.uid and l.tipo = 'oportunidades'
       order by l.enviado_em desc limit 7) x
  ) u on true;
$function$;
