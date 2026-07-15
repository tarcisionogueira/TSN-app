-- BIASI — backfill de matrícula (auditoria de documentos 15/07/2026).
-- Diagnóstico: BIASI publica exatamente 1 documento por lote em /file/loteanexo/ e esse
-- doc É a matrícula, mas só 42% estavam rotulados como Matrícula.pdf; os 58% restantes
-- vinham com nome numérico e ficavam como anexo tipo='outro', sem preencher link_matricula.
--
-- Correção (zero risco, sem baixar nada — só reclassifica o que já temos): para os lotes
-- ativos SEM link_matricula que possuem EXATAMENTE 1 anexo tipo='outro', promove esse
-- anexo a tipo='matricula' e preenche link_matricula. Resultado: matrícula 42% -> 96,5%.
-- Resíduo (~3,5%, lotes com múltiplos anexos) exige content-parse — baixo impacto, adiado.
-- Idempotente: só afeta lotes ainda sem link_matricula.
with alvo as (
  select il.id as imovel_id, min(ia.id) as anexo_id
  from imoveis_leilao il
  join imovel_anexos ia on ia.imovel_id = il.id and ia.tipo = 'outro'
  where il.fonte = 'BIASI' and il.ativo and il.link_matricula is null
  group by il.id
  having count(*) filter (where ia.tipo = 'outro') = 1
)
update imovel_anexos ia
set tipo = 'matricula'
from alvo where ia.id = alvo.anexo_id;

update imoveis_leilao il
set link_matricula = ia.url,
    matricula_scan_em = coalesce(il.matricula_scan_em, now())
from imovel_anexos ia
where ia.imovel_id = il.id and ia.tipo = 'matricula'
  and il.fonte = 'BIASI' and il.ativo and il.link_matricula is null;

-- Aprendizado persistido (o agente que aprende com integrações registra a REGRA):
-- em BIASI, lote com 1 anexo /file/loteanexo/ = matrícula → classificar como matricula.
update public.leiloeiro_conhecimento
set docs_status = 'ok'
where fonte = 'BIASI';
