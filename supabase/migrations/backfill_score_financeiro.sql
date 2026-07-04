-- Score BidPro — camada Financeiro (auditoria 2026-07-04, decisão do produto):
-- score_financeiro estava 0/38.174 porque só o fluxo staff (processar-analise)
-- o gravava. A fórmula é determinística (desconto/modalidade/tipo), idêntica à
-- de api/calcular-score.js e api/processar-analise.js — então dá para preencher
-- todo o acervo e ligar a camada Financeiro do Score BidPro na busca.

create or replace function public.calc_score_financeiro(p_modalidade text, p_desconto numeric, p_tipo text)
returns int language sql immutable as $$
  select greatest(0, least(100, round(
      50
    + least(coalesce(p_desconto, 0) * 0.6, 60)
    + case lower(coalesce(p_modalidade,''))
        when 'judicial' then -10
        when 'extrajudicial' then 5
        else 0 end
    + case
        when lower(coalesce(p_tipo,'')) = 'terreno' then -5
        when lower(coalesce(p_tipo,'')) in ('apartamento','casa') then 5
        else 0 end
  )))::int
$$;

-- Backfill: só onde ainda não há score (nunca sobrescreve um laudo real gravado
-- pelo fluxo de análise).
update public.imoveis_leilao
   set score_financeiro   = public.calc_score_financeiro(modalidade, desconto_percentual, tipo),
       score_calculado_em = now()
 where score_financeiro is null;
