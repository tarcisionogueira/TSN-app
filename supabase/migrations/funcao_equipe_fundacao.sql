-- 22/08 — FUNDAÇÃO da separação "role de plano × função de equipe" (regra do dono: todo usuário
-- é um usuário de PLANO — explorador/investidor pró/assessorado/leilão clube — e a atribuição de
-- equipe/parceiro é uma FUNÇÃO ADICIONAL via convite; ninguém é "só o convite").
--
-- ESTADO ATUAL (medido 22/08): `role` está sobrecarregado — guarda o tier do plano (explorador/
-- top2/assessorado) E o staff (admin). Há 1 só usuário de equipe (o admin/dono); nenhum
-- analista/advogado. A autorização por `role='admin'/'analista'/'advogado'` está em ~82 políticas
-- RLS + 33 funções + ~90 pontos de api + 33 de front.
--
-- ESTRATÉGIA SEGURA (sem lockout): esta migração é 100% ADITIVA.
--   1. coluna `funcao_equipe` (a função de equipe interna, separada do plano).
--   2. helper `eh_funcao()`/`eh_admin()` que é SUPERSET: reconhece funcao_equipe OU o role legado
--      — então a autorização pode migrar para o helper progressivamente SEM quebrar nada (quem
--      já é admin por role continua admin; quem for staff só por funcao_equipe passa a valer).
--   3. backfill: staff atual ganha funcao_equipe = role, MANTENDO o role (não vira o plano ainda —
--      virar o role do único admin antes de TODA a autorização ler o helper seria auto-lockout).
--
-- O CONSULTOR/PARCEIRO já segue a regra por outra via (perfis.vendedor_tipo='consultor', role de
-- plano preservado — ver convite_consultor_capacidade.sql). A virada do role do staff para tier de
-- plano + a troca das ~230 checagens para eh_funcao() é a FASE DEDICADA (testada), sem impacto hoje.

alter table public.perfis add column if not exists funcao_equipe text;
do $$ begin
  alter table public.perfis add constraint perfis_funcao_equipe_ck
    check (funcao_equipe is null or funcao_equipe in ('analista','advogado','admin'));
exception when duplicate_object then null; end $$;

-- Backfill: o staff de hoje (só o admin) ganha a função; o role permanece até a fase da virada.
update public.perfis set funcao_equipe = role
 where role in ('analista','advogado','admin') and funcao_equipe is distinct from role;

-- Helper SUPERSET (funcao_equipe OU role legado). SECURITY DEFINER para ser chamável de RLS.
create or replace function public.eh_funcao(p_funcao text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.perfis
     where id = (select auth.uid())
       and (funcao_equipe = p_funcao or role = p_funcao)
  );
$$;
create or replace function public.eh_admin()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.eh_funcao('admin');
$$;
-- Definer: nunca exposto a anon/public (a auditoria_seguranca acusa senão). Anon teria auth.uid()
-- nulo (retornaria false), mas fechamos a porta por higiene — só authenticated/service_role.
revoke execute on function public.eh_funcao(text) from public, anon;
revoke execute on function public.eh_admin() from public, anon;
grant execute on function public.eh_funcao(text) to authenticated, service_role;
grant execute on function public.eh_admin() to authenticated, service_role;
