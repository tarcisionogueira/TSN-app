-- ═══════════════════════════════════════════════════════════════════════════
-- DEMOGRAFIA + PRESSÃO HABITACIONAL POR CIDADE (base própria, como o Índice)
--
-- PEDIDO DO DONO: "déficit habitacional e crescimento demográfico de uma cidade — dá para
-- registrar e replicar no relatório mercadológico?". Dá — e MUDA decisão: cidade que cresce
-- com pouco imóvel vago tem demanda represada (liquidez de revenda, aluguel firme); cidade
-- estagnada com muito domicílio vago tem estoque ocioso (saída lenta, preço pressionado).
--
-- REGRA DE OURO DESTA ENTREGA (constraint explícito do dono): "atenção com a separação das
-- etapas para não cairmos no mesmo erro anterior de sobrecarregar o tempo de coleta". Por isso
-- o dado NÃO é pesquisado durante o relatório. Ele é INGERIDO por um cron diário separado
-- (/api/socio-ingestao-cron, uma fonte por execução) e o relatório apenas LÊ uma linha
-- indexada (socio_regiao). Custo de coleta no relatório: ZERO.
--
-- HONESTIDADE DO NÚMERO: cada campo carrega FONTE e ANO. O "déficit habitacional" oficial é
-- da FJP (metodologia própria: habitação precária + coabitação + ônus com aluguel +
-- adensamento) e NÃO sai de API — por isso ele tem colunas PRÓPRIAS (deficit_fjp_*), vazias
-- até que o dado oficial seja carregado. O que derivamos do Censo é chamado pelo que é:
-- PRESSÃO HABITACIONAL, com o método escrito no próprio registro. Nunca vendemos estimativa
-- nossa como número da FJP.
--
-- BAIRRO: a chave já contempla `bairro_norm` (o relatório lê bairro > cidade). A API do IBGE,
-- porém, só serve município (N6) — dado por bairro existe apenas em agregados de setores
-- censitários, que não vêm por API. Fase 1 entrega CIDADE; a estrutura está pronta para o dia
-- em que o recorte por bairro for viável, sem migração de esquema.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.cidade_socio (
  nivel        text not null default 'cidade',   -- 'cidade' | 'bairro'
  cidade_norm  text not null,
  uf           text not null,
  bairro_norm  text not null default '',
  ibge_codigo  text,

  -- ── CENSO (estrutural, decenal) ──
  populacao              integer,
  populacao_ano          smallint,
  populacao_ant          integer,     -- censo anterior, para a variação intercensitária
  populacao_ant_ano      smallint,
  crescimento_pct        numeric,     -- variação % entre os dois censos
  area_km2               numeric,
  densidade_hab_km2      numeric,
  domicilios             integer,
  domicilios_ano         smallint,
  domicilios_ocupados    integer,
  domicilios_vagos       integer,
  domicilios_vagos_pct   numeric,     -- derivado
  moradores_por_domicilio numeric,

  -- ── ESTIMATIVA ANUAL (conjuntural: é ela que mostra se a cidade cresce AGORA) ──
  pop_estim              integer,
  pop_estim_ano          smallint,
  pop_estim_ant          integer,
  pop_estim_ant_ano      smallint,
  crescimento_recente_aa_pct numeric, -- derivado: % ao ano entre as duas estimativas

  -- ── REGISTRO CIVIL (formação de novos domicílios) ──
  nascimentos            integer,
  nascimentos_ano        smallint,

  -- ── EMPREGO FORMAL (renda que sustenta preço; ver socio_fontes) ──
  empregos_saldo         integer,
  empregos_ref           text,        -- 'AAAA-MM' ou 'AAAA'

  -- ── DÉFICIT OFICIAL FJP — reservado, só entra com o dado real ──
  deficit_fjp            integer,
  deficit_fjp_pct        numeric,
  deficit_fjp_ano        smallint,

  -- ── LEITURA DERIVADA (método explícito, autocalibrado — ver socio_derivar) ──
  pressao_classe         text,        -- 'demanda_reprimida' | 'equilibrio' | 'estoque_ocioso'
  pressao_nota           text,        -- frase pronta, com os números e a régua usada
  pressao_metodo         text,

  atualizado_em timestamptz not null default now(),
  detalhe       jsonb,                -- bruto por fonte, para auditoria do número
  primary key (nivel, cidade_norm, uf, bairro_norm)
);

create index if not exists cidade_socio_cidade_idx on public.cidade_socio (cidade_norm, uf);
create index if not exists cidade_socio_ibge_idx   on public.cidade_socio (ibge_codigo);

alter table public.cidade_socio enable row level security;
drop policy if exists cidade_socio_leitura on public.cidade_socio;
create policy cidade_socio_leitura on public.cidade_socio
  for select to authenticated using (true);   -- referência pública, sem PII; escrita só service_role

