-- 15/11 — ERRO DA UNIFICAÇÃO, CORRIGIDO. A migração 20261115_indice_corpus_unico copiou da tabela antiga
-- (indice_amostras) as 13 linhas "sem espelho" — e elas eram exatamente as amostras de Capão da Canoa que o dono
-- mandou apagar mais cedo (apagadas só da singular): 12 anúncios inexistentes (Zap/VivaReal com IDs sequenciais,
-- Casa Linda genérica, OLX, Rei do Imóvel) e o próprio lote em leilão do BidHero (7.512/m², 33,28 m², que voltou sem
-- link porque o redirecionador expirado foi descartado na cópia). Nenhuma outra cidade estava entre as 13.
-- Mesmo conteúdo já autorizado pelo dono (#483). A tabela antiga não é mais lida por nada (corpus único).
delete from public.indice_amostra
 where cidade_norm = 'capaodacanoa' and origem = 'portal'
   and id in ('990be62d-5e9c-44ba-b342-e907e3be4abe','ba8bb1d7-c752-4a13-9632-bd448cc676fd','430a5ce8-b1f8-4f0a-af79-cfc8fc99c8b9',
              'e4a8dd8f-4eaf-491f-a2d2-6a0a5688c66a','4792e94c-83c4-4b79-ae4e-0dfb3854a11c','d653c58c-4fa3-47b8-9b4d-dd854f85922f',
              '922dba39-44ae-49d8-872f-b287c6866cb6','118723e1-60e1-41ed-8ba1-cad4ecaadf47','bde321a8-6e66-4d7d-a7b2-31492e7e5f39',
              '02cd0cc8-e24b-42b4-b592-8c564b11dadb','fb577663-4de8-496e-903b-8f1bb868e324','34cd1d49-2215-426a-8113-7a02b3e7b3aa',
              '6b16b494-66a9-4efe-8f99-0f710ee4da45');
