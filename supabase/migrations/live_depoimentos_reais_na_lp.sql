-- 05/09 — Depoimentos reais na LP da aula ao vivo (aditivo, motivado por comparativo de
-- concorrente) + `vagas_max` passa a viajar pronto pra virar "restam N vagas" quando for
-- preenchido (campo já existia na tabela desde sempre; live_proxima() já o devolvia; só
-- não havia coluna nenhuma de prova social e o front nunca lia vagas_max em lugar nenhum).
--
-- `depoimentos`: array de {nome, local, tag, resultado, texto} — mesmo padrão de `imagens`
-- (só aparece na página pública quando o array não está vazio). Sem editor de admin ainda:
-- populado direto via SQL enquanto os casos chegam por print, igual `imagens` já é hoje.
alter table public.eventos_live
  add column if not exists depoimentos jsonb not null default '[]'::jsonb;

comment on column public.eventos_live.depoimentos is
  'Provas sociais reais da LP da aula (nome curto + local, resultado, citação). Array de objetos; vazio = a seção some da página.';

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
    'depoimentos', coalesce(e.depoimentos,'[]'::jsonb),
    'apresentador', e.apresentador, 'apresentador_bio', e.apresentador_bio,
    'apresentador_foto', e.apresentador_foto, 'apresentador_cargo', e.apresentador_cargo,
    'recorrencia', e.recorrencia,
    'edicao', (v_quando at time zone 'America/Bahia')::date
  );
end $function$;
