-- 23/09 — Decisão do dono: herança de pátio por leilão exige ≥2 lotes lidos confirmando.
-- Os 18 veículos LJUD que herdaram com 1 lote lido voltam a 'indefinido' (a próxima coleta
-- recalcula; a herança não é mais preservada entre rodadas — ver salvarVeiculos).
update veiculos_leilao set status_patio = 'indefinido',
  status_patio_motivo = 'sem sinal textual claro nos dois sentidos — não exibir por padrão'
where fonte = 'LJUD' and status_patio = 'confirmado' and status_patio_motivo like 'leilão de pátio: 1 lote(s)%';
