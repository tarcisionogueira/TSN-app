-- ════════════════════════════════════════════════════════════════════════════
-- BidPro Brasil — modelo de comissão alinhado ao Clube Conselheiro + envelope PJ.
-- Aplicado com a rede VAZIA (0 uplines, 0 comissões) → inerte e seguro.
--
-- Modelo (ver docs/PLANO_COMISSIONAMENTO_MLM.md §12.2–12.9):
--  • Comissão de Indicação (venda direta): FLAT 20% (N1) — base = entrada, recorrente.
--  • Bônus de Equipe (multinível): N2..N6 = 4/3/2/2/1% — a graduação (rank) governa a
--    PROFUNDIDADE (max_nivel). Fonte: números reais do Clube Conselheiro.
--  • Envelope jurídico: parceiro-cliente saca via PJ (B2B), campos em perfis.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Ranks: nomes finais (linha história+liderança) + profundidade (max_nivel) + piso de entrada no r1
alter table public.comissao_ranks add column if not exists max_nivel int not null default 1;
update public.comissao_ranks set nome='Pioneiro',   max_nivel=1, min_diretos_pagantes=1, min_rede_pagante=1 where rank_key='r1';
update public.comissao_ranks set nome='Fundador',   max_nivel=2 where rank_key='r2';
update public.comissao_ranks set nome='Mestre',     max_nivel=3 where rank_key='r3';
update public.comissao_ranks set nome='Mentor',     max_nivel=4 where rank_key='r4';
update public.comissao_ranks set nome='Embaixador', max_nivel=5 where rank_key='r5';
update public.comissao_ranks set nome='Lenda',      max_nivel=6 where rank_key='r6';

-- 2) Comissão de Indicação (flat) — config única
alter table public.rank_config add column if not exists comissao_indicacao_pct numeric not null default 20;

-- 3) Modelo unificado nos 3 trilhos: N1 = indicação 20% ; N2..N6 = bônus de equipe 4/3/2/2/1 ; N7..N10 = 0
update public.comissao_regras
   set pct = case nivel when 1 then 20 when 2 then 4 when 3 then 3 when 4 then 2 when 5 then 2 when 6 then 1 else 0 end,
       ativo = true
 where tipo in ('assinatura','produto','venda_direta');

-- 4) Envelope B2B: dados da PJ do parceiro (saque condicionado)
alter table public.perfis add column if not exists cnpj text;
alter table public.perfis add column if not exists razao_social text;
alter table public.perfis add column if not exists pj_chave_pix text;
alter table public.perfis add column if not exists pj_validada_em timestamptz;

-- 5) meu_nivel(): painel do parceiro. Usa auth.uid() — cada parceiro só vê o PRÓPRIO nível.
create or replace function public.meu_nivel()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $fn$
declare v_uid uuid := auth.uid(); m record; v_rank text; v_ord int; v_prox record; v_indic numeric;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'erro', 'sem_sessao'); end if;
  select comissao_indicacao_pct into v_indic from public.rank_config where id = 1;
  select * into m from public.rede_metricas_parceiro(v_uid);
  v_rank := public.rank_do_parceiro(v_uid);
  select ordem into v_ord from public.comissao_ranks where rank_key = v_rank;
  select * into v_prox from public.comissao_ranks where ativo and ordem > coalesce(v_ord, 0) order by ordem asc limit 1;
  return jsonb_build_object(
    'ok', true,
    'tem_rank', v_rank is not null,
    'comissao_indicacao_pct', coalesce(v_indic, 20),
    'metricas', jsonb_build_object('diretos_pagantes', coalesce(m.diretos_pagantes,0), 'rede_pagante', coalesce(m.rede_pagante,0)),
    'rank_atual', (select jsonb_build_object('nome', nome, 'ordem', ordem, 'max_nivel', max_nivel) from public.comissao_ranks where rank_key = v_rank),
    'proximo', (case when v_prox.rank_key is null then null else jsonb_build_object(
        'nome', v_prox.nome,
        'faltam_diretos', greatest(v_prox.min_diretos_pagantes - coalesce(m.diretos_pagantes,0), 0),
        'faltam_rede', greatest(v_prox.min_rede_pagante - coalesce(m.rede_pagante,0), 0)
      ) end),
    'trilha', (select jsonb_agg(jsonb_build_object('nome', nome, 'atingido', ordem <= coalesce(v_ord,0)) order by ordem) from public.comissao_ranks where ativo)
  );
