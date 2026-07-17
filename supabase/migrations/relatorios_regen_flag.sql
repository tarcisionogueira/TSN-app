-- "Apontamento para regerar": quando o gerador detecta um VÍCIO regenerável (matrícula
-- não lida, CNJ não consultado, avaliação ausente, contradição/revisão no laudo, etc.),
-- marca o relatório com o motivo. Um cron de regeneração (reusa a infra de retry) refaz
-- quando a causa-raiz for resolvível. regen_em = quando foi (re)gerado por último.
alter table public.analises_mercado    add column if not exists regen_motivo text, add column if not exists regen_em timestamptz;
alter table public.analises_documental add column if not exists regen_motivo text, add column if not exists regen_em timestamptz;
alter table public.analises_laudo      add column if not exists regen_motivo text, add column if not exists regen_em timestamptz;
