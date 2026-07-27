-- Abandono de saldo a receber (pedido do dono): PJ com valores a receber que passa 90 dias
-- SEM atualizar os dados E SEM realizar saque → abandono; o valor fica para a empresa.
-- IMPORTANTE (embasamento legal — ver docs/BASE_LEGAL_ABANDONO_SALDO.md): 90 dias NÃO se
-- sustenta por prescrição (essa é de anos, CC art. 206). Só se sustenta por CLÁUSULA
-- CONTRATUAL de caducidade + crédito condicionado (CC arts. 121-130), aceita pelo parceiro
-- nos Termos, com AVISO PRÉVIO. Por segurança, a EXECUÇÃO é gated por env ABANDONO_ATIVO e
-- é REVERSÍVEL. Só ligar após a cláusula entrar nos Termos e revisão jurídica.
alter table public.perfis add column if not exists pj_dados_atualizados_em timestamptz; -- última atualização dos dados da PJ
alter table public.perfis add column if not exists abandono_avisado_em     timestamptz; -- quando avisamos (aviso prévio)
alter table public.perfis add column if not exists abandono_em             timestamptz; -- quando o saldo foi revertido

-- Inicia o relógio para quem já é parceiro validado (NÃO retroage — começa agora, ninguém
-- é pego de surpresa por inatividade passada).
update public.perfis set pj_dados_atualizados_em = coalesce(pj_dados_atualizados_em, now())
  where pj_validada_em is not null;

-- Reversão do saldo por abandono: lança uma caducidade que zera o saldo disponível e carimba
-- abandono_em. REVERSÍVEL (admin lança um crédito compensatório se for engano). Atômica.
create or replace function public.reverter_saldo_abandono(p_user_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_saldo numeric;
begin
  if p_user_id is null then return jsonb_build_object('ok', false, 'error', 'Usuário inválido'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select coalesce(sum(valor),0) into v_saldo from saldo_lancamentos where user_id=p_user_id and status <> 'cancelado';
  if v_saldo <= 0 then return jsonb_build_object('ok', false, 'error', 'Sem saldo a reverter'); end if;
  insert into saldo_lancamentos (user_id, tipo, valor, descricao, status)
    values (p_user_id, 'caducidade_abandono', -round(v_saldo,2),
            coalesce(nullif(btrim(p_motivo),''), 'Saldo revertido por abandono (Termos de Uso)'), 'sacado');
  update public.perfis set abandono_em = now() where id = p_user_id;
  return jsonb_build_object('ok', true, 'revertido', round(v_saldo,2));
end; $$;
revoke all on function public.reverter_saldo_abandono(uuid,text) from public, anon, authenticated;
grant execute on function public.reverter_saldo_abandono(uuid,text) to service_role;
