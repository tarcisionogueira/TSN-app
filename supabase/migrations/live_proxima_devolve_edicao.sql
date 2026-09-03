-- DECISÃO DO DONO (03/09, tarde): "a contagem do marketing de interessados na live deve ser
-- contabilizada entre uma live e outra" — o número de "novos inscritos" da PRÓXIMA edição não
-- pode somar as edições passadas (isso é papel da lista de comunicação por e-mail, que já é
-- cumulativa por desenho). `live_proxima` já é a ÚNICA fonte da data da ocorrência; agora também
-- devolve a EDIÇÃO pronta (mesma fórmula que o gatilho `live_edicao_preencher` usa), para que
-- quem contar "inscritos desta edição" não precise recalcular `at time zone 'America/Bahia'::date`
-- por conta própria — foi copiar essa fórmula em 3 lugares que causou o defeito de 03/09.
create or replace function public.live_proxima(p_slug text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  e record;
  v_quando timestamptz;
  v_base date;
  v_delta int;
begin
  select * into e from eventos_live where slug = p_slug and ativo limit 1;
  if e.id is null then return null; end if;

  if coalesce(e.recorrencia,'') <> 'semanal' or e.recorrencia_dia is null then
    v_quando := e.data_hora;
  else
    v_base := (now() at time zone 'America/Bahia')::date;
    -- Nunca antes do início declarado.
    if e.recorrencia_inicio is not null and e.recorrencia_inicio > v_base then
      v_base := e.recorrencia_inicio;
    end if;
    v_delta := (e.recorrencia_dia - extract(dow from v_base)::int + 7) % 7;
    v_quando := ((v_base + v_delta) + make_interval(hours => coalesce(e.recorrencia_hora, 19)))
                  at time zone 'America/Bahia';
    -- Janela de 2h: quem abre a página às 19h05 vê "começando agora", não a semana que vem.
    while v_quando < now() - interval '2 hours' loop
      v_quando := v_quando + interval '7 days';
    end loop;
  end if;

  return jsonb_build_object(
    'id', e.id, 'slug', e.slug, 'titulo', e.titulo, 'subtitulo', e.subtitulo,
    'descricao', e.descricao, 'data_hora', v_quando, 'duracao_min', e.duracao_min,
    'capa_url', e.capa_url, 'vagas_max', e.vagas_max, 'imagens', coalesce(e.imagens,'[]'::jsonb),
    'apresentador', e.apresentador, 'apresentador_bio', e.apresentador_bio,
    'apresentador_foto', e.apresentador_foto, 'apresentador_cargo', e.apresentador_cargo,
    'recorrencia', e.recorrencia,
    'edicao', (v_quando at time zone 'America/Bahia')::date
  );
end $function$;
