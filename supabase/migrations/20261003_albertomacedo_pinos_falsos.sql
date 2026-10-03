-- 03/10 — REGISTRO de correção de dados já aplicada (idempotente).
-- 10 lotes ALBERTOMACEDOLEILOES de um pacote "estado de São Paulo — alienação fiduciária" entraram
-- em 01/10 sem cidade/UF (a página do item não traz "Cidade - UF") e o geocodificador, sem ter
-- contra o que validar, gravou pinos genéricos como nível 'rua' (bairros da capital paulista no
-- Pará, -1,28/-47,93, e em Franca/SP). Correção de código: api/_geo.js não geocodifica lote sem
-- cidade e sem UF válida. Aqui: os pinos falsos voltam a 'falhou' (fora do mapa) até haver cidade.
-- Os outros 3 lotes sem cidade com coordenada (SUPERBID/Panamby, LEILOTECH/Curitiba) ficaram:
-- plausíveis, sem prova de erro.
update imoveis_leilao
   set latitude = 0, longitude = 0, geocod_nivel = 'falhou', pontos_proximos = null, proximidades_em = null
 where ativo and fonte = 'ALBERTOMACEDOLEILOES'
   and coalesce(trim(cidade),'') = '' and coalesce(estado,'') !~ '^[A-Z]{2}$'
   and geocod_nivel = 'rua' and latitude <> 0;
