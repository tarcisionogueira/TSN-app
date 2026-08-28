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
