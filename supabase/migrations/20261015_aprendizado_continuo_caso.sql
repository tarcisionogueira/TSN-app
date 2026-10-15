-- Aprendizado contínuo dos casos pós-arremate (15/10, dono): "a IA deve aprender com cada devolutiva de e-mail,
-- cada anexo, cada movimentação processual. Isso gera aprendizado para auxiliar em novas arrematações e
-- diagnósticos futuros."
--
-- juridico_aprendizado existia só no banco (nenhuma migração a criava: forma 7b). O CREATE abaixo é o
-- espelho do que está em produção, para recriar o banco a partir do repositório não perder a tabela.
create table if not exists public.juridico_aprendizado (
  id uuid primary key default gen_random_uuid(),
  caso_id uuid,
  imovel_id text,
  campo text,
  valor_ia text,
  valor_advogado text,
  observacao text,
  criado_em timestamptz default now()
);

-- De onde veio a lição e a que recorte ela vale: o gerar-documental prioriza as da mesma UF/modalidade.
alter table public.juridico_aprendizado add column if not exists fonte text;      -- devolutiva | documento | andamento | movimento | correcao | reuniao
alter table public.juridico_aprendizado add column if not exists uf text;
alter table public.juridico_aprendizado add column if not exists modalidade text;  -- judicial | extrajudicial | venda_direta ...
comment on column public.juridico_aprendizado.fonte is 'Origem da lição: devolutiva (e-mail do escritório), documento (anexo do caso), andamento (registro da equipe), movimento (CNJ/DataJud), correcao (divergência IA x advogado), reuniao.';

-- Até onde o caso-aprendizado-cron já leu de cada fonte. Sem isto, cada rodada pagaria IA para reler o histórico.
create table if not exists public.caso_aprendizado_cursor (
  caso_id uuid primary key references public.casos(id) on delete cascade,
  documentos_ate timestamptz,
  andamentos_ate timestamptz,
  movimentos_ate timestamptz,
  licoes_total int not null default 0,
  atualizado_em timestamptz not null default now()
);
alter table public.caso_aprendizado_cursor enable row level security;
-- Sem política: só o service role (cron) lê e grava.
