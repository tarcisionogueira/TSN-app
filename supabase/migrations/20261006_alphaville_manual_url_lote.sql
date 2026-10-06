-- 06/10: o lote manual do Alphaville foi promovido a lote da base depois de um recarregamento da tela (versão
-- nova do app), com o campo do link já vazio — ficou sem url_lote. O link é o que o dono colou (página VIP).
-- O código agora guarda a origem do link no documento "Descrição do leiloeiro" (api/_docs-manuais.js).
set local lock_timeout = '8s';
update imoveis_leilao set url_lote = 'https://www.leilaovip.com.br/evento/anuncio/casa-com-24666-m-alphaville-22357'
 where id = 'ccd40da8-75e3-4a75-ab0c-38520a4e1677' and fonte = 'MANUAL' and url_lote is null;
