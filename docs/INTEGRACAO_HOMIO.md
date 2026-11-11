# Integração Homio → BidPro (lançamento de 26/11)

Quem se inscreve na página de lançamento feita na Homio ganha uma **conta Explorador** (plano grátis)
na BidPro, criada na hora. Construída em 11/11. Pendências: #471 (configurar), #472 (teste ponta a
ponta), #473 (cota de e-mail no pico).

## Dados obrigatórios do Explorador (régua do sistema)

**No webhook da Homio, só três campos são obrigatórios (decisão do dono, 11/11): nome, e-mail e
telefone.** Falta um deles → a rota responde 400 dizendo qual. O resto a pessoa completa no BidPro,
depois de clicar no e-mail de ativação.

| Dado | Obrigatório para a conta? | Regra | Onde é pedido |
|---|---|---|---|
| Nome completo | **sim** | nome **e** sobrenome, só letras, 5–80 caracteres, sem nome de empresa | **Homio** (obrigatório no webhook); se vier só o primeiro nome, o popup pede o completo |
| E-mail | **sim** | válido; é o login | **Homio** (obrigatório no webhook) |
| WhatsApp | **sim** | DDD + número (10 ou 11 dígitos); celular com 9 após o DDD; aceita "+55" | **Homio** (obrigatório no webhook); se vier fora da regra ou já usado em outra conta, o popup pede |
| Senha | **sim** | 8+ caracteres com maiúscula, minúscula, número e símbolo | BidPro, ao clicar no e-mail de ativação — nunca na Homio |
| Cidade + UF | **sim** | cidade e UF — filtram os imóveis da região e os alertas | BidPro, popup de cadastro (se a Homio mandar, já entra preenchido) |
| Aceite dos Termos e da Privacidade | **sim** | caixa marcada pela própria pessoa | BidPro, popup de cadastro |
| Questionário de perfil do investidor | não (pedido uma vez) | objetivo, faixa de valor, pagamento, experiência, cidades, veículos | BidPro, popup no 1º acesso |
| CPF | não | só na hora de pagar um plano ou sacar comissão | — |

**O que a pessoa vê depois de clicar em "Ativar minha conta":**
1. Tela de criar senha → "Conta ativada!" — ela **continua logada** (não volta ao login).
2. Página inicial com os popups em fila: **cadastro** (cidade/UF, aceite dos termos e o que faltar de
   nome/telefone) → vídeo de boas-vindas → **questionário de perfil do investidor**.

## Para o desenvolvedor da página (backend próprio na Vercel)

Se o cadastro da página já passa por um backend do desenvolvedor, ele chama o BidPro direto, **do
servidor** (nunca do navegador: o token ficaria exposto no código da página). Não é preciso a
automação da Homio nesse caso.

- **Método e URL:** `POST https://www.bidprobrasil.com.br/api/homio-lead?campanha=lancamento`
- **Cabeçalhos:** `Content-Type: application/json` e `x-homio-secret: <token>` — o token é o mesmo valor de
  `HOMIO_WEBHOOK_SECRET` da Vercel do BidPro, entregue ao desenvolvedor por canal privado (nunca por
  e-mail aberto, chat de grupo ou repositório). No backend dele, fica numa variável de ambiente.
- **Corpo:**
  ```json
  { "nome": "Maria da Silva", "email": "maria@exemplo.com", "telefone": "71998765432" }
  ```
  Opcionais: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `gclid`, `fbclid`,
  `cidade`, `uf`, `contact_id`.
- **Respostas:**

| HTTP | corpo | significado / o que fazer |
|---|---|---|
| 200 | `{"ok":true,"situacao":"conta_criada","email_ativacao":"enviado"}` | conta criada; e-mail de ativação saiu (`enfileirado` = sai amanhã por cota) |
| 200 | `{"ok":true,"situacao":"ja_tinha_conta"}` | e-mail já é cliente; nada mudou na conta |
| 200 | `{"ok":true,"repetido":true,...}` | mesma inscrição já processada; não repetir |
| 400 | `{"error":"...","faltando":["telefone"]}` | campo obrigatório ausente; corrigir e reenviar |
| 401 | `{"error":"Não autorizado"}` | token errado ou ausente |
| 429 / 502 / 503 | `{"error":"..."}` | falha temporária: tentar de novo em alguns segundos (até 3×) |

