-- NOTA FISCAL EM TODO SAQUE, pelo valor BRUTO do saque (16/10, decisão do dono).
--
-- Antes: até R$ 2.500/mês sem nota; acima disso, plano pago + nota do total do mês.
-- Agora:
--   • TODO saque exige nota fiscal de serviço da empresa do beneficiário contra a BidPro, no valor
--     BRUTO exato do saque (regra 'saque.exige_nf_sempre'). A BidPro repassa o bruto, sem retenção;
--     tributos e encargos sobre a parte do parceiro são dele.
--   • O teto mensal (saque.teto_sem_nf, R$ 2.500) continua existindo, mas passa a governar SÓ a
--     exigência de PLANO PAGO acima dele. Zerar o teto teria exigido plano pago em todo saque e
--     travado o parceiro grátis — por isso a nota virou regra própria em vez de "teto = 0".
--   • Uma nota ATIVA por pessoa (em conferência ou aprovada e ainda não usada), garantido por
--     índice único. O parceiro não apaga nem troca nota: não tem política de exclusão nem de alteração em
--     saque_nf nem no bucket. Substituir é ação da equipe (status 'substituida', a nota antiga
--     fica guardada — é documento contábil).
--   • Cada nota é consumida por UM saque (lancamento_id), inclusive no ramo de PJ em validação.

-- ── Regras ────────────────────────────────────────────────────────────────────────────────────
insert into public.regra_negocio (chave, valor, descricao, ativo, aplicada_por)
values ('saque.exige_nf_sempre',
        '{"ativo": true, "escopo": "todos", "valor": "bruto_do_saque", "tolerancia": 0.01}'::jsonb,
        'Todo saque exige nota fiscal de serviço emitida pela empresa do beneficiário contra a BidPro, no valor BRUTO exato do saque. A BidPro repassa o bruto, sem retenção; tributos e encargos sobre o valor recebido são do beneficiário. Uma nota por saque; a IA lê e confere emitente, tomador, valor e data; sem confirmação da prefeitura vai para a equipe. Decisão do dono, 16/10.',
        true, array['saque_avaliar','solicitar_saque_ledger','solicitar_saque_pj_pendente'])
on conflict (chave) do update set valor = excluded.valor, descricao = excluded.descricao,
  ativo = true, aplicada_por = excluded.aplicada_por;

update public.regra_negocio
   set valor = valor || '{"exige_nf": false}'::jsonb,
       descricao = 'Acima do teto mensal (saque.teto_sem_nf) o saque exige PLANO PAGO, para qualquer perfil. A nota fiscal deixou de ser exigência só acima do teto: desde 16/10 vale para TODO saque (saque.exige_nf_sempre).'
 where chave = 'saque.acima_do_teto';

update public.regra_negocio
   set descricao = 'Teto mensal de saque SEM PLANO PAGO (R$ por mês-calendário). Desde 16/10 não dispensa mais a nota fiscal — a nota é exigida em todo saque (saque.exige_nf_sempre). O nome da chave ficou por compatibilidade.'
 where chave = 'saque.teto_sem_nf';

-- ── Uma nota ativa por pessoa ─────────────────────────────────────────────────────────────────
create unique index if not exists saque_nf_uma_ativa
  on public.saque_nf (user_id)
  where lancamento_id is null and status in ('revisao_manual', 'aprovada');

-- ── Qual nota cobre este saque ────────────────────────────────────────────────────────────────
-- Aprovada, ainda não usada e no valor EXATO do saque (bruto). Nota maior que o saque não serve:
-- documentaria um repasse que não aconteceu. Nota presa a um saque CANCELADO (reprovado pela equipe)
-- volta a valer: o repasse que ela documentaria não aconteceu.
create or replace function public.saque_nf_que_cobre(p_user_id uuid, p_valor numeric)
 returns uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  -- Regra 'saque.exige_nf_sempre' (16/10).
  select id from public.saque_nf
   where user_id = p_user_id and status = 'aprovada'
     and (lancamento_id is null
          or exists (select 1 from public.saldo_lancamentos l where l.id = saque_nf.lancamento_id and l.status = 'cancelado'))
     and abs(valor_nf - round(p_valor, 2)) <= coalesce((public.regra('saque.exige_nf_sempre')->>'tolerancia')::numeric, 0.01)
   order by criado_em asc
   limit 1;
