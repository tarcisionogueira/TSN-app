-- 22/10: o url_lote do PESTANA era a página do LEILÃO (/agenda-de-leiloes/<leilão>) — 154 lotes do leilão
-- 6312 com o mesmo link, o "ver no leiloeiro" caía na lista. A rota do app do site é
-- /agenda-de-leiloes/:id/:loteId/:slug? (bundle app.*.js, breadcrumb "Lote" para /\d+/\d+); o loteId é o
-- mesmo id da API que já forma o fonte_id (pestana_<id>). O coletor já grava assim (scraper-puppeteer.mjs).
update public.imoveis_leilao
   set url_lote = url_lote || '/' || substring(fonte_id from '^pestana_(\d+)$')
 where fonte = 'PESTANA' and url_lote ~ '/agenda-de-leiloes/\d+$' and fonte_id ~ '^pestana_\d+$';
