-- Build do plano anual RECORRENTE + troca de ciclo mensal↔anual (dono, 31/07) — APLICADO.
-- Regras: (a) mensal→anual cobra o anual agora e vira recorrente 12m; (b) anual→mensal só ao
-- fim dos 12m; (c) anual sem mudança renova +12m. Guiado por design workflow + crítica adversarial.

-- 1) Coluna de agendamento de ciclo (regra b: anual->mensal). Só o servidor (service_role) escreve.
alter table public.perfis add column if not exists ciclo_agendado text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='perfis_ciclo_agendado_chk') then
    alter table public.perfis add constraint perfis_ciclo_agendado_chk check (ciclo_agendado in ('mensal','anual'));
  end if;
end $$;

-- 2) Blindar ciclo_agendado contra auto-concessão pelo cliente (estende o trigger vigente,
--    preservando TODOS os campos já protegidos + o novo). Base = definição real em produção.
create or replace function public.proteger_campos_sensiveis_perfil()
returns trigger language plpgsql set search_path to 'public' as $function$
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
    new.ciclo_agendado := old.ciclo_agendado;   -- NOVO (regra b)
    new.bonus_documental := old.bonus_documental;
    new.analises_bonus := old.analises_bonus;
    new.comissao_afiliado_pct := old.comissao_afiliado_pct;
    new.comissionamento_bloqueado := old.comissionamento_bloqueado;
    new.comissionado_por := old.comissionado_por;
    new.identidade_validada := old.identidade_validada;
    new.identidade_validada_em := old.identidade_validada_em;
    new.identidade_pendente := old.identidade_pendente;
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

-- 3) Índice para o loop do cron (regra b): varre agendados vencidos sem full scan.
create index if not exists idx_perfis_ciclo_agendado
  on public.perfis (plano_vencimento) where ciclo_agendado is not null;

-- 4) preco_anual (fonte do valor anual; mp.js/asaas.js já leem). No-op se já existe.
alter table public.planos_config add column if not exists preco_anual numeric;
