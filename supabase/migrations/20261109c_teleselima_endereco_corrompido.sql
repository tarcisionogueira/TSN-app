-- 09/11: lote Teles & Lima 21554 (Feira de Santana) com endereço "aL [��, 5" vindo da página do leiloeiro.
-- Limpa o endereço e devolve à fila: o condomínio "Alphaville Feira de Santana" agora é âncora da geocodificação.
update imoveis_leilao set endereco = null, geocod_nivel = 'refazer'
 where fonte = 'TELESELIMA' and endereco like '%' || chr(65533) || '%';
