-- 15/11 (#461) — HASTA: dois motorhomes ("RENAULT/MARIMAR MCA06.CH (MOTOR CASA)", leilão de bens do Governo da Bahia)
-- estavam ATIVOS como tipo casa — o "CASA" casava no detector de imóvel. Detector corrigido em
-- scripts/lib/dom-parse-util.mjs (teste scripts/testes/nao-imovel-motor-casa.mjs); aqui, os dois já gravados saem.
update public.imoveis_leilao set ativo = false, suprimido_motivo = 'nao_imovel'
 where fonte = 'HASTA' and ativo and fonte_id in ('hasta_12301', 'hasta_12408')
   and titulo ~* 'motor[\s-]?casa';
