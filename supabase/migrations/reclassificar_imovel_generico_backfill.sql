-- Backfill ONE-TIME (aplicado via MCP em 21/07/2026) — reclassifica o balde genérico 'imovel'
-- do acervo ATIVO usando os MESMOS sinais do leiloeiro que o scraper passa a usar going-forward
-- (helper reforcarTipo em scripts/scraper-puppeteer.mjs): (1) CATEGORIA embutida na url_lote
-- (autoritativa no Grupo Lance: /imoveis/<categoria>/…) e, se genérico, (2) o TÍTULO. Só faz
-- UPGRADE do balde 'imovel' (nunca sobrescreve tipo específico) e é conservador (residencial
-- vem antes de terreno; 'area' CRU NÃO indica terreno — só "area/data de terra"). Corrige o
-- vazamento de TERRENOS na intenção "Locação" (ex.: Bertioga) sem tocar no filtro da Busca.
-- Resultado: 106 lotes reclassificados (43 terreno, 27 comercial, 27 casa, 6 rural, 3 apto).
-- Idempotente: re-rodar não altera nada novo (só toca tipo='imovel' que casa um sinal).
with cand as (
  select id,
    lower(translate(coalesce((regexp_match(url_lote,'/imoveis/([^/?#]+)'))[1],''),
      'áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ','aaaaeeiooucAAAAEEIOOUC')) as cat_raw,
    lower(translate(coalesce(titulo,''),
      'áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ','aaaaeeiooucAAAAEEIOOUC')) as tit
  from imoveis_leilao where ativo and tipo='imovel'
),
cls as (
  select c.id, coalesce((
      select t.tp from (values (1, replace(c.cat_raw,'-',' ')), (2, c.tit)) v(pri,txt)
      cross join lateral (select case
        when v.txt ~ 'rural|fazenda|sitio|chacara|agricol|agropecu|pecuari|haras|lavoura' then 'rural'
        when v.txt ~ 'apart|apto|flat|kitnet|kitinete|studio|cobertura' then 'apartamento'
        when v.txt ~ 'casa|sobrado|resid' then 'casa'
        when v.txt ~ 'terreno|lote|gleba|data de terra|area de terra' then 'terreno'
        when v.txt ~ 'comerc|sala|loja|galp|barrac|industr|armazem|deposito|predio|escritorio|conjunto|ponto|hotel|pousada|motel' then 'comercial'
        else 'imovel' end as tp) t
      where t.tp <> 'imovel' order by v.pri limit 1),'imovel') as novo
  from cand c
)
update imoveis_leilao im
set tipo = cls.novo
from cls
where im.id = cls.id and cls.novo <> 'imovel';
