-- 09/11: SOLEON e PW deixavam ~1.000 lotes listados sem ler (teto de novos por rodada + gate de 72 h).
-- Com o teto maior no runner-residencial.sh, a rodada diária fecha o buraco em poucos dias. Custo zero (IP residencial).
update coleta_cliente set intervalo_horas = 24 where fonte in ('SOLEON', 'PW') and intervalo_horas = 72;