- **Tempo de resposta:** até ~10 s (cria a conta e manda o e-mail). Use timeout de 20 s e não segure a
  tela da pessoa esperando: registre a inscrição dele primeiro e chame o BidPro em seguida.
- **Teste:** com um e-mail que não tenha conta no BidPro, a resposta deve ser `conta_criada` e o e-mail
  "Ative sua conta na BidPro Brasil" deve chegar em até 1 minuto.

## Como funciona

1. A pessoa preenche o formulário na página da Homio.
2. A automação da Homio chama `POST https://www.bidprobrasil.com.br/api/homio-lead?campanha=lancamento`
   com o cabeçalho `x-homio-secret`.
3. A BidPro cria a conta **trancada**: Explorador, senha aleatória, sem aceite dos termos.
   - E-mail que **já tem conta** não é tocado (nem senha, nem plano): fica registrado como `ja_tinha_conta`.
   - A mesma inscrição repetida não cria nada de novo.
4. A pessoa recebe o e-mail **"Ative sua conta na BidPro Brasil"**. O link vale 30 dias e leva à tela de
   criar senha. Abrir o link mandado ao e-mail é a prova de que o e-mail é dela (regra de #251).
5. Depois de criar a senha ela segue logada para a página inicial, onde os popups pedem cidade/UF, o
   **aceite dos termos** e o que faltar, e depois o questionário de perfil do investidor.
6. Quando ela cria a senha, o cron (a cada 10 min) marca a conta como **ativada** e avisa a Homio.

## Passo a passo (dono)

### Passo 1 — Criar o segredo
1. Gere um texto aleatório de 40 caracteres (letras e números), por exemplo num gerador de senhas.
2. Guarde num lugar seguro (gerenciador de senhas). Ele vai em dois lugares: Vercel e Homio.
3. **Nunca** cole esse valor em arquivo do repositório nem em mensagem pública.

### Passo 2 — Cadastrar na Vercel
1. vercel.com → projeto **tsn-app** → **Settings → Environment Variables → Add New**.
2. Nome: `HOMIO_WEBHOOK_SECRET` · Valor: o texto do passo 1.
3. Marque **Production**, **Preview** e **Development** → **Save**.
4. **Deployments** → no deploy mais recente → **⋯ → Redeploy**. Sem redeploy a variável não vale.
5. Conferência: depois do redeploy, a rota deixa de responder "Integração não configurada" e passa a
   responder "Não autorizado" para quem chama sem o segredo (eu confiro isso por você).

### Passo 3 — Formulário da página na Homio
1. Campos obrigatórios: **Nome completo**, **E-mail** e **WhatsApp**. Só esses três. (Se um dia quiser
   pedir cidade e estado na página, a rota aproveita — estado como lista de siglas AC…TO.)
2. Caixa de consentimento obrigatória, com texto como: *"Ao me inscrever, recebo acesso gratuito à BidPro
   Brasil e concordo em receber comunicações sobre o lançamento."* (LGPD — o aceite dos Termos de Uso
   em si é feito na BidPro, no primeiro acesso.)
3. Página de obrigado: avise *"Enviamos para o seu e-mail o link para ativar a sua conta BidPro."*

### Passo 4 — Automação na Homio: formulário → BidPro
1. Homio → **Automações** → nova automação.
2. **Gatilho:** "Formulário enviado" → escolha o formulário do lançamento.
3. **Ação:** "Webhook personalizado" (custom webhook):
   - Método: **POST**
   - URL: `https://www.bidprobrasil.com.br/api/homio-lead?campanha=lancamento`
     (sempre com **www**; sem ele o aviso pode se perder no redirecionamento)
   - Cabeçalhos: `x-homio-secret` = o segredo do passo 1; `Content-Type` = `application/json`
   - Corpo (se a Homio pedir para montar à mão), usando as variáveis do contato:
     ```json
     {
       "email": "{{contact.email}}",
       "nome": "{{contact.name}}",
       "telefone": "{{contact.phone}}",
       "contact_id": "{{contact.id}}",
       "utm_source": "{{contact.attributionSource.utmSource}}",
       "utm_campaign": "{{contact.attributionSource.utmCampaign}}"
     }
     ```
     Os nomes das variáveis (`{{contact.…}}`) podem variar na Homio: escolha-as no seletor de campos dela.
     A rota também aceita o contato inteiro (sem montar corpo) e os nomes em inglês (`name`, `phone`,
     `city`, `state`, `first_name` + `last_name`).
