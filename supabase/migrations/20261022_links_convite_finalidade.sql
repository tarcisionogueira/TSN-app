-- 22/10 (dono: "esses convites têm qual finalidade? não tem descrição, só o link"). O link de indicação
-- (`/convite/<código>` → usar_convite → perfis.indicado_por) era só código: 22 cartões iguais na tela.
-- Rótulo livre de quem gera; não muda a regra de indicação.
alter table public.links_convite add column if not exists finalidade text;
comment on column public.links_convite.finalidade is 'Para que serve o link (campanha, parceiro, canal) — definido por quem gera; só rótulo, não muda a regra de indicação.';
