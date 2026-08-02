-- O manifesto classificava por "não tem _auto no nome" — e a captura GENÉRICA
-- (scripts/captura-documentos.mjs) grava `casos/<imovel>/<tipo>_<hash>.pdf`, SEM o marcador
-- que os outros 4 scripts de captura usam. Resultado: 3.614 arquivos recapturáveis (5,5 GB)
-- entraram na lista de "irrecuperáveis". O backup foi desenhado para ~33 arquivos / 11 MB e
-- passou a mirar 5,5 GB — não cabe nos 120s do cron; ativá-lo assim daria timeout todo dia.
--
-- Classificar pelo NOME é frágil, mas aqui o nome carrega a origem de forma confiável e sem
-- renomear nada (renomear re-subiria 5,5 GB por causa do dedup por storage_path):
--   • upload de humano  → `casos/<imovel>/<epoch13>_<nome>`       (api/upload-anexo.js)
--   • parecer jurídico  → `casos/<imovel>/parecer_<epoch>_<nome>` (api/inbound-juridico.js)
--   • captura automática→ `casos/<imovel>/<tipo>_<hash16>.pdf`    (recapturável — FICA DE FORA)
--   • fora de casos/    → pj/, contratos-docs/, comprovantes/, ebooks/ (tudo humano)
-- Conferido contra o acervo real: 45 arquivos / 15 MB irrecuperáveis × 5.569 MB recapturáveis.
create or replace function public.backup_manifesto_irrecuperaveis()
returns table(bucket text, name text, tamanho bigint, atualizado_em timestamp with time zone)
language sql
security definer
set search_path to 'public', 'storage'
as $function$
  select o.bucket_id::text,
         o.name::text,
         nullif(o.metadata->>'size','')::bigint,
         o.updated_at
  from storage.objects o
  where o.bucket_id in ('documentos','arrematacoes','comprovantes')
    and o.name not ilike '%\_auto%'
    and (
      o.name !~ '^casos/'          -- pastas de material humano (pj, contratos, comprovantes)
      or o.name ~ '/[0-9]{13}_'    -- upload feito por pessoa (carimbo epoch no nome)
      or o.name ~ '/parecer_'      -- parecer jurídico recebido por e-mail
    )
  order by o.updated_at desc nulls last
$function$;

comment on function public.backup_manifesto_irrecuperaveis() is
  'Lista o que o backup off-region deve espelhar: SO o irrecuperavel (upload humano, parecer juridico, docs de contrato/PJ/comprovante). Documento capturado de leiloeiro fica de fora — a propria captura refaz.';
