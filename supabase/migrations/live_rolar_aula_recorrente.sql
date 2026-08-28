-- ─────────────────────────────────────────────────────────────────────────────────────────
-- A AULA SEMANAL PASSA A ROLAR SOZINHA — 28/08
--
-- `eventos_live.recorrencia = 'semanal'` era uma PROMESSA sem mecanismo: a landing dizia
-- "Toda quarta, às 19h", o Google Agenda recebia a RRULE — e `data_hora` ficava parada na
-- primeira ocorrência. Passada a aula, a página anunciaria uma data vencida, o lembrete
-- pré-aula não dispararia para quem se inscrevesse depois (ele conta as horas até
-- `data_hora`) e o card compartilhado cairia no texto de fallback. Com tráfego pago apontado
-- para a landing em setembro, isso é dinheiro comprando uma página que diz um dia que já foi.
--
-- ⚠️ POR QUE ESPERAR A OFERTA FECHAR, E NÃO SÓ A AULA TERMINAR. `lancamento-remarketing-cron`
-- passou a exigir, hoje mesmo, que a aula já tenha acontecido para começar a sequência de
-- venda. Se a rolagem acontecesse logo após a aula, `data_hora` viraria futuro de novo e a
-- sequência da aula que ACABOU nunca sairia — o conserto da manhã anulando o da tarde, em
-- silêncio. Então a rolagem só ocorre quando o ciclo inteiro fecha: aula terminada E janela
-- de oferta encerrada (ou inexistente).
--
-- O passo é de 7 dias sobre a própria `data_hora`, o que preserva dia da semana e hora local
-- (o Brasil não tem horário de verão desde 2019). Se alguém mudar `recorrencia_dia` sem mexer
-- na data, a data gravada é que manda — ela é o fato, o campo é a descrição.
--
-- CONFERIDO nos dois sentidos antes de subir: com a aula de 02/09 no futuro e a oferta aberta,
-- devolve `roladas: 0` e não toca na data; num evento de teste com data e oferta vencidas há
-- 9 dias, avança 14 dias, cai numa QUARTA e volta para o futuro (evento apagado em seguida).
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.live_rolar_recorrentes()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_roladas jsonb;
begin
  with alvo as (
    update public.eventos_live e
       set data_hora = e.data_hora
             + ((floor(extract(epoch from (now() - e.data_hora)) / 604800)::int + 1) * interval '7 days'),
           atualizado_em = now()
     where e.ativo
       and e.recorrencia = 'semanal'
       and e.data_hora is not null
       -- a aula terminou…
       and e.data_hora + make_interval(mins => coalesce(e.duracao_min, 90)) < now()
       -- …e o ciclo de venda dela também fechou.
       and (e.oferta_fecha_em is null or e.oferta_fecha_em < now())
    returning e.slug, e.data_hora
  )
  select coalesce(jsonb_agg(jsonb_build_object('slug', slug, 'nova_data', data_hora)), '[]'::jsonb)
    into v_roladas from alvo;
  return jsonb_build_object('ok', true, 'roladas', jsonb_array_length(v_roladas), 'eventos', v_roladas);
end $fn$;

comment on function public.live_rolar_recorrentes() is
  'Avanca a data_hora das aulas semanais para a proxima ocorrencia, depois que a aula terminou E a janela de oferta fechou. Chamada por /api/live-lembrete-cron (de hora em hora).';

revoke execute on function public.live_rolar_recorrentes() from public, anon, authenticated;
grant  execute on function public.live_rolar_recorrentes() to service_role;
