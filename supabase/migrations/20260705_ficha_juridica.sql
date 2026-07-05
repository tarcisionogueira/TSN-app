-- Resumo do RAIO-X JURÍDICO (Fase 1) por imóvel, para a TELA DO IMÓVEL exibir
-- selos e campos (fraude à execução, direito de preferência, ocupação detalhada,
-- débitos assumidos, cronograma do leilão, nº de proprietários na cadeia dominial,
-- certidões pendentes) sem reabrir o laudo. Preenchido pelo agente documental.
alter table imoveis_leilao add column if not exists ficha_juridica jsonb;
