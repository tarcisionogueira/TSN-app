-- Escala: havia DUAS políticas de leitura pública IDÊNTICAS (using true) em imoveis_leilao.
-- O Postgres avalia TODAS as policies permissivas por linha em cada busca — com 33k linhas
-- e milhares de buscas simultâneas, é avaliação duplicada à toa. Remove a duplicata; a
-- leitura pública continua pela outra ("Leitura pública imoveis_leilao").
drop policy if exists "Leitura publica de imoveis" on public.imoveis_leilao;
