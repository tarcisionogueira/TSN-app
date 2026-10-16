-- Pendência 226 (16/10): 3 veículos SUPORTE com o MODELO como cidade ("Onibus M.benz"/UF "LO",
-- "Motocicleta Honda"/UF "CG"). mapLoteSuporteVeiculo, sem local na listagem, lia o título
-- "MARCA/MODELO" como "Cidade/UF". Conserto em scripts/scraper-puppeteer.mjs (UF válida e sem marca/
-- tipo de veículo). Aqui: zera cidade/UF falsas — sem isto o coletor as PRESERVARIA (cidade não
-- esquece) e o edital nunca teria chance de preencher.
update public.veiculos_leilao set cidade = null, estado = null
 where fonte = 'SUPORTE' and local_ibge = false
   and (estado is null or estado not in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB',
                                         'PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'));

-- Mesma checagem achou 19 veículos MEGA com UF "SI" (o caminho da URL traz "si" = sem informação).
-- mapearMegaVeiculo passa a aceitar só UF real.
update public.veiculos_leilao set estado = null where fonte = 'MEGA' and estado = 'SI';
