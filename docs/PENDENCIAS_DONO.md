# ✅ Pendências que dependem do DONO (fazer no computador / painéis)

> Itens que o Claude **não consegue fazer sozinho** (ação em painel, assinatura de plano,
> variável de ambiente). Cada um traz o **porquê**, o **passo a passo** e **o que o Claude
> faz depois** que você concluir. Quando estiver no computador, é só ir por aqui.
>
> _Última atualização: 15/07/2026._

---

## 🟢 Fazer agora — grátis e rápido

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
