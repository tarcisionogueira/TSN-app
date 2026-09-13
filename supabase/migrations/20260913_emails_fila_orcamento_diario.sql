-- Fila de e-mails represados pelo orçamento diário do Resend (plano Free = 100/dia).
-- Contexto (13/09): o dono decidiu NÃO assinar o plano pago agora e usar o máximo do teto
-- grátis, com o excedente do dia sendo enviado no dia seguinte, em vez de falhar.
-- Ver `api/_email.js` (função `enviarEmail`, que enfileira aqui quando o orçamento estoura)
-- e `api/drenar-fila-emails-cron.js` (que envia o que está pendente, dentro do orçamento
-- restante do dia). RLS sem política = só service role acessa, mesmo padrão de `emails_log`.
create table if not exists public.emails_fila (
  id uuid primary key default gen_random_uuid(),
  destinatario text not null,
  cc text[],
  assunto text not null,
  html text,
  texto_plano text,
  reply_to text,
  tipo text,
  user_id uuid,
  status text not null default 'pendente', -- pendente | enviado | falha
  criado_em timestamptz not null default now(),
  processado_em timestamptz,
  tentativas int not null default 0,
  erro text
);

create index if not exists idx_emails_fila_pendentes
  on public.emails_fila (criado_em)
  where status = 'pendente';

alter table public.emails_fila enable row level security;
