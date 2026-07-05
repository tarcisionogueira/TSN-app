-- Situação de ocupação do imóvel (Ocupado/Desocupado) capturada direto do leiloeiro
-- quando disponível (ex.: Frazão, na página de detalhe do lote). Coluna própria
-- para não conflitar com ficha_cef/ficha_juridica; exibida na tela do imóvel.
alter table imoveis_leilao add column if not exists ocupacao text;
