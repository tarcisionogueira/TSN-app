-- Broken access control (PII/LGPD): a policy "documentos_select_autenticado" dava
-- SELECT (listar + baixar) do bucket privado `documentos` a QUALQUER usuário
-- autenticado — inclusive documentos de casos e comprovantes de OUTROS usuários. Um
-- cliente comum (até o gratuito) conseguia enumerar e baixar todos os 2.371 arquivos.
-- As fotos e docs de imóvel são servidos por URLs JÁ ASSINADAS gravadas no banco
-- (bypassam RLS), então restringir o SELECT NÃO quebra a visualização. Equipe
-- (admin/analista/advogado/consultor) mantém acesso total (usam telas de ONR/contratos
-- que assinam no client); o cliente comum passa a ver só os docs dos SEUS casos.
drop policy if exists "documentos_select_autenticado" on storage.objects;

create policy "documentos_select_dono_ou_equipe"
on storage.objects for select to authenticated
using (
  bucket_id = 'documentos'
  and (
    exists (
      select 1 from public.perfis p
      where p.id = (select auth.uid())
        and p.role in ('admin','analista','advogado','consultor')
    )
    or exists (
      select 1 from public.casos c
      where c.id::text = split_part(storage.objects.name, '/', 2)
        and c.cliente_id = (select auth.uid())
    )
  )
);
