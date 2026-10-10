-- 10/10 (#154, correção de dado, já aplicada): lotes FERREIRALEIL sem data que são venda direta da PGFN
-- (Comprei) viram 'venda_direta' — a regra nova do scraper-soleon.mjs aplicada ao que já estava no banco.
-- Os que são o MESMO bem da fonte COMPREI (matrícula + UF) saem como 'duplicata_comprei'.
update imoveis_leilao set modalidade = 'venda_direta'
 where fonte = 'FERREIRALEIL' and ativo and data_leilao is null
   and descricao ~* 'comprei|pgfn|aliena[çc][ãa]o\s+por\s+iniciativa\s+particular';
update imoveis_leilao f set ativo = false, suprimido_motivo = 'duplicata_comprei'
 where f.fonte = 'FERREIRALEIL' and f.ativo and f.modalidade = 'venda_direta' and f.numero_matricula is not null
   and exists (select 1 from imoveis_leilao c where c.fonte = 'COMPREI' and c.ativo and c.estado = f.estado
                 and regexp_replace(c.numero_matricula, '\D', '', 'g') = regexp_replace(f.numero_matricula, '\D', '', 'g'));
