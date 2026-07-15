# ✅ Pendências que dependem do DONO (fazer no computador / painéis)

> Itens que o Claude **não consegue fazer sozinho** (ação em painel, assinatura de plano,
> variável de ambiente). Cada um traz o **porquê**, o **passo a passo** e **o que o Claude
> faz depois** que você concluir. Quando estiver no computador, é só ir por aqui.
>
> _Última atualização: 15/07/2026._

---

## 🟢 Fazer agora — grátis e rápido

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
