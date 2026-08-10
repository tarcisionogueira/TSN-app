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

## ✅ AS 5 DE ALTA — CORRIGIDAS EM 10/08 (commit `e78e511`)

### A1. Crédito comprado não desbloqueava a geração — **RESOLVIDO**
`analisesBloqueado` não consultava `credito_saldo`, e `lerCotaMercado` descartava esse campo
(que vem no TOPO de `minhas_cotas`, não dentro de `mercado`). O servidor aceitaria:
`gerar-analise.js:1551` chama `pode_debitar` e segue com `cobrarCredito`. **O cliente pagava e
não conseguia gastar.**
→ Regra única em `cotaAnalise.bloqueado()`, que inclui o crédito. O contador passa a dizer
"as próximas análises usam seu saldo de créditos" em vez de mostrar a cota estourada sem
contexto. **Não criar uma segunda cópia desta regra.**

### A2. "Corrigir e regerar a avaliação" não regerava nem persistia — **RESOLVIDO**
O botão chamava `analisarMercadoClick`, caminho LEGADO do cliente que só faz `setMercado()`
local — recarregou, voltava. E o laudo lê `analises_mercado`, então o parecer final seguia
decidindo sobre a cidade/área que o documental acabara de desmentir.
→ Passa a chamar `gerarRelMercado(corr)`, a geração do SERVIDOR, que persiste. `gerarRelMercado`
ganhou `override` (mesma razão do override em `analisarMercadoClick`: `setD` é assíncrono), e
`metricas`/`teto` são recalculados sobre o snapshot corrigido — senão o laudo iria com a
viabilidade dos dados velhos.

### A3. `enviar-alertas-cron`: inanição determinística da cauda — **RESOLVIDO**
`continuar()` só era chamado DEPOIS do lote inteiro, e o cursor vivia apenas na query string da
chamada encadeada. Timeout matava a cadeia, e como o cron reinicia em `cursor=''`, era sempre o
MESMO pedaço final da tabela que ficava sem e-mail.
→ Orçamento de 240s dentro do laço; ao cortar, encadeia a partir do **último processado** (não
do fim do lote, senão os não tratados seriam pulados). `ultimoProcessado` só avança depois de
tratar o perfil, então o corte nunca engole quem estava em andamento. Rastro da varredura em
`alerta_estado` (chave `enviar_alertas_cron`) — "não havia ninguém" e "a cadeia morreu" deixam
de ser indistinguíveis.
> **Follow-up FECHADO na terceira leva:** o `health-check` passou a ler esse rastro
> ("E-mail de oportunidades — varredura completa").

### A4. Upgrade de plano só existia pelo Asaas — **RESOLVIDO (upgrade)**
`mudarPlano` só chamava `/api/asaas`, e `api/mp.js` não tem action equivalente. Como o MP é o
principal, o assinante típico levava *"Cliente não encontrado no Asaas"* sem alternativa.
→ 404 do Asaas passa a significar "a assinatura está no MP": o **upgrade** segue por
`gerarLink()`, o caminho já usado e testado na troca mensal→anual (cancela as recorrências
anteriores e cria a nova, cobrando agora — a semântica exata de um upgrade).
> ⚠️ **DOWNGRADE pelo MP ficou de fora DE PROPÓSITO — decisão do dono pendente.** Cancelar e
> recriar por valor menor faz o cliente perder o restante do período já pago. Enquanto não se
> decide, a tela diz a verdade e encaminha ao suporte, em vez de dar erro de gateway.

### A5. `CompletarCadastroModal` podia travar o app — **RESOLVIDO**
Três defeitos somados: (a) o `passos.length === 0 ? null` vivia DENTRO do JSX do overlay, então
sobrava a cortina em tela cheia sem campo, botão, X ou clique-fora; (b) o `error` da consulta
era descartado, e com `data` nulo tudo virava "faltando"; (c) o modal aceitava o `full_name` do
metadata como nome válido enquanto o AuthContext exige `perfis.nome` — discordância que se
auto-perpetuava, porque o patch só grava `passos.includes('nome')`.
→ Early return ANTES do overlay + desligamento do estado em efeito (nunca durante o render);
falha de leitura não bloqueia mais (o gate de verdade é o servidor); e o critério do nome passa
a ser o MESMO do contexto, com o valor do metadata pré-preenchido para o usuário confirmar —
o que finalmente grava `perfis.nome` e faz as duas leituras concordarem.
> **Nota:** o achado **M8** (AuthContext descartando o `error` e gravando o perfil de falha no
> cache) é o *outro* gatilho desta família — resolvido logo abaixo, na segunda leva.


---

## ✅ SEGUNDA LEVA — CORRIGIDA EM 10/08 (commit `1787f1d`)

### M8. Falha de leitura do perfil rebaixava o assinante — e ia para o cache — **RESOLVIDO**
`const { data } = await …single()` descartava o `error`, e o postgrest-js não lança em não-2xx.
Um 500 transitório no refetch de foco virava `role:'explorador'` + `cadastroIncompleto:true`, e
`savePerfilCache` **gravava isso** — então a próxima abertura hidratava com o perfil rebaixado.
→ `maybeSingle()` separa de vez "não tem perfil" (dado) de "não consegui ler" (falha); o
resultado carrega `falhouLeitura`; o cache só aceita leitura boa (`podeCachear`); e o popup de
cadastro não abre numa falha — o `role` segue fail-closed, porque permissão a MAIS é pior, mas
trancar o app atrás de um popup por um 500 é o oposto do que o popup existe para fazer.

