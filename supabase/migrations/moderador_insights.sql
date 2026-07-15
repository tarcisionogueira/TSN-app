-- Agente MODERADOR (camada meta). Não faz cada agente aprender tudo: observa a
-- operação e PONTUA/DIRECIONA os especialistas, destilando padrões que fazem diferença
-- num relatório futuro. Determinístico (SQL puro, sem custo de LLM). Idempotente por
-- `chave` (snapshot atual, atualizado a cada run pelo cron /api/moderador-cron).
create table if not exists public.moderador_insights (
  chave      text primary key,
  categoria  text,   -- calibracao | custo | cobertura | fonte
  severidade text,   -- info | atencao | critico
  agente     text,   -- especialista que o insight direciona
  titulo     text,
  detalhe    text,
  dados      jsonb,
  gerado_em  timestamptz default now()
);
alter table public.moderador_insights enable row level security;
drop policy if exists "service_only_moderador" on public.moderador_insights;
create policy "service_only_moderador" on public.moderador_insights for all using (false);

create or replace function public.moderador_gerar_insights()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare n int;
begin
  -- 1) CALIBRAÇÃO por modalidade/tipo (previsto × realizado) → direciona a mercadológica.
  insert into moderador_insights (chave, categoria, severidade, agente, titulo, detalhe, dados)
  select
    'calibracao:'||coalesce(modalidade,'na')||':'||coalesce(tipo_aquisicao,'na'),
    'calibracao',
    case when abs(avg((assertividade->>'valor_delta_pct')::numeric)) >= 15 then 'critico'
         when abs(avg((assertividade->>'valor_delta_pct')::numeric)) >= 8  then 'atencao' else 'info' end,
    'analise-mercadologica',
    'Calibração '||coalesce(modalidade,'?')||' / '||coalesce(tipo_aquisicao,'?'),
    'Desvio médio do valor previsto×realizado: '||round(avg((assertividade->>'valor_delta_pct')::numeric),1)||'% (n='||count(*)||').',
    jsonb_build_object('n',count(*),'valor_delta_pct_med',round(avg((assertividade->>'valor_delta_pct')::numeric),1))
  from arremate_aprendizado
  where assertividade is not null and assertividade ? 'valor_delta_pct'
  group by modalidade, tipo_aquisicao
  on conflict (chave) do update set severidade=excluded.severidade, detalhe=excluded.detalhe, dados=excluded.dados, gerado_em=now();

  -- 2) CUSTO: leiloeiros no caminho PAGO (Bright Data) → revalidar via grátis (economia).
  insert into moderador_insights (chave, categoria, severidade, agente, titulo, detalhe, dados)
  select 'custo:pago', 'custo',
    case when count(*) >= 5 then 'atencao' else 'info' end, 'scraper',
    'Leiloeiros no caminho PAGO (Bright Data)',
    count(*)||' fonte(s): '||string_agg(fonte, ', ' order by fonte)||'. Revalidar periodicamente se há via grátis.',
    jsonb_build_object('fontes', jsonb_agg(fonte order by fonte))
  from leiloeiro_conhecimento where custo='pago' having count(*) > 0
  on conflict (chave) do update set severidade=excluded.severidade, detalhe=excluded.detalhe, dados=excluded.dados, gerado_em=now();

  -- 3) DÍVIDA DE MAPEAMENTO: plataforma a confirmar → direciona o scraper.
  insert into moderador_insights (chave, categoria, severidade, agente, titulo, detalhe, dados)
  select 'cobertura:a_confirmar', 'cobertura', 'info', 'scraper',
    'Leiloeiros sem plataforma mapeada',
    count(*)||' fonte(s): '||string_agg(fonte, ', ' order by fonte)||'. Mapear acelera integrações futuras.',
    jsonb_build_object('fontes', jsonb_agg(fonte order by fonte))
  from leiloeiro_conhecimento where plataforma='a_confirmar' having count(*) > 0
  on conflict (chave) do update set severidade=excluded.severidade, detalhe=excluded.detalhe, dados=excluded.dados, gerado_em=now();

  -- 4) SAÚDE DAS FONTES: última execução degradada/falha → crítico p/ o scraper.
  insert into moderador_insights (chave, categoria, severidade, agente, titulo, detalhe, dados)
  select 'fonte:saude', 'fonte',
    case when count(*) filter (where status <> 'ok') > 0 then 'critico' else 'info' end, 'scraper',
    'Saúde das fontes de coleta',
    case when count(*) filter (where status <> 'ok') > 0
         then string_agg(fonte||' ('||status||')', ', ') filter (where status <> 'ok')
         else 'todas as fontes saudáveis na última execução' end,
    jsonb_build_object('degradadas', coalesce(jsonb_agg(fonte) filter (where status <> 'ok'), '[]'::jsonb))
  from (select distinct on (fonte) fonte, status from fonte_saude order by fonte, executado_em desc) s
  on conflict (chave) do update set severidade=excluded.severidade, detalhe=excluded.detalhe, dados=excluded.dados, gerado_em=now();

  select count(*) into n from moderador_insights;
  return n;
end
$function$;