# Loop jurídico por e-mail (advogado)

O advogado **nunca entra no sistema** — recebe e responde tudo por e-mail.
Para o analista/admin, aparece no **Atendimento** (chat interno).

## Fluxo

1. **Analista** (na/após a 1ª reunião) clica em **"Encaminhar ao Jurídico"** na tela do Caso.
   → `POST /api/enviar-juridico-email` envia ao advogado:
   - **todos os anexos** do imóvel (matrícula, edital, etc.);
   - o **relatório de avaliação documental** (`analise_relatorios` tipo `juridica_preliminar`) — **sem** mercadológico/financeiro;
   - pedido de análise "com brevidade para confirmação de viabilidade";
   - `reply_to` único por caso: `juridico+<token>@INBOUND_EMAIL_DOMAIN`.
   → caso vai para `juridico_solicitado`; cria/abre o chamado interno (`segmento='interno'`, `caso_id`).
2. **Advogado responde o próprio e-mail** (mantém o thread).
3. `POST /api/inbound-juridico` (webhook `email.received` do Resend):
   - casa ao caso pelo `juridico+<token>` (fallback `In-Reply-To`/`References`);
   - remove o texto citado, salva anexos do advogado em `imovel_anexos` (`parecer_juridico`);
   - **compila com a IA**: estrutura o parecer (`analise_juridica`: resultado/risco/ressalvas/relatório) e registra **divergências** vs. a avaliação documental em `juridico_aprendizado` (aprendizado);
   - caso vai para `juridico_concluido`;
   - publica a devolutiva no **chat interno** (visível a analista/admin).

## Configuração necessária (no Resend + Vercel) — AÇÃO DO ADMIN

1. **Domínio de recebimento** no Resend (Domains → Receiving): configurar os **registros MX** no DNS conforme o painel.
2. **Webhook** no Resend: evento **`email.received`** apontando para
   `https://bidprobrasil.com.br/api/inbound-juridico`. Copiar o **signing secret**.
3. **Variáveis de ambiente** (Vercel → Production + Preview):
   - `INBOUND_EMAIL_DOMAIN` = o domínio de recebimento (ex.: `bidprobrasil.com.br (raiz — recebimento no domínio existente, sem custo de domínio novo)`)
   - `INBOUND_WEBHOOK_SECRET` = o `whsec_...` do webhook
   - (já existentes) `RESEND_API_KEY`, `VITE_SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `CLAUDE_KEY`
4. Garantir que o **domínio de envio** (`bidprobrasil.com.br`) está verificado para envio (já está).

> Enquanto o domínio de recebimento não estiver ativo, a **Fase 1 (envio)** já funciona;
> a ingestão da resposta (Fases 2/3) só passa a operar após os passos 1–3.

## Tabelas/colunas

- `casos.juridico_token`, `casos.juridico_email_id` — rastreio do thread.
- `juridico_emails` — auditoria (saída/entrada).
- `juridico_aprendizado` — divergências IA × advogado (base para lapidar a análise).
- `chamados.segmento='interno'` + `chamados.caso_id` — chat interno do caso.

## RLS / isolamento

- `chamados`/`chamados_mensagens`: policies por `app_role()` e segmento.
  - admin: tudo · analista: clientes + `interno` · consultor: não-clientes · advogado: nada (usa e-mail).
- `juridico_emails` e `juridico_aprendizado`: RLS ligada, sem policies (somente service key).

---

# Captura automática da matrícula CEF

Imóveis da Caixa têm a matrícula atrás da sessão do site (`matricula.asp`), que
não abre como link direto. Em vez de upload manual:

1. Ao **pedir análise** de um imóvel CEF sem documento anexado, o
   `processar-analise` **enfileira** a captura em `cef_matricula_fila` (status 202).
2. O GitHub Actions **`matricula-cef.yml`** (a cada 10 min, ou rodando manualmente
   em Actions → Run workflow) executa `scripts/captura-matricula-cef.mjs`:
   abre o imóvel no site da Caixa via Puppeteer (mesma sessão das fotos), captura
   a matrícula em **PDF**, sobe no Storage (`documentos`) e registra em
   `imovel_anexos` (tipo `matricula`).
3. Gerar a análise de novo → a IA processa o PDF automaticamente.

- Secrets do workflow: `VITE_SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (já existem,
  iguais aos do `fotos-cef.yml`).
- CPF: o script gera um CPF válido descartável apenas se o site exigir o
  formulário (o acesso direto ao detalhe normalmente dispensa).
- ⚠️ Validar com um run real no Actions e ajustar o seletor/cookies se a Caixa
  mudar o fluxo.
