-- COMISSIONAMENTO MULTINÍVEL (5 níveis) — backend. Estende o afiliado single-level para uma
-- rede de até 5 níveis, com COMPRESSÃO DINÂMICA (só uplines PAGANTES ocupam nível; não-pagante
-- é pulado) e qualificação por assinatura ativa. Ganha sobre assinatura, produto e venda
-- direta — NUNCA sobre honorários de êxito nem recarga de crédito. Sem menção pública ainda;
-- o cliente acompanha no Perfil (tela vem em seguida). Repasse na sexta (fluxo de saque atual).

-- 1) Regras: % por tipo × nível. ativo=true → já vale (o dono pediu "no ar").
create table if not exists public.comissao_regras (
  tipo text not null check (tipo in ('assinatura','produto','venda_direta')),
  nivel smallint not null check (nivel between 1 and 5),
  pct numeric(6,2) not null,
  ativo boolean not null default true,
  primary key (tipo, nivel)
);
insert into public.comissao_regras (tipo, nivel, pct) values
  ('assinatura',1,8),('assinatura',2,4),('assinatura',3,2),('assinatura',4,1),('assinatura',5,1),
  ('produto',1,20),('produto',2,5),('produto',3,3),('produto',4,1),('produto',5,1),
  ('venda_direta',1,10),('venda_direta',2,3),('venda_direta',3,2),('venda_direta',4,1),('venda_direta',5,1)
on conflict (tipo, nivel) do nothing;

alter table public.comissao_regras enable row level security;
drop policy if exists comissao_regras_admin on public.comissao_regras;
create policy comissao_regras_admin on public.comissao_regras for select
  using (exists (select 1 from public.perfis p where p.id = auth.uid() and p.role = 'admin'));

-- 2) Quem é PAGANTE (tem direito a receber comissão). Explorador/consultor/equipe: não.
create or replace function public.eh_pagante(p_role text)
returns boolean language sql immutable as $function$
  select p_role in ('top2','top2_anual','assessorado','assessorado_anual','clube','clube_anual')
$function$;

-- 3) Vínculo de indicação por LINK (?ref=<id> ou código). Qualquer usuário pode ser upline
--    (antes só consultor). Grava indicado_por se ainda vazio e não for o próprio.
create or replace function public.vincular_upline(p_ref text)
returns boolean language plpgsql security definer set search_path to 'public' as $function$
declare v_up uuid;
begin
  if p_ref is null or auth.uid() is null then return false; end if;
  -- tenta como UUID (id do indicador); senão como código de indicação
  begin v_up := p_ref::uuid; exception when others then v_up := null; end;
  if v_up is not null then
    if not exists (select 1 from public.perfis where id = v_up) then v_up := null; end if;
  end if;
  if v_up is null then
    select id into v_up from public.perfis where codigo_indicacao = upper(p_ref) limit 1;
  end if;
  if v_up is null or v_up = auth.uid() then return false; end if;
  update public.perfis set indicado_por = v_up, ultima_indicacao_em = now()
    where id = auth.uid() and indicado_por is null;
  return found;
end; $function$;

-- 4) Distribuição multinível. Sobe a árvore indicado_por, conta só PAGANTES (compressão),
--    até 5 níveis, credita comissoes + saldo_lancamentos (idempotente por pagamento+nível).
--    Chamada pelo webhook de pagamento SÓ para assinatura/produto/venda_direta.
create or replace function public.distribuir_comissao_rede(
  p_comprador uuid, p_tipo text, p_valor numeric, p_gateway_payment_id text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_cur uuid; v_role text; v_next uuid;
  v_nivel int := 0; v_pct numeric; v_valor_com numeric; v_hops int := 0;
  v_total numeric := 0; v_pagos jsonb := '[]'::jsonb; v_oid text;
begin
  if p_comprador is null or coalesce(p_valor,0) <= 0
     or p_tipo not in ('assinatura','produto','venda_direta') or coalesce(p_gateway_payment_id,'') = ''
  then return jsonb_build_object('ok', false, 'erro', 'parametros'); end if;

  select indicado_por into v_cur from public.perfis where id = p_comprador;
  while v_cur is not null and v_nivel < 5 and v_hops < 25 loop
    v_hops := v_hops + 1;
    select role, indicado_por into v_role, v_next from public.perfis where id = v_cur;
    if public.eh_pagante(v_role) then
      v_nivel := v_nivel + 1;
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
    v_cur := v_next;
  end loop;
  return jsonb_build_object('ok', true, 'total', v_total, 'niveis_pagos', v_nivel, 'detalhe', v_pagos);
end; $function$;