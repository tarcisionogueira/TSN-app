# Varredura de bugs — 10/08/2026 (bug bounty do código, item 6 do ritual)

5 agentes em paralelo, por camada: pré-login · relatórios/cotas · arremate·uploads·checkout ·
endpoints de cliente · crons·e-mails·webhooks. **28 achados**, cada um com tentativa de
refutação antes de entrar na lista.

> **O fio condutor do dia, e ele é o mesmo do bug que o dono relatou nas proximidades:**
> *resposta de erro entregue como conteúdo válido.* Aparece em 6 achados distintos, em
> camadas que não se falam. Quando bater o olho em código novo, a pergunta de rotina é:
> **"este vazio é uma resposta ou é uma falha que não sabe que falhou?"**

---

## ✅ CORRIGIDO EM 10/08 (commit `408abb1`, além do `c2dfa24` das proximidades)

| # | achado | onde |
|---|---|---|
| 1 | Extrato tratava falha HTTP como fim das páginas e carimbava `completo: true` | `api/financeiro-extrato.js` |
| 2 | Cobrança da assessoria (R$ 4.800–6.000) sem gate e com preço vindo do body | `api/mp-checkout.js` |
| 3 | "Pagamento aprovado" + home vazia quando o contrato não sai | `src/pages/Checkout.jsx` |
| 4 | Lixeira de documentos apagava 0 linhas e a tela dizia que removeu | `src/pages/Arrematados.jsx` |
| 5 | Id local (`tsn_…`) em `arrematados.imovel_id` zerava a lista inteira | `Analise`/`Painel`/`Arrematados` |
| 6 | Plano escolhido sumia no link de confirmação do e-mail | `src/contexts/AuthContext.jsx` |

---

## 🔴 ABERTO — ALTA

### A1. Crédito comprado não desbloqueia a geração
`src/pages/Analise.jsx:167` (`analisesBloqueado`) · `src/utils/cotaAnalise.js:47`
Explorador que usou as 3 amostras vê "compre créditos", compra, e o card continua "🔒 Limite
atingido". **O servidor aceitaria** — `api/gerar-analise.js:1551-1563` chama `pode_debitar` e
segue com `cobrarCredito = true`. O bloqueio é só do cliente: `analisesBloqueado` não consulta
`credito_saldo`, e `lerCotaMercado` joga fora esse campo que `minhas_cotas` já devolve.
**Ele pagou e não consegue gastar.** Vale para top2 que estourou os 10/mês e recarregou.

### A2. "Corrigir e regerar a avaliação" não regera nem persiste
`src/pages/Analise.jsx:2924` → `:794` → `src/utils/claude.js:289`
O botão roda o caminho LEGADO do cliente e só faz `setMercado()` em estado local. Recarregou,
os números voltam. Pior: `analises_mercado` nunca é atualizado e o **laudo lê dessa tabela**
(`api/gerar-laudo-viabilidade.js:253`) — o parecer final segue decidindo sobre a cidade/área
que o documental já desmentiu. O resultado legado ainda é mais pobre que o salvo (sem
`metodologia`, `condicoesEdital`, `indiceBidPro`, `pracaReferencia`, `divergenciaArea`).

### A3. `enviar-alertas-cron`: inanição determinística da cauda
`api/enviar-alertas-cron.js:173,622`
Processa 120 perfis e só na ÚLTIMA instrução aciona o próximo lote; o cursor existe apenas na
query string dessa chamada encadeada. Timeout → a cadeia morre e **ninguém acima daquele `id`
recebe**. Como o cron sempre reinicia em `cursor=''`, é sempre o MESMO pedaço final da tabela
que fica de fora. Sem registro de execução: "0 e-mails" e "morreu no meio" são idênticos.
O custo se concentra na segunda-feira — o dia em que o e-mail deveria sair.

### A4. Upgrade de plano só existe pelo Asaas
`src/pages/Checkout.jsx:747` → `api/asaas.js:283`
`iniciarPagamento` desvia para `mudarPlano()` ANTES de escolher gateway, e `mudarPlano` só
chama `/api/asaas`. Como o MP é o principal, o assinante típico não está no Asaas: a tela
mostra "Confirmar upgrade →" e devolve *"Cliente não encontrado no Asaas"*. Não há action
equivalente em `api/mp.js` — **não existe caminho de upgrade para quem assinou pelo MP.**

### A5. `CompletarCadastroModal` pode travar o app num overlay cinza vazio
`src/components/CompletarCadastroModal.jsx:109-121` vs `src/contexts/AuthContext.jsx:38`
Duas leituras da mesma tabela discordam (o contexto usa só `perfis.nome`; o modal aceita o
`full_name` do metadata). Quando o contexto diz "incompleto" e o modal conclui "nada falta", o
`return null` está DENTRO do overlay: sobra a cortina em tela cheia, sem campo, sem botão, sem
X, sem clique-fora. E se auto-perpetua, porque o patch de gravação nunca grava `perfis.nome`.

---

## 🟠 ABERTO — MÉDIA

