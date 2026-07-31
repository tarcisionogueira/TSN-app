-- Bug bounty 31/07 (BUG 4) — APLICADO. perfis.mp_id era sobrecarregado: buscarCliente
-- (webhook) o usa como CUSTOMER id para localizar o perfil, mas ativarRoleInline gravava
-- ali o PREAPPROVAL id. A cada pagamento, processarConfirmado sobrescrevia com o customer
-- id → o cancelamento (garantia-cancelar) fazia PUT /preapproval/{customer} → 404 e a
-- recorrência seguia cobrando. Coluna dedicada para o preapproval id, sem colisão.
-- (ativarRoleInline passa a gravar mp_preapproval_id; garantia-cancelar cancela pela busca
--  escopada por external_reference + candidatos do perfil, cobrindo os rows legados.)
alter table public.perfis add column if not exists mp_preapproval_id text;
comment on column public.perfis.mp_preapproval_id is 'ID do preapproval (assinatura recorrente) do MP — separado de mp_id (customer id) para gerência/cancelamento.';
