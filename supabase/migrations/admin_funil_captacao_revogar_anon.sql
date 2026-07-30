-- Hardening: admin_funil_captacao (SECURITY DEFINER, criada na sessão 19 de marketing)
-- ficou com o grant default de EXECUTE para PUBLIC/anon. A função tem guard de admin
-- interno, mas a regra da casa (auditoria_seguranca) é: SECURITY DEFINER nunca
-- executável por anon fora da allowlist. Chamada só pelo front AUTENTICADO (Admin.jsx)
-- → mantém authenticated + service_role.
revoke execute on function public.admin_funil_captacao(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_funil_captacao(timestamptz, timestamptz) to authenticated, service_role;
