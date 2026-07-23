-- BACKUP EXTERNO (Cloudflare R2) — manifesto do que é IRRECUPERÁVEL.
--
-- O backup diário do Supabase Pro cobre o BANCO (7 dias, mesma região), mas NÃO cobre o
-- Storage (arquivos). Para DR "em locais distintos", copiamos para o R2 apenas o que NÃO
-- dá para recapturar: uploads do próprio usuário (matrícula manual, KYC, contrato, compro-
-- vantes). Tudo que é `_auto` (matrícula/edital/anexo raspado dos leiloeiros) é recuperável
-- pela própria captura — fica de fora (14 GB que não precisam sair da plataforma).
--
-- Esta função (service-role) devolve o manifesto dos objetos irrecuperáveis para o cron
-- api/backup-r2-cron.js iterar. Convenção do projeto: SECURITY DEFINER + revoke amplo.
create or replace function public.backup_manifesto_irrecuperaveis()
returns table (bucket text, name text, tamanho bigint, atualizado_em timestamptz)
language sql
security definer
set search_path = public, storage
as $$
  select o.bucket_id::text,
         o.name::text,
         nullif(o.metadata->>'size','')::bigint,
         o.updated_at
  from storage.objects o
  where o.bucket_id in ('documentos','arrematacoes','comprovantes')
    and o.name not ilike '%\_auto%'   -- exclui os raspados (recuperáveis)
  order by o.updated_at desc nulls last
$$;

revoke all on function public.backup_manifesto_irrecuperaveis() from public, anon, authenticated;
