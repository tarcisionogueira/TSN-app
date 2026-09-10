-- LEILOEIRO JÁ NASCE PARCEIRO HABILITADO (10/09, achado do dono AO VIVO numa reunião com
-- leiloeiros: acessou o portal e viu "Quero ser parceiro" em vez do link de venda pronto).
--
-- Argumento do dono, e ele está certo: o leiloeiro já passa por uma barra de confiança bem
-- mais alta que o opt-in genérico do Programa de Parceiros (CNPJ, matrícula, documentos
-- reais subindo pela integração) — pedir para ele clicar num botão de "quero ser parceiro"
-- por cima disso é atrito redundante, não proteção.
--
-- MECANISMO: sempre que uma linha de `perfis` PASSA a ter role='leiloeiro' (por qualquer
-- caminho — resgatar_convite_leiloeiro, usar_convite_equipe, edição manual do admin) e ainda
-- não tem `parceiro_aceite_em`, o próprio gatilho já protegido (`proteger_campos_sensiveis_
-- perfil`, BEFORE UPDATE) carimba o aceite. Cobre todo caminho de uma vez, sem editar cada
-- RPC separadamente — e qualquer papel novo que precisar do mesmo comportamento no futuro
-- some a este mesmo bloco.
--
-- ⚠️ RESSALVA HONESTA, registrada para quem for auditar depois: isto é um carimbo
-- ADMINISTRATIVO, não a mesma prova de consentimento do clique real em `aceitar_parceria()`
-- (que junto ao termo promete registrar "metadados do seu aceite... data/hora, IP e
-- dispositivo" — nenhum desses existe aqui). Por isso `parceiro_aceite_versao` NÃO usa o
-- padrão vN-AAAA-MM do termo real (`TERMO_PARCEIRO_VERSAO` em ConviteParceiro.jsx) — usa
-- 'leiloeiro-auto-v1', de propósito, para nunca se confundir com um aceite de clique de
-- verdade numa auditoria ou numa disputa sobre comissão.
begin;

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
    new.parceiro_aceite_em := old.parceiro_aceite_em;
    new.parceiro_aceite_versao := old.parceiro_aceite_versao;
    new.juridico_aceite_em := old.juridico_aceite_em;
    new.juridico_aceite_versao := old.juridico_aceite_versao;
    new.honorario_exito_pct := old.honorario_exito_pct;
    new.convites_leiloeiro_disponiveis := old.convites_leiloeiro_disponiveis;
  end if;

  -- Auto-habilita o Programa de Parceiros para quem vira leiloeiro (ver cabeçalho acima).
  -- Roda DEPOIS do bloqueio acima, de propósito: mesmo o bloco de proteção não pode zerar
  -- isto de volta — um leiloeiro que já veio com o aceite não perde por causa de outro UPDATE
  -- feito pelo próprio usuário em outro campo qualquer (ex.: telefone).
  if new.role = 'leiloeiro' and new.parceiro_aceite_em is null then
    new.parceiro_aceite_em := now();
    new.parceiro_aceite_versao := 'leiloeiro-auto-v1';
  end if;

  return new;
end
$function$;

-- Backfill: nenhuma conta role='leiloeiro' existe hoje (confirmado 10/09), então não há
-- linha para corrigir agora — mas o UPDATE cobre o caso se isso mudar antes do deploy.
update public.perfis set parceiro_aceite_em = now(), parceiro_aceite_versao = 'leiloeiro-auto-v1'
 where role = 'leiloeiro' and parceiro_aceite_em is null;

commit;
