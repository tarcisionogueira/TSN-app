# Integração Homio → BidPro (lançamento de 26/11)

Quem se inscreve na página de lançamento feita na Homio ganha uma **conta Explorador** (plano grátis)
na BidPro, criada na hora. Construída em 11/11. Pendências: #471 (configurar), #472 (teste ponta a
ponta), #473 (cota de e-mail no pico).

## Como funciona

1. A pessoa preenche o formulário na página da Homio (nome, e-mail, WhatsApp).
2. Uma automação da Homio chama `POST https://www.bidprobrasil.com.br/api/homio-lead?campanha=lancamento`
   com o cabeçalho `x-homio-secret`.
3. A BidPro cria a conta **trancada**: Explorador, senha aleatória, sem aceite dos termos.
   - E-mail que **já tem conta** não é tocado (nem senha, nem plano): só fica registrado como `ja_tinha_conta`.
   - A mesma inscrição repetida não cria nada de novo.
4. A pessoa recebe o e-mail **"Ative sua conta na BidPro Brasil"** (formato carta). O link
   (`/api/ativar-conta?t=...`) vale 30 dias e leva à tela de criar senha.
   - Abrir o link mandado ao e-mail é a prova de posse do endereço (regra de #251): sem ela,
     qualquer um poderia criar conta com o e-mail de outra pessoa.
5. No primeiro acesso, o popup de cadastro incompleto pede cidade/UF e o **aceite dos termos**.
6. Quando a pessoa define a senha, o cron (a cada 10 min) marca a conta como **ativada** e avisa a Homio.

## Configurar (dono)

### 1. Segredo na Vercel
Crie `HOMIO_WEBHOOK_SECRET` (Production + Preview + Development) com um texto longo e aleatório
(32+ caracteres) e faça Redeploy. Sem ele, a rota recusa tudo (503). **Nunca escreva o valor no
repositório** — ele é público. Trocar o segredo invalida os links de ativação já enviados.

### 2. Automação na Homio: formulário → BidPro
- Gatilho: **formulário enviado** (o formulário da página do lançamento).
- Ação: **webhook personalizado** (custom webhook), método **POST**, URL:
  `https://www.bidprobrasil.com.br/api/homio-lead?campanha=lancamento`
  (sempre com **www**: o domínio sem www redireciona e o aviso pode se perder).
- Cabeçalho: `x-homio-secret` = o mesmo valor do passo 1.
- Corpo: o contato. A rota aceita os nomes comuns — `email`, `name`/`full_name`/`first_name`+`last_name`
  (ou `nome`), `phone` (ou `telefone`/`whatsapp`), `contact_id`, e utm soltas ou em `attributionSource`.
  Só o **e-mail** é obrigatório; nome e telefone que não passarem na régua do cadastro o popup pede depois.
- O formulário da página precisa de uma caixa de consentimento dizendo que a inscrição cria uma conta
  grátis na BidPro Brasil (LGPD).

### 3. (Opcional) Homio recebe os avisos da BidPro
Crie na Homio uma automação com gatilho **webhook de entrada** (inbound webhook), copie a URL e grave
em `HOMIO_WEBHOOK_URL` na Vercel. A BidPro manda um POST JSON com `evento`:

| evento | quando | campos extras |
|---|---|---|
| `conta_criada` | conta nova criada | `link_ativacao` (a Homio pode mandar por e-mail/WhatsApp) |
| `ja_tinha_conta` | e-mail já era cliente | — |
| `conta_ativada` | a pessoa definiu a senha | — |

Todos levam `email`, `nome`, `telefone`, `contact_id` (o da Homio), `campanha` e `em`.
Uso sugerido: lembrete "ative sua conta" para quem não ativou em 24 h; parar o lembrete em `conta_ativada`.
Falha de entrega volta sozinha pelo cron (até 10 tentativas).

> O `link_ativacao` abre a conta de quem o tiver. Ele só vai para a Homio (ferramenta do dono) e para o
> e-mail da pessoa — nunca na resposta da rota.

## Atenção: cota de e-mail no pico (#473)

O plano grátis do Resend dá 100 e-mails/dia, 80 para o sistema. Acima disso o e-mail de ativação vai
para a fila e sai **no dia seguinte**. Num lançamento, isso trava quem se inscreveu à noite.
Saídas: plano pago do Resend no período, ou a Homio mandar o `link_ativacao` (passo 3).

## Onde ver

- Banco: `select * from homio_leads order by recebido_em desc;`
  e o resumo `select public.homio_leads_resumo(72);`
- Health-check (2×/dia): item **"Lançamento — inscritos da Homio"** — erro se houver inscrição com
  erro ou sem e-mail de ativação há mais de 1 h; aviso se houver aviso à Homio pendente.

## Arquivos

| Arquivo | Papel |
|---|---|
| `api/homio-lead.js` | recebe a inscrição, cria a conta, manda a ativação, avisa a Homio |
| `api/ativar-conta.js` | link do e-mail → link de recuperação do Supabase → `/redefinir-senha` |
| `api/homio-reenvio-cron.js` | marca ativadas, reenvia avisos e e-mails que falharam |
| `api/_homio.js` | regras puras (leitura do corpo, segredo, token) — testes em `scripts/testes/homio-lead.mjs` |
| `api/_homio-io.js` | banco, e-mail e aviso à Homio |
| `supabase/migrations/20261111_homio_leads.sql`, `20261111b_homio_leads_funcoes.sql` | tabela e funções |
