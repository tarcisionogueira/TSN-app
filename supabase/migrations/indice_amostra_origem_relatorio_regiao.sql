-- Permite a origem 'relatorio_regiao' (colheita oportunista de OUTRAS tipologias na MESMA
-- busca do mercadológico — semeia o Índice dos outros segmentos no nível cidade, sem leilão).
-- Uma busca paga passa a semear vários segmentos; a origem distinta permite auditar o ganho
-- (select origem, count(*) from indice_amostra group by origem). Mantém as origens existentes.
-- Idempotente.
alter table public.indice_amostra drop constraint if exists indice_amostra_origem_check;
alter table public.indice_amostra add constraint indice_amostra_origem_check
  check (origem = any (array['relatorio', 'revenda', 'portal', 'imobiliaria', 'relatorio_regiao']));
