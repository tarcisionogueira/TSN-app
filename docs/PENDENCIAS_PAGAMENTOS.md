# Pendências de Pagamentos / Chargeback

## ⏳ Submissão automática da defesa de chargeback no MercadoPago

**Status:** adiado de propósito — implementar quando for possível **validar contra a API de disputas real do MP**.

**Por quê está adiado:** não dá para testar o endpoint de claims/disputes do MP em ambiente de desenvolvimento sem uma disputa real; ligar o envio automático "às cegas" pode tratar disputas reais de forma errada.

**O que JÁ está pronto (núcleo de proteção):**
- Identificação automática do chargeback nos dois gateways (`api/mp-webhook.js`, `api/asaas-webhook.js` → `processarChargeback` em `api/_webhook-core.js`).
- Dossiê de defesa montado automaticamente (aceite com IP/UA/versão + pagamento), gravado em `chargebacks.dossie`.
- Suspensão do acesso durante a disputa + alerta à equipe.
- Tela `/admin/chargebacks` com o dossiê **copiável** (envio manual em 1 clique).

**O que falta (este lembrete):**
1. Mapear `payment_id` → `claim_id` via API de claims do MP (`GET /v1/claims/search` ou similar).
2. Endpoint `POST /api/chargeback-defesa` (admin) que envia o dossiê como evidência na API de disputas do MP.
3. Botão **"Enviar defesa"** na tela `/admin/chargebacks` (preferir botão a automático cego), atualizando `chargebacks.defesa_status` para `enviada`.
4. Asaas: envio segue manual (API limitada) — manter o dossiê copiável.

**Momento sugerido para implantar:** quando houver a primeira disputa real no MP (ou acesso à doc/sandbox de claims), validar o fluxo end-to-end e então ligar o botão de envio.

---

## ⏳ Renovação automática do plano ANUAL

**Status:** o aviso de renovação por e-mail (`api/renovacao-avisos-cron.js`) já cobre as
assinaturas **recorrentes** (preapproval mensal do MP: Investidor Pro mensal / Leilão Club),
enviando ~3 dias antes da cobrança com plano, valor, data e forma de pagamento.

**O que falta:** o plano **anual** (`top2_anual`) hoje é **pagamento único** (`criarPreferencia`,
não-recorrente) — não é um preapproval, então **não auto-renova** e não entra no aviso.
Para "anual parcelado com renovação automática" é preciso um mecanismo de **recobrança anual**
(ex.: preapproval anual no MP, ou agendar nova cobrança 12 meses depois via cron), e então
incluir esses assinantes no `renovacao-avisos-cron`. Validar contra o MP real antes de ligar.

---

## ⏳ (Resolvido) Prevenção de dupla cobrança MP↔Asaas
Implementado em `src/pages/Checkout.jsx` (`cancelarAssinaturasAnteriores`): antes de criar uma nova assinatura recorrente, cancela as assinaturas ativas do cliente nos dois gateways.
