-- Bug bounty 03/09 (P0): bucket privado 'arrematacoes' (documentos/comprovantes de
-- arremate) tinha as policies 'arrematacoes_read'/'arrematacoes_upload' só checando
-- `bucket_id = 'arrematacoes'` — sem NENHUMA cláusula ligando o path do objeto
-- (arrematacao_id/tipo/nome, ver api/arrematacoes.js:135-136) ao dono (auth.uid()) ou à
-- equipe. Qualquer usuário autenticado (inclusive plano gratuito) podia listar e baixar
-- ou sobrescrever documentos de QUALQUER outro cliente via Storage REST/SDK direto,
-- contornando toda a checagem de dono do endpoint. Mesma classe de bug já corrigida no
-- bucket irmão 'documentos' (documentos_bucket_escopo_dono_equipe.sql) — essas duas
-- policies nunca passaram por migração no repo (só existiam no banco), então nenhuma
-- varredura de código as via.
drop policy if exists "arrematacoes_read" on storage.objects;
drop policy if exists "arrematacoes_upload" on storage.objects;

create policy "arrematacoes_select_dono_ou_equipe"
on storage.objects for select to authenticated
using (
  bucket_id = 'arrematacoes'
  and (
    exists (
      select 1 from public.perfis p
      where p.id = (select auth.uid())
        and p.role in ('admin','analista','advogado','consultor')
    )
    or exists (
      select 1 from public.arrematacoes a
      where a.id::text = split_part(storage.objects.name, '/', 1)
        and a.arrematante_id = (select auth.uid())
    )
  )
);

create policy "arrematacoes_insert_dono_ou_equipe"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'arrematacoes'
  and (
    exists (
      select 1 from public.perfis p
      where p.id = (select auth.uid())
        and p.role in ('admin','analista','advogado','consultor')
    )
    or exists (
      select 1 from public.arrematacoes a
      where a.id::text = split_part(storage.objects.name, '/', 1)
        and a.arrematante_id = (select auth.uid())
    )
  )
);
