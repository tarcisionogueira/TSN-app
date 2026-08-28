-- COMISSÃO DO ADVOGADO PELA VENDA DA ASSESSORIA — 10% (28/08, decisão do dono)
--
-- O advogado apresenta a Assessoria na reunião (termo, cláusula 5) e passa a receber por isso:
-- 10% do valor pago, em paridade com o parceiro indicante.
--
-- POR QUE NÃO PEGA CARONA em `distribuir_comissao_rede`: aquela função percorre a cadeia
-- `perfis.indicado_por`, e o advogado que conduziu a reunião NÃO está necessariamente nela —
-- normalmente não está. Ele é encontrado pelo CASO, não pela indicação. São dois vínculos
-- diferentes com o mesmo cliente, e espremer um no outro faria a comissão ir para a pessoa
-- errada ou não sair.
--
-- QUAL ADVOGADO: o designado no caso mais recente do comprador. Se nenhum caso dele tem
-- advogado, ninguém vendeu pela reunião e não há comissão — o silêncio aqui é resposta
-- correta, não falha, e por isso a RPC devolve `sem_comissao` em vez de erro.
--
-- O GATE inclui `juridico_aceite_em`: sem o termo aceito ele não assumiu as obrigações que
-- tornam essa venda defensável (recomendar com honestidade, não contrariar o próprio parecer).
-- Pagar comissão de venda a quem não aceitou o termo que rege a venda é repasse sem contrato.
--
-- ESCOPO: assessoria apenas. O Leilão Club (R$ 60.000) fica FORA de propósito — 10% ali seriam
-- R$ 6.000 por venda, decisão de negócio que o dono não tomou. Incluir por analogia seria
-- decidir sozinho o tamanho de um repasse que ninguém autorizou.
--
-- ⚠️ `comissoes.tipo` teve de aceitar 'venda_assessoria' (ver migração irmã). O CHECK lista os
-- tipos um a um, e o teste desta função pegou isso ANTES da produção. Sem ele, o primeiro
-- pagamento real de assessoria com advogado designado estouraria dentro do webhook: a RPC roda
-- DEPOIS da ativação, então o cliente teria acesso normalmente e só a comissão sumiria — erro
-- no log que ninguém lê, advogado sem receber, nada na tela dizendo por quê.

insert into public.regra_negocio (chave, valor, descricao, aplicada_por, ativo)
values (
  'comissao.venda_assessoria',
  jsonb_build_object('pct', 10, 'escopo', 'assessorado', 'exige_aceite_juridico', true, 'acumula_com_indicacao', true),
  'O advogado que conduziu a reunião recebe 10% do valor pago da Assessoria, em paridade com o '
  || 'parceiro indicante. Encontrado pelo CASO (casos.advogado_id), não pela cadeia de indicação — '
  || 'são vínculos diferentes com o mesmo cliente. Exige advogado ativo e com o Termo do Advogado '
  || 'Parceiro aceito, porque é esse termo que o obriga a recomendar com honestidade. Acumula com a '
  || 'comissão de indicação quando ele também for o indicante. Pago apenas sobre cobrança RECEBIDA. '
  || 'Escopo: assessoria; o Leilão Club está fora.',
  array['comissao_venda_assessoria'],
  true
)
on conflict (chave) do update
  set valor = excluded.valor, descricao = excluded.descricao,
      aplicada_por = excluded.aplicada_por, ativo = true;

create or replace function public.comissao_venda_assessoria(
  p_comprador uuid, p_valor numeric, p_gateway_payment_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
  -- Regra de negócio aplicada aqui: comissao.venda_assessoria
declare
  v_adv uuid; v_pct numeric; v_com numeric; v_oid text;
begin
  if p_comprador is null or coalesce(p_valor, 0) <= 0 or coalesce(p_gateway_payment_id, '') = '' then
    return jsonb_build_object('ok', false, 'erro', 'parametros');
  end if;

  v_pct := coalesce((public.regra('comissao.venda_assessoria')->>'pct')::numeric, 0);
  if v_pct <= 0 then return jsonb_build_object('ok', true, 'sem_comissao', 'pct_zero'); end if;

  select c.advogado_id into v_adv
    from public.casos c
    join public.perfis a on a.id = c.advogado_id
   where c.cliente_id = p_comprador
     and a.role = 'advogado'
     and coalesce(a.ativo, true)
     and a.juridico_aceite_em is not null
   order by c.created_at desc
   limit 1;

  if v_adv is null then return jsonb_build_object('ok', true, 'sem_comissao', 'sem_advogado_elegivel'); end if;
  if v_adv = p_comprador then return jsonb_build_object('ok', true, 'sem_comissao', 'auto_venda'); end if;

  v_com := round(p_valor * v_pct / 100.0, 2);
  v_oid := p_gateway_payment_id || '-advvenda';

  if exists (select 1 from public.saldo_lancamentos where origem_id = v_oid) then
    return jsonb_build_object('ok', true, 'ja_creditado', true);
  end if;

  insert into public.comissoes
    (beneficiario_id, cliente_id, tipo, origem, referencia, valor_base, percentual, valor_comissao,
     competencia, status, gateway_payment_id, gateway)
  values
    (v_adv, p_comprador, 'venda_assessoria', 'venda_direta', 'Venda da Assessoria (reunião)',
     p_valor, v_pct, v_com, current_date, 'pendente', p_gateway_payment_id, 'rede');

  insert into public.saldo_lancamentos
    (user_id, tipo, valor, origem_tipo, origem_id, descricao, status)
  values
    (v_adv, 'comissao_venda', v_com, 'venda_direta', v_oid, 'Venda da Assessoria (reunião)', 'disponivel');

  return jsonb_build_object('ok', true, 'beneficiario', v_adv, 'pct', v_pct, 'valor', v_com);
end;
$function$;

revoke all on function public.comissao_venda_assessoria(uuid, numeric, text) from public, anon, authenticated;

alter table public.comissoes drop constraint if exists comissoes_tipo_check;
alter table public.comissoes add constraint comissoes_tipo_check
  check (tipo = any (array[
    'afiliado','honorario','infinito','venda_assessoria',
    'rede_n1','rede_n2','rede_n3','rede_n4','rede_n5','rede_n6','rede_n7','rede_n8'
  ]));
