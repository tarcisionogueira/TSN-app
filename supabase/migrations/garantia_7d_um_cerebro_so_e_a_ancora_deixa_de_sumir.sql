-- 29/08 — A ÂNCORA DOS 7 DIAS DO CDC TINHA TRÊS CÉREBROS E NENHUM DONO
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- `perfis.plano_pago_em` é a âncora do direito de arrependimento (CDC art. 49):
-- `garantia-cancelar.js` faz `dentro7 = plano_pago_em && (agora - plano_pago_em <= 7d)`.
-- **Âncora nula = reembolso NEGADO**, sem erro e sem rastro.
--
-- A decisão estava escrita em TRÊS pontos de JS (`ativarPlanoDireto`, `processarConfirmado`,
-- `mp.js/ativarRoleInline`), sempre na mesma forma:
--
--     if (!plano_pago_em && !PAGANTES.includes(role)) { ancora }
--
-- ...que usa **"o role já é pagante" como sinônimo de "já foi ancorado"**. Não são a mesma
-- coisa: quem vira pagante por um caminho que NÃO grava a âncora (concessão manual,
-- cortesia, ativação antiga) fica preso — o role pagante passa a bloquear para sempre a
-- gravação que faltou, e o cliente perde um direito legal sem que nada acuse.
--
-- Medido em 29/08: **1 dos 4 pagantes reais** estava assim (`top2`, duas cobranças
-- aprovadas em 01/07 e 01/08, âncora nula). E o vetor segue vivo: há uma conta
-- `assessorado` de CORTESIA na base — no dia em que ela pagar, cairia no mesmo buraco.
--
-- ─── POR QUE A REGRA VEM PARA O BANCO ───────────────────────────────────────────────────
-- É o padrão que esta base já cobra de si mesma: `auditoria_regras_negocio()` termina
-- verificando que `solicitar_saque_ledger` delega a `saque_avaliar` — "voltaram os dois
-- cérebros". Regra de DINHEIRO com três cópias em JS é a mesma doença, e foi assim que
-- "explorador não saca" virou letra morta em 08/08: escrita no comentário, ausente do
-- código. Aqui ela vira DADO (`regra_negocio`) com um avaliador único que o auditor
-- consegue conferir sozinho.

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 1) O AVALIADOR ÚNICO
-- ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.garantia_7d_avaliar(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_role text; v_ancora timestamptz; v_pagou boolean;
  -- regra: garantia.ancora_7d  (a chave aparece literalmente aqui porque
  -- auditoria_regras_negocio() exige que a função aplicadora MENCIONE a regra que aplica)
begin
  if p_user_id is null then
    return jsonb_build_object('ancorar', false, 'motivo', 'sem_usuario', 'regra', 'garantia.ancora_7d');
  end if;

  select p.role, p.plano_pago_em into v_role, v_ancora
    from public.perfis p where p.id = p_user_id;

  if not found then
    -- Perfil não lido não é "perfil sem âncora": não decide, e o lado conservador é não ancorar.
    return jsonb_build_object('ancorar', false, 'motivo', 'perfil_nao_encontrado', 'regra', 'garantia.ancora_7d');
  end if;

  -- (1) Já ancorado → NUNCA reancora. Renovação mensal não reinicia a janela.
  if v_ancora is not null then
    return jsonb_build_object('ancorar', false, 'motivo', 'ja_ancorado', 'regra', 'garantia.ancora_7d');
  end if;

  -- (2) Role não-pagante → é a estreia. Cobre também a RECONTRATAÇÃO depois de cancelar:
  --     `garantia-cancelar` rebaixa para explorador e zera a âncora, então o cliente cai
  --     aqui e ganha uma janela nova — correto (o reembolso em si segue limitado a UMA VEZ
  --     POR CPF via `reembolsos_garantia`).
  if v_role is null or v_role not in ('top2','assessorado','clube','top2_anual','assessorado_anual','clube_anual') then
    return jsonb_build_object('ancorar', true, 'motivo', 'estreia', 'regra', 'garantia.ancora_7d');
  end if;

  -- (3) Role pagante SEM âncora → estado que não deveria existir. Ancora somente se NÃO
  --     houver cobrança aprovada anterior (a conta de cortesia que passa a pagar). Havendo,
  --     é renovação de alguém cuja âncora se perdeu: ancorar em now() daria 7 dias não
  --     devidos. Esse resíduo se corrige no DADO, pela data real do 1º pagamento (bloco 3).
  select exists (select 1 from public.mp_pagamentos m
                  where m.user_id = p_user_id and m.status = 'approved') into v_pagou;

  return jsonb_build_object('ancorar', not v_pagou,
    'motivo', case when v_pagou then 'pagante_com_historico' else 'promovido_sem_cobranca' end,
    'regra', 'garantia.ancora_7d');
end; $function$;

comment on function public.garantia_7d_avaliar(uuid) is
  'Avaliador UNICO da ancora dos 7 dias (CDC art. 49). Devolve {ancorar, motivo, regra}. '
  'Todo caminho de ativacao paga consulta esta funcao — nao reimplemente a decisao em JS.';

revoke all on function public.garantia_7d_avaliar(uuid) from public, anon;
grant execute on function public.garantia_7d_avaliar(uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 2) A REGRA VIRA DADO (e o auditor passa a cobrá-la sozinho)
-- ─────────────────────────────────────────────────────────────────────────────────────
insert into public.regra_negocio (chave, valor, descricao, aplicada_por, ativo)
values (
  'garantia.ancora_7d',
  jsonb_build_object('janela_dias', 7, 'base_legal', 'CDC art. 49', 'uma_vez_por', 'cpf'),
  'A janela de arrependimento de 7 dias e ancorada em perfis.plano_pago_em na PRIMEIRA '
  || 'ativacao paga. Renovacao nao reinicia; recontratacao apos cancelamento inicia uma nova; '
  || 'conta promovida sem cobranca que passa a pagar ganha a dela. "Role pagante" NAO e '
  || 'sinonimo de "ja ancorado" — foi essa confusao que negou o direito a 1 dos 4 pagantes.',
  array['garantia_7d_avaliar'],
  true)
on conflict (chave) do update
  set valor = excluded.valor, descricao = excluded.descricao,
      aplicada_por = excluded.aplicada_por, ativo = true, atualizado_em = now();

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 3) O RESÍDUO: âncora perdida recuperada pela data REAL do 1º pagamento
-- ─────────────────────────────────────────────────────────────────────────────────────
-- NÃO usa now(): isso inventaria uma janela de 7 dias que já venceu há muito. Usa
-- `dados_mp.date_approved` do pagamento mais antigo — que é quando o direito de fato
-- começou. Para o caso de 29/08 (1ª cobranca em 01/07) a janela venceu em 08/07: a
-- correcao nao concede reembolso nenhum, so faz o registro dizer a verdade — inclusive no
-- AdminFinanceiro, que hoje imprime "pgto —" para um cliente que pagou duas vezes.
with primeiro as (
  select m.user_id,
         min(coalesce((m.dados_mp->>'date_approved')::timestamptz,
                      (m.dados_mp->>'date_created')::timestamptz,
                      m.criado_em)) as em
    from public.mp_pagamentos m
   where m.status = 'approved' and m.user_id is not null
   group by m.user_id)
