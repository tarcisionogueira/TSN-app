-- 11/09: PILOTO — "leilão de veículos", pedido do dono para testar no painel Operacional antes
-- de decidir se entra nos filtros públicos de busca. Tabela SEPARADA de imoveis_leilao (não
-- reaproveita o schema imóvel-específico — m², matrícula, IPTU não fazem sentido para veículo,
-- e o trigger trg_imovel_bem_movel já existe justamente para EXCLUIR bem móvel do acervo de
-- imóveis; misturar os dois teria sido reintroduzir, num campo, o que aquele trigger bloqueia).
--
-- FONTE PILOTO: Sodré Santoro (fonte já integrada para imóveis em scripts/scraper-puppeteer.mjs
-- via /api/search-lots — mesmo mecanismo, só troca o segmento 'imoveis' por 'veiculos'). Escolha
-- deliberada: é o único leiloeiro já no acervo cujo próprio negócio histórico é veículo (bens
-- recuperados por instituição financeira/seguradora, já em pátio para leilão) — não abre uma
-- fonte nova nem-nunca-testada, e não exige recon de site novo.
--
-- CRITÉRIO "não tomar de executado" (pedido explícito do dono): o classificador de pátio é
-- CONSERVADOR por desenho — só marca 'confirmado' com sinal textual explícito de que o bem já
-- está recolhido/disponível (pátio, comitente financeira, já retirado). Qualquer coisa que cite
-- busca e apreensão pendente, "não localizado" ou posse do executado marca 'excluido'. Ausência
-- de sinal claro nos dois sentidos fica 'indefinido' e NÃO deve ser exibida por padrão — o efeito
-- de um falso "confirmado" (oferecer ao cliente um bem que na prática ainda depende de apreender
-- do devedor) é o que o dono pediu para evitar, então o padrão é pender para fora, não para dentro.
create table if not exists public.veiculos_leilao (
  id uuid primary key default gen_random_uuid(),
  fonte text not null,
  fonte_id text,
  leiloeiro text,
  titulo text,
  descricao text,
  marca text,
  modelo text,
  ano_fabricacao int,
  ano_modelo int,
  placa text,
  km numeric,
  valor_minimo numeric,
  valor_avaliacao numeric,
  cidade text,
  estado text,
  link_lote text,
  fotos jsonb default '[]'::jsonb,
  data_leilao timestamptz,
  status_patio text not null default 'indefinido' check (status_patio in ('confirmado','indefinido','excluido')),
  status_patio_motivo text,
  ativo boolean not null default true,
  raw jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create unique index if not exists veiculos_leilao_fonte_id_unico
  on public.veiculos_leilao (fonte, fonte_id) where fonte_id is not null;
create index if not exists veiculos_leilao_ativo_idx on public.veiculos_leilao (ativo) where ativo;
create index if not exists veiculos_leilao_status_patio_idx on public.veiculos_leilao (status_patio);

alter table public.veiculos_leilao enable row level security;

-- Mesmo padrão de imoveis_leilao: leitura pública (é dado de vitrine, sem PII), escrita só
-- pelo service_role (coletores).
create policy "Leitura pública veiculos_leilao" on public.veiculos_leilao
  for select using (true);
create policy "Service role gerencia veiculos_leilao" on public.veiculos_leilao
  for all using ((select auth.role()) = 'service_role');
-- atualizado_em é gravado pelo próprio upsert do coletor (mesma convenção de imoveis_leilao,
-- que também não tem trigger de touch) — não pelo tipo genérico fn_set_updated_at (esse
-- escreve em `updated_at`, coluna que esta tabela não tem).
