-- 21/10 (bug bounty, #264): a policy de SELECT de imovel_anexos liberava edital/matrícula/regras a QUALQUER
-- logado — ~24 mil `origem_url` apontando para o site do leiloeiro, o mesmo dado que a view mascarada esconde.
-- Agora o ramo "qualquer logado" exige pode_ver_leiloeiro() (plano pago ou equipe). Arrematante e equipe jurídica
-- seguem pelos ramos próprios. api/doc-url.js lê com o JWT do usuário, então fica certo sozinho.
alter policy imovel_anexos_select_consolidada on public.imovel_anexos using (
  ((select auth.uid()) is not null
     and tipo::text = any (array['matricula','edital','regras_venda'])
     and public.pode_ver_leiloeiro())
  or exists (select 1 from public.arrematados a where a.imovel_id = imovel_anexos.imovel_id::text and a.user_id = (select auth.uid()))
  or exists (select 1 from public.arrematacoes a where a.id = imovel_anexos.arrematacao_id and a.arrematante_id = (select auth.uid()))
  or exists (select 1 from public.perfis where perfis.id = (select auth.uid()) and perfis.role = any (array['admin','analista','advogado']))
);
