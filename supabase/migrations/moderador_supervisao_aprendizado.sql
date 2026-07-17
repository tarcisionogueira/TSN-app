-- Supervisão do moderador sobre o APRENDIZADO (determinística, zero IA). Escreve insights
-- em moderador_insights (padrão dos demais RPCs do moderador; o moderador-cron semanal já
-- lê e envia). A cada run: agentes parados (não aprendem há 14d), regens pendentes por
-- vício, e o resumo de volume por agente (7/30d). É o "quem não está aprendendo / o que
-- recorre" — o moderador supervisiona cada agente que vai aprendendo.
create or replace function public.moderador_supervisao_aprendizado()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n int := 0; r record;
begin
  delete from public.moderador_insights where chave like 'aprendizado:%';
  for r in
    select agente, max(criado_em) as ultimo,
      count(*) filter (where criado_em > now() - interval '7 days')  as v7,
      count(*) filter (where criado_em > now() - interval '30 days') as v30
    from public.agente_aprendizado group by agente
  loop
    if r.ultimo < now() - interval '14 days' then
      insert into public.moderador_insights (chave, categoria, severidade, agente, titulo, detalhe, dados, gerado_em)
      values ('aprendizado:parado:'||r.agente, 'aprendizado', 'atencao', r.agente,
        'Agente sem aprendizado recente',
        'Última lição há '||floor(extract(epoch from now()-r.ultimo)/86400)::int||' dias. Verifique se o gerador '||r.agente||' está emitindo.',
        jsonb_build_object('ultimo', r.ultimo, 'vol_7d', r.v7, 'vol_30d', r.v30), now());
      v_n := v_n + 1;
    end if;
  end loop;
  for r in
    select 'documental'::text as tabela, count(*) as n from public.analises_documental where regen_motivo is not null
    union all select 'laudo', count(*) from public.analises_laudo where regen_motivo is not null
  loop
    if r.n > 0 then
      insert into public.moderador_insights (chave, categoria, severidade, agente, titulo, detalhe, dados, gerado_em)
      values ('aprendizado:regen:'||r.tabela, 'aprendizado', 'atencao', r.tabela,
        r.n||' relatorio(s) aguardando regeracao por vicio',
        'Vicio detectado na emissao (matricula/CNJ/contradicao). O cron regenera ate 3x quando a causa-raiz for resolvivel.',
        jsonb_build_object('pendentes', r.n), now());
      v_n := v_n + 1;
    end if;
  end loop;
  insert into public.moderador_insights (chave, categoria, severidade, agente, titulo, detalhe, dados, gerado_em)
  select 'aprendizado:volume', 'aprendizado', 'info', 'moderador',
    'Aprendizado na emissao (7/30d)',
    coalesce(string_agg(agente||': '||v7||'/'||v30, ' | ' order by agente), 'sem licoes ainda'),
    jsonb_agg(jsonb_build_object('agente', agente, 'v7', v7, 'v30', v30)), now()
  from (select agente,
      count(*) filter (where criado_em > now()-interval '7 days')  as v7,
      count(*) filter (where criado_em > now()-interval '30 days') as v30
    from public.agente_aprendizado group by agente) s;
  return jsonb_build_object('insights', v_n, 'gerado_em', now());
end $$;
revoke all on function public.moderador_supervisao_aprendizado() from public, anon, authenticated;
grant execute on function public.moderador_supervisao_aprendizado() to service_role;
