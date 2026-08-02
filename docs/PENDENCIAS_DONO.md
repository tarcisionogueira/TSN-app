# ✅ Pendências que dependem do DONO (fazer no computador / painéis)

> Itens que o Claude **não consegue fazer sozinho** (ação em painel, assinatura de plano,
> variável de ambiente). Cada um traz o **porquê**, o **passo a passo** e **o que o Claude
> faz depois** que você concluir. Quando estiver no computador, é só ir por aqui.
>
> _Última atualização: 02/08/2026._

---

## 🟢 Fazer agora — grátis e rápido

### -3. 🔴 CLOUDFLARE R2 — ligar o 2º servidor (backup fora da região) — ~15 min, **custo R$ 0**

- **Por quê (o que está em risco HOJE):** o Supabase Pro faz backup do **banco** (7 dias) —
  mas na **mesma região** (`sa-east-1`, São Paulo) — e **não faz backup nenhum do Storage**.
  Ou seja: os **documentos que o próprio cliente enviou** (matrícula, KYC, contrato assinado,
  comprovantes) não têm cópia em lugar nenhum. Se essa região tiver um incidente sério, esses
  arquivos não voltam. O código do espelhamento (`/api/backup-r2-cron`) **já está pronto e
  rodando todo dia às 04:40** — mas está **DORMENTE**, porque faltam as chaves. É só isto:
  criar o bucket e colar 5 variáveis.
- **Quanto vai custar:** o backup copia só o que é **irrecuperável** — hoje **45 arquivos,
  15 MB** (as ~14 GB de matrícula/edital raspados dos leiloeiros ficam de fora de propósito:
  a captura recria tudo). O nível gratuito do R2 dá **10 GB**. Ou seja: **R$ 0**, com muita
  folga, e sem taxa de saída (o R2 não cobra egress).

**Passo 1 — criar a conta e o bucket (Cloudflare)**
1. Entre em `dash.cloudflare.com` (cria conta grátis se não tiver) → menu lateral **R2**.
2. Se pedir cartão para habilitar o R2, é só cadastro — o consumo fica dentro do gratuito.
3. **Create bucket**:
   - **Bucket name:** `bidpro-backup` (se usar outro nome, é esse que vai na variável `R2_BUCKET`).
   - **Location / Location hint:** **⚠️ o ponto mais importante desta tarefa.** Escolha uma
     região **FORA da América do Sul** — se a cópia ficar na mesma região do banco, ela cai
     junto no dia do incidente e o backup não serviu para nada. Recomendo
     **`Eastern North America (enam)`** (é a mais próxima do Brasil entre as opções válidas).
     Alternativa: `Western Europe (weur)`.
   - Criar.

**Passo 2 — gerar as chaves de acesso**
1. Ainda em **R2** → **Manage R2 API Tokens** (canto direito) → **Create API token**.
2. **Permissions:** `Object Read & Write` (NÃO precisa Admin).
3. **Specify bucket:** aponte só para `bidpro-backup` (princípio do menor privilégio — se essa
   chave vazar, ela não alcança mais nada da conta).
4. Criar e **copiar agora** (o segredo só aparece uma vez):
   - **Access Key ID**
   - **Secret Access Key**
5. **Account ID:** está na página inicial do R2, na barra lateral direita (é também o código
   que aparece na URL do painel). Copie também.

**Passo 3 — colar as 5 variáveis na Vercel**
Painel Vercel → projeto **tsn-app** → **Settings → Environment Variables → Add New**.
Para **cada** uma, marque **Production + Preview + Development**:

| Variável | O que colar |
|---|---|
| `R2_ACCOUNT_ID` | o Account ID do passo 2.5 |
| `R2_ACCESS_KEY_ID` | o Access Key ID |
| `R2_SECRET_ACCESS_KEY` | o Secret Access Key |
| `R2_BUCKET` | `bidpro-backup` (ou o nome que você deu) |
| `R2_LOCATION` | **`enam`** (ou `weur` — exatamente a região que você escolheu no passo 1) |

> ⚠️ `R2_LOCATION` é o que o check-up de saúde lê para confirmar que a cópia está longe do
> banco. Ele **não muda** onde o bucket está — só **declara**. Se você criar em `enam` e
> escrever `weur`, o painel vai dizer que está tudo certo quando não está. Tem que bater com
> a região real.

**Passo 4 — publicar**
Abra no navegador o link de deploy que já está no `CLAUDE.md`:
`https://api.vercel.com/v1/integrations/deploy/prj_E0tUYhPJN9IteuNI8spS0CEgZuxo/saLCcQwzMK`
(variável de ambiente nova só passa a valer depois de um novo deploy).

