-- Raio de 250m no Índice (pedido do dono): a base REAL da composição (indice_amostra) só tinha
-- bairro_norm + geo_grid (~1km). Para classificar a ~250m (rua/condomínio) na origem, cada amostra
-- passa a guardar a coordenada do imóvel-alvo do relatório (os comparáveis são vizinhos por
-- construção). Aditivo e nulo p/ o legado → sem regressão; o 250m entra conforme novas amostras.
-- Consumido por api/indice-consulta.js (recorte por raio) e gravado por api/gerar-analise.js.
alter table public.indice_amostra add column if not exists lat double precision;
alter table public.indice_amostra add column if not exists lng double precision;
create index if not exists idx_indice_amostra_geo on public.indice_amostra (cidade_norm, uf, tipo) where lat is not null and lng is not null;
