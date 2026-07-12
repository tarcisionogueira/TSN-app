-- Auditoria 12/07 — fecha a lacuna crítica de escalonamento de benefícios.
-- A RLS de `perfis` permite o usuário atualizar o PRÓPRIO perfil (auth.uid()=id) e o
-- trigger `proteger_campos_sensiveis_perfil` só revertia role/ativo/indicado/bonus_mercado.
-- Ficavam graváveis pelo cliente: plano, créditos (bonus_documental/analises_bonus) e
-- comissão — permitindo auto-concessão de plano pago, análises grátis e manipulação de
-- comissionamento. Aqui estendemos a proteção a esses campos.
-- Endpoints server-side usam a service_role (não 'authenticated'/'anon') → NÃO afetados.
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
  end if;
  return new;
end $function$;

-- Nota (follow-up): identidade_validada é setada pelo CLIENTE (Perfil.jsx) após /api/validar-selfie.
-- Para protegê-la sem quebrar o KYC, mover o set para o endpoint (service key) e então adicionar
-- new.identidade_validada/identidade_validada_em/identidade_pendente a este trigger.
