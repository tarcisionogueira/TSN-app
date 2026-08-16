-- ============================================================================
-- PAINEL GOOGLE ADS — DE DESENHO PARA MEDIÇÃO (16/08)
--
-- POR QUE ESTA FUNÇÃO EXISTE
-- O bloco "Google Ads" do /admin > Marketing era um ARRAY LITERAL: quatro caixas
-- com `status: true` escrito à mão ("Tag instalada", "Conversão: Cadastro",
-- "Conversão: Plano", "Page Views"). Nenhuma delas consultava nada. Exibiam
-- quatro bolinhas verdes desde o dia em que foram escritas e exibiriam o mesmo
-- com a conta do Google desligada.
--
-- O dono relatou "o Google não está atualizando, somente aumentando o
-- investimento". A frase descreve a tela ao pé da letra: o gasto é somado no
-- cliente a partir de `marketing_metricas_dia` (que está fresco e bate EXATO com
-- o painel do Google — 235 cliques / R$ 343,81 / 3.367 impressões / 2 conversões
-- / CPC R$ 1,46 na janela 02–15/08), enquanto as quatro caixas ao lado são
-- constantes. O dado nunca foi o problema.
--
-- É a pergunta de revisão do CLAUDE.md numa forma pior que "vazio entregue como
-- resposta": SINAL VERDE ENTREGUE COMO VERIFICAÇÃO, sem nunca ter havido
-- consulta — a mesma família do selo jurídico dado sem consulta (08/08).
--
-- O QUE ELA MEDE
-- Cada card do painel passa a ter uma fonte no banco e um RELÓGIO (horas desde o
-- último sinal). Verde exige sinal recente; sem sinal a tela precisa PODER dizer
-- "não estou recebendo" — que é exatamente a informação que faltava.
--
-- A razão `cobertura_pct` (visitas com click id ÷ cliques que o Google cobrou) é
-- o número que o painel falso escondia: em 14 dias, 235 cliques pagos × 47
-- visitas rastreadas = 20%. Um número sozinho parece saudável; é a RAZÃO entre
-- os dois que denuncia a perda.
--
-- Agregado no servidor de propósito: o PostgREST corta em 1.000 linhas, e contar
-- no navegador foi o que já congelou o "Total de buscas" em 1000 nesta mesma tela.
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
  v_role text;
  v_ini  date := p_inicio::date;
  v_fim  date := p_fim::date;
begin
  select role into v_role from public.perfis where id = auth.uid();
  if v_role is distinct from 'admin' then raise exception 'apenas admin'; end if;

  return (
    with visitas as (
      select * from public.visita_origem
       where primeira_em >= p_inicio and primeira_em <= p_fim
    ),
    -- Click id do Google: gclid (busca), gbraid/wbraid (iOS/app, sem gclid).
    -- Tratar só gclid subestimaria a cobertura e acusaria perda que não existe.
    v_click as (
      select * from visitas
       where gclid is not null or gbraid is not null or wbraid is not null
    ),
    pagos as (
      select coalesce(sum(cliques), 0)::int as cliques
        from public.marketing_metricas_dia
       where data >= v_ini and data <= v_fim
         and canal ilike 'Google%'
    ),
    ing as (
      select max(data) as ultimo_dia, max(atualizado_em) as atualizado_em
        from public.marketing_metricas_dia
       where canal ilike 'Google%'
    ),
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
      'janela', jsonb_build_object('inicio', p_inicio, 'fim', p_fim),
      'pageview', jsonb_build_object(
        'visitas',     (select count(*)::int from visitas),
        'ultima_em',   (select max(primeira_em) from visitas),
        'horas_desde', (select round(extract(epoch from (now() - max(primeira_em)))/3600.0, 1) from visitas)
      ),
      'click_id', jsonb_build_object(
        'visitas',       (select count(*)::int from v_click),
        'cliques_pagos', (select cliques from pagos),
        -- null (e não 0) quando não houve clique pago: sem denominador não há
        -- cobertura a calcular, e 0% leria como "perdemos tudo".
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
                     -- A ingestão roda ~10h50 UTC e traz o DIA ANTERIOR: "último
                     -- dia = ontem" é o normal, não atraso. O relógio que vale é
                     -- o de `atualizado_em` (quando a rodada de fato aconteceu).
                     'horas_desde',   round(extract(epoch from (now() - i.atualizado_em))/3600.0, 1)
                   ) from ing i)
    )
  );
end $function$;

comment on function public.admin_ads_rastreamento(timestamptz, timestamptz) is
  'Saúde REAL do rastreamento Google Ads para o painel do admin. Substitui as quatro '
  'caixas hardcoded com status:true que exibiam verde sem consultar nada.';

-- Mesma postura do hardening de 24/07: SECURITY DEFINER não fica exposta a anon.
revoke all on function public.admin_ads_rastreamento(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_ads_rastreamento(timestamptz, timestamptz) to authenticated;
