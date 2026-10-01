-- Perfil do lead levantado pela IA no WhatsApp (01/10, dono: "buscar conexão com o cliente,
-- entender o perfil dele"). A IA devolve uma linha interna [[PERFIL: …]] a cada resposta a quem
-- não é cliente; o respondedor grava aqui e devolve no próximo turno, para não repetir pergunta.
alter table public.wa_conversas
  add column if not exists perfil_lead text,
  add column if not exists perfil_em   timestamptz;
