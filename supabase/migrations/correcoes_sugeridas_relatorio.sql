-- Item 2 (regerar-com-impacto): quando o DOCUMENTAL lê os documentos e encontra um dado que
-- CORRIGE o que o mercadológico usou (cidade, metragem, avaliação, endereço, etc.), NÃO regera
-- em silêncio — registra a correção + o IMPACTO aqui, e a tela oferece regerar ao usuário.
alter table public.analises_mercado
  add column if not exists correcoes_sugeridas jsonb;

-- índice parcial: a tela só precisa achar as análises COM correção pendente.
create index if not exists idx_analises_mercado_correcoes
  on public.analises_mercado ((correcoes_sugeridas is not null))
  where correcoes_sugeridas is not null;
