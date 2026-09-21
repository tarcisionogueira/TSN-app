-- Fila de processamento assíncrono do webhook do Mercado Pago (21/09, pedido do dono: mexer
-- nisso agora, com o fluxo pequeno, é mais barato que depois — mas responder rápido e "torcer"
-- é arriscado: waitUntil() da Vercel é best-effort, sem retry, e a própria doc deles desaconselha
-- pra lógica de negócio crítica (ativar plano, creditar comissão). Por isso fila DURÁVEL + cron,
-- mesmo padrão já usado em `emails_fila`/`drenar-fila-emails-cron.js`, não um atalho de memória.
--
-- Fluxo: api/mp-webhook.js verifica a assinatura, enfileira aqui e responde 200 na hora (rápido
-- e garantido, não depende de quanto tempo o processamento de verdade leva). O cron
-- `processar-fila-webhook-mp-cron` (a cada 1 min) drena a fila chamando a MESMA função de
-- processamento que já existia (processarEventoMp, extraída sem mudar UMA linha da lógica de
-- negócio) — se ela falhar, tenta de novo no próximo minuto até `tentativas` esgotar.
--
-- SEM unique(mp_topic, mp_data_id) DE PROPÓSITO — quase virou bug: o MP entrega o MESMO
-- (type, data.id) MAIS DE UMA VEZ conforme o pagamento MUDA de estado de verdade (ex.: 'payment'
-- criado → depois 'payment' aprovado, ambos com o mesmo data.id). Uma unique aqui rejeitaria a
-- 2ª entrega (a que importa, com o status novo) como "duplicata" e a aprovação NUNCA seria
-- processada. processarEventoMp já é seguro pra rodar mais de uma vez pro mesmo pagamento — ele
-- sempre confere o estado ATUAL via API do MP (nunca confia no payload) e tem sua própria
-- idempotência por efeito (`eventoJaProcessado`/checagens de status já pago) — é ela quem
-- protege contra duplo-processamento, não uma constraint na fila.
create table if not exists public.mp_webhook_fila (
  id bigint generated always as identity primary key,
  mp_topic text not null,
  mp_data_id text not null,
  payload jsonb not null,
  status text not null default 'pendente' check (status in ('pendente', 'processado', 'falhou')),
  tentativas int not null default 0,
  ultimo_erro text,
  resultado jsonb,
  criado_em timestamptz not null default now(),
  processado_em timestamptz
);

-- Índice parcial: o cron só lê 'pendente', e é sobre isso que ele filtra toda vez.
create index if not exists mp_webhook_fila_pendente_idx
  on public.mp_webhook_fila (criado_em)
  where status = 'pendente';

-- RLS ligado sem política — só o backend (service_role) acessa, mesmo padrão de
-- verificar_cpf_rate/login_tentativas/asaas_transferencias_pendentes.
alter table public.mp_webhook_fila enable row level security;
