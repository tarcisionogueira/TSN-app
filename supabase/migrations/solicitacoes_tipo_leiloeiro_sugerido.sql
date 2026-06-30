-- Estende os tipos válidos de `solicitacoes`.
-- A constraint original só permitia os 3 tipos das avaliações pagas
-- (mercadologica/edital/processual). Porém o workflow de /analise já insere
-- 'consulta' (pedido de revisão pelo analista) e 'juridico' (encaminhamento),
-- que vinham sendo REJEITADOS silenciosamente pela constraint (try/catch).
-- Aqui regularizamos esses tipos e adicionamos 'leiloeiro_sugerido': o cliente
-- pede análise de um imóvel cujo leiloeiro ainda não está integrado, e a equipe
-- é notificada para avaliar a integração.
ALTER TABLE public.solicitacoes DROP CONSTRAINT IF EXISTS solicitacoes_tipo_check;
ALTER TABLE public.solicitacoes ADD CONSTRAINT solicitacoes_tipo_check
  CHECK (tipo = ANY (ARRAY[
    'mercadologica'::text,
    'edital'::text,
    'processual'::text,
    'consulta'::text,
    'juridico'::text,
    'leiloeiro_sugerido'::text
  ]));