comment on table public.cidade_socio is
  'Demografia e pressao habitacional por cidade (IBGE). Ingerida por cron separado; o relatorio so LE. Cada campo tem fonte e ano — o deficit oficial da FJP tem colunas proprias e nunca e confundido com a estimativa derivada.';


-- ── CONFIGURAÇÃO DAS FONTES (fica no BANCO, de propósito) ────────────────────
-- O ingestor NÃO tem ID de agregado nem nome de variável no código. Ele lê daqui. Se o IBGE
-- mudar um agregado, o conserto é um UPDATE — sem deploy, sem esperar sessão. Mesma autonomia
-- que o Índice tem hoje.
--   agregado  : id do agregado na API v3 do IBGE (/api/v3/agregados/{id})
--   periodo   : '2022' (fixo), 'last' (mais recente) ou '-2' (dois últimos, p/ variação)
--   mapa      : { "<regex sobre 'Variável | Categoria'>": "<coluna de cidade_socio>" }
-- O casamento é por NOME (regex), não por id de variável: nome muda muito menos que id.
create table if not exists public.socio_fontes (
  chave       text primary key,
  descricao   text,
  agregado    text not null,
  periodo     text not null default 'last',
  mapa        jsonb not null default '{}'::jsonb,
  ativa       boolean not null default true,
  ordem       smallint not null default 100,
  ultimo_em   timestamptz,
  ultimo_ok   boolean,
  ultimo_linhas integer,
  ultimo_erro text
);
alter table public.socio_fontes enable row level security;  -- sem policy: só service_role

comment on table public.socio_fontes is
  'Fontes IBGE da base socio-demografica. IDs de agregado e mapa de variaveis ficam AQUI (nao no codigo) para corrigir por SQL, sem deploy.';

insert into public.socio_fontes (chave, descricao, agregado, periodo, ordem, mapa) values
  ('censo_populacao',
   'Censo 2022 — população residente, variação desde 2010, área e densidade',
   '4709', '2022', 10,
   '{"popula(ç|c)(ã|a)o residente$":"populacao",
     "varia(ç|c)(ã|a)o.*relativa":"crescimento_pct",
     "(á|a)rea.*territorial":"area_km2",
     "densidade demogr":"densidade_hab_km2"}'::jsonb),

  ('censo_domicilios',
   'Censo 2022 — domicílios recenseados por espécie (ocupados/vagos) e média de moradores',
   '4712', '2022', 20,
   '{"domic(í|i)lios.*ocupad":"domicilios_ocupados",
     "domic(í|i)lios.*vago":"domicilios_vagos",
     "domic(í|i)lios recenseados$":"domicilios",
     "m(é|e)dia de moradores":"moradores_por_domicilio"}'::jsonb),

  ('estimativa_populacao',
   'Estimativas anuais de população (dois últimos anos → crescimento recente)',
   '6579', '-2', 30,
   '{"popula(ç|c)(ã|a)o residente":"pop_estim"}'::jsonb),

  ('registro_civil_nascimentos',
   'Estatísticas do Registro Civil — nascidos vivos por município',
   '2612', '-1', 40,
   '{"nascidos vivos":"nascimentos"}'::jsonb)
on conflict (chave) do nothing;

-- CAGED fica DESLIGADO e DOCUMENTADO: o Novo CAGED não tem API por município — só o arquivo
-- mensal nacional (FTP, compactado, centenas de MB). Baixar isso dentro de uma função
-- serverless seria caro e frágil. O lugar certo é uma GitHub Action mensal (já temos o padrão
-- dos scrapers) que agrega por município e faz o upsert aqui. Registrado para não virar
-- promessa esquecida.
insert into public.socio_fontes (chave, descricao, agregado, periodo, ativa, ordem, mapa, ultimo_erro) values
  ('caged_emprego', 'Novo CAGED — saldo de emprego formal por município', 'n/a', 'n/a', false, 90,
   '{}'::jsonb,
   'Desligada de proposito: o Novo CAGED nao expoe API por municipio, so o arquivo mensal nacional compactado. Caminho correto = GitHub Action mensal que baixa, agrega por municipio e faz upsert em cidade_socio.empregos_saldo.')
on conflict (chave) do nothing;


-- ── LOG DE INGESTÃO (backup que ninguém verifica não é backup; dado idem) ────
create table if not exists public.socio_ingestao (
  id         bigserial primary key,
  executado_em timestamptz not null default now(),
  fonte      text,
  ok         boolean not null default false,
  linhas     integer default 0,
  ms         integer,
  erro       text,
  detalhe    jsonb
);
create index if not exists socio_ingestao_recente_idx on public.socio_ingestao (executado_em desc);
alter table public.socio_ingestao enable row level security;  -- sem policy: só service_role
