-- DECISÃO DO DONO (03/09, tarde): "públicos anteriores somam a lista de comunicação do e-mail,
-- mas não [entram] na contagem de novos inscritos para a próxima live." `live_inscritos(slug)`
-- contava TODAS as edições desde sempre (achado registrado no HANDOFF: "hoje são 5 e não
-- engana; depois de algumas semanas vira número cumulativo apresentado como 'inscritos nesta
-- aula'"). Passa a contar só a edição que `live_proxima` aponta como a PRÓXIMA — a mesma fonte
-- que a landing usa para tudo o mais, sem recalcular a fórmula da edição aqui dentro.
create or replace function public.live_inscritos(p_slug text)
 returns integer
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select count(*)::int from live_inscricoes i
    join eventos_live e on e.id = i.evento_id
   where e.slug = p_slug and e.ativo
     and i.edicao = ((public.live_proxima(p_slug))->>'edicao')::date;
$function$;
