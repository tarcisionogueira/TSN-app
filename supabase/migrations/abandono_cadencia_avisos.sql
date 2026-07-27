-- Abandono — cadência de avisos (pedido do dono, reforço do resguardo jurídico):
-- ao identificar a DIVERGÊNCIA (revalidação pendente), inicia o relógio de 90 dias e envia
-- aviso IMEDIATO cobrando a atualização dos dados + lembrando a cláusula; mais 2 avisos ao
-- longo dos 90 dias. Persistindo → caducidade. Atualizar dados / sacar interrompe.
alter table public.perfis add column if not exists abandono_inicio_em timestamptz;      -- início do relógio (divergência identificada)
alter table public.perfis add column if not exists abandono_avisos     int not null default 0; -- quantos avisos já enviados (0..3)

-- marcar_revalidacao_pj: além do flag, gerencia o relógio de abandono.
create or replace function public.marcar_revalidacao_pj(p_user_id uuid, p_divergiu boolean, p_motivo text, p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_divergiu then
    update public.perfis
       set pj_revalidacao_pendente = true,
           pj_revalidacao_motivo   = nullif(btrim(coalesce(p_motivo,'')),''),
           pj_revalidado_em        = now(),
           pj_socio_qsa            = coalesce(p_snapshot, pj_socio_qsa),
           abandono_inicio_em      = coalesce(abandono_inicio_em, now()),  -- inicia o relógio (mantém se já iniciado)
           abandono_avisos         = coalesce(abandono_avisos, 0)
     where id = p_user_id;
  else
    update public.perfis
       set pj_revalidacao_pendente = false,
           pj_revalidacao_motivo   = null,
           pj_revalidado_em        = now(),
           pj_socio_qsa            = coalesce(p_snapshot, pj_socio_qsa),
           abandono_inicio_em      = null,   -- resolveu → zera o relógio e a cadência
           abandono_avisos         = 0,
           abandono_avisado_em     = null
     where id = p_user_id;
  end if;
  return jsonb_build_object('ok', true, 'pendente', p_divergiu);
end; $$;
revoke all on function public.marcar_revalidacao_pj(uuid,boolean,text,jsonb) from public, anon, authenticated;
grant execute on function public.marcar_revalidacao_pj(uuid,boolean,text,jsonb) to service_role;

-- Validação automática (match): limpa flag E o relógio de abandono.
create or replace function public.registrar_pj_validacao_auto(p_user_id uuid, p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update public.perfis
     set pj_validada_em          = coalesce(pj_validada_em, now()),
         pj_validada_via         = coalesce(pj_validada_via, 'auto_qsa'),
         pj_socio_qsa            = p_snapshot,
         pj_revalidacao_pendente = false,
         pj_revalidacao_motivo   = null,
         pj_revalidado_em        = now(),
         abandono_inicio_em      = null,
         abandono_avisos         = 0,
         abandono_avisado_em     = null
   where id = p_user_id;
  return jsonb_build_object('ok', true);
end; $$;
revoke all on function public.registrar_pj_validacao_auto(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.registrar_pj_validacao_auto(uuid,jsonb) to service_role;

-- Aprovação manual: libera o saque, marca PJ validada E limpa o relógio de abandono.
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
         pj_revalidado_em        = now(),
         abandono_inicio_em      = null,
         abandono_avisos         = 0,
         abandono_avisado_em     = null
   where id = v_user;
  return jsonb_build_object('ok', true, 'user_id', v_user);
end; $$;
revoke all on function public.aprovar_saque_pj(bigint,uuid,text) from public, anon, authenticated;
grant execute on function public.aprovar_saque_pj(bigint,uuid,text) to service_role;
