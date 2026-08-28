-- TERMO DE ADESÃO DO ADVOGADO PARCEIRO — aceite registrado (28/08)
--
-- Até aqui o Programa de Parceiros tinha termo (`parceiro_aceite_em`) e o jurídico não tinha
-- NADA: o advogado era convidado por `ConviteEquipe`, informava OAB e área de atuação, e
-- passava a receber casos e a ter direito a 4,5% do valor arrematado — o maior repasse da casa
-- — sem nenhum documento dizendo o que ele deve, quando recebe, o que é sigiloso e o que
-- acontece se sair no meio de um caso.
--
-- Espelha a estrutura do termo do parceiro de propósito (colunas `_aceite_em`/`_aceite_versao`
-- + RPC que não sobrescreve aceite anterior): a auditoria de LGPD do Admin já sabe ler esse
-- formato, e um segundo formato significaria uma segunda tela de auditoria para manter.

alter table public.perfis add column if not exists juridico_aceite_em timestamptz;
alter table public.perfis add column if not exists juridico_aceite_versao text;

create or replace function public.aceitar_termo_juridico(p_versao text default null::text)
returns timestamptz
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_atual timestamptz; v_role text;
begin
  if v_uid is null then return null; end if;
  select juridico_aceite_em, role into v_atual, v_role from public.perfis where id = v_uid;
  -- Só advogado (e o admin, que precisa conseguir revisar o fluxo) assina este termo. Sem esta
  -- checagem qualquer usuário autenticado poderia carimbar um aceite jurídico no próprio
  -- perfil — aceite que ninguém pediu vira prova de vínculo que nunca existiu.
  if coalesce(v_role,'') not in ('advogado','admin') then return null; end if;
  if v_atual is not null then return v_atual; end if;  -- já aceitou → mantém a data original
  update public.perfis
     set juridico_aceite_em = now(),
         juridico_aceite_versao = coalesce(nullif(btrim(p_versao), ''), 'v1')
   where id = v_uid;
  return (select juridico_aceite_em from public.perfis where id = v_uid);
end;
$function$;

revoke all on function public.aceitar_termo_juridico(text) from public, anon;
grant execute on function public.aceitar_termo_juridico(text) to authenticated;

-- ── CARIMBO DE ACEITE NÃO PODE SER ESCRITO PELO PRÓPRIO TITULAR ──────────────────────────
-- `proteger_campos_sensiveis_perfil` devolve ao valor antigo tudo que o usuário não pode mudar
-- sozinho — role, plano, indicado_por, validação de identidade. Os carimbos de ACEITE ficaram
-- de fora: `parceiro_aceite_em` desde sempre, e `juridico_aceite_em` nasceria assim hoje.
--
-- Esses campos são a PROVA de que a pessoa aceitou um contrato, em que data e em que versão — o
-- Admin os exibe como registro de auditoria, com valor canônico para conferência. Sem esta
-- proteção, qualquer usuário autenticado podia gravá-los por PATCH no próprio perfil,
-- inventando data e versão de um aceite que nunca houve, ou apagando o real. Prova que o
-- provado pode escrever não é prova.
--
-- As RPCs `aceitar_parceria` e `aceitar_termo_juridico` são SECURITY DEFINER e seguem
-- funcionando: rodam como dono do banco, não como `authenticated`. O único caminho para
-- carimbar um aceite passa a ser o fluxo que EXIBE o termo antes de registrar.
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
  end if;
  return new;
end $function$;

-- SPLIT DO ÊXITO (decisão do dono, 28/08): 10% sobre a arrematação, divididos meio a meio
-- entre jurídico e plataforma DEPOIS de descontar o 1 ponto do parceiro que indicou.
--   advogado 4,5  ·  plataforma 4,5  ·  parceiro 1,0  ·  analista 0  =  10,0
-- `admin_pct` é informativo: o cálculo em `_honorarios.js` deriva o admin como
-- total − soma(envolvidos), então ele absorve a fatia de papel sem pessoa designada.
update public.config_honorarios
   set total_pct = 10, advogado_pct = 4.5, admin_pct = 4.5, analista_pct = 0, consultor_pct = 1,
       atualizado_em = now()
 where id = 1;

-- `fontes_com_limpeza_pulada` estava executável por ANÔNIMO — acusada por
-- `auditoria_seguranca()` (rpc_definer_anon) na conferência desta mesma sessão. É função de
-- monitoramento interno: diz quais leiloeiros tiveram a limpeza de lotes pulada e em que
-- proporção. Não expõe dado de cliente, mas entrega a qualquer visitante não autenticado o
-- mapa de qual fonte está degradada. O `=X/postgres` na ACL é o PUBLIC — por isso `anon` e
-- qualquer papel futuro herdavam execução.
revoke all on function public.fontes_com_limpeza_pulada(interval, numeric) from public, anon;
grant execute on function public.fontes_com_limpeza_pulada(interval, numeric) to authenticated, service_role;
