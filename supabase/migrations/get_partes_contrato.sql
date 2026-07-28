-- Roster de assinantes de um contrato (tela "Meus Contratos" → ver quem já assinou).
--
-- Um contrato com várias partes é representado por VÁRIAS linhas em contratos_link, todas com o
-- mesmo contrato_grupo_id (uma por assinante_email). A RLS "Assinante lê próprios contratos_link"
-- (assinante_email = auth.email()) faz o cliente enxergar SÓ a própria linha — então uma query
-- por contrato_grupo_id devolveria roster incompleto. Esta RPC SECURITY DEFINER agrega as partes
-- do grupo devolvendo só campos SEGUROS (nome + e-mail + status de assinatura/testemunha), NUNCA
-- CPF/KYC de terceiros. Guarda de autorização: só quem é PARTE do grupo, o CRIADOR, ou EQUIPE.
--
-- Grant só a `authenticated` (não `anon`) → não precisa entrar na allowlist do auditoria_seguranca
-- (essa allowlist cobre apenas funções SECURITY DEFINER executáveis por anon).
create or replace function public.get_partes_contrato(p_grupo_id uuid)
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'nome', coalesce(nullif(c.dados_signatario->>'nome',''), nullif(c.dados_signatario->>'razao_social',''), c.assinante_email),
    'email', c.assinante_email,
    'assinou', (c.status = 'assinado'),
    'assinado_em', c.assinado_em,
    'requer_testemunha', coalesce(c.requer_testemunha, false),
    'testemunha_assinou', (c.testemunha_em is not null),
    'nome_testemunha', c.nome_testemunha
  ) order by c.criado_em), '[]'::jsonb)
  from public.contratos_link c
  where c.contrato_grupo_id = p_grupo_id
    and (
      public.is_equipe()
      or exists (
        select 1 from public.contratos_link m
        where m.contrato_grupo_id = p_grupo_id
          and (m.assinante_email = (select auth.email()) or m.criado_por = (select auth.uid()))
      )
    );
$$;

revoke all on function public.get_partes_contrato(uuid) from public;
-- No Supabase, ALTER DEFAULT PRIVILEGES concede EXECUTE direto a anon/authenticated/service_role
-- em toda função nova do schema public — o "revoke from public" acima NÃO tira esse grant direto.
-- Revogamos explicitamente de anon (roster é só para usuário autenticado; senão o
-- auditoria_seguranca() acusa "rpc_definer_anon" e é risco real de exposição a anônimo).
revoke execute on function public.get_partes_contrato(uuid) from anon;
grant execute on function public.get_partes_contrato(uuid) to authenticated;
