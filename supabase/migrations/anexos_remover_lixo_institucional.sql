-- Remove anexos INSTITUCIONAIS do site do leiloeiro gravados como documento do LOTE
-- (Política de Privacidade / avisos de cookies-privacidade / termos de uso do site /
-- política de segurança da informação / PDF de consentimento "disclaimer" do adopt).
-- Achado do dono em 01/08 no lote MEGA de Bertioga; varredura: 6.698 entradas em
-- 2.340 imóveis. O classificador (RE_DOC_INSTITUCIONAL em api/_doc-scan.js) foi
-- estendido na mesma data — esta migração limpa o acervo já contaminado. Idempotente.
-- APLICADA em produção em 01/08/2026 (varredura pós = 0 entradas restantes).
with alvo as (
  select id,
    coalesce(jsonb_agg(a order by ord) filter (where not lixo), '[]'::jsonb) as novos,
    count(*) filter (where lixo) as removidos
  from (
    select i.id, t.a, t.ord,
      (t.a->>'nome' ~* 'pol[ií]tica|privacidade|cookie|termos de uso|seguranca da informacao|seguran[çc]a da informa[çc][ãa]o'
       or t.a->>'url' ~* 'politica[_-]?de[_-]?privacidade|privacidade|cookie|termos[_-]?de[_-]?uso|seguranca[_-]?da[_-]?informacao|/disclaimer/') as lixo
    from public.imoveis_leilao i, jsonb_array_elements(i.anexos) with ordinality t(a, ord)
    where jsonb_typeof(i.anexos) = 'array'
  ) x group by id
)
update public.imoveis_leilao i set anexos = alvo.novos
from alvo where alvo.id = i.id and alvo.removidos > 0;
