-- Segurança (anti-interposição): os campos de CONFIANÇA da PJ só podem ser setados pelo
-- backend (service_role) ou admin — nunca pelo cliente via self-update em perfis. Antes, o
-- trigger protegia role/plano/identidade_validada mas NÃO os pj_validada_*/pj_revalidacao_*,
-- então MinhaRede.salvarPj gravava pj_validada_em=now() e furava o gate de saque (o parceiro
-- validava qualquer CNPJ e sacava para PIX de terceiro). Campos EDITÁVEIS pelo cliente
-- (cnpj, razao_social, pj_chave_pix, pj_dados_atualizados_em) seguem livres.
create or replace function public.proteger_campos_sensiveis_perfil()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if current_user in ('authenticated','anon') and not public.is_admin() then
    new.role := old.role;
    new.role_anterior := old.role_anterior;
    new.ativo := old.ativo;
    new.inadimplente_desde := old.inadimplente_desde;
    new.indicado_por := old.indicado_por;
    new.bonus_mercado := old.bonus_mercado;
    new.analises_count := old.analises_count;
    new.analises_mes := old.analises_mes;
    new.plano := old.plano;
    new.plano_ciclo := old.plano_ciclo;
    new.plano_pago_em := old.plano_pago_em;
    new.plano_vencimento := old.plano_vencimento;
    new.bonus_documental := old.bonus_documental;
    new.analises_bonus := old.analises_bonus;
    new.comissao_afiliado_pct := old.comissao_afiliado_pct;
    new.comissionamento_bloqueado := old.comissionamento_bloqueado;
    new.comissionado_por := old.comissionado_por;
    new.identidade_validada := old.identidade_validada;
    new.identidade_validada_em := old.identidade_validada_em;
    new.identidade_pendente := old.identidade_pendente;
    -- Anti-interposição: prova de validação da empresa é gerada só pelo backend/admin.
    new.pj_validada_em := old.pj_validada_em;
    new.pj_validada_por := old.pj_validada_por;
    new.pj_validada_via := old.pj_validada_via;
    new.pj_socio_qsa := old.pj_socio_qsa;
    new.pj_revalidacao_pendente := old.pj_revalidacao_pendente;
    new.pj_revalidacao_motivo := old.pj_revalidacao_motivo;
    new.pj_revalidado_em := old.pj_revalidado_em;
  end if;
  return new;
end $function$;