### M1. Documental: cota debitada e o cliente recebia o relatório ANTERIOR — **RESOLVIDO**
Os dois pontos que chamam `preservarSeBom` fazem `if (_pres) return _pres;`, e o bloco de
estorno estava LOGO ABAIXO desse `return` — inalcançável nesse caminho. O cliente pagava a cota
e recebia de volta o relatório que já tinha.
→ O estorno foi para DENTRO do helper, não nos chamadores: assim acompanha qualquer call site
futuro, que é exatamente o tipo de "esqueceram no terceiro lugar" que criou o bug. E o `catch`
passa a preservar `status:'concluida'` quando há relatório bom, alinhando com o gêmeo
`gerar-analise.js:2603` — rebaixar para `'erro'` com um `result` bom na linha mostrava falha
sobre um relatório que o cliente tem e fazia a próxima geração contar como nova.

### M2. "Atualizar Pesquisa de Mercado": IA paga sem cota nem medição — **RESOLVIDO**
Era o último ponto vivo do caminho LEGADO do cliente (`utils/claude.js` → `/api/claude`):
Sonnet com `web_search max_uses: 8` a cada clique, sem debitar cota, sem debitar crédito, sem
registrar custo — uma cota comprava pesquisas ilimitadas. E era o único botão da tela sem o gate
`analisesBloqueado`, que os vizinhos já tinham.
→ Passa pela geração do servidor (`gerarRelMercado`), que debita, mede e **persiste**. O caminho
legado (`analisarMercadoClick` + o import de `analisarMercado`) foi **removido**: deixar código
morto que gasta dinheiro é convite para ressuscitar.

### M5. `sinalizar-revenda` devolvia `ok:true` sem checar a gravação — **RESOLVIDO**
O PATCH era disparado com o resultado descartado. O front só checa `res.ok`, mostrava o valor na
tela, e ele sumia no próximo carregamento — sendo que a revenda é o **gabarito que calibra o
Índice**.
→ Mesmo remédio do irmão `sinalizar-arremate.js:87` (corrigido em 07/08 e não propagado): 502
quando o gabarito não grava. O insert da amostra do Índice é acessório e não derruba a resposta,
mas `amostra` passa a refletir o que de fato entrou — é o que a tela mostra ao cliente.

### M6. `validar-pj-socio` anunciava "pode sacar" sem checar a gravação — **RESOLVIDO**
O helper `rpc()` devolve `{ok, data}` de propósito e o call site descartava os dois. Falhando a
gravação, `pj_validada_em` ficava nulo — e é ele que `api/saque.js:224` exige — mas a resposta já
dizia `matched: true` e a MinhaRede imprimia "✓ Empresa validada — você já pode solicitar o
saque". Convidava a sacar e barrava na hora.
→ Fail-closed: 502 quando a gravação não confirma. Confirmação de gate de dinheiro não se dá
antes de o registro existir.

---

## ✅ TERCEIRA LEVA — TODO O RESTANTE, CORRIGIDO EM 10/08 (commit `219ec6b`)

**M3 · `retencao-avisos-cron`** — `apagar_em` e `push_enviado` entraram no `select`. No reenvio,
`row.apagar_em` saía `undefined` e o `||` caía no valor CRU da regra (que pode já estar no
passado), enquanto o prazo honrado é o gravado, `max(regra, agora+7d)`: o cliente lia "seus
documentos serão removidos a partir de <data que já passou>". Mesma forma do bug do
`juridico_escalado_admin` — a coluna que decide não estava no select e o `||` mascarou. O push
passa a sair **uma vez**: rodava a cada passagem, e quem nunca consegue receber e-mail reentrava
todo dia, levando "Confirme seu arremate" indefinidamente sem nunca chegar à deleção.

**M4 · `financiamento-alertas-cron`** — o `if (emailRes.ok)` não tinha `else`, então um 429/5xx
do Resend não contava, não entrava em `erros`, não alertava e não gerava `emails_log` (este cron
fala com o Resend direto). E a perda é DEFINITIVA: a janela é a igualdade `dtStr === hoje`.
Agora entra em `erros`, que é o que dispara o e-mail ao admin — alguém precisa saber no mesmo dia.

**M7 · `/api/saque` sem `.ok`** — em MinhaRede e Comissões. `apiCall` devolve o Response cru e
não lança: um 401/500 trazia JSON válido e `Number(sq.saldo || 0)` virava **R$ 0,00** com "Você
ainda não tem saldo a sacar". Com `faltando` vazio, nem o aviso de cadastro pendente aparecia —
a tela ficava coerente e errada. Agora **saldo desconhecido não é saldo zero**: as duas telas
dizem que não conseguiram consultar.

