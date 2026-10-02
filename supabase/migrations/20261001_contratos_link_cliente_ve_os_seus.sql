-- O CLIENTE NÃO VIA OS DOCUMENTOS QUE A EQUIPE GEROU PARA ELE (01/10, Marcos).
-- A leitura de contratos_link só liberava criado_por = eu, equipe, ou assinante_email = meu e-mail.
-- Termo de assessoria e procurações gerados pela equipe (api/_termo-assessoria.js) gravam o cliente
-- em `arremate_user_id` — sem e-mail de assinante e com criado_por = equipe/nulo. Resultado: o aviso
-- "assine o contrato pendente" (contratos_pendentes) mandava para /contratos, que vinha VAZIA, e os
-- "Contratos vinculados" da arrematação também. Só LEITURA: update/delete seguem como estavam.
drop policy if exists contratos_link_select_consolidada on public.contratos_link;
create policy contratos_link_select_consolidada on public.contratos_link for select to public
  using (
    (( select ( select auth.uid() as uid) as uid) = criado_por)
    or is_equipe()
    or (assinante_email = ( select ( select auth.email() as email) as email))
    or (arremate_user_id = ( select ( select auth.uid() as uid) as uid))
  );