### M1. Documental: cota debitada e o cliente recebe o relatório ANTERIOR
`api/gerar-documental.js:931,1458` (o `return` de `preservarSeBom` está ACIMA do estorno das
linhas 942/1469). O `catch` sempre rebaixa para `status:'erro'`, o que torna a próxima geração
"nova" e cobrável. O mercadológico trata o mesmo par e trata certo (`gerar-analise.js:2604`).

### M2. "Atualizar Pesquisa de Mercado": IA paga sem cota, sem crédito e sem medição
`src/pages/Analise.jsx:2946` → `api/claude.js`. Dispara Sonnet com `web_search max_uses: 8` a
cada clique. Nenhum débito, nenhuma linha em `registrarCustoGeracao`. O botão segue ativo com
`analisesBloqueado === true` — os botões vizinhos do mesmo arquivo têm o gate, só falta nele.
Exige uma geração oficial antes, o que limita mas não impede: 1 cota compra pesquisas
ilimitadas.

### M3. `retencao-avisos-cron`: a data anunciada não é a data aplicada
`api/retencao-avisos-cron.js:120,140`. No caminho de REENVIO, `apagar_em` não está no `select`
→ `row.apagar_em` é `undefined` e o e-mail usa o valor CRU da regra, que pode já estar no
passado, enquanto a linha gravada é `max(regra, agora+7d)`. Mesma forma do bug do
`juridico_escalado_admin`. Junto: o push "Confirme seu arremate" é reenviado **todo dia,
indefinidamente**, para quem tem `email_enviado=false`.

### M4. `financiamento-alertas-cron`: falha de envio silenciosa e irrecuperável
`api/financiamento-alertas-cron.js:125` — `if (emailRes.ok)` sem `else`. Um 429/5xx do Resend
não conta, não entra em `erros`, não alerta, não gera `emails_log` (este cron fala com o Resend
direto). E a janela é a igualdade `dtStr === hoje`: amanhã já não casa e o lembrete **nunca
mais sai**.

### M5. `sinalizar-revenda` devolve `ok:true` sem checar a gravação
`api/sinalizar-revenda.js:76-92`. Irmão não corrigido do `sinalizar-arremate.js:87-91` (fechado
em 07/08). A revenda é o **gabarito que calibra o Índice**: o dado que o cliente acha que
entregou não entrou.

### M6. `validar-pj-socio` anuncia "pode sacar" sem checar a gravação
`api/validar-pj-socio.js:65`. O helper devolve `{ok, data}` de propósito e o call site descarta
os dois. Se a RPC falhou, `pj_validada_em` fica nulo e `api/saque.js:224` barra o saque — o
parceiro é convidado a sacar e bloqueado. (`Perfil.jsx` reconsulta e corrige o selo;
`MinhaRede.jsx`, que é a tela que fala em saque, não.)

### M7. `/api/saque` lido sem `.ok` em duas telas
`src/pages/MinhaRede.jsx:143` · `src/pages/Comissoes.jsx:66`. Em qualquer falha (401, 500,
timeout), a tela mostra R$ 0,00 e *"Você ainda não tem saldo a sacar"* — indistinguível de um
parceiro sem comissão. Com `faltando` vazio, nem o aviso de cadastro pendente aparece: a tela
fica coerente e errada.

### M8. Falha de leitura do perfil rebaixa o assinante — e é gravada no cache
`src/contexts/AuthContext.jsx:28`. `const { data } = await ...single()` descarta o `error`;
postgrest-js não lança em não-2xx. Um 500 transitório no refetch de foco vira
`role:'explorador'` + `cadastroIncompleto:true`, e `savePerfilCache` **grava isso**. 401/403/406
estão em `STATUS_IGNORADOS`, então nem rastro em `erros_cliente` fica.

### M9. `cancelar-nao-pagos-cron`: varredura sem teto dentro de `maxDuration: 60`
`api/cancelar-nao-pagos-cron.js:20,73-112`. Até 300 chamadas ao Asaas por página, sequenciais,
sem checagem de deadline; `erros` só existe no corpo da resposta. Volume do Asaas hoje é baixo
(é o backup) — por isso média, não alta.

### M10. Conciliação/DRE importa no máximo 300 lançamentos e reporta sucesso
`api/financeiro-extrato.js:285` (`slice(0, 300)`, um limite de UI) consumido por
`conciliacao.js:177` e `conciliacao-sync-cron.js:49` como se fosse a lista completa. Acima de
300 na janela, o resto **nunca** chega a `conciliacao_lancamento` — e como o upsert é
idempotente e a ordem é data desc, repetir a importação não alcança os antigos. Latente: só
morde acima de ~6,7 lançamentos/dia na janela de 45 dias.

### M11. KYC por imagem: Edge com timeout de 120s × 3 contra o teto de 25s
`api/verificar-identidade-kyc.js` · `api/validar-selfie.js` — `runtime: 'edge'` chamando
`anthropicFetch` sem opções (herda `retries: 3, timeoutMs: 120000`). Um 529 do Anthropic passa
dos 25s e a Vercel mata a função: **todo o desenho de fail-open-to-review vira código morto** e
o cliente recebe erro de rede em vez de "sua identidade passará por revisão".

