-- Resultado REAL do leilão de VEÍCULO (21/09, pedido do dono: "tanto para veículos como para
-- imóveis é trazer os lotes que não tiveram lance ou que não foi vendido"). Até aqui o filtro
-- "Leilão negativo" em BuscaVeiculos.jsx era só INFERÊNCIA por data (data_leilao no passado +
-- ainda ativo = presume sem comprador) — a mesma limitação que api/propor-veiculo-leiloeiro.js
-- já documentava desde 17/09 ("nenhuma fonte informa o resultado"). Em 20/09 isso foi resolvido
-- para IMÓVEIS com apuração real por lote (ver resultado_leilao_apurado.sql); esta migration
-- espelha as mesmas colunas em veiculos_leilao para a MESMA apuração cobrir os dois acervos.
alter table public.veiculos_leilao
  add column if not exists resultado_leilao text check (resultado_leilao in ('vendido','sem_lance','indeterminado')),
  add column if not exists valor_lance_vencedor numeric,
  add column if not exists resultado_apurado_em timestamptz,
  add column if not exists resultado_apuracao_tentativas int not null default 0;

comment on column public.veiculos_leilao.resultado_leilao is 'Apurado 1x/dia revisitando a página do lote após o leilão encerrar (api/apurar-resultado-leilao-cron.js). NULL = ainda não apurado. "indeterminado" = apurado mas a página não deu sinal confiável (distinto de NULL).';
comment on column public.veiculos_leilao.valor_lance_vencedor is 'Só quando resultado_leilao=vendido E a página publica o valor.';

create index if not exists idx_veiculos_leilao_apuracao_pendente
  on public.veiculos_leilao (data_leilao) where resultado_leilao is null;
