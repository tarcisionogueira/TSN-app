-- 31/10 (#372, conferência dos leiloeiros integrados): dois defeitos de classificação nos parsers DOM.
-- (1) `inferirTipo` (leilaopro-parse) lia título + URL INTEIRA — o domínio "casa…" fazia todo lote virar "casa":
--     CASAFORTELEIL (complexo industrial de R$ 21,7 mi em Canela) e CASADELEILOES (2 terrenos no MS).
-- (2) leilovia-parse: "Endereço para visitação: GALPÃO" num "LEILÃO DE BENS DIVERSOS" virava tipo Galpão — fogão
--     industrial, ferragem de barraca e caixas de som entraram como imóvel.
-- Os parsers foram corrigidos; aqui, o que já estava gravado (mesmos valores que a releitura daria).
update public.imoveis_leilao set tipo = 'comercial'
 where fonte_id = 'casaforteleil_171' and tipo = 'casa';
update public.imoveis_leilao set tipo = 'terreno'
 where fonte_id in ('casadeleiloes_66809', 'casadeleiloes_66967') and tipo = 'casa';
update public.imoveis_leilao set ativo = false, suprimido_motivo = 'nao_imovel'
 where fonte_id in ('casadeleiloes_67217', 'casadeleiloes_67248', 'casadeleiloes_67222') and ativo;
