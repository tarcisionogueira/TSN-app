-- ─────────────────────────────────────────────────────────────────────────────────────────
-- ASSINANTES: NOME DE QUEM AINDA NÃO ASSINOU + LINK PARA REENCAMINHAR — 28/09/2026
--
-- Print do dono: modal "Assinantes" com 3 linhas "Pendente" em branco. Contrato criado no modo
-- link (e-mail opcional, 20/09): sem `assinante_email` e sem `dados_signatario` até a pessoa
-- assinar — e o nome digitado na criação vive em `assinante_nome`, que esta função não lia.
--
-- `link_token`: só para quem pode REENCAMINHAR (equipe ou quem criou o contrato) e só enquanto
-- a parte não assinou. Co-signatário NUNCA recebe o token dos outros — com ele assinaria no
-- lugar de outra pessoa.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.get_partes_contrato(p_grupo_id uuid)
 returns jsonb language sql security definer set search_path to 'public' as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'nome', coalesce(nullif(c.dados_signatario->>'nome',''), nullif(c.dados_signatario->>'razao_social',''),
                     nullif(btrim(c.assinante_nome),''), c.assinante_email),
    'email', c.assinante_email,
    'assinou', (c.status = 'assinado'),
    'assinado_em', c.assinado_em,
    'requer_testemunha', coalesce(c.requer_testemunha, false),
    'testemunha_assinou', (c.testemunha_em is not null),
    'nome_testemunha', c.nome_testemunha,
    'link_token', case when c.status <> 'assinado' and (public.is_equipe() or c.criado_por = (select auth.uid()))
                       then c.token end
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
$function$;
