-- Moderador: enxergar TAMBÉM os relatórios de MERCADO aguardando auto-cura.
--
-- Contexto (20/08): a supervisão do moderador contava "regens pendentes" de documental
-- e laudo (que usam a coluna `regen_motivo`), mas ficava CEGA ao mercadológico. O mercado
-- NÃO usa `regen_motivo`: sua regeneração roda por loops DEDICADOS e mais específicos no
-- `regenerar-relatorios-cron` — `result->>mercadoVazio` (fonte sem amostras), `parecer`
-- vazio, e `status=erro` por timeout — cada um com seu próprio teto de tentativas.
--
-- Por isso NÃO plugamos `regen_motivo` no upsert do mercado (era o follow-up anotado):
-- (a) seria inerte para regeneração — o mercado não está no laço genérico `AGENTES`; e
-- (b) `vicioRegen` inclui `avaliacao_ausente`/`minimo_ausente`, que no mercado NÃO têm
--     loop de backfill→regeneração — apareceriam como "pendente" para SEMPRE, um número
--     que nunca drena (o anti-padrão "contar não é validar"). A observabilidade honesta
--     lê o sinal REAL que dispara a auto-cura, e por isso ela DRENA quando o caso resolve.

CREATE OR REPLACE FUNCTION public.moderador_supervisao_aprendizado()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_n int := 0; v_m int := 0; r record;
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

  -- MERCADO: auto-cura por sinal DEDICADO (não usa regen_motivo). Conta o que os loops do
  -- regenerar-relatorios-cron perseguem AGORA — mercado vazio (sem amostras) ou sem parecer,
  -- e o timeout que ainda re-tenta — cada um sob o seu teto de tentativas. Como lê o sinal
  -- real, o número DRENA sozinho quando a fonte volta a preencher (não vira dívida fantasma).
  select
    count(*) filter (where status='concluida' and coalesce(result->>'mercadoVazio','')='true' and coalesce(regen_tentativas,0) < 4)
    + count(*) filter (where status='concluida' and coalesce(result->>'parecer','')='' and coalesce(regen_tentativas,0) < 3)
    + count(*) filter (where status='erro' and erro ilike '%tempo%limite%' and coalesce(regen_tentativas,0) < 4)
    into v_m
  from public.analises_mercado;
  if v_m > 0 then
    insert into public.moderador_insights (chave, categoria, severidade, agente, titulo, detalhe, dados, gerado_em)
    values ('aprendizado:regen:mercado', 'aprendizado', 'atencao', 'mercado',
      v_m||' relatorio(s) de mercado em auto-cura',
      'Mercado sem amostras / sem parecer / timeout transitorio, re-gerado em background por loop dedicado ate o teto de tentativas. Drena sozinho quando a fonte volta.',
      jsonb_build_object('pendentes', v_m), now());
    v_n := v_n + 1;
  end if;

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
end $function$;
