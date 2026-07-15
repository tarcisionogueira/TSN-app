-- ZUK — negative-cache da matrícula (auditoria de documentos 15/07/2026).
-- Diagnóstico: o edital do ZUK é público (100%), mas a matrícula é login-gated. O pipeline
-- captura-matricula-zuk.mjs lia os pendentes SEM order by/offset, então reprocessava sempre
-- a CABEÇA da lista — os lotes que não têm matrícula na fonte poluíam o lote de 20 e a CAUDA
-- (matrículas realmente disponíveis) nunca era alcançada. Coverage travado em ~62,9%.
--
-- Correção (grátis): coluna de negative-cache. O script passa a:
--   - ORDER BY matricula_checada_em NULLS FIRST (nunca-checados primeiro) + id;
--   - marcar matricula_checada_em=now() quando a fonte não tem matrícula (cooldown 14d);
--   - lote 20 -> 50.
-- Assim cada rodada avança para a cauda; o resíduo é login-gated sem matrícula publicada
-- (lacuna ESPERADA). Bright Data não resolve login-gated.
alter table public.imoveis_leilao add column if not exists matricula_checada_em timestamptz;
comment on column public.imoveis_leilao.matricula_checada_em is
  'Negative-cache: última vez que checamos e a MATRÍCULA não estava disponível na fonte. Permite pular o lote por um cooldown e alcançar a CAUDA da fila (ex.: ZUK login-gated), sem reprocessar sempre a cabeça.';

update public.leiloeiro_conhecimento set docs_status='ok' where fonte='ZUK';
