-- Achado ao vivo, 21/09 (print do dono: lote SODRE mostrando VENDIDO que apuramos errado —
-- investigação seguinte achou que o scraper de veículos SUPORTE nunca capturava marca/modelo
-- confiável, e a página de detalhe do lote (Rodrigo Collyer) expõe chassi/RENAVAM/placa/cor
-- num bloco "Descrição" estruturado: "...placa HKP6077, chassi 93XJRKB8T9C808991, RENAVAM
-- 00121309878...". `placa` e `cor` já tinham coluna; `chassi`/`renavam` nunca existiram.
alter table public.veiculos_leilao add column if not exists chassi text;
alter table public.veiculos_leilao add column if not exists renavam text;
