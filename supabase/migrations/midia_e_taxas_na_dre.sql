-- ============================================================================
-- MÍDIA PAGA E TAXA DE GATEWAY ENTRAM NA DRE (08/08)
--
-- Duas lacunas que faziam a DRE mostrar menos custo do que a operação tem.
--
-- 1. MÍDIA. O custo operacional passou a ser pago pelo cartão do Mercado Pago e
--    entra sozinho pelo extrato — MENOS o Google Ads, que não aceita cartão
--    pré-pago. R$ 262 em 14 dias ficavam fora da contabilidade, com a conta 6.1
--    zerada. Não precisa esperar extrato de outro cartão: o script do Google já
--    alimenta `marketing_metricas_dia` todo dia. Esta ponte transforma aquele
--    dado em lançamento contábil.
--
--    ANTI-DUPLICIDADE: `banco = '<canal> (mídia)'` é origem PRÓPRIA e nunca se
--    confunde com extrato bancário — se um dia o cartão que paga o Google for
--    importado, a duplicidade fica VISÍVEL (duas linhas, bancos diferentes) em
--    vez de somar em silêncio. Chave determinística por dia+campanha, sobre o
--    índice único (banco, chave_origem): rodar dez vezes grava uma vez.
--
-- 2. TAXA. Já era capturada, mas ficava numa COLUNA do lançamento e nunca
--    chegava à conta 4.1. Na DRE, "Deduções da receita" aparecia zerada mesmo
--    havendo taxa, e a receita entrava pelo bruto sem o custo de receber — erro
--    que cresce exatamente na proporção do faturamento.
--
-- NOTA DE PROCESSO: a primeira versão da ponte tinha `exception when others` e
-- contou 11 recusas do CHECK de `classificado_por` como "barradas por
-- competência fechada" — mentira, não havia competência fechada nenhuma. É o
-- mesmo antipadrão de erro silenciado que já custou o "relatório vazio" e as
-- conversões do Google. Aqui a competência fechada é verificada ANTES, de
-- propósito, e qualquer outro erro ESTOURA.
-- ============================================================================

create or replace function public.midia_para_conciliacao(p_desde date default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  r record;
  v_gravados int := 0;
  v_barrados int := 0;
  v_desde date := coalesce(p_desde, current_date - 90);
begin
  for r in
    select m.data, m.canal, m.campanha, m.gasto
      from public.marketing_metricas_dia m
     where m.data >= v_desde
       and coalesce(m.gasto, 0) > 0
  loop
    if public.competencia_esta_fechada(r.data) then
      v_barrados := v_barrados + 1;
      continue;
    end if;

    insert into public.conciliacao_lancamento
      (banco, chave_origem, data, descricao, direcao, valor_bruto, valor_liquido, taxa,
       metodo, conta, classificado_por, fornecedor, conciliado)
    values (
      coalesce(r.canal, 'Mídia') || ' (mídia)',
      'midia-' || to_char(r.data, 'YYYYMMDD') || '-' || coalesce(r.campanha, 'geral'),
      r.data,
      coalesce(r.canal, 'Mídia') || ' — ' || coalesce(r.campanha, 'investimento em mídia'),
      'saida',
      round(r.gasto::numeric, 2), round(r.gasto::numeric, 2), 0,
      'cartao', '6.1', 'regra', lower(coalesce(r.canal, 'midia')), false)
    on conflict (banco, chave_origem) do update
       -- O gasto do dia corrente ainda sobe durante o dia: atualiza enquanto ninguém
       -- conferiu. Depois de conciliado, não se mexe no que a pessoa já validou.
       set valor_bruto = excluded.valor_bruto,
           valor_liquido = excluded.valor_liquido
     where conciliacao_lancamento.conciliado = false;

    v_gravados := v_gravados + 1;
  end loop;

  return jsonb_build_object('ok', true, 'gravados', v_gravados,
                            'barrados_competencia_fechada', v_barrados);
end $$;

create or replace function public.taxas_para_conciliacao(p_desde date default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  r record;
  v_gravados int := 0;
  v_barrados int := 0;
  v_desde date := coalesce(p_desde, current_date - 90);
begin
  for r in
    select l.banco, l.chave_origem, l.data, l.taxa, l.descricao
      from public.conciliacao_lancamento l
     where l.data >= v_desde
       and coalesce(l.taxa, 0) > 0
       and l.banco not like '%(taxa)%'
  loop
    if public.competencia_esta_fechada(r.data) then
      v_barrados := v_barrados + 1;
      continue;
    end if;

    insert into public.conciliacao_lancamento
      (banco, chave_origem, data, descricao, direcao, valor_bruto, valor_liquido, taxa,
       conta, classificado_por, fornecedor, conciliado)
    values (
      r.banco || ' (taxa)',
      r.chave_origem || '-taxa',
      r.data,
      'Taxa do gateway — ' || left(coalesce(r.descricao, 'recebimento'), 60),
      'saida',
      round(r.taxa::numeric, 2), round(r.taxa::numeric, 2), 0,
      '4.1', 'regra', lower(split_part(r.banco, ' ', 1)), false)
    on conflict (banco, chave_origem) do nothing;

    v_gravados := v_gravados + 1;
  end loop;

  return jsonb_build_object('ok', true, 'gravados', v_gravados,
                            'barrados_competencia_fechada', v_barrados);
end $$;

revoke all on function public.midia_para_conciliacao(date) from public, anon, authenticated;
revoke all on function public.taxas_para_conciliacao(date) from public, anon, authenticated;
grant execute on function public.midia_para_conciliacao(date) to service_role;
grant execute on function public.taxas_para_conciliacao(date) to service_role;
