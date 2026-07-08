-- Corrige imóveis da Caixa (CEF) gravados como 'judicial' por uma versão antiga do
-- scraper. Caixa NÃO é judicial: os leilões são SFI/alienação fiduciária (Lei 9.514)
-- = EXTRAJUDICIAL. O scraper atual (api/scraper-caixa.js, normalizarModalidade) já
-- mapeia qualquer 'judicial'/'SFI'/'edital único' da Caixa para 'extrajudicial';
-- esta migração acerta os ~5.000 registros históricos. Idempotente.
update public.imoveis_leilao
set modalidade = 'extrajudicial'
where fonte in ('CEF', 'caixa') and modalidade = 'judicial';
