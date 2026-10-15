-- Aprendizado com as devolutivas do escritório (15/10, dono).
--
-- "A IA deve aprender com as respostas; se vir que é algo recorrente ou uma movimentação que demore mais,
-- pode espaçar para quinzenal." O juridico-devolutivas-cron lê cada resposta nova do escritório num caso
-- (email_caixa.direcao='entrada' com caso_id), junto com o histórico da conversa, e grava aqui:
--   - a situação do processo, o último movimento e o que se aguarda (juiz, cartório, cliente, nós);
--   - o que é pendência NOSSA (para a decisão do dono);
--   - o intervalo do próximo acompanhamento (7 ou 14 dias), que o casos-acompanhamento-cron respeita;
--   - uma referência curta ao último ponto, citada no próximo e-mail ("desde a última comunicação, sobre …").
-- Lições gerais (ex.: "o cartório só registra com a Carta de Arrematação") vão para juridico_aprendizado,
-- que o gerar-documental já lê nos relatórios.

create table if not exists public.caso_acompanhamento_analise (
  id uuid primary key default gen_random_uuid(),
  caso_id uuid not null references public.casos(id) on delete cascade,
  email_id uuid references public.email_caixa(id) on delete set null,  -- a resposta que motivou a análise
  situacao text,
  ultimo_movimento text,
  referencia_curta text,
  aguardando text,          -- juiz | cartorio | cliente | escritorio | nos | nada
  pendencias_nossas jsonb not null default '[]'::jsonb,
  intervalo_dias int not null default 7 check (intervalo_dias in (7, 14)),
  motivo_intervalo text,
  provedor text,
  criado_em timestamptz not null default now()
);
create index if not exists caso_acomp_analise_caso_idx on public.caso_acompanhamento_analise (caso_id, criado_em desc);
create unique index if not exists caso_acomp_analise_email_uidx on public.caso_acompanhamento_analise (email_id) where email_id is not null;

alter table public.caso_acompanhamento_analise enable row level security;
-- Só a equipe lê (mesmo critério da caixa de e-mail); escrita só pelo servidor (service role).
drop policy if exists caso_acomp_analise_equipe on public.caso_acompanhamento_analise;
create policy caso_acomp_analise_equipe on public.caso_acompanhamento_analise for select using (public.pode_caixa_email());

alter table public.casos add column if not exists acompanhamento_intervalo_dias int not null default 7;
comment on column public.casos.acompanhamento_intervalo_dias is 'Intervalo do acompanhamento ao escritório (7 = semanal às quartas, 14 = quinzenal); ajustado pelo juridico-devolutivas-cron.';
