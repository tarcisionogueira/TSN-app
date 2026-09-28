-- ─────────────────────────────────────────────────────────────────────────────────────────
-- PAINEL DE QUALIDADE (/admin → Qualidade) ABRE PELA RODADA DIÁRIA — 28/09/2026
--
-- A aba chamava `admin_qa_invariantes()`, que roda os ~90 invariantes NA HORA do clique:
-- 5–10 s medidos em `qa_invariantes_execucao` (27/09: 8.192 ms no servidor), sob o teto de
-- 8 s do `authenticated`. Frio, estourava — e a tela mostrava "Erro: canceling statement due
-- to statement timeout" no lugar do painel. O monitor (18h10 UTC) já roda exatamente o mesmo
-- cálculo todo dia, com timeout próprio de 30 s (qa_invariantes_medido_timeout_proprio.sql).
--
-- Agora: o monitor grava o resultado em `qa_invariantes_execucao.resultado`, a tela abre por
-- ele (instantâneo, com a hora da medição à vista) e o recálculo ao vivo vira botão, com o
-- mesmo timeout próprio de 30 s — o teto de 8 s continua valendo para todo o resto.
-- ─────────────────────────────────────────────────────────────────────────────────────────
alter table public.qa_invariantes_execucao add column if not exists resultado jsonb;

alter function public.admin_qa_invariantes() set statement_timeout = '30s';

-- Última rodada que AVALIOU (ok=true com resultado). Rodada que falhou não entra: a tela tem
-- que mostrar a medição válida mais recente e a hora dela, não um vazio com cara de "tudo ok".
create or replace function public.admin_qa_invariantes_ultima()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_role text; r record;
begin
  select role into v_role from public.perfis where id = auth.uid();
  if v_role is distinct from 'admin' then raise exception 'apenas admin'; end if;
  select e.executado_em, e.resultado into r from public.qa_invariantes_execucao e
   where e.ok and e.resultado is not null order by e.executado_em desc limit 1;
  if r.executado_em is null then return null; end if;
  return jsonb_build_object('executado_em', r.executado_em, 'itens', r.resultado);
end $$;
revoke all on function public.admin_qa_invariantes_ultima() from public, anon;
grant execute on function public.admin_qa_invariantes_ultima() to authenticated;
