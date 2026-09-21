-- Segunda camada de segurança pro saque PIX (pedido do dono, 21/09): o Asaas oferece
-- "validação de saque via Webhook" — ele avisa nosso servidor ~5s depois de CRIAR a
-- transferência e só executa de fato se respondermos APPROVED. Pra isso funcionar de
-- verdade (não só "responder aprovado pra qualquer payload"), a doc do próprio Asaas
-- exige registrar a operação ANTES de a validação chegar, pra comparar o payload
-- recebido contra o que NÓS pedimos (id, valor, chave PIX) — sem isso não há nada a
-- validar de fato. RLS ligado sem política — só o backend (service_role) acessa,
-- mesmo padrão de verificar_cpf_rate/login_tentativas.
create table if not exists public.asaas_transferencias_pendentes (
  asaas_transfer_id text primary key,
  valor numeric not null,
  chave_pix text not null,
  criado_por uuid references public.perfis(id),
  criado_em timestamptz not null default now(),
  validado_em timestamptz,
  resultado text
);

alter table public.asaas_transferencias_pendentes enable row level security;
