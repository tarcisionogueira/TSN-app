-- Pedido do dono (20/09): tirar a landing da "aula ao vivo" do ar pro público sem perder a
-- própria visão dela enquanto o texto é remodelado para o lançamento com o Érico Rocha
-- (15/11). `live_proxima` (existente) só enxerga evento com `ativo` — é assim que a página
-- pública sai do ar: basta `ativo=false` na linha, sem mexer em rota nem em código. Esta
-- função é o espelho dela SEM o filtro de `ativo`, mas com um portão que `live_proxima` não
-- precisa ter: ela é SECURITY DEFINER e devolveria rascunho pra qualquer um que soubesse o
-- slug, então só sai algo se quem chama (auth.uid(), o JWT de quem está logado) for admin —
-- do contrário devolve null, igual a "evento não encontrado".
create or replace function public.live_proxima_preview(p_slug text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  e record;
  v_quando timestamptz;
  v_base date;
  v_delta int;
begin
  if not exists (select 1 from perfis where id = auth.uid() and role = 'admin') then
    return null;
  end if;

  select * into e from eventos_live where slug = p_slug limit 1;
  if e.id is null then return null; end if;

  if coalesce(e.recorrencia,'') <> 'semanal' or e.recorrencia_dia is null then
    v_quando := e.data_hora;
  else
    v_base := (now() at time zone 'America/Bahia')::date;
    if e.recorrencia_inicio is not null and e.recorrencia_inicio > v_base then
      v_base := e.recorrencia_inicio;
    end if;
    v_delta := (e.recorrencia_dia - extract(dow from v_base)::int + 7) % 7;
    v_quando := ((v_base + v_delta) + make_interval(hours => coalesce(e.recorrencia_hora, 19)))
                  at time zone 'America/Bahia';
    while v_quando < now() - interval '2 hours' loop
      v_quando := v_quando + interval '7 days';
    end loop;
  end if;

  return jsonb_build_object(
    'id', e.id, 'slug', e.slug, 'titulo', e.titulo, 'subtitulo', e.subtitulo,
    'descricao', e.descricao, 'data_hora', v_quando, 'duracao_min', e.duracao_min,
    'capa_url', e.capa_url, 'vagas_max', e.vagas_max, 'imagens', coalesce(e.imagens,'[]'::jsonb),
    'depoimentos', coalesce(e.depoimentos,'[]'::jsonb),
    'apresentador', e.apresentador, 'apresentador_bio', e.apresentador_bio,
    'apresentador_foto', e.apresentador_foto, 'apresentador_cargo', e.apresentador_cargo,
    'apresentador_destaques', coalesce(e.apresentador_destaques,'[]'::jsonb),
    'recorrencia', e.recorrencia,
    'edicao', (v_quando at time zone 'America/Bahia')::date,
    'ativo', e.ativo
  );
end $$;

grant execute on function public.live_proxima_preview(text) to authenticated;
