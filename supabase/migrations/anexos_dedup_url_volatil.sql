-- Deduplicação de imoveis_leilao.anexos por ARQUIVO (URL canônica) — bug "7x Edital" (30/07).
-- Causa: CDNs de leiloeiro servem o MESMO documento com querystring VOLÁTIL (cache-buster
-- ?v= no Grupo Lance, assinatura ?Expires/&Signature na ZUK, regeneradas a cada visita) e a
-- união de anexos do scrape diário comparava a URL COMPLETA → +1 "Edital" idêntico por
-- rodada (311 lotes GRUPOLANCE, 192 ZUK, 6 SUPERBID). O código foi corrigido para chave
-- canônica (api/_doc-scan.js: chaveDocCanonica); este backfill limpa o acúmulo existente.
-- Regras (espelham o código):
--   * entrada sem URL http(s) (ex.: javascript:_gt() sai;
--   * &amp; não-decodificado vira & (o link assinado volta a abrir);
--   * chave canônica: path com extensão de documento → host+path (querystring toda fora);
--     senão, a URL inteira em minúsculas (query significativa tipo /download?id=1 preservada);
--   * mantém a PRIMEIRA ocorrência de cada chave (a união grava os mais novos primeiro —
--     assinatura mais recente = link vivo; as antigas estão expiradas).
-- Idempotente: rodar de novo não altera nada.

with alvo as (
  select id, anexos
  from imoveis_leilao
  where jsonb_typeof(anexos) = 'array' and jsonb_array_length(anexos) > 0
),
novo as (
  select a.id,
         (select coalesce(jsonb_agg(el order by ord), '[]'::jsonb)
          from (
            select distinct on (chave) el, ord
            from (
              select
                jsonb_set(value, '{url}', to_jsonb(replace(value->>'url', '&amp;', '&'))) as el,
                ordinality as ord,
                replace(value->>'url', '&amp;', '&') as u
              from jsonb_array_elements(a.anexos) with ordinality
              where value->>'url' is not null
            ) raw,
            lateral (
              select case
                when split_part(u, '?', 1) ~* '\.(pdf|docx?|xlsx?|odt|rtf)$'
                  then lower(split_part(u, '?', 1))
                else lower(u)
              end as chave
            ) c
            where u ~* '^https?://'
            order by chave, ord
          ) d
         ) as anexos_novos
  from alvo a
)
update imoveis_leilao i
set anexos = n.anexos_novos
from novo n
where i.id = n.id
  and n.anexos_novos is distinct from i.anexos;
