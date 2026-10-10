-- Lote manual (#142, 10/10): o link colado pelo cliente é procurado no acervo por url_lote antes de
-- criar lote MANUAL — o teste do dono colou um lote da MILAN que já estava na base. Sem índice, a
-- busca varre 80 mil linhas (262 MB) a cada clique em "Liberar análise".
create index if not exists idx_imoveis_leilao_url_lote on public.imoveis_leilao (url_lote);
