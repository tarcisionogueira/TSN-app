-- Revalidação PERIÓDICA da PJ do parceiro (pedido do dono).
-- Regra nova de saque: uma vez o cadastro APROVADO (pj_validada_em preenchido), o parceiro
-- saca à vontade — NÃO revalida a cada saque (antes, todo 2º+ saque caía em conferência manual).
-- Em troca, um cron MENSAL reconfere, de graça (dado aberto da Receita/QSA), se o parceiro
-- ainda é sócio do CNPJ e se o CNPJ segue ATIVO. Se DIVERGIR, marca pj_revalidacao_pendente
-- e o próximo repasse fica RETIDO até o parceiro atualizar os dados do CNPJ e revalidar
-- (o "popup" do Perfil volta a aparecer). Sem atrito no caminho feliz; rigor quando muda.
--
-- Colunas de estado/auditoria da revalidação:
alter table public.perfis add column if not exists pj_revalidacao_pendente boolean not null default false;
alter table public.perfis add column if not exists pj_revalidacao_motivo   text;        -- por que divergiu
alter table public.perfis add column if not exists pj_revalidado_em         timestamptz; -- última reconferência (ok ou divergência)

-- Marca o resultado de uma reconferência periódica. divergiu=true → segura o repasse; false →
-- reafirma/limpa a pendência. Sempre atualiza o carimbo e o snapshot mais recente do QSA.
create or replace function public.marcar_revalidacao_pj(p_user_id uuid, p_divergiu boolean, p_motivo text, p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_divergiu then
    update public.perfis
       set pj_revalidacao_pendente = true,
           pj_revalidacao_motivo   = nullif(btrim(coalesce(p_motivo,'')),''),
           pj_revalidado_em        = now(),
           pj_socio_qsa            = coalesce(p_snapshot, pj_socio_qsa)
     where id = p_user_id;
  else
    update public.perfis
       set pj_revalidacao_pendente = false,
           pj_revalidacao_motivo   = null,
           pj_revalidado_em        = now(),
           pj_socio_qsa            = coalesce(p_snapshot, pj_socio_qsa)
     where id = p_user_id;
  end if;
  return jsonb_build_object('ok', true, 'pendente', p_divergiu);
end; $$;
revoke all on function public.marcar_revalidacao_pj(uuid,boolean,text,jsonb) from public, anon, authenticated;
grant execute on function public.marcar_revalidacao_pj(uuid,boolean,text,jsonb) to service_role;

-- A validação automática (match no QSA) passa a LIMPAR qualquer pendência de revalidação
-- (quando o parceiro corrige os dados e revalida, o repasse volta a ser liberado).
create or replace function public.registrar_pj_validacao_auto(p_user_id uuid, p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update public.perfis
     set pj_validada_em          = coalesce(pj_validada_em, now()),
         pj_validada_via         = coalesce(pj_validada_via, 'auto_qsa'),
         pj_socio_qsa            = p_snapshot,
         pj_revalidacao_pendente = false,
         pj_revalidacao_motivo   = null,
         pj_revalidado_em        = now()
   where id = p_user_id;
  return jsonb_build_object('ok', true);
end; $$;
revoke all on function public.registrar_pj_validacao_auto(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.registrar_pj_validacao_auto(uuid,jsonb) to service_role;

-- A aprovação MANUAL também limpa a pendência de revalidação (a equipe reconferiu e liberou).
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
     set pj_validada_em          = coalesce(pj_validada_em, now()),
         pj_validada_via         = coalesce(pj_validada_via, p_via),
         pj_validada_por         = coalesce(pj_validada_por, p_validador),
         pj_revalidacao_pendente = false,
         pj_revalidacao_motivo   = null,
         pj_revalidado_em        = now()
   where id = v_user;
  return jsonb_build_object('ok', true, 'user_id', v_user);
end; $$;
revoke all on function public.aprovar_saque_pj(bigint,uuid,text) from public, anon, authenticated;
grant execute on function public.aprovar_saque_pj(bigint,uuid,text) to service_role;

-- GATE de revalidação no saque direto: parceiro com revalidação pendente não emite novo repasse
-- pelo caminho liberado — cai para conferência (o handler roteia para 'aguardando_pj').
create or replace function public.solicitar_saque_ledger(p_user_id uuid, p_valor numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_perfil   record;
  v_faltando text[] := '{}';
  v_saldo    numeric;
  v_valor    numeric := round(p_valor::numeric, 2);
  v_parceiro boolean;
  v_pix_pag  text;
begin
  if p_user_id is null then return jsonb_build_object('ok', false, 'error', 'Usuário inválido'); end if;
  if v_valor is null or v_valor <= 0 then return jsonb_build_object('ok', false, 'error', 'Valor inválido'); end if;

  select nome, cpf, cpf_hash, telefone, chave_pix, role, cnpj, razao_social, pj_chave_pix, pj_validada_em, pj_revalidacao_pendente
    into v_perfil from perfis where id = p_user_id;

  v_parceiro := v_perfil.role = any (array['top2','top2_anual','assessorado','assessorado_anual','clube','clube_anual']);

  if v_perfil.nome is null or btrim(v_perfil.nome) = '' then v_faltando := array_append(v_faltando, 'nome'); end if;
  if (v_perfil.cpf is null or btrim(v_perfil.cpf) = '') and v_perfil.cpf_hash is null then v_faltando := array_append(v_faltando, 'CPF'); end if;
  if v_perfil.telefone is null or btrim(v_perfil.telefone) = '' then v_faltando := array_append(v_faltando, 'telefone'); end if;

  if v_parceiro then
    if v_perfil.cnpj is null or btrim(v_perfil.cnpj) = '' then v_faltando := array_append(v_faltando, 'empresa (CNPJ)'); end if;
    if v_perfil.razao_social is null or btrim(v_perfil.razao_social) = '' then v_faltando := array_append(v_faltando, 'razão social'); end if;
    if v_perfil.pj_chave_pix is null or btrim(v_perfil.pj_chave_pix) = '' then v_faltando := array_append(v_faltando, 'PIX da empresa'); end if;
    v_pix_pag := v_perfil.pj_chave_pix;
  else
    if v_perfil.chave_pix is null or btrim(v_perfil.chave_pix) = '' then v_faltando := array_append(v_faltando, 'chave PIX'); end if;
    v_pix_pag := v_perfil.chave_pix;
  end if;

  if array_length(v_faltando, 1) > 0 then
    return jsonb_build_object('ok', false,
      'error', 'Complete seu cadastro para sacar. Falta: ' || array_to_string(v_faltando, ', ') || '.',
      'faltando', to_jsonb(v_faltando));
  end if;

  -- GATE PJ (anti-interposição): parceiro só saca com a empresa VALIDADA pela equipe.
  if v_parceiro and v_perfil.pj_validada_em is null then
    return jsonb_build_object('ok', false, 'pj_pendente', true,
      'error', 'Saque bloqueado: sua empresa (PJ) ainda não foi validada. Envie o cartão CNPJ/contrato social — o CPF do parceiro precisa constar no quadro societário. Liberamos o saque assim que a validação for concluída.');
  end if;

  -- GATE de REVALIDAÇÃO: reconferência periódica detectou divergência → segura até atualizar o CNPJ.
  if v_parceiro and coalesce(v_perfil.pj_revalidacao_pendente, false) then
    return jsonb_build_object('ok', false, 'pj_revalidar', true,
      'error', 'Repasse retido: os dados da sua empresa divergiram na reconferência periódica. Atualize o CNPJ/razão social no seu perfil e clique em "Verificar automaticamente" para liberar os novos repasses.');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select coalesce(sum(valor), 0) into v_saldo
  from saldo_lancamentos
  where user_id = p_user_id and status <> 'cancelado';

  if v_valor > v_saldo then
    return jsonb_build_object('ok', false,
      'error', 'Saldo insuficiente. Disponível: R$ ' || to_char(v_saldo, 'FM999999990.00'),
      'saldo', v_saldo);
  end if;

  insert into saldo_lancamentos (user_id, tipo, valor, descricao, status)
  values (p_user_id, 'saque', -v_valor, 'Solicitação de saque para PIX ' || v_pix_pag, 'solicitado');

  return jsonb_build_object('ok', true, 'saldo_restante', round(v_saldo - v_valor, 2));
end; $$;
revoke all on function public.solicitar_saque_ledger(uuid, numeric) from public, anon, authenticated;
grant execute on function public.solicitar_saque_ledger(uuid, numeric) to service_role;