update public.perfis p
   set plano_pago_em = pr.em
  from primeiro pr
 where p.id = pr.user_id
   and p.plano_pago_em is null
   and p.role in ('top2','assessorado','clube','top2_anual','assessorado_anual','clube_anual');

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 4) A TRAVA: o estado corrompido não pode voltar em silêncio
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Pagante com cobrança aprovada e âncora nula = cliente com o reembolso de 7 dias negado
-- por falta de dado. Limite 0. Não depende de ninguém lembrar de olhar.
create or replace function public.qa_invariante_pagante_sem_ancora_cdc()
returns bigint language sql stable set search_path to 'public' as $$
  select count(*)::bigint from public.perfis p
   where p.plano_pago_em is null
     and p.role in ('top2','assessorado','clube','top2_anual','assessorado_anual','clube_anual')
     and exists (select 1 from public.mp_pagamentos m
                  where m.user_id = p.id and m.status = 'approved');
$$;

do $do$
declare d text; alvo text; novo text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'qa_invariantes';
  alvo := E'where i.ativo and not exists (select 1 from fonte_saude s where s.fonte = i.fonte)) c), 0)';
  if position(alvo in d) = 0 then raise exception 'ancora nao encontrada em qa_invariantes()'; end if;
  if position('pagante_sem_ancora_cdc' in d) > 0 then raise notice 'ja registrado'; return; end if;
  novo := alvo || E',\n     (''pagante_sem_ancora_cdc'',''Pagante com cobranca aprovada e plano_pago_em nulo — reembolso de 7 dias (CDC art. 49) negado por falta de dado'',''Financeiro'',''critico'',\n       public.qa_invariante_pagante_sem_ancora_cdc(), 0)';
  execute replace(d, alvo, novo);
end $do$;
