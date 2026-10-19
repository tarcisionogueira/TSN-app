-- herdar_foto_da_caixa (limpar-fotos-orfas-cron, 04h20 UTC) estourou os 8 s em 19/10: varria os 29 mil ativos pelo
-- heap para achar ~1.400 sem foto. Índice parcial minúsculo: 1,7 s → 0,66 s (o resto é a regex de numero_imovel_caixa).
create index concurrently if not exists idx_imoveis_ativo_sem_foto
  on public.imoveis_leilao (fonte) where ativo and coalesce(link_foto, '') = '';
