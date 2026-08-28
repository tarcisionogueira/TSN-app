-- ─────────────────────────────────────────────────────────────────────────────────────────
-- QUEM NUNCA LOGA FICAVA ÓRFÃO DE CARTEIRA — 28/08 (achado a partir de um print do dono)
--
-- O dono viu duas linhas "Sem consultor" no Comercial. A correlação no banco é perfeita:
-- dos 67 clientes que JÁ LOGARAM, 67 têm consultor; os 2 sem consultor estão entre os 3 que
-- NUNCA logaram. A causa é uma só: `vincular_owner_default()` é chamada pelo `AuthContext`,
-- no evento SIGNED_IN/INITIAL_SESSION — **a regra do upline padrão só existe no navegador**.
-- Quem nunca entra no app nunca passa por lá, e o perfil já nasceu (pelo trigger
-- `handle_new_user` ou pelo próprio endpoint que criou a conta com a service key).
--
-- Os dois caminhos que produziram órfãos, e um terceiro armado:
--   1. `api/live-inscrever.js` — inscrição na aula. Grava TODO o marketing no perfil e não
--      grava `indicado_por`. A pessoa recebe o e-mail e não entra.
--   2. Cadastro normal com e-mail nunca confirmado — o trigger cria o perfil pela metadata
--      do signUp e a pessoa não confirma.
--   3. `api/criar-conta-checkout.js` tem a mesma lacuna; só não gerou órfão porque quem paga
--      entra logo depois.
--
-- POR QUE CARÊNCIA, E NÃO DEFAULT NO NASCIMENTO (decisão do dono, opção "a"): preencher o
-- upline no momento em que o perfil nasce **rouba a indicação do parceiro**. `vincular_upline`
-- só grava `where indicado_por is null`, e no cadastro por Google o `?ref=` é resolvido no
-- navegador DEPOIS de o perfil existir — o padrão fecharia a porta do parceiro para sempre.
-- Com 24h de carência, o link do parceiro tem toda a janela real para se resolver, e só
-- quem sobra é adotado. O custo é uma janela curta de "Sem consultor" no painel, que é
-- honesta: naquele momento o sistema de fato ainda não sabe de quem é o cliente.
--
-- Esta função é a MESMA regra de `vincular_owner_default`, com o mesmo carimbo
-- ('padrao_dono') e os mesmos guardas — não uma segunda régua. A diferença é só QUEM chama:
-- lá o navegador, aqui o cron, para o caso em que navegador não há.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.adotar_orfaos_padrao_dono(p_horas int default 24)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_owner uuid := '92c713f3-1f1a-4758-bab2-32e6c83da433'; -- dono (upline padrão)
  v_corte timestamptz := now() - make_interval(hours => greatest(coalesce(p_horas, 24), 1));
  v_adotados int;
begin
  -- Aplica a regra comercial.upline_padrao: ninguém fica órfão de carteira. Mesmos guardas
  -- de vincular_owner_default (não toca em quem já tem upline, no próprio dono nem em staff)
  -- e o mesmo carimbo de origem, para o padrão continuar distinguível de indicação real.
  with adotados as (
    update public.perfis
       set indicado_por = v_owner,
           ultima_indicacao_em = now(),
           indicacao_origem = 'padrao_dono'
     where indicado_por is null
       and id <> v_owner
       and role not in ('admin','analista','advogado','consultor')
       and created_at < v_corte
    returning id
  )
  select count(*) into v_adotados from adotados;
  return jsonb_build_object('ok', true, 'adotados', v_adotados,
                            'carencia_horas', greatest(coalesce(p_horas, 24), 1),
                            'corte', v_corte);
end $fn$;

comment on function public.adotar_orfaos_padrao_dono(int) is
  'Adota como upline padrao (dono) os perfis de cliente que passaram da carencia sem nenhum upline. Existe porque vincular_owner_default so roda no navegador e quem nunca loga nunca passava por ela. Chamada por /api/adotar-orfaos-cron.';

revoke execute on function public.adotar_orfaos_padrao_dono(int) from public, anon, authenticated;
grant  execute on function public.adotar_orfaos_padrao_dono(int) to service_role;

-- ── A regra passa a ser DECLARADA, não só implementada ────────────────────────────────────
insert into public.regra_negocio (chave, valor, descricao, aplicada_por, ativo) values
 ('comercial.upline_padrao',
  '{"upline_padrao":"dono","carencia_horas":24,"carimbo":"padrao_dono","motivo_carencia":"o ?ref= do parceiro e resolvido no navegador depois de o perfil existir"}'::jsonb,
  'Ninguem fica orfao de carteira: cliente sem link de parceiro recebe o dono como upline. Aplicada em DOIS momentos porque um so nao cobre todo mundo — vincular_owner_default no primeiro login (navegador) e adotar_orfaos_padrao_dono no cron, 24h depois, para quem nunca loga (inscricao na aula, cadastro nao confirmado, conta criada no checkout). A carencia existe para nao roubar a indicacao do parceiro: vincular_upline so grava com indicado_por nulo, e o ?ref= do cadastro por Google e resolvido no navegador DEPOIS de o perfil existir. Toda atribuicao carimba indicacao_origem, para o padrao nunca se passar por indicacao real.',
  array['vincular_owner_default','adotar_orfaos_padrao_dono'], true)
on conflict (chave) do update
   set valor = excluded.valor, descricao = excluded.descricao,
       aplicada_por = excluded.aplicada_por, ativo = true, atualizado_em = now();

-- ── `indicacao_origem` entra na lista de campos que o cliente não escreve ─────────────────
-- O `indicado_por` já era protegido; o CARIMBO não era. Um usuário autenticado não conseguia
-- mudar de carteira, mas conseguia rotular a própria origem como 'link_parceiro' — e a origem
-- é o que responde "de onde veio este cadastro". Rótulo mentiroso em cima de dado correto
-- estraga o relatório do mesmo jeito. As RPCs legítimas são SECURITY DEFINER (current_user =
-- dono da função), então continuam gravando normalmente; o Admin passa por `is_admin()`.
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
  end if;
  return new;
end $function$;

-- ── REGRESSÃO MINHA, pega pela própria auditoria no mesmo minuto ──────────────────────────
-- Declarei a regra com DOIS aplicadores e só o novo mencionava a chave: `auditoria_regras_
-- negocio()` acusou `vincular_owner_default` como aplicadora órfã, que é exatamente o
-- trabalho para o qual ela foi escrita. A menção entra no corpo, junto do porquê de a regra
-- precisar de dois aplicadores.
create or replace function public.vincular_owner_default()
returns boolean language plpgsql security definer set search_path to 'public' as $fn$
declare v_owner uuid := '92c713f3-1f1a-4758-bab2-32e6c83da433'; -- dono (upline padrão)
begin
  -- Aplica a regra comercial.upline_padrao no PRIMEIRO LOGIN. É metade da regra: quem nunca
  -- abre o app não passa por aqui, e para esses o cron chama adotar_orfaos_padrao_dono 24h
  -- depois. A carência existe para não roubar a indicação do parceiro.
  if auth.uid() is null then return false; end if;
  update public.perfis
     set indicado_por = v_owner,
         ultima_indicacao_em = now(),
         -- O CARIMBO É O PONTO: sem ele, este update produz uma linha idêntica à de quem foi
         -- mesmo indicado pelo dono.
         indicacao_origem = 'padrao_dono'
   where id = auth.uid()
     and indicado_por is null
     and id <> v_owner
     and role not in ('admin','analista','advogado','consultor');
  return found;
end; $fn$;
