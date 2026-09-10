-- CORRIGE ACHADO REAL (10/09, achado testando resgatar_convite_leiloeiro contra dado real):
-- `perfis_role_check` nunca foi atualizada quando os papéis 'leiloeiro' (Portal do Leiloeiro,
-- Parte 39/40) e 'afiliado' (INVITE_BTNS em Admin.jsx, resgatado por usar_convite_equipe)
-- foram introduzidos no código. Consequência: HOJE, qualquer tentativa de gravar
-- `role='leiloeiro'` ou `role='afiliado'` — pela minha nova RPC, por usar_convite_equipe, ou
-- por um UPDATE manual do admin — falha com "new row for relation perfis violates check
-- constraint perfis_role_check", sem que nenhuma tela avise o motivo real (o Postgres devolve
-- 400/500 genérico ao PostgREST). É por isso que existem ZERO contas com role='leiloeiro' no
-- banco até agora, apesar de toda a UI (Portal do Leiloeiro, Admin, App.jsx) já pressupor que
-- o papel funciona — nunca foi exercido de ponta a ponta.
--
-- Também remove 'top1', papel aposentado (Admin.jsx: "'top1' foi removido (Investidor Pro é
-- 'top2')") — nenhuma linha em produção usa mais (conferido: 0 de 139 perfis). Note-se que
-- 'top2_anual'/'assessorado_anual'/'clube_anual' NÃO pertencem aqui: essas variantes vivem na
-- coluna `plano` (perfis_plano_check já as lista), não em `role` — a leitura delas dentro de
-- conceder_plano_usuario() é defensiva e nunca é de fato escrita nesta coluna.
begin;

alter table public.perfis drop constraint perfis_role_check;
alter table public.perfis add constraint perfis_role_check
  check (role = any (array['admin','explorador','top2','assessorado','clube','consultor','analista','advogado','leiloeiro','afiliado']));

commit;
