-- Achado 12/09 (bug bounty via clique real na campanha do ebook R$1): a página pública
-- do produto (/#/p/ebook/:id) quebrava para QUALQUER visitante NÃO LOGADO — não só na
-- campanha nova, em qualquer link (SEO, WhatsApp, indicação). A RLS já tinha a política
-- "Leitura publica ebooks"/"Leitura publica aulas" (qual = true, liberando a leitura),
-- mas RLS só filtra LINHAS de uma consulta que já passou pelo GRANT — sem o GRANT SELECT
-- de base, a política nunca chega a ser avaliada e o PostgREST recusa a consulta inteira.
-- `cursos_admin` tinha o GRANT correto; `ebooks_admin`/`aulas_admin` não tinham.
--
-- Auditoria (12/09): de todas as tabelas com política "leitura pública" (qual=true, role
-- public), só estas duas estavam sem o GRANT — as demais (cursos_admin, licoes, modulos,
-- planos_config, imoveis_leilao, veiculos_leilao, etc.) já estavam corretas.
grant select on public.ebooks_admin to anon;
grant select on public.aulas_admin to anon;
