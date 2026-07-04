-- E-sign de contratos (auditoria 2026-07-04):
-- (a) o cliente gravava em coluna inexistente assinatura_hash → update inteiro
--     rejeitado ("Erro ao assinar"). Adiciona a coluna.
-- (b) o código cria status='aguardando_assinatura', mas a policy de leitura
--     pública exigia status='aguardando' → o link nem abria o contrato.
--     Alinha a policy ao status real.
-- A finalização passa a ser feita por endpoint server-side (api/assinar-contrato)
-- com service key, que grava IP/timestamp/hash autoritativos.

alter table public.contratos_link add column if not exists assinatura_hash text;

drop policy if exists "Público acessa contrato pelo token" on public.contratos_link;
create policy "Público acessa contrato pelo token" on public.contratos_link
  for select to public
  using (status in ('aguardando','aguardando_assinatura') and expira_em > now());
