-- Bug bounty 03/09 (P0): as policies de INSERT/UPDATE do bucket público 'imoveis-fotos'
-- diziam no comentário/nome "apenas service_role (scraper)", mas nenhuma tinha a cláusula
-- `TO service_role` — sem ela o Postgres cria a policy para `public`, ou seja, QUALQUER
-- visitante não-logado (com a anon key pública do site) podia enviar ou SOBRESCREVER
-- fotos (até 5MB, mimetypes de imagem) no bucket que serve fotos de imóveis para todo
-- mundo. O backend de scraping sempre grava via service_role (que ignora RLS de qualquer
-- forma), então essas policies nunca habilitaram nenhum fluxo legítimo — só abuso
-- (defacement/armazenamento). Havia também um INSERT duplicado ("fotos insert service"),
-- igualmente aberto a public. A policy de SELECT (leitura pública das fotos) é intencional
-- e correta — não é tocada aqui.
drop policy if exists "Fotos imoveis update service role" on storage.objects;
drop policy if exists "Fotos imoveis upload service role" on storage.objects;
drop policy if exists "fotos insert service" on storage.objects;

create policy "imoveis_fotos_insert_service_role"
on storage.objects for insert to service_role
with check (bucket_id = 'imoveis-fotos');

create policy "imoveis_fotos_update_service_role"
on storage.objects for update to service_role
using (bucket_id = 'imoveis-fotos');
