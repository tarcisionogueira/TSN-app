-- 15/11 — DONO RODA (REVOKE fica com o dono, regra de 06/11). Fecha dois avisos:
--
-- (1) health-check: "homio_leads(user_id) com RLS mas SEM escrita do usuário". Só api/homio-lead.js escreve
--     (SERVICE_KEY); `grep src/` não acha a tabela. Mesmo remédio de 20261023_cartorio_e_compartilhamento_so_do_servidor:
--     tira a escrita herdada do default do Supabase. service_role intacto.
-- (2) auditoria_seguranca: `rpc_definer_anon` em politica_parcelamento. A migração de 07/11 deu EXECUTE a
--     authenticated e service_role, mas o anon herdava pelo PUBLIC (forma nº 3: o grant não erra, só a ACL prova).
--     Quem chama é a tela de checkout (logado) e api/mp-checkout.js (servidor) — anônimo não precisa.
revoke insert, update, delete, truncate on public.homio_leads from anon, authenticated;

revoke execute on function public.politica_parcelamento(text) from public, anon;
grant  execute on function public.politica_parcelamento(text) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.politica_parcelamento(text)', 'EXECUTE') then
    raise exception 'anon ainda executa politica_parcelamento — revoke nao surtiu efeito';
  end if;
  if has_table_privilege('authenticated', 'public.homio_leads', 'INSERT') then
    raise exception 'authenticated ainda escreve em homio_leads — revoke nao surtiu efeito';
  end if;
end $$;