**Passo 5 — conferir (no dia seguinte)**
No painel Admin → **Check-up de saúde**, o item **“Infra — backup off-region (2º servidor)”**
deve sair de 🔴 **erro** para 🟢 **ok**, mostrando algo como
`Último: há 3h · 45/45 arquivo(s) novos · 7 tabela(s) · destino r2:<conta>/bidpro-backup (enam)`.
Se aparecer 🟡 avisando *“região não declarada ou na América do Sul”*, o `R2_LOCATION` está
vazio ou com valor sul-americano — reveja o passo 3.

- **O que o Claude faz depois:** confirmo pelos logs e pelo `backup_execucoes` que a primeira
  cópia subiu inteira, e a partir daí o check-up cobra sozinho todo dia (sem backup há 48h,
  falha de cópia ou região errada viram **erro** no painel).
- **Uma coisa para você decidir com consciência:** esse backup leva documentos pessoais de
  clientes (KYC, contratos) para fora do país. A LGPD permite transferência internacional com
  salvaguardas contratuais — a Cloudflare disponibiliza DPA/cláusulas-padrão na própria conta.
  Se preferir manter tudo em território nacional, o preço é abrir mão da proteção contra uma
  falha regional; dá para conversar sobre um meio-termo (ex.: outro provedor com região no
  Brasil, aceitando o risco correlacionado). **Me avisa se quiser mudar essa escolha.**

### -2. 🟠 RESEND — reativar o webhook com a URL "www" (2 min; rastreio de entrega/abertura parado)
- **Por quê:** o Resend DESATIVOU o webhook (e-mail de 01/08) porque a URL cadastrada usa o
  APEX `bidprobrasil.com.br`, que responde **308 → www** (confirmado ao vivo) — o Resend não
  segue redirect, então TODO evento falhou. Efeito: os ENVIOS continuam normais (33 desde
  27/07 saíram), mas o 360 nunca recebe "entregue/aberto/clicado" (`emails_log.entregue_em`
  está vazio na base inteira — o webhook nunca chegou a funcionar).
- **Passos:** painel Resend → Webhooks → editar a URL para
  `https://www.bidprobrasil.com.br/api/resend-webhook?k=<o MESMO ?k= que já está lá>`
  (só acrescentar o `www.`) → salvar → **Re-enable**. O endpoint no www já responde 200 ✓.
- **Depois:** o Claude confere `emails_log.entregue_em/aberto_em` preenchendo nos e-mails
  seguintes (o de oportunidades de sábado ~8h é um bom teste).

### -1. 🔴 VERIFICAÇÃO DO ANUNCIANTE Google Ads (prazo: 31/08/2026 — anúncios PAUSAM se não fizer)
- **Por quê:** e-mail oficial do Google (01/08) — a conta **475-979-5747** exige a "verificação
  do anunciante" (identidade do responsável/empresa; exigência padrão do Google, não é golpe).
  Sem concluir até **31/08**, a campanha "Pesquisa — Leilão de Imóveis (BR)" é pausada. O
  processo pode levar **até 7 dias úteis** — não deixar para a última semana.
- **Passos:** Google Ads → Faturamento/Central "Verificação do anunciante" (ou o botão
  "Iniciar a verificação" do próprio e-mail, conferindo que o link leva a ads.google.com) →
  enviar os dados/documentos da empresa (CNPJ) ou pessoais.
- **Depois:** nada muda no código; o rastreamento segue igual. Se pausar por atraso, o funil
  pago para de gerar cadastros (o 1º lead real chegou dia 01/08 — vale proteger).

### 0. ⭐ TESTAR a compra AVULSA da loja (ebook/curso) — no computador
- **Por quê:** o checkout avulso (Mercado Pago + Asaas) foi para produção nesta sessão; falta um teste real de ponta a ponta (o dono pediu para testar mais tarde).
- **Passos:**
  1. Use uma conta **SEM acesso** (explorador — não admin nem assinante; senão o fluxo devolve "você já tem acesso" e **não cobra**).
  2. *(Opcional p/ gastar pouco)* baixe o preço do ebook de teste para ~R$ 1 na aba **Configurações**.
  3. Em **Membros** abra o ebook → **"Comprar por R$X"** (ou a página `/#/p/ebook/:id`) → pague no MP/Asaas.
  4. Confira que a tela **libera sozinha** e aparece **"Ler eBook"**.