4. Salve e **publique** a automação.

### Passo 5 — (Opcional, recomendado) Homio recebe os avisos da BidPro
1. Nova automação na Homio com gatilho **"Webhook de entrada"** (inbound webhook). Copie a URL que ela gera.
2. Vercel → `HOMIO_WEBHOOK_URL` = essa URL (mesmo processo do passo 2, com Redeploy).
3. A BidPro manda um POST com `evento`:

| evento | quando | campos extras |
|---|---|---|
| `conta_criada` | conta nova criada | `link_ativacao` (a Homio pode mandar por e-mail ou WhatsApp) |
| `ja_tinha_conta` | e-mail já era cliente | — |
| `conta_ativada` | a pessoa criou a senha | — |

   Todos levam `email`, `nome`, `telefone`, `contact_id` (o da Homio), `campanha` e `em`.
4. Uso sugerido na Homio: se em 24 h não chegar `conta_ativada`, mandar lembrete no WhatsApp
   *"Falta ativar sua conta: confira o e-mail"*; ao chegar `conta_ativada`, parar o lembrete e seguir a
   sequência do lançamento. Quem é `ja_tinha_conta` vai direto para a sequência.

> O `link_ativacao` abre a conta de quem o tiver. Ele só vai para a Homio (ferramenta do dono) e para o
> e-mail da pessoa — nunca na resposta da rota.

### Passo 6 — Teste ponta a ponta (dono + sessão)
1. Inscreva-se na página com um e-mail seu que **não** tenha conta na BidPro.
2. Em até 1 minuto deve chegar "Ative sua conta na BidPro Brasil".
3. Clique, crie a senha, marque o aceite no popup e entre.
4. A sessão confere no banco: `select situacao, email_ativacao_em, ativado_em, homio_avisado from homio_leads order by recebido_em desc limit 3;`
   — esperado `conta_criada`, e-mail enviado e, até 10 min depois, `ativado_em` preenchido.
5. Repita com um e-mail que **já** tem conta: deve virar `ja_tinha_conta` e nada mudar na conta.

### Passo 7 — Antes do dia 26: cota de e-mail (#473)
O plano grátis do Resend dá 100 e-mails/dia, 80 para o sistema. Acima disso o e-mail de ativação vai
para a fila e sai **no dia seguinte**. Para o lançamento: assinar o plano pago do Resend no período
(cancelável depois), ou usar o passo 5 para a Homio mandar o `link_ativacao`.

## Onde ver

- Banco: `select * from homio_leads order by recebido_em desc;` e `select public.homio_leads_resumo(72);`
- Health-check (2×/dia): item **"Lançamento — inscritos da Homio"** — erro se houver inscrição com erro
  ou sem e-mail de ativação há mais de 1 h; aviso se houver aviso à Homio pendente.

## Arquivos

| Arquivo | Papel |
|---|---|
| `api/homio-lead.js` | recebe a inscrição, cria a conta, manda a ativação, avisa a Homio |
| `api/ativar-conta.js` | link do e-mail → link de recuperação do Supabase → `/redefinir-senha` |
| `api/homio-reenvio-cron.js` | marca ativadas, reenvia avisos e e-mails que falharam |
| `api/_homio.js` | regras puras (leitura do corpo, segredo, token) — testes em `scripts/testes/homio-lead.mjs` |
| `api/_homio-io.js` | banco, e-mail e aviso à Homio |
| `supabase/migrations/20261111_homio_leads.sql`, `20261111b_homio_leads_funcoes.sql` | tabela e funções |
