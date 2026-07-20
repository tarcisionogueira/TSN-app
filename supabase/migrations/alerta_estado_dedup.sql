-- Estado de deduplicação de alertas por e-mail (health-check, monitor-fontes-cron).
-- Guarda a "assinatura" do último conjunto de problemas NOTIFICADO por e-mail, para que
-- os crons diários só enviem quando o conjunto MUDA (problema novo/erro) — e não
-- re-enviem todo dia a mesma condição já conhecida/aceita (ex.: BIASI degradado = 173,
-- acervo real do site; anomalias de relatório já vistas). Reduz o e-mail diário a ~0
-- em regime estável, sem perder um problema novo (avisa na hora) nem um ERRO persistente
-- (heartbeat a cada 3 dias). O painel Admin e o health_check_logs seguem com o estado
-- completo diariamente — só o e-mail é filtrado.
--
-- Só-servidor (service_role); sem PII → não é flagrada por auditoria_uso (sem grant a
-- authenticated) nem por auditoria_seguranca (RLS ligada, sem dado sensível).
-- Aplicada em produção via MCP (auditoria_seguranca 0/0, auditoria_uso 0 gaps).
create table if not exists public.alerta_estado (
  chave         text primary key,
  assinatura    text not null default '',
  enviado_em    timestamptz,
  atualizado_em timestamptz not null default now()
);

alter table public.alerta_estado enable row level security;
revoke all on public.alerta_estado from anon, authenticated;
grant all on public.alerta_estado to service_role;

comment on table public.alerta_estado is
  'Dedup de alertas (health-check/monitor-fontes): assinatura do último conjunto de problemas notificado. Só-servidor; sem PII.';
