-- Ficha técnica da Caixa (campos extras da página de detalhe do imóvel):
-- ocupação, áreas (privativa/total/terreno/construída), matrícula, inscrição
-- imobiliária, comarca, ofício, aceite de FGTS/consórcio/financiamento e de
-- quem é a responsabilidade das despesas (IPTU/condomínio/tributos).
-- Preenchida pelo cron enriquecer-datas-cef (mesma visita que captura a data —
-- custo zero) e exibida na tela do imóvel.
alter table imoveis_leilao add column if not exists ficha_cef jsonb;