$function$;
revoke all on function public.saque_nf_que_cobre(uuid, numeric) from public, anon, authenticated;
grant execute on function public.saque_nf_que_cobre(uuid, numeric) to service_role;

-- ── O avaliador único ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.saque_avaliar(p_user_id uuid, p_valor numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- Regras: saque.teto_sem_nf (teto SEM PLANO PAGO), saque.acima_do_teto, saque.exige_nf_sempre,
-- saque.exige_kyc, saque.exige_termos_vigentes, saque.destino_sempre_pj.
-- A nota é a ÚLTIMA checagem de propósito: o parceiro só é mandado emitir nota quando todo o
-- resto (cadastro, PJ, saldo) já está certo — nota emitida para um saque que não sairia é
-- documento fiscal sem repasse.
declare
  v_p          record;
  v_faltando   text[] := '{}';
  v_valor      numeric := round(coalesce(p_valor, 0)::numeric, 2);
  v_pagante    boolean;
  v_equipe     boolean;
  v_teto       numeric := coalesce((public.regra('saque.teto_sem_nf')->>'valor')::numeric, 2500);
  v_exige_kyc  boolean := coalesce((public.regra('saque.exige_kyc')->>'ativo')::boolean, true);
  v_kyc_escopo text := coalesce(public.regra('saque.exige_kyc')->>'escopo', 'todos');
  v_nf_sempre  boolean := coalesce((public.regra('saque.exige_nf_sempre')->>'ativo')::boolean, true);
  v_ja         numeric;
  v_total_mes  numeric;
  v_acima      boolean;
  v_exige_nf   boolean := false;
  v_saldo      numeric;
  v_exige_pj   boolean := coalesce((public.regra('saque.destino_sempre_pj')->>'ativo')::boolean, true);
  v_pag_escopo text := coalesce(public.regra('saque.acima_do_teto')->>'escopo', 'todos');
  v_nf_ativa   record;
begin
  if p_user_id is null then
    return jsonb_build_object('permitido', false, 'motivo', 'Usuário inválido');
  end if;

  select nome, cpf, cpf_hash, telefone, role, cnpj, razao_social,
         pj_chave_pix, pj_validada_em, pj_revalidacao_pendente, identidade_validada, termos_uso_versao
    into v_p from public.perfis where id = p_user_id;

  if not found then
    return jsonb_build_object('permitido', false, 'motivo', 'Perfil não encontrado');
  end if;

  v_pagante   := public.eh_pagante(v_p.role);
  v_equipe    := v_p.role = any (array['admin','analista','advogado','consultor','afiliado','leiloeiro']);
  v_ja        := public.saque_sacado_na_janela(p_user_id);
  v_total_mes := v_ja + v_valor;
  v_acima     := v_total_mes > v_teto;
  v_exige_nf  := v_nf_sempre
                 or (v_acima and coalesce((public.regra('saque.acima_do_teto')->>'exige_nf')::boolean, false));

  select coalesce(sum(valor), 0) into v_saldo
    from public.saldo_lancamentos where user_id = p_user_id and status not in ('cancelado','a_liberar');

  if v_p.nome is null or btrim(v_p.nome) = '' then
    v_faltando := array_append(v_faltando, 'nome');
  end if;
  if (v_p.cpf is null or btrim(v_p.cpf) = '') and v_p.cpf_hash is null then
    v_faltando := array_append(v_faltando, 'CPF');
  end if;
  if v_p.telefone is null or btrim(v_p.telefone) = '' then
    v_faltando := array_append(v_faltando, 'telefone');
  end if;

  if v_exige_kyc
     and (v_kyc_escopo = 'todos' or not v_equipe)
     and not coalesce(v_p.identidade_validada, false) then
    v_faltando := array_append(v_faltando, 'identidade validada (selfie + documento)');
  end if;

  if coalesce((public.regra('saque.exige_termos_vigentes')->>'ativo')::boolean, false)
     and not v_equipe
     and coalesce(v_p.termos_uso_versao, '') <> coalesce(public.regra('saque.exige_termos_vigentes')->>'versao', '') then
    v_faltando := array_append(v_faltando, 'aceite da versão atual dos Termos (basta aceitar — nenhum documento novo)');
  end if;

  if v_exige_pj and (v_p.cnpj is null or btrim(v_p.cnpj) = '') then
    v_faltando := array_append(v_faltando, 'empresa (CNPJ do qual você é sócio)');
  end if;
  if v_exige_pj and (v_p.razao_social is null or btrim(v_p.razao_social) = '') then
    v_faltando := array_append(v_faltando, 'razão social');
  end if;
  if v_exige_pj and (v_p.pj_chave_pix is null or btrim(v_p.pj_chave_pix) = '') then
    v_faltando := array_append(v_faltando, 'PIX da empresa');
  end if;

  -- Acima do teto do mês: plano pago (a nota agora vale para qualquer valor — ver o fim).
  if v_acima
     and coalesce((public.regra('saque.acima_do_teto')->>'exige_pagante')::boolean, true)
     and not v_pagante
     and (v_pag_escopo = 'todos' or not v_equipe) then
    return jsonb_build_object(
      'permitido', false, 'acima_do_teto', true, 'precisa_assinar', true, 'exige_nf', v_exige_nf,
      'teto', v_teto, 'ja_sacado_na_janela', v_ja, 'total_do_mes', v_total_mes,
      'disponivel_sem_nf', greatest(v_teto - v_ja, 0), 'disponivel_sem_plano', greatest(v_teto - v_ja, 0),
      'saldo', v_saldo, 'faltando', to_jsonb(v_faltando),
      'motivo', 'Você já sacou R$ ' || to_char(v_ja, 'FM999999990.00') || ' neste mês. Com este pedido o mês chega a R$ '
                || to_char(v_total_mes, 'FM999999990.00') || ', acima do limite de R$ ' || to_char(v_teto, 'FM999999990.00')
                || ' — a partir daí o saque exige plano pago. Você pode sacar até R$ '
                || to_char(greatest(v_teto - v_ja, 0), 'FM999999990.00') || ' agora, ou assinar um plano para liberar o valor cheio.');
  end if;

  if array_length(v_faltando, 1) > 0 then
    return jsonb_build_object('permitido', false, 'faltando', to_jsonb(v_faltando),
      'acima_do_teto', v_acima, 'exige_nf', v_exige_nf, 'teto', v_teto,
      'ja_sacado_na_janela', v_ja, 'total_do_mes', v_total_mes,
      'disponivel_sem_nf', greatest(v_teto - v_ja, 0), 'disponivel_sem_plano', greatest(v_teto - v_ja, 0),
      'saldo', v_saldo,
      'motivo', 'Complete seu cadastro para sacar. Falta: ' || array_to_string(v_faltando, ', ') || '.');
  end if;

  if v_exige_pj and v_p.pj_validada_em is null then
    return jsonb_build_object('permitido', false, 'pj_pendente', true, 'saldo', v_saldo, 'exige_nf', v_exige_nf,
      'teto', v_teto, 'ja_sacado_na_janela', v_ja, 'total_do_mes', v_total_mes,
      'disponivel_sem_nf', greatest(v_teto - v_ja, 0), 'disponivel_sem_plano', greatest(v_teto - v_ja, 0),
      'motivo', 'Saque bloqueado: sua empresa (PJ) ainda não foi validada. Envie o cartão CNPJ/contrato social — o seu CPF precisa constar no quadro societário do CNPJ informado.');
  end if;
  if v_exige_pj and coalesce(v_p.pj_revalidacao_pendente, false) then
    return jsonb_build_object('permitido', false, 'pj_revalidar', true, 'saldo', v_saldo, 'exige_nf', v_exige_nf,
      'teto', v_teto, 'ja_sacado_na_janela', v_ja, 'total_do_mes', v_total_mes,
      'disponivel_sem_nf', greatest(v_teto - v_ja, 0), 'disponivel_sem_plano', greatest(v_teto - v_ja, 0),
      'motivo', 'Repasse retido: os dados da sua empresa divergiram na reconferência periódica. Atualize o CNPJ/razão social e clique em "Verificar automaticamente".');
  end if;

  if v_valor > 0 and v_valor > v_saldo then
    return jsonb_build_object('permitido', false, 'saldo', v_saldo, 'exige_nf', v_exige_nf,
      'teto', v_teto, 'ja_sacado_na_janela', v_ja, 'total_do_mes', v_total_mes,
      'disponivel_sem_nf', greatest(v_teto - v_ja, 0), 'disponivel_sem_plano', greatest(v_teto - v_ja, 0),
      'motivo', 'Saldo insuficiente. Disponível: R$ ' || to_char(v_saldo, 'FM999999990.00'));
  end if;

  -- ── NOTA FISCAL (saque.exige_nf_sempre) — a última trava ────────────────────────────────────
  -- Sem valor (p_valor = 0: a tela só perguntando se o saque está habilitado) não há nota a pedir.
  if v_exige_nf and v_valor > 0 and public.saque_nf_que_cobre(p_user_id, v_valor) is null then
    select status, valor_nf into v_nf_ativa from public.saque_nf
     where user_id = p_user_id and lancamento_id is null and status in ('revisao_manual', 'aprovada')
     order by criado_em desc limit 1;
    return jsonb_build_object(
      'permitido', false, 'exige_nf', true, 'falta_nf', true,
      'nf_valor_exigido', v_valor,
      'nf_em_revisao', coalesce(v_nf_ativa.status = 'revisao_manual', false),
      'nf_aprovada_valor', case when v_nf_ativa.status = 'aprovada' then v_nf_ativa.valor_nf end,
      'teto', v_teto, 'ja_sacado_na_janela', v_ja, 'total_do_mes', v_total_mes,
      'disponivel_sem_nf', greatest(v_teto - v_ja, 0), 'disponivel_sem_plano', greatest(v_teto - v_ja, 0),
      'saldo', v_saldo,
      'motivo', case
        when v_nf_ativa.status = 'revisao_manual' then
          'Sua nota fiscal está em conferência pela equipe. Assim que for aprovada, o saque é liberado.'
        when v_nf_ativa.status = 'aprovada' then
          'Sua nota aprovada é de R$ ' || to_char(v_nf_ativa.valor_nf, 'FM999999990.00')
          || '. O saque precisa ser exatamente desse valor (o repasse é pelo valor bruto da nota).'
        else
          'Todo saque exige a nota fiscal de serviço da sua empresa contra a BidPro Brasil, no valor BRUTO deste saque (R$ '
          || to_char(v_valor, 'FM999999990.00') || '). Anexe a nota na tela de saque — os tributos sobre esse valor são da sua empresa.'
      end);
  end if;

  return jsonb_build_object('permitido', true, 'saldo', v_saldo, 'teto', v_teto,
    'ja_sacado_na_janela', v_ja, 'total_do_mes', v_total_mes,
    'disponivel_sem_nf', greatest(v_teto - v_ja, 0), 'disponivel_sem_plano', greatest(v_teto - v_ja, 0),
    'acima_do_teto', v_acima, 'exige_nf', v_exige_nf, 'destino', 'pj');
end; $function$;

-- ── Saque no caminho principal: consome a nota do valor EXATO ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.solicitar_saque_ledger(p_user_id uuid, p_valor numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- Regra 'saque.exige_nf_sempre': a nota que cobre o saque fica presa a ele (lancamento_id).
declare
  v_valor numeric := round(p_valor::numeric, 2);
  v_av    jsonb;
  v_pix   text;
  v_saldo numeric;
  v_lanc  bigint;
  v_nf    uuid;
begin
  if p_user_id is null then return jsonb_build_object('ok', false, 'error', 'Usuário inválido'); end if;
  if v_valor is null or v_valor <= 0 then return jsonb_build_object('ok', false, 'error', 'Valor inválido'); end if;

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
      'falta_nf', coalesce((v_av->>'falta_nf')::boolean, false),
      'nf_em_revisao', coalesce((v_av->>'nf_em_revisao')::boolean, false),
      'precisa_assinar', coalesce((v_av->>'precisa_assinar')::boolean, false),
      'nf_valor_exigido', v_av->'nf_valor_exigido',
      'disponivel_sem_nf', v_av->'disponivel_sem_nf',
      'saldo', v_av->'saldo');
  end if;

  if coalesce((v_av->>'exige_nf')::boolean, false) then
    v_nf := public.saque_nf_que_cobre(p_user_id, v_valor);
    if v_nf is null then  -- não deveria acontecer (o avaliador acabou de checar sob o mesmo lock)
      return jsonb_build_object('ok', false, 'falta_nf', true, 'error', 'Nota fiscal do saque não encontrada.');
    end if;
  end if;

  select pj_chave_pix into v_pix from public.perfis where id = p_user_id;

  insert into public.saldo_lancamentos (user_id, tipo, valor, descricao, status)
  values (p_user_id, 'saque', -v_valor, 'Solicitação de saque para PIX ' || v_pix, 'solicitado')
  returning id into v_lanc;

  if v_nf is not null then
    update public.saque_nf set lancamento_id = v_lanc where id = v_nf;
  end if;

  select coalesce(sum(valor), 0) into v_saldo
    from public.saldo_lancamentos where user_id = p_user_id and status not in ('cancelado','a_liberar');

  return jsonb_build_object('ok', true, 'saldo_restante', round(v_saldo, 2), 'nf_id', v_nf);
end; $function$;

-- ── Saque com PJ ainda em validação: mesma nota, mesmo consumo ────────────────────────────────
CREATE OR REPLACE FUNCTION public.solicitar_saque_pj_pendente(p_user_id uuid, p_valor numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- Regra 'saque.exige_nf_sempre' aplicada também neste ramo (é uma 2ª porta de saque).
declare
  v_perfil record; v_faltando text[] := '{}'; v_saldo numeric; v_valor numeric := round(p_valor::numeric,2); v_id bigint;
  v_teto numeric; v_ja numeric; v_total_mes numeric; v_acima boolean; v_nf uuid;
  v_nf_sempre boolean := coalesce((public.regra('saque.exige_nf_sempre')->>'ativo')::boolean, true);
begin
  if p_user_id is null then return jsonb_build_object('ok',false,'error','Usuário inválido'); end if;
  if v_valor is null or v_valor <= 0 then return jsonb_build_object('ok',false,'error','Valor inválido'); end if;
  select nome,cpf,cpf_hash,telefone,role,cnpj,razao_social,pj_chave_pix,identidade_validada
    into v_perfil from perfis where id = p_user_id;
  if v_perfil.nome is null or btrim(v_perfil.nome)='' then v_faltando := array_append(v_faltando,'nome'); end if;
  if (v_perfil.cpf is null or btrim(v_perfil.cpf)='') and v_perfil.cpf_hash is null then v_faltando := array_append(v_faltando,'CPF'); end if;
  if v_perfil.telefone is null or btrim(v_perfil.telefone)='' then v_faltando := array_append(v_faltando,'telefone'); end if;
  if v_perfil.cnpj is null or btrim(v_perfil.cnpj)='' then v_faltando := array_append(v_faltando,'empresa (CNPJ)'); end if;
  if v_perfil.razao_social is null or btrim(v_perfil.razao_social)='' then v_faltando := array_append(v_faltando,'razão social'); end if;
  if v_perfil.pj_chave_pix is null or btrim(v_perfil.pj_chave_pix)='' then v_faltando := array_append(v_faltando,'PIX da empresa'); end if;
  if array_length(v_faltando,1) > 0 then
    return jsonb_build_object('ok',false,'error','Complete o cadastro da empresa para sacar. Falta: '||array_to_string(v_faltando,', ')||'.','faltando',to_jsonb(v_faltando));
  end if;
  if not coalesce(v_perfil.identidade_validada,false) then
    return jsonb_build_object('ok',false,'kyc_pendente',true,'error','Conclua a verificação de identidade (selfie + documento) antes de sacar.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));

  -- Teto do mês: acima dele exige plano pago (mesma regra do caminho principal).
  v_teto := coalesce((public.regra('saque.teto_sem_nf')->>'valor')::numeric, 2500);
  v_ja := public.saque_sacado_na_janela(p_user_id);
  v_total_mes := v_ja + v_valor;
  v_acima := v_total_mes > v_teto;
  if v_acima and coalesce((public.regra('saque.acima_do_teto')->>'exige_pagante')::boolean, true)
     and not public.eh_pagante(v_perfil.role)
     and (coalesce(public.regra('saque.acima_do_teto')->>'escopo', 'todos') = 'todos'
          or not (v_perfil.role = any (array['admin','analista','advogado','consultor','afiliado','leiloeiro']))) then
    return jsonb_build_object('ok', false, 'acima_do_teto', true, 'precisa_assinar', true,
      'teto', v_teto, 'ja_sacado_na_janela', v_ja, 'total_do_mes', v_total_mes,
      'error', 'Com este pedido o mês chega a R$ ' || to_char(v_total_mes, 'FM999999990.00')
               || ', acima do limite de R$ ' || to_char(v_teto, 'FM999999990.00') || ' — a partir daí o saque exige plano pago.');
  end if;

  select coalesce(sum(valor),0) into v_saldo from saldo_lancamentos where user_id=p_user_id and status not in ('cancelado','a_liberar');
  if v_valor > v_saldo then
    return jsonb_build_object('ok',false,'error','Saldo insuficiente. Disponível: R$ '||to_char(v_saldo,'FM999999990.00'),'saldo',v_saldo);
  end if;

  if v_nf_sempre then
    v_nf := public.saque_nf_que_cobre(p_user_id, v_valor);
    if v_nf is null then
      return jsonb_build_object('ok', false, 'exige_nf', true, 'falta_nf', true, 'nf_valor_exigido', v_valor,
        'error', 'Todo saque exige a nota fiscal de serviço da sua empresa contra a BidPro Brasil, no valor BRUTO deste saque (R$ '
                 || to_char(v_valor, 'FM999999990.00') || '). Anexe a nota e, depois de aprovada, peça o saque.');
    end if;
  end if;

  insert into saldo_lancamentos (user_id,tipo,valor,descricao,status)
    values (p_user_id,'saque',-v_valor,'Saque em validação da PJ (aguardando conferência)','aguardando_pj')
    returning id into v_id;
  if v_nf is not null then
    update public.saque_nf set lancamento_id = v_id where id = v_nf;
  end if;
  return jsonb_build_object('ok',true,'lancamento_id',v_id,'saldo_restante',round(v_saldo - v_valor,2));
end; $function$;