**M9 · `cancelar-nao-pagos-cron`** — orçamento de 45s dentro do laço (de `maxDuration: 60`), e
`completo: false` na resposta. A varredura ia até 10.000 offsets com até ~300 chamadas ao Asaas
por página; ao estourar, `res.status(200)` nunca rodava e o array `erros` — única memória de um
DELETE que falhou — sumia junto.

**M10 · Conciliação/DRE cortada em 300** — o `slice(0, 300)` é limite de UI, e os dois
importadores server-side consumiam a lista como se fosse completa; acima de 300 na janela, o
resto **nunca** chegava a `conciliacao_lancamento`. Novo `?lista=completa` para consumidor de
servidor, mais `lista_truncada` explícito para ninguém precisar deduzir o corte comparando
contagens.

**M11 · KYC no Edge** — os handlers são `runtime: 'edge'` (teto duro de 25s) e chamavam
`anthropicFetch` sem opções, herdando `retries: 3, timeoutMs: 120000`. Um 529 passava dos 25s e a
Vercel matava a função: todo o desenho de fail-open (`revisar`/`pendente`, que existe para não
travar a assinatura de um contrato) era **código morto**. Agora `retries: 1, timeoutMs: 8000` nos
4 call sites — cabe nos 25s e mantém a proteção contra o 529 transitório.

**M12 · Convite de equipe** — ganhou o guard `identities.length === 0` que os outros três fluxos
já tinham. E a ORDEM foi corrigida: `salvar_kyc_equipe` roda ANTES de `usar_convite_equipe`,
porque o primeiro filtra `ativo = true` e o segundo faz `set ativo = false` — as 3 fotos de KYC
eram descartadas em silêncio, e o retorno do RPC nem era checado.

**M13 · Promoção** — o front nunca lia `jaExistia`, que o servidor mandava. Com e-mail já
cadastrado, a senha nova não abre a conta antiga, o login falhava e o `nav('/checkout')` rodava
assim mesmo: a pessoa chegava deslogada, sem nunca ler que o e-mail já existe. Agora a mensagem
diz a verdade e o checkout só recebe quem está logado.

**M14 · Assinante ANUAL** — `PLANOS_COM_CONTEUDO.includes(role)` passou a normalizar `_anual`,
como o ramo de PLANO do mesmo arquivo já fazia. Mandava "faça upgrade" para quem já paga o anual
e já tem o conteúdo incluso.

**B1 · Índice** — `rpcOk()` separa "a RPC falhou" de "não veio resultado". O colapso num `null`
fazia a tela dizer "Não encontramos anúncios nesta localidade" DEPOIS de a pesquisa web ter
rodado inteira (60–200s, custo real) e as amostras terem sido inseridas — o cliente concluía que
a região não tem mercado e clicava de novo, pagando outra pesquisa.

**B2 · `push-subscribe`** — upsert e delete passam a ser checados; "notificações ativadas" sem
inscrição gravada acabou.

**B3 · NF do saque** — **o achado estava parcialmente errado, e vale registrar.** O motor no banco
SEMPRE esteve certo: `saque_avaliar` exige `valor_nf >= total_do_mes` (= `ja_sacado_na_janela +
este pedido`) e já devolve `nf_valor_exigido`. Não dá para escapar fatiando saques — essa parte
do achado é **refutada**. O defeito era só de TRANSPORTE: `api/saque.js` montava o 422 à mão e
descartava o campo, então a tela caía no fallback `|| valor` e pedia a nota do PEDIDO. Corrigido
encaminhando `nf_valor_exigido` e `total_do_mes`.

**B4 · `indice-reforco-cron`** — o helper `rpc()` devolvia `null` em qualquer não-ok, então RPC
ausente virava "fila vazia" e o cron respondia `200 ok` — verde, indistinguível de "tudo bem".
Agora cada saída tem `motivo` (`desligado_por_env` · `fila_vazia` · `rpc_indisponivel`, este com
502) e a falha de ingestão sobe como `ultimo_erro` em vez de virar "inseriu zero". A **cadência
do cron ficou como está de propósito**: ela é o botão do dono, e mudá-la agora alteraria em
silêncio o comportamento da funcionalidade no dia em que for ligada.

---

## 🛡️ O QUE IMPEDE ESTA FAMÍLIA DE VOLTAR

1. **`npm run verificar:padroes`** — 4 regras estruturais, linha de base por arquivo, roda no
   `prebuild` (todo build e todo deploy da Vercel) e no CI. Só reprova ocorrência NOVA.
   Achou um bug REAL na primeira execução: um `signUp` legado em `src/utils/supabase.js`, sem o
   guard de duplicata, sem nenhum importador e gravando `role: 'aluno'` — removido.
2. **`CLAUDE.md` → "A PERGUNTA DE REVISÃO"** — as quatro formas que já morderam esta base, para
   o que o scanner não alcança.
3. **`qa_invariantes.proximidades_vazio_falso`** — o vazio falso volta a ser visível se reaparecer.
4. **`health-check` → "E-mail de oportunidades — varredura completa"** — fecha o follow-up que
   ficou aberto no A3: o rastro do cron agora é LIDO, e uma cadeia cortada vira aviso.

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