end; $fn$;
grant execute on function public.meu_nivel() to authenticated;

-- 6) distribuir_comissao_rede: + DEPTH-GATE por rank (o upline só recebe o nível que seu rank destrava)
CREATE OR REPLACE FUNCTION public.distribuir_comissao_rede(p_comprador uuid, p_tipo text, p_valor numeric, p_gateway_payment_id text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_cur uuid; v_role text; v_next uuid; v_aceite timestamptz;
  v_ativo boolean; v_inad timestamptz; v_venc date;
  v_nivel int := 0; v_pct numeric; v_valor_com numeric; v_hops int := 0;
  v_total numeric := 0; v_pagos jsonb := '[]'::jsonb; v_oid text; v_maxdepth int;
  v_max int := (select coalesce(max(nivel),5) from public.comissao_regras where ativo);
begin
  if p_comprador is null or coalesce(p_valor,0) <= 0
     or p_tipo not in ('assinatura','produto','venda_direta') or coalesce(p_gateway_payment_id,'') = ''
  then return jsonb_build_object('ok', false, 'erro', 'parametros'); end if;

  select indicado_por into v_cur from public.perfis where id = p_comprador;
  while v_cur is not null and v_nivel < v_max and v_hops < 30 loop
    v_hops := v_hops + 1;
    select role, indicado_por, parceiro_aceite_em, ativo, inadimplente_desde, plano_vencimento
      into v_role, v_next, v_aceite, v_ativo, v_inad, v_venc
      from public.perfis where id = v_cur;
    if public.eh_pagante(v_role) and v_aceite is not null
       and coalesce(v_ativo, true) and v_inad is null
       and (v_venc is null or v_venc >= current_date)
    then
      v_nivel := v_nivel + 1;
      -- DEPTH-GATE: o upline só recebe ESTE nível se o rank dele o destrava (max_nivel).
      -- Sem rank ainda → só o N1 (base). A fatia não paga fica com a empresa (compressão por mérito).
      select coalesce(cr.max_nivel, 1) into v_maxdepth
        from public.perfis pp left join public.comissao_ranks cr on cr.rank_key = pp.rank_key
        where pp.id = v_cur;
      if v_nivel <= coalesce(v_maxdepth, 1) then
        select pct into v_pct from public.comissao_regras where tipo = p_tipo and nivel = v_nivel and ativo;
        if coalesce(v_pct,0) > 0 then
          v_valor_com := round(p_valor * v_pct / 100.0, 2);
          v_oid := p_gateway_payment_id || '-n' || v_nivel;
          if v_valor_com > 0 and not exists (
            select 1 from public.saldo_lancamentos where origem_id = v_oid and tipo = 'comissao_rede'
          ) then
            insert into public.comissoes (beneficiario_id, cliente_id, tipo, origem, referencia, valor_base, percentual, valor_comissao, competencia, status, gateway_payment_id, gateway)
              values (v_cur, p_comprador, 'rede_n'||v_nivel, p_tipo, 'Comissão de rede nível '||v_nivel,
                      p_valor, v_pct, v_valor_com, current_date, 'pendente', p_gateway_payment_id, 'rede');
            insert into public.saldo_lancamentos (user_id, tipo, valor, origem_tipo, origem_id, descricao, status)
              values (v_cur, 'comissao_rede', v_valor_com, p_tipo, v_oid,
                      'Comissão nível '||v_nivel||' ('||p_tipo||')', 'disponivel');
            v_total := v_total + v_valor_com;
            v_pagos := v_pagos || jsonb_build_object('nivel', v_nivel, 'beneficiario', v_cur, 'pct', v_pct, 'valor', v_valor_com);
          end if;
        end if;
      end if;
    end if;
    v_cur := v_next;
  end loop;
  return jsonb_build_object('ok', true, 'total', v_total, 'niveis_pagos', v_nivel, 'detalhe', v_pagos);
end; $function$;

comment on function public.meu_nivel() is 'Painel do parceiro (BidPro Brasil): nivel atual, comissao de indicacao, metricas e proximo nivel. auth.uid — cada parceiro so ve o proprio.';
