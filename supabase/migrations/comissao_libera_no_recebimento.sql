-- COMISSÃO SÓ FICA SACÁVEL QUANDO O DINHEIRO CHEGA (regra do dono, 24/09: "comissões devem
-- ficar disponíveis de acordo com recebimento e não venda... não podemos bancar comissão para
-- receber depois").
--
-- O QUE ESTAVA ERRADO, medido: as quatro funções que creditam comissão (distribuir_comissao_rede,
-- comissao_venda_assessoria, confirmar_compra_produto e o bônus infinito dentro da primeira)
-- inseriam o lançamento JÁ 'disponivel' no instante em que o gateway APROVAVA o pagamento. No
-- cartão, o Mercado Pago libera o dinheiro em ~30 dias e o Asaas em D+32 — o parceiro podia sacar
-- a comissão antes de a BidPro receber a venda que a gerou, e um chargeback nesse intervalo
-- deixava o saque feito sobre dinheiro que nunca entrou.
--
-- A TRAVA MORA NO BANCO, NÃO EM CADA FUNÇÃO: um BEFORE INSERT em saldo_lancamentos converte
-- toda comissão positiva em 'a_liberar' com `liberar_em` = data de liberação do gateway
-- (`pagamento_liberacao`, gravada pelos webhooks) ou, sem ela, +33 dias (o pior prazo real:
-- Asaas D+32). Função de comissão nova que surgir amanhã já nasce presa, sem ninguém lembrar.
-- `liberar_comissoes_recebidas()` vira 'disponivel' o que venceu (cron diário do aviso de saldo).
-- Estorno de comissão ainda presa CANCELA a comissão em vez de lançar negativo sobre o disponível.

alter table public.saldo_lancamentos add column if not exists liberar_em timestamptz;
create index if not exists saldo_lancamentos_a_liberar_idx on public.saldo_lancamentos (liberar_em) where status = 'a_liberar';

create table if not exists public.pagamento_liberacao (
  gateway_payment_id text primary key,
  gateway            text,
  liberar_em         timestamptz not null,
  registrado_em      timestamptz not null default now()
);
alter table public.pagamento_liberacao enable row level security;
revoke all on public.pagamento_liberacao from anon, authenticated;

create or replace function public.saldo_lancamento_segura_ate_receber()
returns trigger language plpgsql set search_path to 'public' as $$
declare v_pay text; v_lib timestamptz; v_orig record; v_regra jsonb; v_prazo interval;
begin
  if new.tipo in ('comissao_rede', 'comissao_infinito', 'comissao_venda', 'honorario_exito')
     and new.status = 'disponivel' and coalesce(new.valor, 0) > 0 then
    -- A regra é DADO: desligar `comissao.libera_no_recebimento` volta ao comportamento antigo.
    select valor into v_regra from regra_negocio where chave = 'comissao.libera_no_recebimento' and ativo;
    if v_regra is null or coalesce((v_regra->>'ativo')::boolean, true) = false then return new; end if;
    v_prazo := make_interval(days => coalesce((v_regra->>'prazo_sem_data_dias')::int, 33));
    if new.tipo = 'honorario_exito' then
      -- Honorário repassado à equipe: libera quando a ÚLTIMA parte recebida do cliente cai na
      -- conta. Gateway → data do gateway; Pix externo → na hora; cheque → +3 dias (compensação).
      select max(case
                   when r.gateway_payment_id is not null then coalesce(pl.liberar_em, r.criado_em + v_prazo)
                   when r.metodo = 'cheque' then r.criado_em + interval '3 days'
                   else r.criado_em end)
        into v_lib
        from honorarios_recebimentos r
        left join pagamento_liberacao pl on pl.gateway_payment_id = r.gateway_payment_id
       where r.arrematacao_id::text = new.origem_id and r.status = 'confirmado';
    else
      v_pay := split_part(coalesce(new.origem_id, ''), '-', 1);
      select liberar_em into v_lib from pagamento_liberacao where gateway_payment_id = v_pay;
    end if;
    new.liberar_em := coalesce(new.liberar_em, v_lib, now() + v_prazo);
    -- Liberação já passou (Pix, ou webhook atrasado): nasce disponível, como antes.
    if new.liberar_em > now() then new.status := 'a_liberar'; end if;
  elsif new.tipo = 'estorno_comissao' and new.origem_id like 'estorno-%' then
    select id, status into v_orig from saldo_lancamentos
     where origem_id = substr(new.origem_id, 9) and user_id = new.user_id limit 1;
    if v_orig.status = 'a_liberar' then
      update saldo_lancamentos set status = 'cancelado' where id = v_orig.id;
      return null;   -- nunca chegou ao disponível: cancelar basta, não há o que descontar
    elsif v_orig.status = 'cancelado' then
      return null;   -- já cancelada por um estorno anterior: idempotente
    end if;
  end if;
  return new;
end $$;

drop trigger if exists saldo_lancamento_segura_ate_receber on public.saldo_lancamentos;
create trigger saldo_lancamento_segura_ate_receber before insert on public.saldo_lancamentos
  for each row execute function public.saldo_lancamento_segura_ate_receber();

-- Webhook grava a data real de liberação; comissão já presa deste pagamento acompanha.
create or replace function public.registrar_liberacao_pagamento(p_gateway_payment_id text, p_liberar_em timestamptz, p_gateway text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  if coalesce(p_gateway_payment_id, '') = '' or p_liberar_em is null then
    return jsonb_build_object('ok', false, 'erro', 'payment_id e data obrigatórios');
  end if;
  insert into pagamento_liberacao (gateway_payment_id, gateway, liberar_em)
  values (p_gateway_payment_id, p_gateway, p_liberar_em)
  on conflict (gateway_payment_id) do update set liberar_em = excluded.liberar_em, registrado_em = now();
  update saldo_lancamentos set liberar_em = p_liberar_em
   where status = 'a_liberar' and origem_id like p_gateway_payment_id || '-%';
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'lancamentos_ajustados', n);
end $$;
revoke all on function public.registrar_liberacao_pagamento(text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.registrar_liberacao_pagamento(text, timestamptz, text) to service_role;

create or replace function public.liberar_comissoes_recebidas()
returns int language plpgsql security definer set search_path to 'public' as $$
declare n int; v_ativa boolean;
begin
  -- Regra `comissao.libera_no_recebimento` desligada = nada fica preso: libera tudo.
  select coalesce((valor->>'ativo')::boolean, true) and ativo into v_ativa
    from regra_negocio where chave = 'comissao.libera_no_recebimento';
  update saldo_lancamentos set status = 'disponivel'
   where status = 'a_liberar' and (liberar_em <= now() or v_ativa is not true);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.liberar_comissoes_recebidas() from public, anon, authenticated;
grant execute on function public.liberar_comissoes_recebidas() to service_role;

-- SALDO: 'a_liberar' não é sacável. Coluna nova no FIM da view (a ordem das antigas não muda).
create or replace view public.saldo_usuarios as
 SELECT p.id AS user_id, p.nome, p.role, p.chave_pix,
    COALESCE(sum(sl.valor) FILTER (WHERE sl.status <> ALL (ARRAY['cancelado'::text, 'a_liberar'::text])), 0::numeric) AS saldo_disponivel,
    COALESCE(- sum(sl.valor) FILTER (WHERE sl.status = 'sacado'::text), 0::numeric) AS total_sacado,
    COALESCE(- sum(sl.valor) FILTER (WHERE sl.status = 'solicitado'::text), 0::numeric) AS saque_pendente,
    COALESCE(sum(sl.valor) FILTER (WHERE sl.status = 'a_liberar'::text), 0::numeric) AS saldo_a_liberar
   FROM perfis p
     LEFT JOIN saldo_lancamentos sl ON sl.user_id = p.id
  WHERE p.role = ANY (ARRAY['admin'::text, 'analista'::text, 'advogado'::text, 'consultor'::text, 'top2'::text, 'top2_anual'::text, 'assessorado'::text, 'assessorado_anual'::text, 'clube'::text, 'clube_anual'::text, 'explorador'::text])
  GROUP BY p.id, p.nome, p.role, p.chave_pix;

-- As funções que medem SALDO para sacar/reverter/exibir: mesma exclusão. Reescrita por
-- substituição sobre a definição VIGENTE (não sobre snapshot — ver forma 7b do CLAUDE.md) e
-- com prova: se a âncora não existir, a migração FALHA em vez de passar sem mudar nada.
do $$
declare f text; d text; antes text;
begin
  foreach f in array array['saque_avaliar','solicitar_saque_ledger','solicitar_saque_pj_pendente','reverter_saldo_abandono','admin_usuario_360'] loop
    select pg_get_functiondef(p.oid) into d from pg_proc p where p.proname = f and p.pronamespace = 'public'::regnamespace;
    if d is null then raise exception 'função % não encontrada', f; end if;
    if position('a_liberar' in d) > 0 then continue; end if;   -- idempotente
    antes := d;
    d := replace(d, 'status <> ''cancelado'')', 'status not in (''cancelado'',''a_liberar''))');
    d := replace(d, 'status <> ''cancelado'';', 'status not in (''cancelado'',''a_liberar'');');
    if d = antes then raise exception 'âncora de saldo não encontrada em %', f; end if;
    execute d;
  end loop;
end $$;

-- Abandono (Termos): o que ainda estava a liberar também caduca, senão reapareceria depois.
do $$
declare d text;
begin
  select pg_get_functiondef('public.reverter_saldo_abandono'::regproc) into d;
  if position('cancelado'' where user_id=p_user_id and status=''a_liberar''' in d) > 0 then return; end if;
  d := replace(d, '  update public.perfis set abandono_em = now() where id = p_user_id;',
                  '  update saldo_lancamentos set status=''cancelado'' where user_id=p_user_id and status=''a_liberar'';' || chr(10) ||
                  '  update public.perfis set abandono_em = now() where id = p_user_id;');
  if position('status=''a_liberar''' in d) = 0 then raise exception 'âncora de abandono não encontrada'; end if;
  execute d;
end $$;

-- Regra de negócio como DADO (auditoria_regras_negocio acusa se nenhuma função aplicar).
insert into public.regra_negocio (chave, valor, descricao, aplicada_por, ativo)
values ('comissao.libera_no_recebimento',
        '{"ativo": true, "prazo_sem_data_dias": 33}'::jsonb,
        'Comissão (rede, bônus infinito, venda de produto, venda da assessoria) e honorário de êxito repassado à equipe só ficam SACÁVEIS quando o dinheiro da venda chega à BidPro — na data de liberação do gateway (MP money_release_date; Asaas estimatedCreditDate/creditDate), gravada pelos webhooks em pagamento_liberacao. Sem a data: +33 dias (pior prazo real, Asaas D+32). Até lá o lançamento fica ''a_liberar'' (visível, não sacável). Estorno de comissão ainda presa cancela a comissão. Regra do dono, 24/09: não bancar comissão para receber depois.',
        array['saldo_lancamento_segura_ate_receber','liberar_comissoes_recebidas'], true)
on conflict (chave) do update set valor = excluded.valor, descricao = excluded.descricao, aplicada_por = excluded.aplicada_por, ativo = true;

-- Retroativo: comissão disponível cuja venda ainda não completou o prazo de recebimento volta a
-- ficar presa até lá (created < 33 dias). Nada foi sacado dela (único saque do ledger: cancelado).
update public.saldo_lancamentos set status = 'a_liberar', liberar_em = criado_em + interval '33 days'
 where tipo in ('comissao_rede','comissao_infinito','comissao_venda') and status = 'disponivel'
   and valor > 0 and criado_em + interval '33 days' > now();
