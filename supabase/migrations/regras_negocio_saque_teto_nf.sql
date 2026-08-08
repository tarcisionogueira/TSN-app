-- ============================================================================
-- REGRAS DE NEGÓCIO COMO DADO + TETO DE SAQUE + NOTA FISCAL (08/08)
--
-- POR QUE ESTA MIGRAÇÃO EXISTE (o pedido do dono): "é para esse tipo de
-- divergência não voltar a acontecer, pois acaba gerando uma confusão na hora
-- de montarmos um planejamento".
--
-- A divergência: `api/saque.js` DOCUMENTAVA a regra do dono ("Explorador indica
-- normalmente; para sacar, precisa de assinatura ativa") e até definia a função
-- `podeReceber()` para ela — mas essa função só alimentava um AVISO na tela. Nem
-- a API nem a RPC bloqueavam. A regra existia em comentário e em texto de
-- planejamento; não existia em lugar nenhum que o dinheiro atravessasse.
--
-- A CAUSA-RAIZ não foi esquecimento: foram DOIS CÉREBROS. A tela decidia por um
-- caminho (`podeReceber`) e o banco por outro (`PLANOS_PAGOS`). Enquanto houver
-- dois, eles divergem — é questão de tempo.
--
-- O CONSERTO tem três partes, e as três estão aqui:
--   1. `regra_negocio` — a regra vira DADO. Um valor, um lugar. Quem planeja lê
--      a mesma linha que o motor obedece; não há "versão do documento".
--   2. `saque_avaliar()` — UM avaliador, sem efeito colateral. A tela chama para
--      mostrar, a RPC chama para decidir e a auditoria chama para conferir. Não
--      dá para a tela e o banco discordarem porque é o mesmo código.
--   3. `auditoria_regras_negocio()` — acusa regra declarada que ninguém aplica,
--      e função de dinheiro que não delega ao avaliador. Roda no ritual, custo
--      zero. É a checagem que teria pego o bug no dia em que ele nasceu.
--
-- A MUDANÇA DE NEGÓCIO que entra junto (decisão do dono, 08/08):
--   - O parceiro GRÁTIS (explorador) passa a GANHAR comissão em todos os fluxos.
--     "Os valores da comissão deles são dele" — não há teto de GANHO.
--   - A trava é no SAQUE, e serve para trazer o parceiro para o plano pago:
--     até R$ 2.500 no mês ele saca direto; ao ultrapassar isso no mês, passa a
--     exigir ser PAGANTE e anexar NOTA FISCAL, conferida pela IA.
--
-- Idempotente. Seguro reexecutar.
-- ============================================================================

-- ── 1. A regra vira dado ────────────────────────────────────────────────────
create table if not exists public.regra_negocio (
  chave         text primary key,
  valor         jsonb not null,
  descricao     text not null,
  -- Funções que DEVEM aplicar esta regra. A auditoria confere que cada uma
  -- delas realmente cita a chave — regra sem aplicador é o bug de origem.
  aplicada_por  text[] not null default '{}',
  ativo         boolean not null default true,
  atualizado_em timestamptz not null default now()
);

comment on table public.regra_negocio is
  'Regras de negócio como DADO (fonte única). Planejamento e motor leem a MESMA linha. Ver auditoria_regras_negocio().';

insert into public.regra_negocio (chave, valor, descricao, aplicada_por) values
  ('saque.teto_sem_nf',
   '{"valor": 2500, "janela": "mes"}'::jsonb,
   'Teto de saque, por mês-calendário, que dispensa nota fiscal. Ao ultrapassar dentro do mês, o saque passa a exigir plano pago + NF conferida. Para virar teto vitalício, troque "janela" para "vitalicio".',
   array['saque_avaliar']),
  ('saque.exige_kyc',
   '{"ativo": true}'::jsonb,
   'Identidade validada (selfie + documento) é pré-requisito de QUALQUER saque, em qualquer valor. Antes, o KYC só era exigido de quem já era pagante — o grátis tinha MENOS controle que o assinante, o inverso do pretendido.',
   array['saque_avaliar']),
  ('saque.acima_do_teto',
   '{"exige_pagante": true, "exige_nf": true}'::jsonb,
   'O que passa a ser exigido depois de estourar o teto do mês: estar em plano pago E anexar nota fiscal (conferida pela IA, com validação do link/QR da prefeitura quando houver).',
   array['saque_avaliar']),
  ('comissao.gratis_ganha',
   '{"ativo": true}'::jsonb,
   'O parceiro grátis (explorador) GANHA comissão em todos os fluxos. Não há teto de ganho — o valor é dele. A trava fica no saque.',
   array['pode_ganhar_comissao'])
on conflict (chave) do nothing;

alter table public.regra_negocio enable row level security;
drop policy if exists "Equipe lê regras" on public.regra_negocio;
create policy "Equipe lê regras" on public.regra_negocio for select using (public.is_equipe());

create or replace function public.regra(p_chave text)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select valor from public.regra_negocio where chave = p_chave and ativo
$$;

-- ── 2. Quem pode GANHAR comissão ────────────────────────────────────────────
-- Lê a regra em vez de embutir a lista: mudar a política é `update regra_negocio`.
create or replace function public.pode_ganhar_comissao(p_role text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.eh_pagante(p_role)
      or (coalesce((public.regra('comissao.gratis_ganha')->>'ativo')::boolean, false)
          and p_role = 'explorador')
$$;

-- ── 3. Nota fiscal do saque ─────────────────────────────────────────────────
create table if not exists public.saque_nf (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  -- Preenchido quando a NF é vinculada a uma solicitação específica.
  -- bigint, não uuid: `saldo_lancamentos.id` é bigint (conferido no catálogo).
  lancamento_id bigint references public.saldo_lancamentos(id) on delete set null,
  storage_path  text not null,
  valor_pedido  numeric(12,2) not null,
  -- O que a IA leu do documento.
  numero            text,
  emitente_cnpj     text,
  tomador_cnpj      text,
  valor_nf          numeric(12,2),
  emitida_em        date,
  verificacao_url   text,
  -- 'confirmada' = o link/QR da prefeitura respondeu e bate. 'sem_link' = a nota
  -- não traz verificação (não é culpa do parceiro, mas não é prova de emissão).
  verificacao_status text not null default 'nao_checada',
  ia_veredito   jsonb,
  -- 'aprovada' | 'reprovada' | 'revisao_manual'
  status        text not null default 'revisao_manual',
  motivo        text,
  revisado_por  uuid references auth.users(id),
  revisado_em   timestamptz,
  criado_em     timestamptz not null default now()
);

create index if not exists ix_saque_nf_user on public.saque_nf (user_id, criado_em desc);
create index if not exists ix_saque_nf_lanc on public.saque_nf (lancamento_id);

alter table public.saque_nf enable row level security;
drop policy if exists "Dono lê a própria NF" on public.saque_nf;
create policy "Dono lê a própria NF" on public.saque_nf for select
  using ((select auth.uid()) = user_id or public.is_equipe());

-- Quanto o usuário JÁ sacou na janela do teto (pedido + pago; cancelado não conta).
create or replace function public.saque_sacado_na_janela(p_user_id uuid)
returns numeric language sql stable security definer set search_path to 'public' as $$
  select coalesce(-sum(valor), 0)::numeric
    from public.saldo_lancamentos
   where user_id = p_user_id
     and tipo = 'saque'
     and status <> 'cancelado'
     and (coalesce(public.regra('saque.teto_sem_nf')->>'janela', 'mes') <> 'mes'
          or criado_em >= date_trunc('month', now()))
$$;

-- ── 4. O AVALIADOR ÚNICO ────────────────────────────────────────────────────
-- SEM efeito colateral, de propósito: a tela pode chamar à vontade. Devolve o
-- veredito completo — o que falta, se exige NF, quanto ainda cabe no teto.
-- Quem decide o saque (solicitar_saque_ledger) é OBRIGADO a passar por aqui;
-- a auditoria confere isso. Foi a existência de dois caminhos que criou o bug.
create or replace function public.saque_avaliar(p_user_id uuid, p_valor numeric)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_p          record;
  v_faltando   text[] := '{}';
  v_valor      numeric := round(coalesce(p_valor, 0)::numeric, 2);
  v_pagante    boolean;
  v_teto       numeric := coalesce((public.regra('saque.teto_sem_nf')->>'valor')::numeric, 2500);
  v_exige_kyc  boolean := coalesce((public.regra('saque.exige_kyc')->>'ativo')::boolean, true);
  v_ja         numeric;
  v_acima      boolean;
  v_exige_nf   boolean := false;
  v_nf_ok      boolean := false;
  v_saldo      numeric;
  -- Equipe operacional recebe por FUNÇÃO, não como parceiro: fica ISENTA do teto,
  -- da NF e do KYC. Sem isto o admin era mandado "assinar um plano" para receber.
  v_equipe     boolean;
begin
  if p_user_id is null then
    return jsonb_build_object('permitido', false, 'motivo', 'Usuário inválido');
  end if;

  select nome, cpf, cpf_hash, telefone, chave_pix, role, cnpj, razao_social,
         pj_chave_pix, pj_validada_em, pj_revalidacao_pendente, identidade_validada
    into v_p from public.perfis where id = p_user_id;

  if not found then
    return jsonb_build_object('permitido', false, 'motivo', 'Perfil não encontrado');
  end if;

  v_pagante := public.eh_pagante(v_p.role);
  v_ja      := public.saque_sacado_na_janela(p_user_id);
  v_acima   := (v_ja + v_valor) > v_teto;
  v_equipe  := v_p.role = any (array['admin','analista','advogado','consultor','afiliado','leiloeiro']);
  if v_equipe then v_acima := false; end if;

  select coalesce(sum(valor), 0) into v_saldo
    from public.saldo_lancamentos where user_id = p_user_id and status <> 'cancelado';

  -- Cadastro base (vale para todos).
  if v_p.nome is null or btrim(v_p.nome) = '' then
    v_faltando := array_append(v_faltando, 'nome');
  end if;
  if (v_p.cpf is null or btrim(v_p.cpf) = '') and v_p.cpf_hash is null then
    v_faltando := array_append(v_faltando, 'CPF');
  end if;
  if v_p.telefone is null or btrim(v_p.telefone) = '' then
    v_faltando := array_append(v_faltando, 'telefone');
  end if;

  -- Identidade: agora exigida de TODOS (regra saque.exige_kyc).
  if v_exige_kyc and not v_equipe and not coalesce(v_p.identidade_validada, false) then
    v_faltando := array_append(v_faltando, 'identidade validada (selfie + documento)');
  end if;

  -- Destino do dinheiro: pagante recebe na PJ (B2B, anti-interposição);
  -- o grátis recebe no PIX pessoal — é o que destrava o saque de baixo valor.
  if v_pagante then
    if v_p.cnpj is null or btrim(v_p.cnpj) = '' then
      v_faltando := array_append(v_faltando, 'empresa (CNPJ)');
    end if;
    if v_p.razao_social is null or btrim(v_p.razao_social) = '' then
      v_faltando := array_append(v_faltando, 'razão social');
    end if;
    if v_p.pj_chave_pix is null or btrim(v_p.pj_chave_pix) = '' then
      v_faltando := array_append(v_faltando, 'PIX da empresa');
    end if;
  else
    if v_p.chave_pix is null or btrim(v_p.chave_pix) = '' then
      v_faltando := array_append(v_faltando, 'chave PIX');
    end if;
  end if;

  -- Acima do teto do mês: precisa ser pagante E ter NF aprovada.
  if v_acima then
    v_exige_nf := coalesce((public.regra('saque.acima_do_teto')->>'exige_nf')::boolean, true);
    if coalesce((public.regra('saque.acima_do_teto')->>'exige_pagante')::boolean, true) and not v_pagante then
      return jsonb_build_object(
        'permitido', false, 'acima_do_teto', true, 'precisa_assinar', true,
        'teto', v_teto, 'ja_sacado_na_janela', v_ja, 'disponivel_sem_nf', greatest(v_teto - v_ja, 0),
        'saldo', v_saldo, 'faltando', to_jsonb(v_faltando),
        'motivo', 'Você já sacou R$ ' || to_char(v_ja, 'FM999999990.00') || ' neste mês. Acima de R$ '
                  || to_char(v_teto, 'FM999999990.00') || ' o saque exige plano pago e nota fiscal. '
                  || 'Você pode sacar até R$ ' || to_char(greatest(v_teto - v_ja, 0), 'FM999999990.00')
                  || ' agora, ou assinar um plano para liberar o valor cheio.');
    end if;
    if v_exige_nf then
      select true into v_nf_ok from public.saque_nf
       where user_id = p_user_id and status = 'aprovada' and lancamento_id is null
         and valor_nf >= v_valor - 0.01
       limit 1;
      if not coalesce(v_nf_ok, false) then
        return jsonb_build_object(
          'permitido', false, 'acima_do_teto', true, 'exige_nf', true,
          'teto', v_teto, 'ja_sacado_na_janela', v_ja, 'disponivel_sem_nf', greatest(v_teto - v_ja, 0),
          'saldo', v_saldo, 'faltando', to_jsonb(v_faltando),
          'motivo', 'Acima de R$ ' || to_char(v_teto, 'FM999999990.00')
                    || ' no mês é necessário anexar a nota fiscal do valor solicitado.');
      end if;
    end if;
  end if;

  if array_length(v_faltando, 1) > 0 then
    return jsonb_build_object('permitido', false, 'faltando', to_jsonb(v_faltando),
      'acima_do_teto', v_acima, 'exige_nf', v_exige_nf, 'teto', v_teto,
      'ja_sacado_na_janela', v_ja, 'disponivel_sem_nf', greatest(v_teto - v_ja, 0), 'saldo', v_saldo,
      'motivo', 'Complete seu cadastro para sacar. Falta: ' || array_to_string(v_faltando, ', ') || '.');
  end if;

  -- Gate da PJ (só pagante): mantido exatamente como estava.
  if v_pagante and v_p.pj_validada_em is null then
    return jsonb_build_object('permitido', false, 'pj_pendente', true, 'saldo', v_saldo,
      'teto', v_teto, 'ja_sacado_na_janela', v_ja, 'disponivel_sem_nf', greatest(v_teto - v_ja, 0),
      'motivo', 'Saque bloqueado: sua empresa (PJ) ainda não foi validada. Envie o cartão CNPJ/contrato social — o CPF do parceiro precisa constar no quadro societário.');
  end if;
  if v_pagante and coalesce(v_p.pj_revalidacao_pendente, false) then
    return jsonb_build_object('permitido', false, 'pj_revalidar', true, 'saldo', v_saldo,
      'teto', v_teto, 'ja_sacado_na_janela', v_ja, 'disponivel_sem_nf', greatest(v_teto - v_ja, 0),
      'motivo', 'Repasse retido: os dados da sua empresa divergiram na reconferência periódica. Atualize o CNPJ/razão social e clique em "Verificar automaticamente".');
  end if;

  if v_valor > 0 and v_valor > v_saldo then
    return jsonb_build_object('permitido', false, 'saldo', v_saldo,
      'teto', v_teto, 'ja_sacado_na_janela', v_ja, 'disponivel_sem_nf', greatest(v_teto - v_ja, 0),
      'motivo', 'Saldo insuficiente. Disponível: R$ ' || to_char(v_saldo, 'FM999999990.00'));
  end if;

  return jsonb_build_object('permitido', true, 'saldo', v_saldo, 'teto', v_teto,
    'ja_sacado_na_janela', v_ja, 'disponivel_sem_nf', greatest(v_teto - v_ja, 0),
    'acima_do_teto', v_acima, 'exige_nf', v_exige_nf,
    'destino', case when v_pagante then 'pj' else 'pessoal' end);
end; $$;

-- ── 5. A RPC de saque passa a OBEDECER ao avaliador ─────────────────────────
create or replace function public.solicitar_saque_ledger(p_user_id uuid, p_valor numeric)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_valor   numeric := round(p_valor::numeric, 2);
  v_av      jsonb;
  v_pix     text;
  v_pagante boolean;
  v_saldo   numeric;
  v_lanc    bigint;
begin
  if p_user_id is null then return jsonb_build_object('ok', false, 'error', 'Usuário inválido'); end if;
  if v_valor is null or v_valor <= 0 then return jsonb_build_object('ok', false, 'error', 'Valor inválido'); end if;

  -- Trava por usuário ANTES de avaliar: sem isso, dois pedidos simultâneos leem
  -- o mesmo "já sacado no mês" e passam os dois pelo teto.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  v_av := public.saque_avaliar(p_user_id, v_valor);
  if not coalesce((v_av->>'permitido')::boolean, false) then
    return jsonb_build_object('ok', false,
      'error', v_av->>'motivo',
      'faltando', v_av->'faltando',
      'pj_pendente', coalesce((v_av->>'pj_pendente')::boolean, false),
      'pj_revalidar', coalesce((v_av->>'pj_revalidar')::boolean, false),
      'acima_do_teto', coalesce((v_av->>'acima_do_teto')::boolean, false),
      'exige_nf', coalesce((v_av->>'exige_nf')::boolean, false),
      'precisa_assinar', coalesce((v_av->>'precisa_assinar')::boolean, false),
      'disponivel_sem_nf', v_av->'disponivel_sem_nf',
      'saldo', v_av->'saldo');
  end if;

  select public.eh_pagante(role), case when public.eh_pagante(role) then pj_chave_pix else chave_pix end
    into v_pagante, v_pix from public.perfis where id = p_user_id;

  insert into public.saldo_lancamentos (user_id, tipo, valor, descricao, status)
  values (p_user_id, 'saque', -v_valor, 'Solicitação de saque para PIX ' || v_pix, 'solicitado')
  returning id into v_lanc;

  -- Consome a NF usada (deixa de valer para um segundo saque).
  if coalesce((v_av->>'exige_nf')::boolean, false) then
    update public.saque_nf set lancamento_id = v_lanc
     where id = (select id from public.saque_nf
                  where user_id = p_user_id and status = 'aprovada' and lancamento_id is null
                    and valor_nf >= v_valor - 0.01 order by criado_em asc limit 1);
  end if;

  select coalesce(sum(valor), 0) into v_saldo
    from public.saldo_lancamentos where user_id = p_user_id and status <> 'cancelado';

  return jsonb_build_object('ok', true, 'saldo_restante', round(v_saldo, 2));
end; $$;

-- ── 6. O grátis passa a ganhar ──────────────────────────────────────────────
-- Única mudança no motor: `eh_pagante` → `pode_ganhar_comissao` na elegibilidade
-- do upline. O resto (compressão, teto por rank, bônus infinito, idempotência,
-- estorno) segue idêntico. Como o explorador não tem rank, `max_nivel` cai no
-- coalesce 1: ele recebe do NÍVEL 1 e só — conservador de propósito.
create or replace function public.distribuir_comissao_rede(p_comprador uuid, p_tipo text, p_valor numeric, p_gateway_payment_id text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_cur uuid; v_role text; v_next uuid; v_aceite timestamptz;
  v_ativo boolean; v_inad timestamptz; v_venc date;
  v_nivel int := 0; v_pct numeric; v_valor_com numeric; v_hops int := 0;
  v_total numeric := 0; v_pagos jsonb := '[]'::jsonb; v_oid text; v_maxdepth int;
  v_max int := (select coalesce(max(nivel),5) from public.comissao_regras where ativo);
  v_inf numeric; v_inf_pago numeric := 0; v_inf_com numeric; v_oid_inf text;
  v_empresa uuid := (select empresa_uid from public.rank_config where id = 1);
begin
  if p_comprador is null or coalesce(p_valor,0) <= 0
     or p_tipo not in ('assinatura','produto','venda_direta') or coalesce(p_gateway_payment_id,'') = ''
  then return jsonb_build_object('ok', false, 'erro', 'parametros'); end if;

  if v_empresa is not null and p_comprador <> v_empresa then
    update public.perfis set indicado_por = v_empresa
     where id = p_comprador and indicado_por is null;
  end if;

  select indicado_por into v_cur from public.perfis where id = p_comprador;
  while v_cur is not null and v_hops < 30 loop
    v_hops := v_hops + 1;
    select role, indicado_por, parceiro_aceite_em, ativo, inadimplente_desde, plano_vencimento
      into v_role, v_next, v_aceite, v_ativo, v_inad, v_venc
      from public.perfis where id = v_cur;
    if v_cur = v_empresa or (public.pode_ganhar_comissao(v_role) and v_aceite is not null
       and coalesce(v_ativo, true) and v_inad is null and (v_venc is null or v_venc >= current_date))
    then
      v_nivel := v_nivel + 1;
      if v_nivel <= v_max then
        select coalesce(cr.max_nivel, 1) into v_maxdepth
          from public.perfis pp left join public.comissao_ranks cr on cr.rank_key = pp.rank_key where pp.id = v_cur;
        if v_nivel <= coalesce(v_maxdepth, 1) then
          select pct into v_pct from public.comissao_regras where tipo = p_tipo and nivel = v_nivel and ativo;
          if coalesce(v_pct,0) > 0 then
            v_valor_com := round(p_valor * v_pct / 100.0, 2);
            v_oid := p_gateway_payment_id || '-n' || v_nivel;
            if v_valor_com > 0 and not exists (select 1 from public.saldo_lancamentos where origem_id = v_oid and tipo = 'comissao_rede') then
              insert into public.comissoes (beneficiario_id, cliente_id, tipo, origem, referencia, valor_base, percentual, valor_comissao, competencia, status, gateway_payment_id, gateway)
                values (v_cur, p_comprador, 'rede_n'||v_nivel, p_tipo, 'Comissão de rede nível '||v_nivel, p_valor, v_pct, v_valor_com, current_date, 'pendente', p_gateway_payment_id, 'rede');
              insert into public.saldo_lancamentos (user_id, tipo, valor, origem_tipo, origem_id, descricao, status)
                values (v_cur, 'comissao_rede', v_valor_com, p_tipo, v_oid, 'Comissão nível '||v_nivel||' ('||p_tipo||')', 'disponivel');
              v_total := v_total + v_valor_com;
              v_pagos := v_pagos || jsonb_build_object('nivel', v_nivel, 'beneficiario', v_cur, 'pct', v_pct, 'valor', v_valor_com);
            end if;
          end if;
        end if;
      end if;
      select coalesce(cr.bonus_infinito_pct, 0) into v_inf
        from public.perfis pp left join public.comissao_ranks cr on cr.rank_key = pp.rank_key where pp.id = v_cur;
      if coalesce(v_inf,0) > v_inf_pago then
        v_inf_com := round(p_valor * (v_inf - v_inf_pago) / 100.0, 2);
        v_oid_inf := p_gateway_payment_id || '-inf' || v_nivel;
        if v_inf_com > 0 and not exists (select 1 from public.saldo_lancamentos where origem_id = v_oid_inf and tipo = 'comissao_infinito') then
          insert into public.comissoes (beneficiario_id, cliente_id, tipo, origem, referencia, valor_base, percentual, valor_comissao, competencia, status, gateway_payment_id, gateway)
            values (v_cur, p_comprador, 'infinito', p_tipo, 'Bônus infinito (liderança)', p_valor, (v_inf - v_inf_pago), v_inf_com, current_date, 'pendente', p_gateway_payment_id, 'rede');
          insert into public.saldo_lancamentos (user_id, tipo, valor, origem_tipo, origem_id, descricao, status)
            values (v_cur, 'comissao_infinito', v_inf_com, p_tipo, v_oid_inf, 'Bônus infinito ('||p_tipo||')', 'disponivel');
          v_total := v_total + v_inf_com;
          v_pagos := v_pagos || jsonb_build_object('infinito', true, 'beneficiario', v_cur, 'pct', (v_inf - v_inf_pago), 'valor', v_inf_com);
        end if;
        v_inf_pago := v_inf;
      end if;
    end if;
    v_cur := v_next;
  end loop;
  return jsonb_build_object('ok', true, 'total', v_total, 'niveis_pagos', v_nivel, 'detalhe', v_pagos);
end; $function$;

-- ── 7. A auditoria que teria pego o bug ─────────────────────────────────────
-- Duas famílias de achado:
--   (a) regra declarada que NENHUMA função aplica — foi o caso do `podeReceber`;
--   (b) função que move DINHEIRO sem passar pelo avaliador único — é o segundo
--       cérebro nascendo de novo.
create or replace function public.auditoria_regras_negocio()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_achados jsonb := '[]'::jsonb;
  r record; v_src text; f text;
begin
  -- (a) toda regra ativa precisa de aplicador, e o aplicador precisa citá-la.
  for r in select chave, aplicada_por from public.regra_negocio where ativo loop
    if coalesce(array_length(r.aplicada_por, 1), 0) = 0 then
      v_achados := v_achados || jsonb_build_object('nivel', 'critico', 'regra', r.chave,
        'achado', 'Regra ativa sem função aplicadora declarada — existe no planejamento e em lugar nenhum do código.');
      continue;
    end if;
    foreach f in array r.aplicada_por loop
      select pg_get_functiondef(p.oid) into v_src
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = f limit 1;
      if v_src is null then
        v_achados := v_achados || jsonb_build_object('nivel', 'critico', 'regra', r.chave,
          'achado', 'A função aplicadora "' || f || '" não existe no banco.');
      elsif position(r.chave in v_src) = 0 then
        v_achados := v_achados || jsonb_build_object('nivel', 'critico', 'regra', r.chave,
          'achado', 'A função "' || f || '" deveria aplicar esta regra e não a menciona — regra órfã (foi exatamente assim que "explorador não saca" virou letra morta).');
      end if;
    end loop;
  end loop;

  -- (b) quem decide saque tem de delegar ao avaliador único.
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'solicitar_saque_ledger' limit 1;
  if v_src is null then
    v_achados := v_achados || jsonb_build_object('nivel', 'critico', 'regra', 'saque',
      'achado', 'solicitar_saque_ledger não existe.');
  elsif position('saque_avaliar' in v_src) = 0 then
    v_achados := v_achados || jsonb_build_object('nivel', 'critico', 'regra', 'saque',
      'achado', 'solicitar_saque_ledger deixou de chamar saque_avaliar — voltaram os dois cérebros.');
  end if;

  return jsonb_build_object(
    'gerado_em', now(),
    'criticos', (select count(*) from jsonb_array_elements(v_achados) e where e->>'nivel' = 'critico'),
    'total', jsonb_array_length(v_achados),
    'achados', v_achados);
end; $$;

-- ── 8. Grants ───────────────────────────────────────────────────────────────
-- Em FUNÇÃO o EXECUTE nasce concedido a PUBLIC: revogar só de anon/authenticated
-- é falsa proteção (lição de 08/08). Revoga de public também.
revoke all on function public.regra(text)                     from public, anon, authenticated;
revoke all on function public.pode_ganhar_comissao(text)      from public, anon, authenticated;
revoke all on function public.saque_sacado_na_janela(uuid)    from public, anon, authenticated;
revoke all on function public.saque_avaliar(uuid, numeric)    from public, anon, authenticated;
revoke all on function public.solicitar_saque_ledger(uuid, numeric) from public, anon, authenticated;
revoke all on function public.distribuir_comissao_rede(uuid, text, numeric, text) from public, anon, authenticated;
revoke all on function public.auditoria_regras_negocio()      from public, anon, authenticated;
grant execute on function public.auditoria_regras_negocio()   to service_role;
