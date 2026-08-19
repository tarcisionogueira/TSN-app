-- 19/08 (hardening baixo, autorizado pelo dono): `brightdata_decisao` é stable/só-leitura,
-- mas expõe o estado do orçamento pago (teto, usado, reservas por propósito) — inteligência
-- operacional que anon não tem por que ler. O grant efetivo era via PUBLIC (default de
-- CREATE FUNCTION), então revogar só `anon` não fecharia nada: revoga PUBLIC, anon e
-- authenticated; o servidor (service_role) e o ritual (postgres) continuam com EXECUTE.
revoke execute on function public.brightdata_decisao(integer, text) from public, anon, authenticated;
