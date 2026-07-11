# Plano de produção — WhatsApp oficial + Meta + Monitoramento de usuários

> Item de fila de produção. Planejamento validado com o dono (jul/2026). **Voz (TTS/STT) fica FORA da 1ª versão** — pode entrar depois como camada opcional.

## Objetivo
1. **WhatsApp oficial (Cloud API)** como canal **receptivo** de atendimento, plugado na tela de atendimento que já existe, com bot de 1º nível e escalonamento a humano.
2. **Integração Meta** (Pixel + Conversions) para rodar/medir campanhas e o gancho **Click-to-WhatsApp**.
3. **Monitoramento 360º do usuário** (relatórios gerados + buscas/intenções + chamados + último acesso) para acompanhar e contatar o cliente.
4. **Google Ads**: já pronto — só criar a campanha no painel.

---

## Estado atual das integrações (verificado no código)

| Integração | Estado | Observação |
|---|---|---|
| **Google Ads + GA4** | ✅ Pronto | Tag `AW-16850175262` + GA4 `G-5YNHQB5F81` em todas as páginas; conversões Cadastro e Plano com rótulos reais em `src/utils/gtag.js`. Falta só criar a campanha no painel Google Ads. |
| **Meta (Pixel/CAPI)** | ⚠️ Só placeholder | `META_PIXEL_ID`/`META_ACCESS_TOKEN` aparecem no `system-status.js`, mas **não há `fbq` no `index.html` nem CAPI no código** — campanha Meta não mede conversão hoje. |
| **WhatsApp** | ❌ Inexistente | Greenfield. Só há coleta de número (`perfis.telefone`, `sdr_leads.whatsapp`) e links `wa.me` manuais. |
| **Atendimento (chamados)** | ✅ Reaproveitável | `chamados`/`chamados_mensagens` + `Atendimento.jsx` + bot `chat-suporte.js`. |
| **E-mail (Resend)** | ✅ Pronto | Canal de saída proativo/marketing (grátis). |

---

## Decisões de arquitetura (fechadas)

- **WhatsApp via Cloud API oficial** (não a não-oficial): encaixa no serverless atual (webhook stateless), sem risco de banimento, sem worker always-on. Modelo receptivo = **grátis** na janela de 24h.
- **Reusar a tela de atendimento**: cada mensagem do WhatsApp vira/atualiza um **chamado**; atendentes trabalham na mesma `Atendimento.jsx`. Transferência entre atendentes (já existe) é **invisível ao cliente** (número único). Comunicação interna do time via **nota interna** (`obs_interna`) — nunca vai ao WhatsApp.
- **Governança de custo/contato**:
  - Botão "responder no WhatsApp" só **habilitado com janela de 24h aberta** (cliente escreveu). Fora disso, só nota interna / e-mail / template pago com permissão.
  - A própria Meta já **bloqueia** mensagem livre fora da janela (só template pago).
  - **Proativo em massa = e-mail** (Resend, grátis); WhatsApp fica receptivo.
- **Custo WhatsApp**: conversas iniciadas pelo cliente (service) = **grátis**; marketing/template proativo = pago (~R$0,30–0,40/msg). Free Entry Point (Click-to-WhatsApp) = 72h grátis, marketing incluso.
- **Voz (TTS/STT)**: **adiada**. Quando entrar: OpenAI TTS como padrão (barato ~R$0,04–0,08/áudio), áudio seletivo, cache de frases padrão, fallback para texto, teto de áudios por cliente.
- **Upsell**: bot pode recomendar cursos/ebooks (`src/data/cursos.js` + checkout) quando a dúvida casa com o material — grátis dentro da janela.

---

## Fases (ordem de menor esforço → maior valor)

### Fase A — Google (imediata, externa)
Criar a campanha de leads no painel Google Ads, marcar as 2 conversões (Cadastro/Plano) como primárias, orçamento/segmentação. **Sem código.** ⚠️ Confirmar que `trackPlanContratado` dispara no pagamento aprovado.

### Fase B — Monitoramento 360º do cliente (não bloqueada; dados já existem)
Tela admin que junta, por usuário: relatórios gerados (`analises_mercado/documental/laudo`) + buscas/intenções (`busca_historico`) + chamados + último acesso (`auth.users.last_sign_in_at`) + plano/cota, com botões **abrir chamado / e-mail / (WhatsApp quando existir)**.
- Ajuste: liberar SELECT de staff em `analises_mercado` e `analises_documental` (hoje só o dono lê; `analises_laudo` já libera) — ou ler via endpoint admin com service_role.
- (Opcional) log de "imóvel visto" (hoje só há filtros de busca, não imóveis abertos).
- Toca: `src/pages/Admin.jsx` (nova aba), talvez `src/pages/Membros.jsx`; endpoint admin novo.

### Fase C — Meta Pixel + Conversions
Instalar o Pixel (`fbq`) no `index.html` + eventos (espelho do `gtag.js`), e opcionalmente CAPI server-side (endpoint novo, com `META_ACCESS_TOKEN`). Habilita campanha Meta medir conversão e o Click-to-WhatsApp.
- Toca: `index.html`, `src/utils/` (novo `metapixel.js`), `system-status.js`.

