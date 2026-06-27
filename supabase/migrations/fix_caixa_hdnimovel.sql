-- A página do imóvel da Caixa (detalhe-imovel.asp) usa o parâmetro hdnimovel.
-- O scraper gravava hdniip, que retorna erro (testado: hdniip = erro, hdnimovel = abre).
-- Corrige os links existentes (url_lote em todos os CEF; link_edital nos http com hdniip).
update public.imoveis_leilao
set url_lote = replace(url_lote, 'hdniip=', 'hdnimovel=')
where fonte = 'CEF' and url_lote like '%hdniip=%';

update public.imoveis_leilao
set link_edital = replace(link_edital, 'hdniip=', 'hdnimovel=')
where fonte = 'CEF' and link_edital like 'http%' and link_edital like '%hdniip=%';
