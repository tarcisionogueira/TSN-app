-- CONVITE DE LEILOEIRO PASSA A SER DECISÃO DO ADMIN, NÃO AUTOSSERVIÇO (10/09, correção do
-- dono sobre a Parte 41: "o leiloeiro não deve poder convidar diretamente. eu como admin devo
-- permitir a quantidade de convites determinada de acordo com a minha vontade").
--
-- Dois ajustes:
-- 1) A cota nasce em 0, não 3. Sem quantidade explícita do admin, ninguém convida ninguém.
-- 2) `convites_leiloeiro_disponiveis` entra na blindagem de `proteger_campos_sensiveis_perfil`
--    — sem isto, RLS ("Usuário atualiza próprio perfil": auth.uid()=id, sem WITH CHECK por
--    coluna) deixaria o PRÓPRIO leiloeiro se autoconceder convites via um UPDATE direto na
--    API REST, contornando esta tela por completo. `resgatar_convite_leiloeiro` continua
--    escrevendo normalmente — é SECURITY DEFINER, roda como owner da função, não como
--    'authenticated', e o gatilho já sabe distinguir isso (mesmo motivo dos carimbos de
--    aceite, comentado no próprio corpo da função).
begin;

alter table public.perfis alter column convites_leiloeiro_disponiveis set default 0;
-- Explícito, não só o default: zera qualquer conta leiloeiro que já tivesse herdado o antigo
-- default de 3 antes desta correção (nenhuma no momento, mas não custa ser exato).
update public.perfis set convites_leiloeiro_disponiveis = 0 where role = 'leiloeiro';

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
    new.indicacao_origem := old.indicacao_origem;
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
    -- Carimbos de aceite: só as RPCs (SECURITY DEFINER) os escrevem.
    new.parceiro_aceite_em := old.parceiro_aceite_em;
    new.parceiro_aceite_versao := old.parceiro_aceite_versao;
    new.juridico_aceite_em := old.juridico_aceite_em;
    new.juridico_aceite_versao := old.juridico_aceite_versao;
    -- O % de êxito individual é dinheiro: quem recebe não define quanto recebe.
    new.honorario_exito_pct := old.honorario_exito_pct;
    -- Quota de convite de leiloeiro (10/09): só admin decide quantos; o leiloeiro não pode
    -- se autoconceder mais via UPDATE direto no próprio perfil.
    new.convites_leiloeiro_disponiveis := old.convites_leiloeiro_disponiveis;
  end if;
  return new;
end
$function$;

commit;
