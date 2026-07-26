-- Validação da PJ do parceiro no SAQUE (anti-interposição) — pedido do dono.
-- Fluxo: parceiro cadastra a PJ + KYC (selfie+documento) + anexa contrato social. Ao sacar,
-- o 1º saque pode liberar pela AUTOMAÇÃO (CPF do parceiro no quadro societário/QSA da Receita,
-- dado aberto gratuito — ver api/_pj-socio.js) e, do 2º saque em diante, exige validação MANUAL
-- (analista funcionário + dono supervisiona, via chamado 'saque_pj'). Reprovado → SAC recarrega.
--
-- Colunas de auditoria (para questão jurídica/auditoria posterior): quem validou, como e o
-- snapshot do quadro societário no momento da validação.
alter table public.perfis add column if not exists pj_validada_via  text;   -- 'auto_qsa' | 'manual'
alter table public.perfis add column if not exists pj_validada_por  uuid;   -- validador (quando manual)
alter table public.perfis add column if not exists pj_socio_qsa     jsonb;  -- snapshot do QSA na validação

-- Reserva ATÔMICA de saque PENDENTE de validação manual (status 'aguardando_pj' — reserva o
-- saldo, NÃO é pagável). Exige cadastro completo + PJ + KYC, mas NÃO o gate pj_validada_em
-- (é justamente o que está sob conferência).
create or replace function public.solicitar_saque_pj_pendente(p_user_id uuid, p_valor numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_perfil record; v_faltando text[] := '{}'; v_saldo numeric; v_valor numeric := round(p_valor::numeric,2); v_id bigint;
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
  select coalesce(sum(valor),0) into v_saldo from saldo_lancamentos where user_id=p_user_id and status <> 'cancelado';
  if v_valor > v_saldo then
    return jsonb_build_object('ok',false,'error','Saldo insuficiente. Disponível: R$ '||to_char(v_saldo,'FM999999990.00'),'saldo',v_saldo);
  end if;
  insert into saldo_lancamentos (user_id,tipo,valor,descricao,status)
    values (p_user_id,'saque',-v_valor,'Saque em validação da PJ (aguardando conferência)','aguardando_pj')
    returning id into v_id;
  return jsonb_build_object('ok',true,'lancamento_id',v_id,'saldo_restante',round(v_saldo - v_valor,2));
end; $$;
revoke all on function public.solicitar_saque_pj_pendente(uuid,numeric) from public, anon, authenticated;
grant execute on function public.solicitar_saque_pj_pendente(uuid,numeric) to service_role;

-- Validação AUTOMÁTICA (match do CPF no QSA) — grava PJ validada + snapshot.
create or replace function public.registrar_pj_validacao_auto(p_user_id uuid, p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update public.perfis
     set pj_validada_em = coalesce(pj_validada_em, now()),
         pj_validada_via = coalesce(pj_validada_via, 'auto_qsa'),
         pj_socio_qsa = p_snapshot
   where id = p_user_id;
  return jsonb_build_object('ok', true);
end; $$;
revoke all on function public.registrar_pj_validacao_auto(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.registrar_pj_validacao_auto(uuid,jsonb) to service_role;

-- APROVAÇÃO manual (analista/dono): libera o saque p/ pagamento + marca a PJ validada.
create or replace function public.aprovar_saque_pj(p_lanc_id bigint, p_validador uuid, p_via text default 'manual')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  update public.saldo_lancamentos set status='solicitado',
         descricao = replace(descricao,'Saque em validação da PJ (aguardando conferência)','Solicitação de saque (PJ validada)')
   where id = p_lanc_id and tipo='saque' and status='aguardando_pj'
   returning user_id into v_user;
  if v_user is null then return jsonb_build_object('ok',false,'error','Saque não encontrado ou já processado.'); end if;
  update public.perfis
     set pj_validada_em = coalesce(pj_validada_em, now()),
         pj_validada_via = coalesce(pj_validada_via, p_via),
         pj_validada_por = coalesce(pj_validada_por, p_validador)
   where id = v_user;
  return jsonb_build_object('ok', true, 'user_id', v_user);
end; $$;
revoke all on function public.aprovar_saque_pj(bigint,uuid,text) from public, anon, authenticated;
grant execute on function public.aprovar_saque_pj(bigint,uuid,text) to service_role;

-- REPROVAÇÃO manual: cancela o saque (devolve o saldo). Motivo vai para o SAC.
create or replace function public.reprovar_saque_pj(p_lanc_id bigint, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  update public.saldo_lancamentos set status='cancelado',
         descricao = 'Saque reprovado na validação da PJ: '||coalesce(nullif(btrim(p_motivo),''),'documentação insuficiente')
   where id = p_lanc_id and tipo='saque' and status='aguardando_pj'
   returning user_id into v_user;
  if v_user is null then return jsonb_build_object('ok',false,'error','Saque não encontrado ou já processado.'); end if;
  return jsonb_build_object('ok', true, 'user_id', v_user);
end; $$;
revoke all on function public.reprovar_saque_pj(bigint,text) from public, anon, authenticated;
grant execute on function public.reprovar_saque_pj(bigint,text) to service_role;
