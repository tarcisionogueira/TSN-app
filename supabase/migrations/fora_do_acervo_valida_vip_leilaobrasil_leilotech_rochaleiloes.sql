-- 22/09: acompanha scraper-puppeteer.mjs (FONTES_FORA_DO_ACERVO_VALIDADAS ampliado) — achado
-- real: "236 Cadeiras, Tipo Universitárias" (fonte VIP) aparecendo na Busca como imóvel.
-- Limpeza retroativa dos 16 lotes confirmados NÃO-imóvel/NÃO-veículo (móveis, hardware,
-- eletrônicos, calçado, nome de marca) das 4 fontes recém-validadas (VIP/LEILAOBRASIL/
-- LEILOTECH/ROCHALEILOES) — diff manual contra o classificador real (scraper-core.mjs),
-- 0 falso-positivo confirmado antes de aplicar.
update public.imoveis_leilao
   set ativo = false,
       suprimido_motivo = 'fora_do_acervo_imovel_veiculo (correção 22/09 — VIP/LEILAOBRASIL/LEILOTECH validados)'
 where id in (
   'c0c8f5ee-ae52-4946-8f0a-08480b2df7bd','dfa72a04-802a-467a-9065-991b3cd54511',
   'c191dabf-dacf-42b6-a625-d19ca85bc6dd','52adf3dc-79bd-4dc6-b5fb-a0a50b00de05',
   '3d4de575-f9a3-413f-ac67-74f84655b737','351515fb-7a01-42f5-ac3c-591c3f743cf0',
   'a1eabec4-e98e-480d-a5de-43bfd05cb4f4','e2e83dc0-a18b-4576-8d91-c2f33cc7b461',
   'bbe44eff-6737-493c-816d-c973796f58ce','eedb1287-0b97-4327-8c6e-16aa42d02c63',
   '0713644b-ddfc-4ebe-b8a4-0a4eb31f0503','1c51d2ad-7208-4fc2-a321-95bfea248b98',
   '5aaa384d-908f-4ee9-88ef-511739ad929f','48152123-2ff8-412c-a327-aa61f88ef7f0',
   '367943bc-9d5e-4fb1-b5f5-b2f85a8ed95a','b1573b30-b805-4e54-abb4-0628071405b0'
 );
