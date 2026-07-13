-- Auditoria 13/07 — fecha o follow-up de identidade_validada.
-- Antes, o cliente (Perfil.jsx) escrevia identidade_validada=true direto no Supabase
-- após a resposta da IA de /api/validar-selfie — bastava chamar o update no console
-- p/ auto-validar a identidade. Agora o SET é feito no endpoint pela service_role
-- (autoritativo) e aqui estendemos o trigger para reverter esses campos quando quem
-- edita é 'authenticated'/'anon' e não é admin.
--
-- Seguro p/ os fluxos legítimos:
--  • /api/validar-selfie grava via service_role → current_user = 'service_role' (não
--    entra na condição) → não é revertido.
--  • salvar_kyc_equipe é SECURITY DEFINER → current_user = dono da função → idem.
--  • Admin faz bypass via public.is_admin().
create or replace function public.proteger_campos_sensiveis_perfil()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if current_user in ('authenticated','anon') and not public.is_admin() then
    -- role / status (já existiam)
    new.role := old.role;
    new.role_anterior := old.role_anterior;
    new.ativo := old.ativo;
    new.inadimplente_desde := old.inadimplente_desde;
    new.indicado_por := old.indicado_por;
    new.bonus_mercado := old.bonus_mercado;
    new.analises_count := old.analises_count;
    new.analises_mes := old.analises_mes;
    -- plano (impede auto-concessão de plano pago)
    new.plano := old.plano;
    new.plano_ciclo := old.plano_ciclo;
    new.plano_pago_em := old.plano_pago_em;
    new.plano_vencimento := old.plano_vencimento;
    -- créditos/bônus (impede análises grátis)
    new.bonus_documental := old.bonus_documental;
    new.analises_bonus := old.analises_bonus;
    -- comissionamento (impede manipulação de comissão)
    new.comissao_afiliado_pct := old.comissao_afiliado_pct;
    new.comissionamento_bloqueado := old.comissionamento_bloqueado;
    new.comissionado_por := old.comissionado_por;
    -- identidade/KYC (impede auto-validação sem selfie — set agora é server-side)
    new.identidade_validada := old.identidade_validada;
    new.identidade_validada_em := old.identidade_validada_em;
    new.identidade_pendente := old.identidade_pendente;
  end if;
  return new;
end $function$;
