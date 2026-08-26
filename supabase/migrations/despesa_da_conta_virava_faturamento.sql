-- ─────────────────────────────────────────────────────────────────────────────────────────
-- A DESPESA DA CONTA VIRAVA FATURAMENTO — 25/08/2026
--
-- O dono perguntou de onde vinham os 47 pagamentos "avulso" sem `user_id` (R$ 5.047,49) e
-- levantou a hipótese de serem as contas gratuitas do plano. NÃO SÃO — e a resposta é o
-- oposto de receita. Lendo a descrição que o próprio Mercado Pago devolve:
--
--     Anthropic + "Anthropic* claude sub"      29×   R$ 2.052,29   ← a assinatura do Claude
--     Pago Bank Transfer Pix                    3×   R$ 2.500,00   ← Pix de terceiro
--     Padaria Mascote — Festa da Colheita 2026  9×   R$   131,00   ← nada a ver com o negócio
--     Supabase                                  1×   R$   129,06   ← a conta do banco de dados
--     Facebk *qlv9n2sml4                        1×   R$    35,14   ← Meta Ads
--     Recurring payment validation              3×   R$     0,00   ← nem é pagamento
--
-- São as DESPESAS da conta (e Pix de terceiros) entrando numa tabela de RECEITA.
--
-- O ESTRAGO ERA MAIOR QUE O FUNIL. `financeiro_resumo()` — a tela financeira — somava tudo
-- isso como venda: **R$ 4.883,29 de "vendas" em agosto**, ao lado de R$ 299,40 de mensalidade,
-- que é a receita de verdade. Ou seja: 94% do faturamento exibido não existia. O conserto de
-- 24/08 no funil de captação não pegou isto, porque lá o filtro por `user_id` já existia; aqui
-- não existia.
--
-- A CAUSA, em `api/backfill-mp-pagamentos-cron.js`:
--     // Só receita de cliente: pagamento comum ou cobrança recorrente.
--     if (op && op !== 'regular_payment' && op !== 'recurring_payment') continue;
-- O comentário promete "só receita de cliente"; o filtro só exclui transferência e saque POR
-- TIPO DE OPERAÇÃO. Cobrança no cartão da conta volta do MP como `regular_payment` e passa.
-- Comentário que descreve uma garantia que o código não entrega — a forma da casa.
--
-- O DISCRIMINADOR CERTO, medido antes de escolher: venda nossa SEMPRE carrega vínculo com
-- usuário (`external_reference` no formato `userId|planoKey`, ou `metadata.user_id`) — 7 de 7
-- pagamentos com `user_id` tinham `external_ref`. E os 31 sem usuário que TÊM external_ref
-- carregam refs no formato `uuid-timestamp`: são do sistema de cobrança da Anthropic, não do
-- nosso checkout. Sem vínculo com usuário = não é venda nossa.
--
-- DUAS BARREIRAS INDEPENDENTES, de propósito:
--   1. A classificação na entrada (backfill + webhook, mesmo commit): sem vínculo grava
--      `origem='terceiro'`, que nenhum relatório de receita lê.
--   2. `financeiro_resumo()` passa a exigir `user_id is not null` por conta própria, mesmo
--      para `origem='avulso'`. Se a classificação errar de novo, o número continua certo.
--
-- VERIFICADO em transação desfeita: devolvi UM registro para 'avulso' e a trava nova acusou 1
-- enquanto o financeiro seguiu em vendas = 0 — as duas barreiras funcionando de forma
-- independente. Depois do conserto: vendas R$ 4.883,29 → R$ 0,00, mensalidades R$ 299,40
-- intactas. Zero venda avulsa é o número honesto: a receita são 5 assinaturas.
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- ── 1) A tela financeira exige vínculo com cliente ──────────────────────────────────────
do $do$
declare def text; ancora text := ' and status=''approved'' and criado_em '; n int;
begin
  select pg_get_functiondef(oid) into def from pg_proc where proname='financeiro_resumo';
  if def is null then raise exception 'financeiro_resumo nao existe'; end if;
  if position('user_id is not null and status' in def) > 0 then
    raise notice 'ja aplicado — nada a fazer'; return;
  end if;
  n := (length(def) - length(replace(def, ancora, ''))) / length(ancora);
  if n <> 4 then
    raise exception 'esperava 4 ocorrencias da ancora, achei % — revise antes de aplicar', n;
  end if;
  execute replace(def, ancora, ' and user_id is not null and status=''approved'' and criado_em ');
  raise notice 'financeiro_resumo passa a exigir vinculo com cliente';
end $do$;

-- ── 2) Reclassifica o histórico ─────────────────────────────────────────────────────────
update public.mp_pagamentos set origem = 'terceiro', atualizado_em = now()
 where user_id is null and origem = 'avulso';

-- ── 3) A trava, que olha o RASTRO e não o código ────────────────────────────────────────
do $do$
declare def text; ancora text := '     (''sem_foto'','; novo text;
begin
  select pg_get_functiondef(oid) into def from pg_proc where proname='qa_invariantes';
  if def is null then raise exception 'qa_invariantes nao existe'; end if;
  if position('receita_sem_cliente' in def) > 0 then
    raise notice 'ja aplicado — nada a fazer'; return;
  end if;
  if position(ancora in def) = 0 then raise exception 'ancora nao encontrada'; end if;
  novo :=
'     (''receita_sem_cliente'',''Pagamento contado como VENDA sem nenhum cliente vinculado (despesa da conta virando faturamento)'',''Financeiro'',''bug'',
       (select count(*) from mp_pagamentos
         where origem in (''avulso'',''recorrente'') and user_id is null), 0),
' || ancora;
  execute replace(def, ancora, novo);
  raise notice 'trava receita_sem_cliente adicionada';
end $do$;
