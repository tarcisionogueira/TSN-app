-- 29/08 — A ATRIBUIÇÃO MANUAL PASSA A PODER PROMOVER, E A REGRA SAI DO COMENTÁRIO
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- O dono relatou: *"matheus foi atribuido a arrematacao manualmente, ja deveria ser
-- assessorado"*. Só que promover já existiu e foi REMOVIDO em 30/07, por decisão dele:
--
--   "atribuição manual NÃO gera cobrança e NÃO altera os direitos do usuário — o role e as
--    cotas ficam como estão. (Antes promovia para 'assessorado' + plano_vencimento, o que
--    dava a um explorador as cotas 10/10/3 do Pro sem cobrança — removido.)"
--
-- As duas intenções são legítimas e não se contradizem de verdade: 30/07 protegia a
-- atribuição de ESTUDO (alimentar a IA com uma arrematação real, sem dar plano de graça);
-- hoje o caso é um cliente que de fato contratou. O que faltava era **distinguir os dois**,
-- e essa distinção não pode morar na cabeça de quem clica. Vira uma CAIXA na tela.
--
-- ─── POR QUE ISSO É UMA FUNÇÃO DE BANCO, E NÃO UM `if` NO ENDPOINT ──────────────────────
-- A regra de 30/07 viveu um mês inteiro como **comentário em `api/atribuir-arremate.js`** —
-- e por isso ninguém, nem o dono, tinha como consultá-la antes de pedir o contrário. É
-- exatamente o achado de 08/08 que criou a tabela `regra_negocio`: *"planejamento inteiro em
-- cima de uma regra que não existia"*. `auditoria_regras_negocio()` cobra `aplicada_por`
-- apontando para uma função REAL — então a regra passa a ter um aplicador auditável, e
-- mudar o comportamento sem mexer na regra (ou vice-versa) acusa na auditoria.

create or replace function public.promover_para_assessorado(p_user_id uuid, p_motivo text default null)
returns text language plpgsql security definer set search_path to 'public' as $$
declare v_antes text;
begin
  -- APLICA regra_negocio['atribuicao.promove_assessorado'] — a chave é citada aqui de
  -- propósito: `auditoria_regras_negocio()` procura a menção no corpo da função declarada em
  -- `aplicada_por`, e sem ela a regra sai como ÓRFÃ. Foi assim que "explorador não saca" virou
  -- letra morta em 08/08 (regra escrita, função existente, ninguém aplicando) — e a auditoria
  -- acusou este mesmo defeito na primeira versão desta migração, que é o teste dela funcionando.
  select role into v_antes from perfis where id = p_user_id;
  if v_antes is null then raise exception 'perfil % nao encontrado', p_user_id; end if;

  -- Só PROMOVE. Quem já é assessorado/top2/clube não é rebaixado por uma atribuição, e um
  -- membro da equipe nunca vira cliente por engano — o role da equipe é o que dá acesso a
  -- painel administrativo, e trocá-lo aqui seria uma escalada silenciosa na direção errada.
  if v_antes <> 'explorador' then return v_antes; end if;

  update perfis set role = 'assessorado' where id = p_user_id;

  -- `plano_vencimento` e `plano_ciclo` ficam NULOS de propósito: a versão de antes de 30/07
  -- carimbava um vencimento, e em 29/08 duas contas foram encontradas com data que não
  -- vencia nada — campo com nome de regra que ninguém aplica (a limpeza está em
  -- `concessao_manual_indeterminada_limpa_data_decorativa.sql`). Concessão manual é por
  -- tempo indeterminado; quando virar assinatura paga, o gateway grava os dois.
  begin
    insert into atividade_log (user_id, evento, detalhe)
    values (p_user_id, 'promocao_assessorado_por_atribuicao',
            coalesce(p_motivo, 'atribuicao manual de arremate com promocao marcada'));
  exception when others then null;  -- log é best-effort; jamais derruba a promoção
  end;
  return 'assessorado';
end $$;

revoke all on function public.promover_para_assessorado(uuid, text) from public, anon, authenticated;

comment on function public.promover_para_assessorado is
  'Promove explorador -> assessorado na atribuicao manual de arremate, quando o admin marca a '
  'opcao. Nunca rebaixa e nunca toca em role de equipe. Sem service key nao roda (revoke acima) '
  'porque conceder plano e decisao de admin, nao de usuario.';

insert into regra_negocio (chave, valor, descricao, aplicada_por, ativo) values (
  'atribuicao.promove_assessorado',
  jsonb_build_object(
    'padrao', false,
    'opcional_na_tela', true,
    'so_promove_explorador', true,
    'nao_carimba_vencimento', true,
    'nao_gera_cobranca', true),
  'Atribuicao manual de arremate NAO promove por padrao (decisao do dono, 30/07: atribuicao de '
  'ESTUDO alimenta a IA com uma arrematacao real e nao pode dar as cotas 10/10/3 do Pro de graca). '
  'Mas o admin pode MARCAR a promocao quando o caso e de cliente que contratou de fato (decisao do '
  'dono, 29/08, a partir do Matheus Barros: atribuido manualmente e ainda explorador). So promove '
  'quem esta em explorador, nunca rebaixa e nunca toca em role de equipe. Nao carimba '
  'plano_vencimento: concessao manual e por tempo indeterminado — data que nao vence nada foi '
  'defeito real encontrado em 29/08.',
  array['promover_para_assessorado'],
  true)
on conflict (chave) do update
  set valor = excluded.valor, descricao = excluded.descricao,
      aplicada_por = excluded.aplicada_por, ativo = true;