### M12. Convite de equipe com e-mail já cadastrado termina em falso sucesso
`src/pages/ConviteEquipe.jsx:412-427`. Com "Confirm email" ligado, o `signUp` de e-mail
existente devolve 200 com `identities: []` e não manda e-mail. O código só checa `signUpError`.
9 passos + 3 fotos de KYC terminam em "Cadastro concluído!" com uma senha que não funciona.
Os outros dois fluxos da base já têm o guard (`Login.jsx:333`, `Checkout.jsx:645`) — é omissão.
*Adjacente, mesmo arquivo:* `usar_convite_equipe` roda ANTES de `salvar_kyc_equipe`, e o
primeiro faz `ativo = false` enquanto o segundo filtra `ativo = true` — as 3 fotos são
descartadas em silêncio.

### M13. Promoção com e-mail já cadastrado: "Conta criada!" e login que falhou calado
`src/pages/Promo.jsx:134-147`. O servidor devolve `jaExistia: true` (decisão correta, para não
sequestrar comissão) e **o front nunca lê esse campo**. Plano pago: `nav('/checkout')` roda
mesmo assim e a pessoa chega deslogada. Curso/e-book: a tela exibe "✅ Conta criada!" e um
botão que rebate para o login.

### M14. Assinante ANUAL barrado em conteúdo incluso no plano
`api/verificar-cpf.js:121` compara o role CRU com `PLANOS_COM_CONTEUDO`, enquanto a linha 105
do mesmo arquivo já normaliza o sufixo `_anual`. `top2_anual` não está na lista → a tela manda
"faça upgrade" para quem já paga o anual, e desabilita o botão de criar conta.

---

## 🟡 ABERTO — BAIXA

### B1. Índice: falha da RPC de ponderação vira "não encontramos anúncios nesta localidade"
`api/indice-mercado.js:257`. A pesquisa web roda inteira (60–200s, custo real), as amostras são
inseridas, e um `null` da RPC colapsa "falhou" com "não há resultado". A resposta traz
`inseridas: N` e a tela ignora. O irmão desse defeito já foi corrigido em
`IndiceConsulta.jsx:44` ("FALHA != NÃO MAPEADO, 07/08") — faltou aqui.

### B2. `push-subscribe` confirma a inscrição sem checar o upsert
`api/push-subscribe.js:55`. O usuário vê "notificações ativadas" e nunca recebe push.

### B3. NF do saque: a tela pede um campo que o servidor nunca envia
`src/pages/Comissoes.jsx:120` lê `data.nf_valor_exigido`, que **não existe em lugar nenhum do
repositório**. O fallback `|| valor` é o único caminho vivo, então a nota exigida vira a do
PEDIDO e não a do mês integral — contrariando o comentário logo acima da linha. No banco,
`saque_avaliar` também só exige `valor_nf >= v_valor`, então dá para fatiar pedidos.

### B4. `indice-reforco-cron` é ruído agendado
6 invocações diárias (`35 */4 * * *`) só para responder `{desligado:true}`. E três estados de
significado oposto — *desligado por decisão*, *nada elegível*, *RPC quebrada* — saem todos como
`200 ok:true`, sem deixar linha. O helper `rpc()` (`:33`) devolve `null` em qualquer resposta
não-ok, então RPC ausente vira "fila vazia".

---

## ✅ REFUTADOS (verificados e descartados — não reabrir)

- **`indice-reforco-cron` quebrado** → **não está**. `indice_reforco_estado` VAZIA prova que a
  execução nunca passou do `if (process.env.INDICE_REFORCO !== '1')` da linha 89, porque
  `marcarEstado` é chamado **mesmo em erro**. É a decisão de custo do dono (~US$ 300/mês), não
  uma falha. `indice_amostras` parada desde 07/08 é a consequência coerente: os dois únicos
  chamadores de `ingerir_amostras_indice` são esse cron e o botão "Gerar índice".
- **Amostra vitalícia do explorador tratada como cota mensal** → não ocorre em nenhuma tela.
- **Servidor reimprimindo o input do cliente** (padrão sistêmico de 07/08) → área da matrícula é
  autoritativa, o lance troca para a praça mais descontada, e valor/locação são recalculados.
- **`export default` devolvendo `Response` no runtime Node** → zero ocorrências novas em 237
  arquivos; os hits são o texto do comentário que documenta a armadilha.
- **`getUser` × `getAuthUser` trocados** → `_auth.js:46` funciona nos dois runtimes.
- **`mp-webhook` sem idempotência** → tem, por transição, com rollback em todos os ramos.
- **Uploads de KYC com path inválido** → gravam no formato exato que `pathDoNossoBucket` aceita.
- **`pagar_todos` marcando lançamento alheio** → só saque nasce com `status='solicitado'`.
- **`garantia-cancelar.js`** → já distingue "cancelei" de "não consegui cancelar".
- **Asaas ausente do extrato** → é o fallback funcionando. (Mas ver o achado 1 corrigido: parte
  do vazio de agora era 403, não ausência de movimento.)
