-- 10/10 — SPLIT DO HONORÁRIO SOBRE O LÍQUIDO RECEBIDO, com repasse automático (pedido do dono).
--
-- "O split de pagamento é feito de acordo com valores RECEBIDOS e não cobrados, pois há taxas das
-- operadoras." Até aqui _honorarios.calcularDistribuicao dividia o honorário COBRADO (10% do
-- arremate) de uma vez, na finalização. Agora:
--   · cada recebimento guarda o LÍQUIDO (valor_liquido: o que de fato entrou, já sem a taxa da
--     operadora) e quanto dele já está DISPONÍVEL na conta (liquido_compensado);
--   · em_poder = 'advogado' marca dinheiro que ficou com o advogado (cheques do Marcos): conta na
--     base e ABATE da cota dele (decisão do dono, 10/10 — se o cheque voltar, marca-se estornado
--     e a conta refaz sozinha);
--   · honorario_liquidar() credita no saldo de cada um o que é devido E já está disponível —
--     terceiros (advogado/parceiro) antes do admin; roda na finalização e todo dia (cron), e
--     marca 'distribuido' só quando tudo compensou e tudo foi creditado.
-- Os PERCENTUAIS continuam vindo de api/_honorarios.js (calcularDistribuicao) — esta função não
-- decide quem recebe quanto %, só aplica sobre a base líquida.
--
-- Créditos incrementais: o índice uq_saldo_credito_origem é (user, tipo, origem_tipo, origem_id) e
-- api/saque.js lê origem_id como id da arrematação — então origem_id fica o id e o 2º, 3º…
-- crédito da mesma pessoa usa origem_tipo 'arrematacao_r2', 'arrematacao_r3'…

alter table public.honorarios_recebimentos add column if not exists valor_liquido numeric;
alter table public.honorarios_recebimentos add column if not exists liquido_compensado numeric;
alter table public.honorarios_recebimentos add column if not exists liquido_atualizado_em timestamptz;
alter table public.honorarios_recebimentos add column if not exists em_poder text not null default 'plataforma';
alter table public.honorarios_recebimentos add column if not exists compensado_em timestamptz;
do $$ begin
  alter table public.honorarios_recebimentos add constraint honorarios_recebimentos_em_poder_chk check (em_poder in ('plataforma','advogado'));
exception when duplicate_object then null; end $$;

insert into public.regra_negocio (chave, valor, descricao, aplicada_por, ativo)
values ('honorario.split_sobre_liquido',
  '{"base":"liquido_recebido","cheque_com_advogado":"abate_da_cota","credito":"automatico_quando_compensa","ordem":"terceiros_antes_do_admin"}'::jsonb,
  'O honorário de êxito é dividido sobre o valor LÍQUIDO efetivamente recebido (descontadas as taxas das operadoras), não sobre o cobrado. Dinheiro que ficou com o advogado (ex.: cheques) conta na base e abate da cota dele. O repasse é creditado automaticamente à medida que o dinheiro fica disponível na conta da plataforma, terceiros antes do admin (dono, 10/10).',
  array['honorario_liquidar'], true)
on conflict (chave) do update set valor = excluded.valor, descricao = excluded.descricao, aplicada_por = excluded.aplicada_por, ativo = true;

-- p_linhas: [{papel, id, pct}] de calcularDistribuicao; p_total: total_pct (10).
create or replace function public.honorario_liquidar(p_arrematacao uuid, p_linhas jsonb, p_total numeric, p_seco boolean default false)
returns jsonb language plpgsql set search_path to 'public' as $function$
-- Aplica a regra honorario.split_sobre_liquido (ver regra_negocio).
declare
  a record; l jsonb; v_base numeric; v_com_adv numeric; v_disp_bruto numeric; v_pend int;
  v_creditado_total numeric; v_disp numeric; v_cota numeric; v_held numeric; v_cred numeric;
  v_devido numeric; v_acred numeric; v_n int; v_saida jsonb := '[]'::jsonb; v_creditou numeric := 0;
  v_falta_compensar numeric; v_resta numeric := 0; v_ordem jsonb;