- **Pré-req:** webhook do Asaas/MP apontando p/ `/api/asaas-webhook` e `/api/mp-webhook` (os mesmos das assinaturas).
- **Depois que fizer:** me avisa o resultado (ou cole `select status,gateway,pago_em from compras_produtos order by criado_em desc limit 1;`) que eu confirmo pelos logs/banco e ajusto se precisar. Se comprou por link `?ref=CÓDIGO`, a comissão do parceiro aparece em `saldo_lancamentos` (origem_tipo `produto`).

### 1. Asaas — terminar o webhook (gateway de backup do Mercado Pago)
- **Por quê:** a fila do Asaas está pausada; o token já está na Vercel, falta o lado do painel.
- **Passos (painel Asaas → Configurações → Integrações → Webhooks):**
  - URL: `https://www.bidprobrasil.com.br/api/asaas-webhook` (com `www`)
  - Token de autenticação: **o mesmo** valor do `ASAAS_WEBHOOK_TOKEN` da Vercel
  - Eventos: pagamento (`PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`, `PAYMENT_REFUNDED`) + chargeback
  - Salvar e clicar em **Reativar fila**
- **Depois que fizer:** me avisa que eu **disparo a reconciliação do Asaas** e confirmo pelos logs/banco que está processando.

### 2. Upstash Redis — rate-limit global (grátis pra começar)
- **Por quê:** sem ele, o limite de requisições não vale entre instâncias na escala. O código já lê as variáveis sozinho (`UPSTASH_REDIS_REST_URL`/`TOKEN` ou `KV_REST_API_URL`/`TOKEN`).
- **Passos (painel Vercel → projeto tsn-app):**
  - Storage (ou Integrations → Marketplace) → **Create Database → Upstash → Redis**
  - Região São Paulo (`sa-east-1`), plano **Free** (10 mil comandos/dia)
  - **Connect to Project → tsn-app** (Production + Preview) → **Redeploy**
- **Depois que fizer:** me avisa que eu **verifico pelos logs** se o L2 ligou de verdade.

### 3. PECINI — validar a captura de documentos (1 rodada, grátis)
- **Por quê:** o scraper do PECINI **já foi ensinado** a extrair os PDFs da página (matrícula/edital/laudo → `link_matricula`/`link_edital`/`anexos`), mas a página é **Cloudflare-gated** e só abre pelo Bright Data (token é segredo do GitHub) — **não dá para validar automaticamente daqui**. É a única fonte ainda com 0% de matrícula.
- **Passos (GitHub → Actions → workflow do PECINI):**
  - Rodar 1x com `PECINI_DRYRUN=1` (não grava) e conferir no log se os links `.pdf` vêm corretos (padrão `/arquivos/Leiloes/Docs/…`).
  - Se estiver certo, rodar com `PECINI_DRYRUN=0` para gravar.
- **Depois que fizer:** me avisa que eu **confirmo pelo banco** a cobertura de matrícula/edital e marco o PECINI como `docs_status='ok'` (sai do alerta semanal de cobertura). Se algum PDF cair no Cloudflare no download, aí sim aciono o Bright Data como suporte.

---

## 🟡 Fazer quando os usuários PAGOS crescerem — exigem assinar plano

### 3. Resend — sair do plano gratuito
- **Por quê:** o gratuito envia só **100 e-mails/dia**. O cron de alertas já processa em lotes encadeados (não perde ninguém), mas o teto de envio é do Resend.
- **Passo:** assinar um plano Resend que cubra o volume de e-mails/dia esperado.
- **Depois que fizer:** eu **ligo a API de lote** do Resend (`/emails/batch`, 100 msgs/chamada) — corte grande no tempo de envio.

### 4. Supabase — upgrade de compute
- **Por quê:** no gratuito, o banco satura na carga combinada de busca (contagem + raio + RLS) quando os usuários entram nas centenas/milhares.
- **Passo:** subir o tamanho do compute (e considerar read replica para a busca) antes do lançamento em massa.
- **Depois que fizer:** eu faço o **pente-fino de índices/consultas** (dedup de índices, composites, `count: estimated`) alinhado ao novo compute.

### 5. Supabase — proteção de senha vazada (HaveIBeenPwned)
- **Por quê:** bloqueia cadastro/login com senhas já vazadas. Recurso do plano pago do Supabase Auth.
- **Passo:** painel Supabase → Authentication → Policies/Settings → ativar **Leaked password protection** (toggle de 1 clique).
- **Depois que fizer:** nada no código — o auditor de segurança já considera isso na postura.

---

## ✔️ Já resolvidos (não precisa mais)
- **VAPID (push):** 3 variáveis na Vercel — **confirmado por você.**
