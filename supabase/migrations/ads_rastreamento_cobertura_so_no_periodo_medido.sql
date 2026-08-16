-- ============================================================================
-- COBERTURA DE RASTREAMENTO: dividir só pelo período em que houve MEDIÇÃO (16/08)
--
-- Correção de um defeito que eu mesmo introduzi horas antes, no commit que trocou o
-- painel do Google Ads de desenho por medição — e é justamente a família de bugs que
-- o CLAUDE.md manda caçar: **o card não distinguia "não foi medido" de "medido e deu
-- zero"**. Ironia registrada porque importa: o aviso está escrito seis linhas acima do
-- snippet de rastreamento em `api/publico.js` ("se mandássemos null, o banco não
-- distinguiria 'veio direto' de 'não foi medido'"), e o card novo caiu nele assim mesmo.
--
-- O QUE APARECIA: "Clique pago rastreado — 18%", em âmbar/vermelho, sugerindo que 4 de
-- cada 5 reais de anúncio chegavam sem rastreio. Levou a um diagnóstico inteiro sobre
-- página de destino fora do React, redirect que perde query string e bloqueador.
--
-- O QUE ERA: a primeira linha de `visita_origem` é de **12/08/2026 21:49** — o
-- rastreamento das páginas públicas de SEO (o destino dos anúncios) subiu naquele dia.
-- A janela padrão do painel é de 30 dias. O cálculo dividia visitas que só podiam
-- existir depois de 12/08 por cliques cobrados desde 17/07. Dez dias sem instrumentação
-- entravam no denominador como se fossem perda.
--
-- Medido só nos dias em que havia rastreador, a captura está praticamente 1:1:
--   13/08 — 15 cliques, 13 dispositivos com gclid
--   14/08 — 12 cliques, 11 dispositivos
--   15/08 — 13 cliques, 18 dispositivos  (passa de 100%: o dia do Google é o do fuso da
--           conta e a linha é gravada em UTC, então as bordas não coincidem)
-- Não há vazamento de 82%. Não há vazamento relevante nenhum.
--
-- A CORREÇÃO: o denominador começa em `greatest(p_inicio, min(visita_origem.primeira_em))`.
-- A função devolve `janela.medicao_desde`, `janela.cobertura_desde` e `janela.recortada`
-- para a tela poder DIZER que recortou — silêncio aqui só trocaria um número errado por
-- outro número errado, sem aviso.
--
-- Nota para quem mexer nisto depois: `min(visita_origem.primeira_em)` é uma aproximação
-- boa enquanto houver UMA instrumentação. Se um dia o rastreador for desligado e religado,
-- ou passar a cobrir páginas novas, isso deixa de bastar e vai precisar de um marco
-- explícito (uma linha em `regra_negocio`, por exemplo) em vez de inferir do dado.
-- ============================================================================

create or replace function public.admin_ads_rastreamento(
  p_inicio timestamptz,
  p_fim    timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_role   text;
  v_medido timestamptz;
  v_ini    timestamptz;
  v_ini_d  date;
  v_fim_d  date;
begin
  select role into v_role from public.perfis where id = auth.uid();
  if v_role is distinct from 'admin' then raise exception 'apenas admin'; end if;

  -- Marco da instrumentação: antes disto não havia o que medir.
  select min(primeira_em) into v_medido from public.visita_origem;
  v_ini   := greatest(p_inicio, coalesce(v_medido, p_inicio));
  v_ini_d := v_ini::date;
  v_fim_d := p_fim::date;

  return (
    with visitas as (
      select * from public.visita_origem
       where primeira_em >= v_ini and primeira_em <= p_fim
    ),
    -- gclid (busca) + gbraid/wbraid (iOS/app, sem gclid). Só gclid subestimaria.
    v_click as (
      select * from visitas
       where gclid is not null or gbraid is not null or wbraid is not null
    ),
    -- Denominador recortado pela mesma janela das visitas — este é o conserto.
    pagos as (
      select coalesce(sum(cliques), 0)::int as cliques
        from public.marketing_metricas_dia
       where data >= v_ini_d and data <= v_fim_d
         and canal ilike 'Google%'
    ),
    ing as (
      select max(data) as ultimo_dia, max(atualizado_em) as atualizado_em
        from public.marketing_metricas_dia
       where canal ilike 'Google%'
    ),
    -- Cadastro e plano seguem a janela PEDIDA (não a da instrumentação): a atribuição
    -- deles vive em `perfis.mkt_*`, que existe desde antes e não depende do tracker.
    cad as (
      select count(*)::int as total,
             count(*) filter (where mkt_gclid is not null)::int as com_click,
             max(created_at) filter (where mkt_gclid is not null) as ultimo_em
        from public.perfis
       where created_at >= p_inicio and created_at <= p_fim
    ),
    pln as (
      select count(*)::int as total,
             count(*) filter (where p.mkt_gclid is not null)::int as com_click,
             max(a.aceito_em) as ultimo_em
        from public.aceites_plano a
        left join public.perfis p on p.id = a.user_id
       where a.aceito_em >= p_inicio and a.aceito_em <= p_fim
         and a.valor > 0
    )
    select jsonb_build_object(
      'janela', jsonb_build_object(
        'inicio', p_inicio, 'fim', p_fim,
        'medicao_desde',   v_medido,
        'cobertura_desde', v_ini,
        'recortada', (v_medido is not null and v_medido > p_inicio)
      ),
      'pageview', jsonb_build_object(
        'visitas',     (select count(*)::int from visitas),
        'ultima_em',   (select max(primeira_em) from visitas),
        'horas_desde', (select round(extract(epoch from (now() - max(primeira_em)))/3600.0, 1) from visitas)
      ),
      'click_id', jsonb_build_object(
        'visitas',       (select count(*)::int from v_click),
        'cliques_pagos', (select cliques from pagos),
        -- null (e não 0) sem clique pago: sem denominador não há cobertura a calcular.
        'cobertura_pct', (select case when p.cliques > 0
                                 then round(100.0 * (select count(*) from v_click) / p.cliques, 0)
                                 else null end from pagos p),
        'ultima_em',     (select max(primeira_em) from v_click),
        'horas_desde',   (select round(extract(epoch from (now() - max(primeira_em)))/3600.0, 1) from v_click)
      ),
      'utm_term', jsonb_build_object(
        'visitas', (select count(*) filter (where utm_term is not null)::int from visitas)
      ),
      'cadastro', (select to_jsonb(c) from cad c),
      'plano',    (select to_jsonb(p) from pln p),
      'ingestao', (select jsonb_build_object(
                     'ultimo_dia',    i.ultimo_dia,
                     'atualizado_em', i.atualizado_em,
                     -- A rodada é ~10h50 UTC e traz o dia ANTERIOR: "último dia = ontem"
                     -- é o normal. O relógio que vale é o da rodada.
                     'horas_desde',   round(extract(epoch from (now() - i.atualizado_em))/3600.0, 1)
                   ) from ing i)
    )
  );
end $function$;

comment on function public.admin_ads_rastreamento(timestamptz, timestamptz) is
  'Saude REAL do rastreamento Google Ads. A cobertura so conta cliques do periodo em que houve medicao (primeira linha de visita_origem: 12/08/2026) — antes disso nao havia rastreador nas paginas publicas, e dividir por esses cliques media ausencia de instrumentacao como se fosse perda.';

revoke all on function public.admin_ads_rastreamento(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_ads_rastreamento(timestamptz, timestamptz) to authenticated;
