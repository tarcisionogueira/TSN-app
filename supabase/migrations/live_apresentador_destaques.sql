-- 05/09 — Estatísticas de autoridade do apresentador na LP da aula ao vivo (aditivo,
-- mesma rodada do comparativo com concorrente que trouxe `depoimentos`).
--
-- `apresentador_destaques`: array de strings curtas (formato "→ frase"), renderizadas como
-- lista ao lado da bio em prosa — mesmo padrão aditivo de `imagens`/`depoimentos` (array
-- vazio, a lista some da página). Fica por evento porque apresentador muda por evento.
alter table public.eventos_live
  add column if not exists apresentador_destaques jsonb not null default '[]'::jsonb;

comment on column public.eventos_live.apresentador_destaques is
  'Bullets de autoridade do apresentador (array de strings). Complementa apresentador_bio; vazio = a lista some.';

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
    'edicao', (v_quando at time zone 'America/Bahia')::date
  );
end $function$;
