-- Bucket PÚBLICO de capas da Área de Membros (ebooks/cursos): imagem PNG/JPG servida
-- direto por <img src> (capa não é sensível e é cacheável). Antes as capas eram links do
-- Google Drive, que bloqueia hotlink de imagem → capa em branco. Upload só por ADMIN.
insert into storage.buckets (id, name, public)
values ('membros-capas', 'membros-capas', true)
on conflict (id) do update set public = true;

-- Leitura pública das capas.
drop policy if exists "membros_capas_read" on storage.objects;
create policy "membros_capas_read" on storage.objects for select to public
  using (bucket_id = 'membros-capas');

-- Upload/edição/remoção só por ADMIN (perfis.role='admin').
drop policy if exists "membros_capas_admin_insert" on storage.objects;
create policy "membros_capas_admin_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'membros-capas' and exists (select 1 from public.perfis p where p.id = (select auth.uid()) and p.role = 'admin'));

drop policy if exists "membros_capas_admin_update" on storage.objects;
create policy "membros_capas_admin_update" on storage.objects for update to authenticated
  using (bucket_id = 'membros-capas' and exists (select 1 from public.perfis p where p.id = (select auth.uid()) and p.role = 'admin'));

drop policy if exists "membros_capas_admin_delete" on storage.objects;
create policy "membros_capas_admin_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'membros-capas' and exists (select 1 from public.perfis p where p.id = (select auth.uid()) and p.role = 'admin'));

-- Capa de imagem para CURSOS (ebooks_admin já tem capa_url; cursos usavam só emoji/cor).
alter table public.cursos_admin add column if not exists capa_url text;
