-- 07/11 — Cobrança por Pix e boleto pelo Banco Inter (decisão do dono: Pix/boleto vão ao Inter, onde o dinheiro
-- cai na conta da empresa na hora e a tarifa é uma fração da do Mercado Pago; cartão segue Mercado Pago → Asaas).
--
-- Cada linha é UMA cobrança emitida na API Cobrança v3 do Inter (boleto com QR Code Pix). O valor e a cobrança
-- de origem vêm sempre do servidor (cobrancas_avulsas); o navegador só manda os dados de quem paga.
-- Baixa: api/inter-cobranca.js (consulta da tela), api/inter-webhook.js (aviso do Inter) e
-- api/inter-cobrancas-cron.js (varredura). Os três RECONSULTAM a API do Inter antes de dar baixa — o corpo do
-- aviso nunca é prova de pagamento.
create table if not exists public.inter_cobrancas (
  id uuid primary key default gen_random_uuid(),
  cobranca_avulsa_id uuid not null,
  codigo_solicitacao text unique,
  seu_numero text not null,
  valor numeric(12,2) not null check (valor > 0),
  vencimento date not null,
  situacao text not null default 'EMITINDO',
  pix_copia_cola text,
  linha_digitavel text,
  nosso_numero text,
  pagador_doc text,
  pagador_nome text,
  pagador_email text,
  valor_recebido numeric(12,2),
  pago_em timestamptz,
  baixa_aplicada_em timestamptz,
  ultimo_erro text,
  consultado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists inter_cobrancas_abertas on public.inter_cobrancas (criado_em)
  where baixa_aplicada_em is null and situacao not in ('CANCELADO', 'EXPIRADO', 'FALHA_EMISSAO');
create index if not exists inter_cobrancas_cobranca on public.inter_cobrancas (cobranca_avulsa_id);

-- Só o servidor (service key) lê e escreve: tem CPF de quem paga.
alter table public.inter_cobrancas enable row level security;
revoke all on public.inter_cobrancas from anon, authenticated;
