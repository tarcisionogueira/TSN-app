-- ─────────────────────────────────────────────────────────────────────────────────────────
-- O CADASTRO VINDO DO META CAIRIA FORA DO CANAL "META ADS" — 25/08/2026
--
-- O QUE A PRIMEIRA MEDIÇÃO MOSTROU. A campanha do Meta entrou no ar em 24/08 e a ingestão
-- funcionou: `marketing_metricas_dia` recebeu `canal = 'Meta Ads'` com R$ 3,65 (24/08) e
-- R$ 0,51 (25/08 parcial). Do lado da visita, 25 linhas em `visita_origem` com
-- `utm_source=instagram` e `utm_medium=cpc` — exatamente os 25 cliques que o Meta reportou.
-- A ponte existe.
--
-- MAS `fbclid` VEIO ZERO nas 25. A Meta não anexou o parâmetro; quem identifica o anúncio é
-- a UTM que configuramos. E `admin_funil_captacao` classificava canal assim:
--
--     when p.mkt_gclid  is not null then 'Google Ads'
--     when p.mkt_fbclid is not null then 'Meta Ads'
--     when p.mkt_utm_source is not null then 'UTM: ' || p.mkt_utm_source
--
-- Ou seja: o primeiro cadastro vindo desta campanha cairia como **'UTM: instagram'**,
-- enquanto o GASTO está registrado sob **'Meta Ads'**. O painel junta cadastros e gasto pelo
-- NOME do canal — as duas linhas nunca se encontrariam. Resultado: "Meta Ads: R$ 4,16 gasto,
-- 0 cadastros" ao lado de "UTM: instagram: N cadastros, sem gasto", e CAC/ROAS quebrados de
-- novo, um dia depois de consertados.
--
-- É a MESMA família de ontem (`funil_nao_enxergava_quem_pagou`) por outro caminho: a consulta
-- olhando para um sinal que não veio, quando o sinal que veio estava do lado.
--
-- CONSERTADO ANTES DE MORDER: nenhum cadastro do Meta havia chegado ainda (25 visitas, 0
-- cadastros). Se tivesse chegado, a atribuição do primeiro cliente pago do canal estaria
-- errada no registro — e esse dado não se recupera depois.
--
-- A REGRA: fonte de anúncio reconhecida por `utm_source` + `utm_medium` pago, para os dois
-- canais. O `gclid`/`fbclid` continuam tendo precedência quando existem; a UTM é o caminho
-- para quando o clique chega sem eles — que, medido, é o caso normal do Meta.
-- ─────────────────────────────────────────────────────────────────────────────────────────

do $do$
declare def text; antes text; depois text;
begin
  select pg_get_functiondef(oid) into def from pg_proc where proname = 'admin_funil_captacao';

  antes := '          when p.mkt_fbclid is not null then ''Meta Ads''
          when p.mkt_utm_source is not null then ''UTM: '' || p.mkt_utm_source';

  depois := '          when p.mkt_fbclid is not null then ''Meta Ads''
          when lower(coalesce(p.mkt_utm_source, '''')) in (''instagram'',''facebook'',''meta'',''ig'',''fb'')
               and lower(coalesce(p.mkt_utm_medium, '''')) in (''cpc'',''ppc'',''paid'',''ads'',''paid_social'') then ''Meta Ads''
          when lower(coalesce(p.mkt_utm_source, '''')) = ''google''
               and lower(coalesce(p.mkt_utm_medium, '''')) in (''cpc'',''ppc'',''paid'',''ads'') then ''Google Ads''
          when p.mkt_utm_source is not null then ''UTM: '' || p.mkt_utm_source';

  if position(antes in def) = 0 then
    if position('paid_social' in def) > 0 then
      raise notice 'ja aplicado — nada a fazer';
      return;
    end if;
    raise exception 'ancora nao encontrada em admin_funil_captacao — revise antes de aplicar';
  end if;

  execute replace(def, antes, depois);
  raise notice 'classificacao de canal por utm aplicada';
end $do$;
