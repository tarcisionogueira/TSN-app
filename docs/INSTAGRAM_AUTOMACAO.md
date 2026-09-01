# Automação de comunicação — Instagram `@tarcisionogueiraleiloes`

> Especificação levantada em **30/08/2026** para a sessão seguinte começar sem descoberta.
> Decisões do dono já fechadas estão marcadas ✅.
>
> ## 🟢 ATUALIZAÇÃO 01/09 — o passo 1 SUBIU. O que já existe, medido:
>
> | Peça | Estado |
> |---|---|
> | `ig_conversas` · `ig_mensagens` · `ig_oferta_vigente` | **criadas e aplicadas** (RLS ligada, 0 políticas, escrita revogada de anon/authenticated) |
> | `ig_webhook_recebido` | **nova, não estava na spec** — ver §6.4 abaixo |
> | `api/instagram-webhook.js` (GET challenge + POST com HMAC, grava e sai) | **no ar, dormente** por falta de `IG_APP_SECRET` |
> | `public.ig_limpar_antigas()` + chamada no `limpar-eventos-cron` | **retenção LGPD virou mecanismo** (180 dias de mensagem, 30 de log) |
> | `npm run testar:instagram` | **28/28** — echo, story, colisão de id e assinatura |
> | `IG_USER_ID` de `tarcisionogueiraleiloes` | **`17841400563334157`** (item 1 do §2 está feito: já é conta profissional) |
>
> **O que falta é seu, no painel da Meta, e é o caminho longo (§2):** criar o app, a
> **Verificação de Negócio** (que é a pendência #9 do HANDOFF, aberta desde 26/08) e o App
> Review. Nada de código destrava isso.
>
> ### 📐 O CAMINHO COMPLETO ESTÁ PUBLICADO
> **https://claude.ai/code/artifact/50654eca-3504-4c1c-b03e-8025dab1d3b7** — as três janelas da
> Meta, a escada alugado→próprio, as 5 fases com portão de saída medível, como a IA aprende com
> as respostas do dono, e as regras que protegem a conta.
>
> **Medido em 01/09, e fecha a pendência #3 do HANDOFF (aberta desde 26/08):**
> `@tarcisionogueiraleiloes` **9.730 seguidores · 632 posts** · `@bidprobrasil` **2.938 · 53**.
>
> ⚠️ **A leitura de COMENTÁRIOS está bloqueada por permissão** no conector Windsor
> (*"Application does not have permission for this action. Reconnect it as an Instagram
> Professional account"*). Isso importa mais do que parece: DM antiga **não é exportável**, mas
> comentário **é** — reconectar a conta pode devolver um corpus histórico de 632 posts de
> respostas escritas pelo próprio dono. É a diferença entre partir do zero e partir de centenas
> de exemplos.
>
> ⚠️ **Private Reply é a ÚNICA forma sancionada de mandar a primeira DM** para quem não
> escreveu: **7 dias a contar do comentário** (não de quando o webhook viu) e **UMA por
> comentário, para sempre**. Um "te chamei no direct" queima o tiro único — a private reply tem
> que carregar a resposta E o pedido.

> ### ⚠️ DUAS CORREÇÕES DE FATO NESTA SPEC (conferidas na documentação, não de memória)
>
> **(a) O §2 conhece só UM dos dois caminhos.** A lista de permissões dele
> (`instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments`,
> `pages_show_list`, `pages_manage_metadata`) é do **Instagram API com Facebook Login**, que
> exige a Página do Facebook vinculada. Existe o **Instagram API com Instagram Login**
> (*Business Login*), cujas permissões são `instagram_business_basic`,
> `instagram_business_manage_messages` e `instagram_business_manage_comments` — e que
> **dispensa a Página**. Os nomes antigos sem o `business_` foram descontinuados nesse
> caminho. **Decidir qual antes de criar o app**: a escolha muda as permissões pedidas, e
> pedir do conjunto errado reprova a submissão inteira.
>
> **(b) A tag de agente humano é para HUMANO, não para o bot.** O §7.1 pergunta o prazo: são
> **7 dias** — mas a Meta a restringe a mensagem **enviada por pessoa**, audita o uso e pode
> revogar. Automação dentro desses 7 dias é uso indevido. Ou seja: **o bot vive dentro das
> 24 h; os 7 dias são para o dono assumir na mão.** Isso reforça o §7.1 em vez de afrouxá-lo —
> todo fluxo automático precisa caber em 24 h ou migrar de canal.

---

## 1. ESCOPO — é da CONTA, não da campanha ✅

Correção do dono em 30/08, e ela muda o desenho: **a automação responde a qualquer interação com
a conta**, venha de post orgânico ou impulsionado. Impulsionar um post existente não cria um
canal novo — só aumenta o volume que chega no mesmo lugar.

Consequência prática: **não há acoplamento com campanha.** O bot não precisa saber por qual
anúncio a pessoa veio; precisa saber **qual é a oferta vigente** (ver §6.3).

| Decisão | Valor |
|---|---|
| Conta | **`@tarcisionogueiraleiloes`** (tem o público de leilão) |
| Canais v1 | **DM · comentário · resposta/reação de story** |
| Persona | **responde como o próprio dono**, aprendendo com as respostas dele |
| Destino | **link da bio**, orientado pela oferta vigente |
| Humano assume | **depois do lead preenchido** em live/evento |

---

## 2. ⏱️ CAMINHO CRÍTICO — é burocrático, e começa ANTES do código

Nada disso depende de programação, e **leva dias a semanas**. Se a sessão começar pelo código, o
código fica pronto e parado.

1. **Instagram Profissional** vinculado a uma **Página do Facebook**.
   (As duas contas já aparecem no conector `instagram` do Windsor — provavelmente já são
   profissionais. **Confirmar** e anotar o `IG_USER_ID` da `tarcisionogueiraleiloes`.)
2. **App** em `developers.facebook.com` com o produto de mensagens do Instagram.
3. **Verificação de Negócio** (CNPJ + documentos) — pré-requisito da revisão.
4. **Revisão do App** pedindo Acesso Avançado. Permissões previstas:
   `instagram_basic` · `instagram_manage_messages` · `instagram_manage_comments` ·
   `pages_show_list` · `pages_manage_metadata` · `business_management`.
5. ⚠️ **A Meta pede VÍDEO do fluxo funcionando.** Ou seja: é preciso um protótipo rodando em
   **Acesso de Desenvolvimento** (que já funciona para contas de teste e para admins do app)
   **antes** de submeter. A ordem é: build → grava vídeo → submete → espera.

---

## 3. 🔑 SUBIR O WEBHOOK EM MODO SÓ-ESCUTA O QUANTO ANTES

O motivo é específico e muda a ordem do projeto: **`message_echoes` entrega as mensagens
enviadas PELA conta — inclusive as que o dono digita à mão no app.** É o corpus do jeito dele de
responder, capturado sozinho.

**Mas o histórico de DM NÃO é exportável em massa pela API.** Só se aprende do dia 1 em diante.
Então o webhook deve subir cedo, mesmo sem poder responder ainda, para o corpus encher enquanto
a burocracia corre. Nas primeiras semanas o bot depende de instrução escrita, não de exemplo.

---

## 4. VARIÁVEIS DE AMBIENTE (nomes — ⚠️ o repositório é PÚBLICO, nunca o valor)

| Nome | Para quê |
|---|---|
| `IG_APP_SECRET` | validar `X-Hub-Signature-256` de cada evento |
| `IG_VERIFY_TOKEN` | responder o `hub.challenge` na verificação do webhook |
| `IG_PAGE_TOKEN` | token long-lived da Página, para ENVIAR |
| `IG_USER_ID` | id da conta Instagram profissional |
| `IG_BOT_ATIVO` | `1`/`0` — mata a resposta automática sem deploy (padrão dormente do projeto) |

---

## 5. CÓDIGO A CONSTRUIR — e o que já existe

| Peça | Estado |
|---|---|
| `api/instagram-webhook.js` — `GET` (challenge) + `POST` (eventos) | **novo** |
| Validação HMAC `X-Hub-Signature-256` | **`api/_webhook-core.js` já faz HMAC** (Asaas) — mesmo padrão |
| Idempotência por `mid` (a Meta reentrega) | **`eventoJaProcessado()` já existe** no `_webhook-core` |
| `api/_instagram-envio.js` — Send API | **novo** |
| `api/instagram-responder-cron.js` — processa a fila | **novo** (mesmo desenho do motor de análise: claim atômico + prova) |
| Motor de resposta (IA) | **`_claude.js` pronto.** Usar **Haiku**: DM é curta e o volume é alto |
| Painel para o dono ler/assumir | **`chamados` + `chamados_mensagens` já existem** — avaliar reuso |

⚠️ **Responder DENTRO do webhook é erro.** A Meta exige `200` rápido e reentrega se demorar —
resposta de IA leva segundos. O webhook **grava e sai**; quem responde é o cron. É a mesma
separação que o motor de análise usa, e pelo mesmo motivo.

---

## 6. TABELAS

### 6.1 `ig_conversas` — uma por pessoa
`ig_user_id` (PK) · `username` · `primeiro_contato_em` · `ultima_msg_deles_em` (governa a
janela de 24 h) · `estado` (`bot` / `humano` / `pausado`) · `lead_preenchido` (bool — vira
`humano` quando true) · `resumo` (memória curta da conversa)

### 6.2 `ig_mensagens` — o corpus e o histórico
`mid` (UNIQUE — idempotência) · `ig_user_id` · `direcao` (`recebida` / `enviada`) ·
`origem` (`dm` / `comentario` / `story`) · `autor` (`pessoa` / `bot` / `dono`) · `texto` ·
`respondida` · `criado_em`

⚠️ **`autor` separa `bot` de `dono` de propósito.** É o campo que permite treinar SÓ com o que o
dono escreveu — sem ele, o bot aprenderia com as próprias respostas e derivaria (o modelo
reforçando o próprio estilo, cada vez mais longe do original).

### 6.3 `ig_oferta_vigente` — o que o bot direciona hoje
`titulo` · `link` · `intencao` (o que se quer que a pessoa faça) · `inicio` · `fim` · `ativo`

**Tabela, não prompt fixo.** A oferta muda (aula de 02/09 hoje, outra coisa em outubro) e o
comportamento tem de mudar **sem deploy** — mesmo padrão dormente do Pixel e do
`SITEMAP_LOTES`.

---

## 7. RESTRIÇÕES QUE DESENHAM O PRODUTO

1. **Janela de 24 h.** Só se responde até 24 h após a última mensagem DA PESSOA. Fora disso, só
   com tag de agente humano (⚠️ **verificar** o prazo estendido atual na doc). Todo fluxo de
   nutrição precisa **caber em 24 h ou migrar de canal** — e é exatamente aí que ele encosta no
   cadastro do BidPro, que é onde o e-mail passa a existir.
2. **Três canais, três permissões, possivelmente três prazos de revisão.** DM, comentário e
   story podem ser aprovados em momentos diferentes → o v1 pode entrar em partes.
3. **LGPD.** Conteúdo de DM é dado pessoal de terceiro. Definir **retenção e finalidade antes de
   gravar** — a mesma régua que barrou o uso das listas de WhatsApp em 30/08.
4. **Rate limits** da Graph API por conta/hora.

---

## 8. ⚠️ VERIFICAR NA DOCUMENTAÇÃO — não afirmar de memória

- Nomes exatos dos campos de webhook (`messages`, `message_echoes`, `message_reactions`,
  `comments`, `mentions`) e da versão atual da Graph API.
- Se **reação de story** (o emoji rápido) chega como evento. *Resposta* de story chega;
  **reação eu não confirmo.**
- Política da Meta sobre **sinalizar que a resposta é automática** quando a persona é o próprio
  dono. ManyChat e concorrentes operam sem sinalizar, mas isso não é prova da regra vigente.
- Prazo da tag de agente humano.

---

## 9. ORDEM PROPOSTA

1. Pré-requisitos Meta (§2) — **primeiro, porque é o que demora**
2. Webhook em **só-escuta** (§3) + tabelas (§6) — corpus começa a encher
3. Protótipo de resposta em Acesso de Desenvolvimento → **grava o vídeo da revisão**
4. Submete a Revisão do App
5. Enquanto espera: motor de resposta, persona, `ig_oferta_vigente`, painel
6. Aprovado → liga `IG_BOT_ATIVO=1`

---

## 10. COMO SABER SE FUNCIONA

Sem isto, "o bot está respondendo" e "o bot está convertendo" viram a mesma frase.
- % de interações respondidas dentro de 24 h
- quantas conversas chegam ao link da bio — e quantas viram **cadastro** (`perfis.mkt_*` já
  registra origem desde 30/08, então dá para casar)
- quantas o dono precisou assumir na mão (se for alto, a persona ainda não está pronta)
- **invariante:** conversa com mensagem da pessoa sem resposta há mais de 24 h — o equivalente,
  aqui, do `job_analise_sem_motor`


---

## 6.4 `ig_webhook_recebido` — a PROVA de que a escuta escutou (acrescentada em 01/09)

Não estava na spec, e é a peça que faltava para o §10 poder responder qualquer coisa.

`recebido_em` · `campos[]` · `gravadas` · `nao_reconhecidos` · `bruto` (jsonb) · `erro`

**Por que existe:** um webhook que recebe um formato que não conhece, devolve 200 e não grava
nada fica **idêntico, por fora, a um webhook que ninguém está chamando**. Nos dois casos
`ig_mensagens` fica vazia e nada dá erro. Semanas depois, na hora de treinar, o corpus estaria
vazio e as duas causas seriam indistinguíveis — e a diferença entre elas é enorme (uma é
configuração no painel, a outra é parser). É a forma de falha nº 1 do `CLAUDE.md` aplicada à
escuta. `bruto` só é preenchido quando `nao_reconhecidos > 0`: guardar sempre seria estocar DM
em dobro, sem finalidade — e finalidade é o que a LGPD cobra.

**A consulta que responde "a escuta está viva?":**
```sql
select max(recebido_em) as ultima_entrega, sum(gravadas) as mensagens,
       sum(nao_reconhecidos) as nao_entendidas
  from ig_webhook_recebido where recebido_em > now() - interval '7 days';
-- nenhuma linha  = ninguém está chamando (painel da Meta não configurado)
-- linhas com gravadas=0 e nao_entendidas>0 = está chamando e o parser não entende: leia `bruto`
```

## 7.5 O que a v1 DELIBERADAMENTE não guarda

`read`, `delivery` e `reaction` chegam pelo mesmo `messaging[]` e são descartados sem contar
como "não reconhecidos" — são eventos que esta versão escolhe não guardar, não formatos que
ela não entendeu. Misturar as duas categorias faria o alarme do §6.4 disparar todo dia por
funcionamento normal, e alarme que sempre toca é alarme desligado.

**Mensagem só com anexo (foto, áudio) É gravada**, com `texto` nulo: ela não serve de corpus,
mas é contato — move a janela de 24 h. Descartá-la faria o bot concluir que a pessoa nunca falou.
