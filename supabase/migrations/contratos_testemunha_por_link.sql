-- Testemunha por LINK (pedido do dono): cada parte encaminha um link à SUA testemunha, que
-- preenche nome/CPF e assina remotamente. Token próprio da testemunha, separado do da parte.
-- Aplicada em produção via MCP. Fluxo: a parte assina sozinha (ContratoLink) e recebe o link
-- da sua testemunha (#/t/<testemunha_token>); a testemunha abre (TestemunhaLink), vê o contrato
-- + quem é a parte, preenche nome/CPF e assina (/api/assinar-testemunha). Contrato completo
-- quando a parte (status='assinado') E a testemunha (testemunha_em) assinam.
alter table public.contratos_link
  add column if not exists testemunha_token text;
alter table public.contratos_link
  alter column testemunha_token set default encode(gen_random_bytes(20), 'hex');
update public.contratos_link
  set testemunha_token = encode(gen_random_bytes(20), 'hex')
  where requer_testemunha is true and testemunha_token is null;
create unique index if not exists contratos_link_testemunha_token_key
  on public.contratos_link(testemunha_token) where testemunha_token is not null;

-- Leitura PÚBLICA da testemunha: SÓ os campos que a testemunha precisa (o contrato e quem é a
-- parte), NUNCA KYC/CPF/dados sensíveis da parte. Casa pelo token EXATO da testemunha.
create or replace function public.get_contrato_testemunha(p_token text)
 returns jsonb language sql security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'id', c.id,
    'titulo', c.titulo,
    'conteudo', c.conteudo,
    'arquivo_url', c.arquivo_url,
    'arquivo_nome', c.arquivo_nome,
    'requer_testemunha', c.requer_testemunha,
    'parte_nome', coalesce(c.dados_signatario->>'nome', c.dados_signatario->>'razao_social', c.assinante_email),
    'parte_assinou', (c.status = 'assinado'),
    'testemunha_assinou', (c.testemunha_em is not null),
    'expira_em', c.expira_em
  )
  from public.contratos_link c
  where c.testemunha_token = p_token and c.requer_testemunha is true
  limit 1;
$$;
revoke all on function public.get_contrato_testemunha(text) from public;
grant execute on function public.get_contrato_testemunha(text) to anon, authenticated, service_role;

-- get_contrato_testemunha é SECURITY DEFINER exposto a anon (o link é público, como o da parte)
-- → precisa entrar na allowlist do auditor. Ver auditoria_allowlist_testemunha.sql.
