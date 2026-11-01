-- 01/11 — auditoria_seguranca acusou `rpc_definer_anon` em duas funções novas (29–30/10).
-- Conferido antes de decidir entre "allowlist" e "revogar" (regra: menor privilégio primeiro;
-- allowlist é só para o que precisa ser público de propósito):
--
-- * admin_precisa_de_voce(): já barra quem não é admin (`is_admin()` → 42501), mas só o /admin
--   (usuário logado) a chama. Anônimo não precisa dela → revoga.
-- * landing_leiloeiros_oficiais(): devolve só um número (sem PII), mas é CARA (varre
--   imoveis_leilao + veiculos_leilao + leiloeiro_junta) e quem a chama é só
--   `landing_numeros_atualizar()` (cron, roda como dono). Exposta a anon, qualquer visitante
--   poderia martelá-la pelo PostgREST e competir com o app (statement timeout). → revoga.
--
-- Nenhuma das duas entra na allowlist. O `=X/postgres` (PUBLIC) também sai: sem isso o anon
-- herda o EXECUTE pelo PUBLIC e o revoke do anon não muda nada (forma nº 3: a operação não dá
-- erro; só reler a ACL prova o que mudou — ver a checagem no fim).

revoke execute on function public.admin_precisa_de_voce() from public, anon;
grant  execute on function public.admin_precisa_de_voce() to authenticated, service_role;

revoke execute on function public.landing_leiloeiros_oficiais() from public, anon, authenticated;
grant  execute on function public.landing_leiloeiros_oficiais() to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.admin_precisa_de_voce()', 'EXECUTE')
     or has_function_privilege('anon', 'public.landing_leiloeiros_oficiais()', 'EXECUTE') then
    raise exception 'anon ainda executa uma das funcoes — revoke nao surtiu efeito';
  end if;
end $$;
