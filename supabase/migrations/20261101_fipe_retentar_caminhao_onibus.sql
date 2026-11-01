-- 01/11: casamento FIPE de modelo numérico corrigido em api/_fipe.js; caminhões e ônibus sem FIPE voltam a ser tentados
-- já na próxima abertura (sem esperar os 3 dias de RETENTAR_SEM_MATCH_DIAS). APLICADA.
update public.veiculos_leilao set fipe_atualizado_em = null
 where ativo and tipo_veiculo in ('caminhao', 'onibus') and valor_fipe is null and fipe_status in ('sem_match', 'sem_dados');
