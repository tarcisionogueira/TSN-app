# Variáveis de ambiente na Vercel — o que JÁ ESTÁ configurado

> **Para a próxima sessão: esta etapa está vencida. Não pergunte de novo, não peça print do
> painel, não conclua "está dormente" sem checar aqui primeiro.** Perguntar de novo é
> retrabalho que já custou tempo do dono mais de uma vez — inclusive em 28/08, quando eu
> tratei o Pixel/CAPI do Meta como possivelmente desligados e eles estavam no ar desde 29/07.
>
> O mesmo erro já tinha acontecido ANTES, e está registrado em `api/system-status.js`: o
> painel checava `META_PIXEL_ID` e `META_ACCESS_TOKEN`, nomes que **nunca existiram**, e por
> isso mostrava "Pendente" para uma integração funcionando. O comentário lá diz o que vale
> como regra: *"painel que mente sobre o que está pronto é pior que painel nenhum — faz
> perder tempo reconfigurando o que já funciona"*.

## 🔴 Nunca escreva o VALOR de nenhuma destas aqui

O repositório é **público**. Este arquivo lista **NOMES**, e só. Valor commitado continua
visível no histórico do git mesmo depois de removido — a única correção real é rotacionar o
segredo (achado de 03/08, com o `RESEND_WEBHOOK_SECRET` em texto puro no HANDOFF).

## A fonte VIVA (use esta antes de confiar numa lista escrita)

`GET /api/system-status` (admin) responde quais integrações estão ligadas, lendo
`process.env` de verdade. Uma lista em markdown envelhece calada; o endpoint não.
Este documento existe para responder "já foi configurado?" sem custo, não para substituí-lo.

## Confirmadas no painel da Vercel em 28/08 (print do dono)

| Nome | Para quê |
|---|---|
| `VITE_META_PIXEL_ID` | Pixel do Meta no navegador (`src/utils/marketing.js`) |
| `VITE_OPENAI_PIXEL_ID` | Pixel do OpenAI Ads / ChatGPT Ads (`src/utils/marketing.js`). Fonte de dados **"BidPro Brasil — site"**, criada em 28/08. O código é dormente sem a env: criar e redeployar liga o canal |
| `META_CAPI_TOKEN` | Meta Conversions API server-side (`api/_meta-capi.js`) |
| `META_ADS_TOKEN` | Ingestão do gasto diário do Meta Ads (`api/meta-insights-cron.js`) |
| `META_AD_ACCOUNT_ID` | idem |

**`META_PIXEL_ID` (sem o prefixo `VITE_`) NÃO existe — e não precisa existir.**
`api/_meta-capi.js:17` faz `META_PIXEL_ID || VITE_META_PIXEL_ID`, e a Vercel expõe **todas**
as envs do projeto ao runtime Node; o prefixo `VITE_` só governa o que entra no bundle do
navegador. Ou seja: Pixel **e** CAPI estão ativos. Não crie a variável duplicada.

## Configuradas — provadas pelo comportamento em produção

Não estão no print acima, mas o sistema não funcionaria sem elas (relatórios saem, e-mails
chegam, crons rodam, cobrança processa). Tratar como configuradas:

- **Núcleo:** `VITE_SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `APP_BASE_URL`, `CRON_SECRET`
- **Receita:** `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `ASAAS_API_KEY`
- **Comunicação:** `RESEND_API_KEY`, `APP_FROM_EMAIL`, `RESEND_WEBHOOK_SECRET`
- **IA:** `CLAUDE_KEY`, `GEMINI_API_KEY`
- **Operação:** `BRIGHTDATA_API_TOKEN`, `BRIGHTDATA_ZONE`, `BRIGHTDATA_MAX_REQ_SEMANA`, `DAILY_API_KEY`

## ✅ `LOCATIONIQ_USD_POR_1000` — resolvido, e NÃO precisa existir

Era listado aqui como pendência. **Não é.** O dono confirmou em 28/08 que o LocationIQ está
no **plano gratuito**: não há cobrança por chamada, então custo zero é o valor *real*, e não
ausência de medição. Foi declarado em `integracao_preco` (`provedor='locationiq'`,
`usd_por_1000=0`), e é a declaração que fecha o invariante `geocode_sem_preco`.

**Não crie a env.** Numa integração gratuita ela não teria o que carregar, e setá-la como `0`
seria indistinguível de não tê-la — que era exatamente o defeito consertado.

Se um dia o plano virar pago: atualize a linha em `integracao_preco` **e** crie
`LOCATIONIQ_USD_POR_1000` na Vercel com o mesmo número.

## Opcionais que podem estar ou não (confirme em `/api/system-status`, não no chute)

`GOOGLE_ADS_*` (conversão offline do PIX), `ONR_EMAIL`/`ONR_SENHA`, `GOOGLE_OAUTH_*`
(agenda), `META_CAPI_TEST_CODE` (só para a aba "Testar eventos").

## Como conferir o Meta sem inscrição real

`/api/meta-capi-test?evento=lead&test_event_code=TESTxxxx` (admin) dispara um `Lead` de
diagnóstico. E o rastro de todo Lead real fica em:

```sql
select detalhe, criado_em from eventos_atividade where tipo='meta_lead' order by criado_em desc limit 5;
```

## ⛔ AINDA NÃO CRIADAS — Instagram / ManyChat próprio (01/09)

O código de `api/instagram-webhook.js` está no ar e **dormente por ausência destas duas**: sem
`IG_APP_SECRET` ele responde 500 e recusa a entrega, em vez de aceitar sem validar assinatura.
Criar as duas na Vercel (Production + Preview + Development) é o que liga a escuta.

| Nome | Para quê |
|---|---|
| `IG_APP_SECRET` | Valida `X-Hub-Signature-256` de cada entrega da Meta. É o **App Secret** do app em `developers.facebook.com` |
| `IG_VERIFY_TOKEN` | String inventada por você. Responde o `hub.challenge` na verificação do webhook — o mesmo valor é digitado no painel da Meta ao cadastrar a URL |

Previstas para as etapas seguintes (ainda sem código que as leia):

| Nome | Para quê |
|---|---|
| `IG_PAGE_TOKEN` | Token long-lived para **ENVIAR** mensagens (Send API) |
| `IG_USER_ID` | Id da conta profissional. **Já medido: `17841400563334157`** (`tarcisionogueiraleiloes`) |
| `IG_BOT_ATIVO` | `1`/`0` — mata a resposta automática sem deploy. **Não governa a escuta**, de propósito |

**Como conferir se a escuta está configurada, sem segredo nenhum:**
`GET /api/instagram-webhook` devolve `{ configurado: true|false }`.
