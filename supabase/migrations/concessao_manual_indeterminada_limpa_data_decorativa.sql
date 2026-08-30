-- 29/08 — DATA DE VENCIMENTO QUE NÃO VENCE NADA (decisão do dono: concessão indeterminada)
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- Duas contas carregavam `plano_vencimento` (14/07/2027 e 21/07/2027) sem que a data
-- tivesse qualquer efeito. Investigado antes de mexer, porque a hipótese óbvia estava errada:
--
--   • NÃO é a cortesia de CURSO. Esse caminho existe (`regra_negocio['produto.concede_plano']`
--     → `conceder_plano_usuario()`) e carimba `plano_ciclo = 'cortesia'`. Medido: `cursos` = 0,
--     `compras` = 0, `compras_produtos` = 0 — o caminho NUNCA rodou —, e as duas contas estão
--     com `plano_ciclo = 'mensal'`, não 'cortesia'.
--   • NÃO é promoção de setembro. As datas são +365 dias exatos de concessões feitas em
--     14/07/2026 e 21/07/2026.
--
-- São duas concessões MANUAIS, e o dono confirmou: **por tempo indeterminado**.
--
-- ─── POR QUE A DATA PRECISA SAIR, E NÃO SÓ SER IGNORADA ─────────────────────────────────
-- Ela é a forma nº 10 em estado puro: um campo com nome de regra que ninguém aplica.
-- O cron de vencimento (`reconciliar-assinaturas-cron.js`) filtra
-- `plano_ciclo in ('anual','cortesia')` **E** `role in ('top2','top2_anual')` — um
-- `assessorado` com ciclo 'mensal' não passa em NENHUM dos dois. Ou seja: o acesso já era
-- permanente, e a data servia só para fazer quem lê o painel acreditar no contrário.
-- Deixá-la seria manter no banco uma promessa que o sistema não cumpre.
--
-- ─── CONFERIDO ANTES: LIMPAR A DATA NÃO EXPÕE A OUTRO REBAIXAMENTO ──────────────────────
-- Trocar um problema por outro seria pior que não mexer. Os caminhos que rebaixam para
-- explorador são três, e nenhum alcança estas contas:
--   1. `reconciliar-assinaturas-cron:259` — o loop de vencimento. Com `plano_vencimento`
--      nulo o `.lt()` nunca casa; a limpeza REFORÇA o indeterminado em vez de arriscá-lo.
--   2. `garantia-cancelar.js:137` — só por ação do próprio cliente.
--   3. `suspenderPlanoDireto` (webhook de vencido/chargeback) — exige evento de gateway, e
--      as duas contas não têm `mp_preapproval_id` nem `asaas_id`.
--   (`reconciliar-asaas-cron` só ATIVA: pula quem não é explorador.)
--
-- Alvo por CONDIÇÃO, não por UUID: concessão manual é exatamente "tem vencimento, nunca
-- pagou e não tem mandato em gateway nenhum". Escrever a intenção em vez da lista deixa a
-- migração legível num banco recriado — e não fixa identificador de cliente num repo público.
-- Dry-run antes de rodar: 2 linhas, as duas esperadas.
update public.perfis p
   set plano_vencimento = null,
       -- `plano_ciclo` também sai: 'mensal' descrevia um ciclo de cobrança que não existe
       -- (zero pagamento, zero mandato). Concessão indeterminada não tem ciclo, e deixar
       -- 'mensal' faria a conta se passar por assinatura paga em qualquer leitura futura.
       plano_ciclo = null
 where p.plano_vencimento is not null
   and p.mp_preapproval_id is null
   and p.asaas_id is null
   and not exists (select 1 from public.mp_pagamentos m
                    where m.user_id = p.id and m.status = 'approved');