begin
  -- Só o servidor (service_role) ou o admin: os percentuais chegam por parâmetro, então ninguém
  -- mais pode chamar (nem para "simular" — o seco também revela valores de terceiros).
  if coalesce(auth.role(), '') <> 'service_role' and public.app_role() is distinct from 'admin' then
    return jsonb_build_object('ok', false, 'erro', 'nao_autorizado');
  end if;
  select * into a from public.arrematacoes where id = p_arrematacao for update;
  if not found then return jsonb_build_object('ok', false, 'erro', 'arrematacao_nao_encontrada'); end if;
  if coalesce(p_total, 0) <= 0 then return jsonb_build_object('ok', false, 'erro', 'total_pct_invalido'); end if;

  select coalesce(sum(coalesce(valor_liquido, valor)), 0),
         coalesce(sum(coalesce(valor_liquido, valor)) filter (where em_poder = 'advogado'), 0),
         coalesce(sum(coalesce(liquido_compensado, 0)) filter (where em_poder = 'plataforma'), 0),
         count(*) filter (where valor_liquido is null),
         coalesce(sum(coalesce(valor_liquido, valor) - coalesce(liquido_compensado, 0)) filter (where em_poder = 'plataforma'), 0)
    into v_base, v_com_adv, v_disp_bruto, v_pend, v_falta_compensar
    from public.honorarios_recebimentos where arrematacao_id = p_arrematacao and status = 'confirmado';

  select coalesce(sum(valor), 0) into v_creditado_total from public.saldo_lancamentos
   where tipo = 'honorario_exito' and origem_id = p_arrematacao::text and origem_tipo like 'arrematacao%';
  v_disp := greatest(0, v_disp_bruto - v_creditado_total);

  -- Terceiros antes do admin: o dinheiro disponível paga primeiro quem não é a plataforma.
  select coalesce(jsonb_agg(x order by (x->>'papel') = 'admin'), '[]'::jsonb) into v_ordem
    from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) x;

  for l in select * from jsonb_array_elements(v_ordem) loop
    v_cota := round(v_base * (l->>'pct')::numeric / p_total, 2);
    v_held := case when l->>'papel' = 'advogado' then v_com_adv else 0 end;
    select coalesce(sum(valor), 0), count(*) into v_cred, v_n from public.saldo_lancamentos
     where user_id = (l->>'id')::uuid and tipo = 'honorario_exito'
       and origem_id = p_arrematacao::text and origem_tipo like 'arrematacao%';
    v_devido := round(v_cota - v_held - v_cred, 2);
    -- Líquido desconhecido (gateway ainda não consultado) → não credita nada: sem o líquido a base
    -- seria o bruto e o repasse sairia maior do que o que entrou.
    v_acred := case when v_pend > 0 or l->>'id' is null then 0 else greatest(0, least(v_devido, v_disp)) end;
    if v_acred >= 0.01 and not p_seco then
      insert into public.saldo_lancamentos (user_id, tipo, valor, origem_tipo, origem_id, descricao, status)
      values ((l->>'id')::uuid, 'honorario_exito', v_acred,
              case when v_n = 0 then 'arrematacao' else 'arrematacao_r' || (v_n + 1) end, p_arrematacao::text,
              format('Honorário de êxito (%s %s%% do líquido recebido) — arremate #%s', l->>'papel', to_char((l->>'pct')::numeric, 'FM990.00'), p_arrematacao),
              'disponivel');
    end if;
    if v_acred >= 0.01 then v_disp := v_disp - v_acred; v_creditou := v_creditou + v_acred; end if;
    v_resta := v_resta + greatest(0, v_devido - v_acred);
    v_saida := v_saida || jsonb_build_object('papel', l->>'papel', 'id', l->>'id', 'nome', l->>'nome', 'pct', (l->>'pct')::numeric,
      'cota', v_cota, 'em_poder', v_held, 'creditado', v_cred, 'devido', v_devido, 'creditar_agora', v_acred);
  end loop;

  if not p_seco then
    if v_pend = 0 and v_falta_compensar < 0.01 and v_resta < 0.01 and a.honorarios_status = 'pago' then
      update public.arrematacoes set honorarios_status = 'distribuido',
        honorarios_split = jsonb_build_object('total_pct', p_total, 'base', 'liquido', 'base_liquida', v_base, 'linhas', v_saida, 'fechado_em', now())
       where id = p_arrematacao;
    else
      update public.arrematacoes set honorarios_split = jsonb_build_object('total_pct', p_total, 'base', 'liquido', 'base_liquida', v_base, 'linhas', v_saida, 'parcial', true, 'apurado_em', now())
       where id = p_arrematacao and honorarios_status <> 'distribuido';
    end if;
  end if;

  return jsonb_build_object('ok', true, 'seco', p_seco, 'cobrado', a.honorarios_valor, 'base_liquida', v_base,
    'com_advogado', v_com_adv, 'disponivel_na_conta', v_disp_bruto, 'falta_compensar', v_falta_compensar,
    'liquido_desconhecido', v_pend, 'creditado_agora', v_creditou, 'resta_a_repassar', v_resta, 'linhas', v_saida);
end;
$function$;

-- Marcos (fb02770c): os 3 cheques ficaram com o advogado (dono, 10/10); o Pix entrou direto na
-- conta (líquido = valor, disponível). O cartão Asaas fica nulo: o líquido vem da API do Asaas.
update public.honorarios_recebimentos set em_poder = 'advogado', valor_liquido = valor
 where arrematacao_id = 'fb02770c-cfda-4f8e-a9ea-8808775bc804' and metodo = 'cheque';
update public.honorarios_recebimentos set valor_liquido = valor, liquido_compensado = valor, liquido_atualizado_em = now()
 where arrematacao_id = 'fb02770c-cfda-4f8e-a9ea-8808775bc804' and metodo = 'pix_externo';
