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

## ✅ CRIADAS — Instagram / ManyChat próprio (confirmado por print do painel, 08/09)

`IG_APP_SECRET`, `IG_APP_SECRET_INSTAGRAM` e `IG_VERIFY_TOKEN` **existem em Production**
(print do dono, 08/09) — o registro de 01/09 abaixo estava desatualizado, ninguém tinha
voltado aqui pra corrigir depois de criá-las. `api/instagram-webhook.js` deveria estar
`configurado: true` agora (checar com `GET /api/instagram-webhook`).

⚠️ **O print mostrava só escopo "Production"**, não "All Environments" — se algum dia for
testar o webhook a partir de uma Preview deployment, confirmar se as 3 têm Preview/Development
marcados também. Pra produção (que é a única URL que a Meta chama de verdade) não importa.

⚠️ **Env var configurada ≠ tráfego real chegando.** Mesmo com as 3 no ar, `ig_webhook_recebido`
não tem NENHUMA entrega real (só 2 pings do botão "Testar" da Meta, ambos de 02/09) — o que
aponta pro próximo gargalo, que é de painel da Meta, não de código: **Acesso de
Desenvolvimento só entrega webhook de contas de TESTE/admin do app; tráfego de gente de fora
só chega depois do App Review aprovar Acesso Avançado** (§2 de `docs/INSTAGRAM_AUTOMACAO.md`).
Verificar o status da Verificação de Negócio e do App Review antes de supor outra causa.

| Nome | Para quê |
|---|---|
| `IG_APP_SECRET` / `IG_APP_SECRET_INSTAGRAM` | Valida `X-Hub-Signature-256` de cada entrega da Meta — o webhook aceita qualquer uma das duas e loga qual fechou (ver comentário em `api/instagram-webhook.js`) |
| `IG_VERIFY_TOKEN` | Responde o `hub.challenge` na verificação do webhook — o mesmo valor digitado no painel da Meta ao cadastrar a URL |

## ✅ CRIADAS — `IG_PAGE_TOKEN` / `IG_USER_ID`, para ENVIAR (09/09)

| Nome | Para quê |
|---|---|
| `IG_PAGE_TOKEN` | Token de longa duração (~60 dias) para a Send API (`api/_instagram-envio.js`) |
| `IG_USER_ID` | **`28367331459563737`** — ver correção abaixo, não é mais o valor antigo |
| `IG_BOT_ATIVO` | `1`/`0` — mata a resposta automática sem deploy. **Não governa a escuta**, de propósito. Ainda não criada — segue prevista |

⚠️ **`IG_USER_ID` mudou de valor — o `17841400563334157` registrado em 01/09 media a conta pelo
caminho ERRADO.** A Meta tem dois IDs para a MESMA conta: um pelo vínculo com Página do
Facebook (`1784...`, o antigo) e outro pelo Instagram Login direto (`2836...`). Como o app
"BidPro - Atendimento-IG" (`911295054971510` — é um app PRÓPRIO, distinto de "BidPro -
Atendimento", `1533306125147104`; não aparece em todo seletor de app, mas existe) usa Instagram
Login, é o ID `2836...` que a Send API espera — confirmado batendo `/me` e o Depurador de Token
da própria Meta contra o token gerado. Usar o ID antigo teria dado erro silencioso ou recusa da
API mesmo com token e secret corretos.

⚠️ **O botão "Gerar token" do painel atual da Meta (v26.0) já entrega token de LONGA DURAÇÃO
direto — não um de 1h.** Achado só depois de gastar várias rodadas tentando `GET
graph.instagram.com/access_token?grant_type=ig_exchange_token` sobre um token que já não
precisava de troca: a Meta devolvia `"Session key invalid"` (código 452) toda vez, com QUALQUER
secret, porque a operação em si não fazia sentido para esse token. O Depurador
(`developers.facebook.com/tools/debug/accesstoken/`) resolveu de vez: `Válido: Verdadeiro`,
expira em ~2 meses. **Antes de gerar um token novo, sempre passar pelo Depurador primeiro** —
ele mostra em segundos se já é de longa duração, evitando repetir esta novela.

⚠️ **Ele expira (~60 dias da geração) e precisa ser renovado antes disso**, via
`GET graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=<TOKEN_ATUAL>`
(token precisa ter pelo menos 24h). Nenhuma automação faz isso ainda — é manual, e sem aviso
programado. Achado a registrar como pendência, não resolvido nesta sessão.

**Como conferir se a escuta está configurada, sem segredo nenhum:**
`GET /api/instagram-webhook` devolve `{ configurado: true|false }`.
