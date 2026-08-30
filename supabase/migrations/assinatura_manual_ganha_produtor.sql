-- 29/08 — A ASSESSORIA PAGA POR FORA NÃO TINHA ONDE SER REGISTRADA
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- O dono relatou um cliente que "contratou uma nova assessoria e pagou por fora do sistema" e
-- perguntou como registrar. Investigado: **não havia como**. `plano_assinaturas` existe desde
-- `add_planos_fidelidade.sql`, o Admin tem tela que LISTA os assessorados a partir dela e
-- botões de cancelar/estender — e **nenhum `insert` existia em lugar nenhum do código**
-- (`api/`, `src/`, `scripts/`). A tabela tinha **0 linhas**.
--
-- É a mesma forma do P1 de ontem (schema e tela em produção esperando um produtor que ninguém
-- escreveu), e o efeito era o que o dono via: o cliente aparece "Assessoria · PAGO" — isso vem
-- do `role`, não de pagamento — com **0 pagamentos e 0 contratos**, e some da lista de
-- assessorados do próprio Admin. O dinheiro que entrou por fora existia só na memória de quem
-- fechou o acordo.
--
-- ─── DECISÕES DE DESENHO ────────────────────────────────────────────────────────────────
-- • **Fidelidade e acesso saem de `planos_config`**, nunca digitados: são POLÍTICA do plano.
--   Campo digitado vira divergência entre o que a tela diz e o que o cancelamento calcula.
-- • **Idempotente por plano ativo**: dois cliques não criam duas assinaturas. Devolve a
--   existente em vez de erro — repetir a ação não é engano do admin, é o mesmo pedido chegando
--   duas vezes, e a tela precisa distinguir "registrei" de "já havia".
-- • **A promoção reusa `promover_para_assessorado()`** (a mesma da atribuição manual, criada
--   hoje): a regra de quem pode virar assessorado mora num lugar só, e nunca rebaixa nem toca
--   em role de equipe.
-- • **NÃO carimba `plano_pago_em`.** Esse campo é a âncora da garantia de 7 dias do CDC
--   (`regra_negocio['garantia.ancora_7d']`). Se pagamento FORA do gateway abre essa janela, e a
--   partir de quando, é decisão comercial do dono — não deste registro. Fica explícito na
--   resposta e na tela, para não virar omissão silenciosa.
create or replace function public.registrar_assinatura_manual(
  p_user_id         uuid,
  p_plano_key       text,
  p_forma_pagamento text default 'externo',
  p_valor_total     numeric default null,
  p_valor_mensal    numeric default null,
  p_imovel_id       uuid    default null,
  p_notas           text    default null,
  p_inicio          timestamptz default now(),
  p_admin           uuid    default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_cfg planos_config%rowtype; v_id uuid; v_role text; v_ja uuid;
begin
  -- APLICA regra_negocio['assinatura.registro_manual'] — a chave é citada aqui de propósito:
  -- `auditoria_regras_negocio()` procura a menção no corpo da função declarada em
  -- `aplicada_por`, e sem ela a regra sai como ÓRFÃ.
  if p_user_id is null then raise exception 'p_user_id obrigatorio'; end if;

  select * into v_cfg from planos_config where plano_key = p_plano_key;
  if not found then raise exception 'plano % nao existe em planos_config', p_plano_key; end if;

  select id into v_ja from plano_assinaturas
   where user_id = p_user_id and plano_key = p_plano_key and status = 'ativo' limit 1;
  if v_ja is not null then
    return jsonb_build_object('id', v_ja, 'criada', false, 'motivo', 'ja havia assinatura ativa deste plano');
  end if;

  insert into plano_assinaturas (
    user_id, plano_key, status, inicio,
    fidelidade_fim, acesso_fim, imovel_id,
    valor_mensal, forma_pagamento, valor_total_pago, notas_admin)
  values (
    p_user_id, p_plano_key, 'ativo', p_inicio,
    case when v_cfg.fidelidade_meses is not null then p_inicio + (v_cfg.fidelidade_meses || ' months')::interval end,
    case when v_cfg.acesso_meses     is not null then p_inicio + (v_cfg.acesso_meses     || ' months')::interval end,
    p_imovel_id,
    coalesce(p_valor_mensal, v_cfg.preco), p_forma_pagamento, p_valor_total, p_notas)
  returning id into v_id;

  if p_plano_key = 'assessorado' then
    v_role := public.promover_para_assessorado(p_user_id, 'assinatura manual registrada');
  else
    select role into v_role from perfis where id = p_user_id;
  end if;

  begin
    insert into atividade_log (user_id, ator_id, evento, detalhe)
    values (p_user_id, p_admin, 'assinatura_manual_registrada',
            coalesce(p_plano_key,'?') || ' · ' || coalesce(p_forma_pagamento,'?')
            || case when p_valor_total is not null then ' · R$ ' || p_valor_total::text else '' end);
  exception when others then null;   -- log best-effort; jamais derruba o registro
  end;

  return jsonb_build_object('id', v_id, 'criada', true, 'role', v_role,
                            'fidelidade_meses', v_cfg.fidelidade_meses,
                            'acesso_meses', v_cfg.acesso_meses);
end $$;

revoke all on function public.registrar_assinatura_manual(uuid,text,text,numeric,numeric,uuid,text,timestamptz,uuid)
  from public, anon, authenticated;
grant execute on function public.registrar_assinatura_manual(uuid,text,text,numeric,numeric,uuid,text,timestamptz,uuid)
  to service_role;

insert into regra_negocio (chave, valor, descricao, aplicada_por, ativo) values (
  'assinatura.registro_manual',
  jsonb_build_object(
    'planos', array['assessorado','clube'],
    'formas', array['externo','a_vista','parcelado','recorrente'],
    'idempotente_por_plano_ativo', true,
    'fidelidade_e_acesso_vem_de_planos_config', true,
    'promove_assessorado', true,
    'nao_ancora_garantia_7d', true),
  'Assessoria/Clube contratada FORA do gateway (pagamento externo, acordo comercial) e '
  'registrada pelo admin em plano_assinaturas. Existe porque a tabela e a tela do Admin ja '
  'existiam e NENHUM insert existia em lugar nenhum do codigo: a tabela tinha 0 linhas e o '
  'cliente aparecia como assessorado pelo role, sem contrato, sem pagamento e fora da lista de '
  'assessorados. Fidelidade e acesso saem de planos_config (politica do plano, nao campo '
  'digitado). Idempotente por plano ativo. NAO carimba plano_pago_em — a ancora da garantia de '
  '7 dias do CDC sobre pagamento externo e decisao do dono, nao do registro.',
  array['registrar_assinatura_manual'],
  true)
on conflict (chave) do update
  set valor = excluded.valor, descricao = excluded.descricao,
      aplicada_por = excluded.aplicada_por, ativo = true;
