-- APRENDIZADO DO GERADOR DE CONTRATOS (18/09, pedido do dono: "é bom aprender visto que ele
-- pode aprimorar com os contratos que vamos utilizando"). Mesmo padrão já usado no jurídico
-- (juridico_aprendizado, alimentado por inbound-juridico.js quando o advogado diverge do
-- sistema): quando o STAFF edita o contrato gerado pela IA antes de mandar para assinatura,
-- a diferença entre o rascunho da IA e o texto final vira lição estruturada, e as lições
-- entram no prompt das PRÓXIMAS gerações do mesmo tipo de contrato.
create table if not exists public.contrato_aprendizado (
  id             uuid primary key default gen_random_uuid(),
  contrato_grupo_id uuid,
  tipo           text,
  clausula       text,
  texto_ia       text,
  texto_final    text,
  motivo         text,
  criado_em      timestamptz not null default now()
);
alter table public.contrato_aprendizado enable row level security;
comment on table public.contrato_aprendizado is
  'Correções reais que o staff fez no contrato gerado por IA antes de enviar para assinatura — realimenta gerar-contrato-ia.js. Só service_role acessa (sem policy = RLS fecha tudo).';
