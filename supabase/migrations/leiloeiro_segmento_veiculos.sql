-- Recon de "este leiloeiro vende veículo?" (11/09) — pedido do dono: expandir o piloto de
-- veículos (hoje só Sodré) para TODOS os leiloeiros de acesso gratuito. Construir um scraper
-- por site sem saber se o site TEM segmento de veículos seria repetir o erro que o CLAUDE.md já
-- cataloga (inventar estrutura sem checar dado real). Em vez disso, o mesmo fetch que já busca
-- o e-mail de contato (scripts/_contato-leiloeiro.mjs) agora TAMBÉM procura, na home já
-- carregada, um link de menu para "veículos/carros/automóveis" — sem custo de rede extra. Só
-- depois de ver aqui QUEM realmente tem o segmento é que vale escrever o scraper daquela fonte.
create table if not exists public.leiloeiro_segmento_veiculos (
  fonte         text primary key,
  tem_sinal     boolean not null,       -- achou link de menu com cara de "veículos/carros"
  url_segmento  text,                   -- href do link encontrado (absoluto)
  texto_sinal   text,                   -- o texto do link/âncora (ex.: "Veículos", "Carros e Motos")
  atualizado_em timestamptz not null default now()
);
alter table public.leiloeiro_segmento_veiculos enable row level security;
drop policy if exists "service_only_leiloeiro_segmento_veiculos" on public.leiloeiro_segmento_veiculos;
create policy "service_only_leiloeiro_segmento_veiculos" on public.leiloeiro_segmento_veiculos for all using (false);