### Fase D — WhatsApp Cloud API (receptivo) plugado no atendimento
- `api/whatsapp-webhook.js` (Edge): recebe mensagem (auth por segredo em header, padrão `inbound-juridico`) → cria/atualiza `chamado` (canal='whatsapp', guarda `wa_id`) → insere em `chamados_mensagens`.
- `api/_whatsapp.js`: envio outbound via Cloud API (espelho do `_email.js`).
- Migração: campo `canal` + `wa_id` + `janela_expira_em` (ou derivar da última msg do cliente) em `chamados`.
- `src/pages/Atendimento.jsx`: trava do botão por janela de 24h + por papel; badge do canal.
- Ligar `chat-suporte.js` como bot de 1º nível no WhatsApp.
- CSP (`vercel.json`) + item no `system-status.js` (grupo comunicacao).

### Fase E — Gancho de campanhas + upsell
- Click-to-WhatsApp nas campanhas Meta (72h grátis) → bot responde usando dados do 360º.
- Bot recomenda cursos/ebooks conforme a dúvida.

### Fase F (futura) — Camada de voz (TTS/STT) — adiada
OpenAI TTS padrão, áudio seletivo ≤30s, cache + fallback texto, teto por cliente.

---

## Pré-requisitos do dono (destravam o código das fases C/D)
1. **Conta Meta Business** verificada (serve para WhatsApp **e** Ads/Pixel — um setup só).
2. **Número dedicado** ao WhatsApp Business Platform (não pode estar ativo no WhatsApp/WhatsApp Business comum).
3. **Credenciais WhatsApp Cloud API**: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID`, `WHATSAPP_VERIFY_TOKEN` (webhook), `WHATSAPP_APP_SECRET`.
4. **`META_PIXEL_ID`** real (para instalar o Pixel) e confirmar `META_ACCESS_TOKEN` (CAPI).
5. **Google Ads**: confirmar as 2 conversões importadas/primárias no painel.

## Progresso
- **Fase B — Tela 360º do cliente: ✅ ENTREGUE** (em produção). Rota `/cliente-360` (admin/analista), botão "👤 360º Cliente" no header. Endpoint `api/admin-usuario-360.js` + funções SQL `admin_busca_usuarios`/`admin_usuario_360` (SECURITY DEFINER, service_role — não afrouxou RLS). Mostra por usuário: perfil + último acesso, intenção (triagem), os 3 relatórios (quantos gerou + últimos imóveis), buscas recentes e chamados, com contato por e-mail e WhatsApp (`wa.me` manual por enquanto).
- **Fase B.1 — Log de imóvel visualizado: ✅ ENTREGUE** (em produção). Tabela `imovel_visto` (upsert com contador de visitas), função `registrar_imovel_visto` (definer, grava p/ `auth.uid()`), registro ao abrir a ficha em `ImovelDetalhe.jsx` (só clientes, não staff). Seção "Imóveis que visualizou" na tela 360º (com nº de vezes). Captura o "de olho, mas ainda não analisou".

## Aprendizado das IAs
- **IA de indicadores (dashboard) aprende com a demanda: ✅ ENTREGUE.** Função `demanda_busca_agregada()` (agregado/anônimo, 30 dias: cidades/tipos/pagamento mais buscados, imóveis mais vistos e **demanda sem oferta** = buscas com 0 resultado) entra no snapshot do `diagnostico-ia.js`; o prompt manda a IA transformar isso em **direcionamentos** (captar leiloeiro/rodar campanha onde há procura sem oferta). Roda no próximo ciclo do diagnóstico.
- **Agente de atendimento — ORGANIZADO para os 2 canais: ✅** O núcleo do bot virou uma função reutilizável `responderSuporte({ mensagens, memoria, canal })` em `api/chat-suporte.js` (não faz auth/HTTP) → **o MESMO agente** atende o chat do site hoje e o WhatsApp quando integrar (o webhook só chama `responderSuporte`). Param `canal` ('site'|'whatsapp'); 'site' inalterado, 'whatsapp' encurta a resposta. As regras de privacidade (nunca dado de terceiros, nunca caso específico, [[ESCALAR]] para humano) já vivem no SYSTEM.
- **Aprendizado do agente (Fase 2): ⏳ ENGATILHADO** — avançar só com o dono no PC (junto do WhatsApp). Trilho de privacidade: o bot só recebe (a) o **360º do PRÓPRIO** cliente + (b) conhecimento **agregado/da plataforma** (catálogo, cursos, leiloeiros, FAQ). **Nunca** dado individual de terceiros — escopado no nível dos dados. Fase posterior: base anonimizada dos chamados resolvidos (`*_aprendizado`).
- **Validar o fluxo na virada (go-live do WhatsApp):** com número/tokens no ar, testar ponta a ponta — cliente manda msg no WhatsApp → vira chamado → bot responde (canal whatsapp) → escala para humano (mesma tela `Atendimento.jsx`) → transferência entre atendentes invisível ao cliente → nota interna não vaza. Só então liberar para clientes reais.

## ⏳ A FAZER QUANDO O DONO ESTIVER NO COMPUTADOR (pedido dele)
**Adiantar o ESQUELETO WhatsApp/Meta** (código pronto, ativa quando as credenciais chegarem):
- Migração: `canal` + `wa_id` + `janela_expira_em` em `chamados`.
- `api/whatsapp-webhook.js` (inbound, auth por segredo em header — padrão `inbound-juridico`).
- `api/_whatsapp.js` (outbound via Cloud API, espelho do `_email.js`), com placeholders de env.
- Meta Pixel (`fbq`) no `index.html` aguardando `META_PIXEL_ID`.
- Requer do dono (para ATIVAR, não para escrever o esqueleto): conta Meta Business, número, tokens WhatsApp, `META_PIXEL_ID` (ver pré-requisitos acima).

## Próximo passo sugerido
Fase A (Google, externa, com o dono) + adiantar o esqueleto WhatsApp/Meta quando o dono estiver no computador.
