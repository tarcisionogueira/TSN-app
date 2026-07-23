-- Reclassifica anexos de matrícula gravados como tipo genérico 'anexo'.
--
-- CAUSA-RAIZ: o classificador (api/_doc-scan.js) só reconhecia "matr[ií]cul", então
-- deixava passar 3 formas comuns no rótulo cru do scraper e as marcava 'anexo':
--   1. ACENTUADA-QUEBRADA por charset (mojibake: UTF-8 lido como Latin-1) →
--      "matrãâ­cula" (com soft-hyphen U+00AD no meio) — padrão do SUPERBID;
--   2. SEM acento colada → "matrcula";
--   3. ABREVIADA → "matr-15964", "matr 129".
-- Consequência no laudo documental (api/gerar-documental.js): a matrícula caía com a
-- prioridade de 'anexo' (fim da fila de leitura, podendo sair do cap) e o GATE dizia
-- "matrícula faltando" mesmo com o PDF já no nosso acervo.
--
-- O código já foi corrigido (regex resiliente em _doc-scan.js e gerar-documental.js +
-- o 'anexo' genérico não ofusca mais o tipo inferido do nome). Esta migração faz o
-- BACKFILL do histórico. É IDEMPOTENTE: só toca elementos ainda tipados 'anexo'/vazio
-- cujo nome é matrícula, e NÃO reclassifica laudo/edital/proposta/regras/certidão que
-- apenas citam a matrícula (ex.: "LAUDO DE AVALIAÇÃO - MATRÍCULA 950").

with afetados as (
  select i.id
  from imoveis_leilao i
  where exists(
    select 1 from jsonb_array_elements(coalesce(i.anexos,'[]'::jsonb)) a
    where coalesce(a->>'tipo','anexo') in ('anexo','')
      and (a->>'nome' ~* 'matr[a-zà-ÿ­]{0,4}cula' or a->>'nome' ~* '(^|[^a-z])matr[ ._:­-]+[0-9]{2}')
      and a->>'nome' !~* 'laudo|avalia|edital|proposta|regras|certid'
  )
)
update imoveis_leilao i
set anexos = (
  select jsonb_agg(
    case when coalesce(a->>'tipo','anexo') in ('anexo','')
              and (a->>'nome' ~* 'matr[a-zà-ÿ­]{0,4}cula' or a->>'nome' ~* '(^|[^a-z])matr[ ._:­-]+[0-9]{2}')
              and a->>'nome' !~* 'laudo|avalia|edital|proposta|regras|certid'
         then a || '{"tipo":"matricula"}'::jsonb
         else a end
  )
  from jsonb_array_elements(i.anexos) a
)
from afetados
where i.id = afetados.id;
