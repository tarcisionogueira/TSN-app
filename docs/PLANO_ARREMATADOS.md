# Plano — Meus Arrematados (14/08/2026)

> Aberto a pedido do dono. **Ponto de partida que muda tudo: a maior parte disto já existe.**
> `src/pages/Arrematados.jsx` (719 linhas), tabelas `arrematados` e `arrematado_lancamentos`,
> tipos de documento de arremate já no `upload-anexo.js`, e o registro de revenda alimentando o
> Índice BidPro. **O acervo tem 2 arrematados e 2 lançamentos.** O plano não é construir a
> funcionalidade — é descobrir por que ela não é usada, fechar as pontas e cobrir dois casos
> reais que o dono trouxe do cliente do Rafael.
>
> ⚠️ **Isto é planejamento. Nada nas seções 4a, 4a-bis, 4a-ter e 4a-quater foi implementado, nada
> disso aparece para cliente nenhum, e nenhuma delas deve virar código antes das decisões que
> cada uma lista** (dono, 14/08: *"essa parte não é pra colocar nada em efetivo — estamos apenas
> desenhando para, no momento certo, implantar"* · *"não é para aparecer para nenhum cliente"*).

---

## 0. O que já está pronto (medido, não suposto)

| Peça | Onde | Estado |
|---|---|---|
| Cadastro do arrematado | `arrematados` (valor, data, status, observações, `documentos`) | ✅ |
| Fluxo de caixa | `arrematado_lancamentos` (tipo entrada/saída, categoria, descrição, valor, data) | ✅ 11 categorias |
| Documentos | `imovel_anexos` + contratos vinculados | ✅ tipos `auto_arrematacao`, `carta_arrematacao`, `contrato_banco`, `escritura`, `boleto_sinal`, `boleto_aquisicao`, `matricula_registrada` |
| Saldo realizado | Entradas − Saídas, na aba e na lista | ✅ calculado |
| Conclusão pela venda | `revenda_valor`/`revenda_data`/`revenda_m2` → vira amostra do Índice | ✅ |

Categorias de lançamento hoje: Arrematação · Honorários advocatícios · Taxa do leiloeiro ·
ITBI/Registro · Reforma · IPTU · Condomínio · Débitos assumidos · Venda · Aluguel recebido · Outro.

---

## Decisão 1 — `arrematacoes` e `arrematados`: uma estrutura ou duas?

**O problema.** São duas tabelas com propósitos que se sobrepõem:

- **`arrematacoes`** — o fluxo da ASSESSORIA: caso, analista, advogado, honorários, beneficiário.
  É a ela que `imovel_anexos.arrematacao_id` aponta.
- **`arrematados`** — o fluxo do CLIENTE: fluxo de caixa, revenda, documentos, observações.
  A tela junta os anexos por `imovel_id`, não pelo vínculo.

Enquanto forem duas sem contrato entre si, **todo recurso novo terá que ser feito duas vezes** e
os documentos continuarão pendurados na estrutura errada.

**Recomendação: manter as duas, com papéis explícitos e uma chave.** `arrematacoes` é o
**processo** (quem trabalhou, quanto se cobrou, qual o estágio da assessoria); `arrematados` é o
**ativo do cliente** (o imóvel que ele tem na mão, o dinheiro que entra e sai, a saída pela
venda). Fundir jogaria dado de honorário e de comissão dentro do portfólio do cliente.

*O que fazer:* `arrematados.arrematacao_id` (FK, nulo permitido — nem todo arremate passa pela
assessoria) e a aba Documentos passa a ler pelo vínculo **e** pelo imóvel, com a origem
declarada em cada documento ("enviado por você" × "anexado pela assessoria").

> ⚠️ Já existe uma armadilha registrada aqui: `arrematados.imovel_id` é **TEXT** enquanto
> `imovel_anexos.imovel_id`, `analises_mercado.imovel_id` e `imoveis_leilao.id` são **UUID**. Um
> id local de portfólio (`tsn_<ts>_<rand>`) cabe na coluna e quebra toda consulta que o use
> (PostgREST `22P02`). Qualquer trabalho aqui precisa resolver isso primeiro.

---

## Decisão 2 — Qual número manda na tela: lucro realizado ou potencial?

**Hoje o card grande diz "ROE × mercado"** e calcula `valor de mercado − arrematação`
(`Arrematados.jsx:169`). Isso é lucro **potencial**, estimado pelo relatório. O lucro
**realizado** (entradas − saídas) existe, aparece como "Saldo", mas em segundo plano.

**Recomendação: inverter.** O dono descreveu "calcular exatamente o lucro que ela teve naquela
operação" — isso é o realizado. E os dois números respondem perguntas diferentes:

| Número | Pergunta que responde | Quando importa |
|---|---|---|
| **Resultado realizado** (entradas − saídas) | "quanto sobrou no meu bolso?" | sempre, e é o único verdadeiro depois da venda |
| Potencial (mercado − arrematação) | "quanto ainda posso ganhar?" | enquanto o imóvel não foi vendido |

*O que fazer:* card principal = **Resultado realizado**, com o potencial ao lado como
comparação. E, depois da venda registrada, o potencial vira **"projetado × realizado"** — que é
o número que ensina o investidor (e calibra o nosso próprio Índice).

---

## Decisão 3 — Implementar o fluxo de arremate de 06/08?

O desenho está aprovado por você e registrado no HANDOFF, e **nunca foi implementado**:

- botão só para **assessorado e clube**;
- **um único arrematante por lote** (índice único parcial em `(imovel_id) where estado in ('declarado','confirmado')`);
- para liberar: **valor da arrematação** + **comprovante** (auto de arrematação ou e-mail do leiloeiro com o valor);
- estados `declarado → confirmado → recusado`.

**Isto é a explicação mais provável para os 2 registros na base**: a porta de entrada não existe
direito. O botão legado do Painel (`Painel.jsx:447`) grava com id `tsn_…` fora do
`sinalizar-arremate` — e morre nesse mesmo movimento.

**Recomendação: sim, e primeiro.** Sem entrada, todo o resto é vitrine.

> **Pergunta sua ainda em aberto:** manter o DELETE dos documentos pelo cliente depois de
> confirmado, ou remover de vez? Recomendação registrada: **remover** — documento de arremate é
> prova e a retenção é obrigação nossa; cliente pede, equipe executa.

---

## Decisão 4 — O que falta no fluxo de caixa

Três lacunas, e a **primeira virou urgente por causa do caso do Rafael**:

### 4a. Parcelamento — e a decisão do dono de fazer disso um PRODUTO

> **Refinamento do dono (14/08):** não é só registrar a proposta. É **fazer o contrato pelo
> módulo de contratos e originar a cobrança**: informa-se o sinal e em quantas vezes parcela; o
> sistema puxa a taxa base de **1% a.m. + IPCA**; a cobrança sai pelo **Mercado Pago**, com as
> **taxas repassadas ao cliente**, mais **0,5% sobre a venda** para a plataforma. E uma
> **simulação** mostrando como fica o parcelado com tudo embutido — possivelmente também na
> visão do vendedor.

Isso muda a natureza do item: deixa de ser um campo no fluxo de caixa e vira **produto
financeiro**. O caso concreto que o originou: a compradora do lote do Rafael propôs **50% à
vista + 50% em 24× com IPCA + 1% a.m.**

#### O que o sistema precisa saber fazer

| Peça | O que é |
|---|---|
| **Simulador** | entrada + nº de parcelas + taxa + índice → parcela, total, custo efetivo, e o que sobra para o vendedor |
| **Contrato** | gerado pelo módulo que já existe (`contratos_link`, assinatura eletrônica) com o plano anexado |
| **Cobrança** | assinatura/recorrência no Mercado Pago, uma cobrança por parcela |
| **Conciliação** | cada parcela paga vira lançamento `realizado` no fluxo de caixa do arrematado |

#### As quatro armadilhas — e a segunda é a mais cara

**1. Previsto não é caixa.** `arrematado_lancamentos` não distingue **previsto** de **realizado**.
Sem a coluna `situacao`, um plano de 24 meses entra como se já tivesse caído na conta e o lucro
sai inflado no dia da assinatura. **É a menor mudança da lista e a que impede a mentira maior.**

**2. Repassar taxa é divisão, não multiplicação.** Para receber líquido `X` com taxa `t`, o valor
cobrado é `X / (1 − t)` — **não** `X × (1 + t)`. Com MP a 4,99%, num boleto de R$ 5.000: por
fora dá R$ 5.249,50 e chegam R$ 4.987,55 (faltam R$ 12,45); por dentro dá R$ 5.262,66 e chegam
os R$ 5.000 exatos. Parece detalhe e não é: **em 24 parcelas a diferença vira quase uma parcela
inteira**, absorvida em silêncio pela plataforma. É a mesma família do yield sem ×100 que
corrigimos hoje — conta com aparência de certa.

**3. IPCA é retroativo, e isso decide o desenho da cobrança.** O índice do mês só é publicado
depois do mês. Duas saídas, e é decisão de produto:
- **parcela variável** — corrige na data de cada vencimento; exige cobrança avulsa mês a mês no
  MP (assinatura de valor fixo não serve) e o cliente não sabe hoje o valor da parcela 18;
- **parcela fixa** — pré-calculada com IPCA projetado; previsível para os dois lados, mas
  **erra** em relação ao índice real, e o contrato precisa dizer o que acontece com a diferença.

**4. Quem é o credor?** A plataforma intermedeia a cobrança, mas o recebível é do vendedor. Em
24 meses há inadimplência, e é preciso estar escrito: qual a garantia (alienação fiduciária do
próprio imóvel?), o que acontece se parar de pagar, e quem executa. **A plataforma não pode
parecer credora sem ser** — nem assumir risco de crédito sem decidir isso.

#### As decisões que faltam

1. **De quem sai os 0,5%** — do vendedor (nosso cliente) ou embutido no parcelado do comprador?
   Muda contrato, tributação e o número que a simulação mostra.
2. **Parcela fixa ou variável** (armadilha 3).
3. **Cartão, boleto ou PIX recorrente** — mudam a taxa, o prazo de repasse e o risco.
4. **Assumimos risco de crédito?** Se não, o contrato precisa dizer isso em letra grande.

> **Sugestão de ordem:** o **simulador primeiro**, sozinho, sem cobrança nenhuma. Ele é barato,
> não move dinheiro, e é o que responde "essa proposta é boa?" — que é a pergunta do Rafael
> hoje. Contrato e cobrança vêm depois, quando as quatro decisões estiverem tomadas.

#### 4a-bis. Banco Inter, repasse ao investidor e taxa administrativa (dono, 14/08)

> "Podemos avançar com a integração do Banco Inter — o Inter tem boletos gratuitos. O ideal
> seria fazer o **de pagamento para o investidor**. A ideia é puxar o IPCA e atualizar a parcela
> mês a mês, mais a **taxa administrativa**, como funciona no financiamento bancário: o cliente
> recebe o valor corrigido e a gente recebe um percentual administrativo em cima. Veja a
> legalidade e a melhor forma de estruturar."

**Não sou advogado e isto não é parecer jurídico.** O que segue é o mapa dos pontos que um
advogado vai olhar, para a conversa com ele começar adiantada — e um deles muda o produto.

##### 🔴 O ponto que muda o produto: 1% a.m. entre PARTICULARES

| | |
|---|---|
| 1% a.m. capitalizado | **12,68% a.a.** |
| Teto da Lei de Usura (Dec. 22.626/1933) para quem **não** é instituição financeira | **12% a.a.** |
| Excede | **sim, por 0,68 ponto** — e ainda há o IPCA por cima (≈17,75% a.a. com IPCA de 4,5%) |

A Súmula 596 do STF afasta esse teto **para instituições financeiras**. O vendedor do imóvel não
é uma — é pessoa física ou jurídica comum vendendo a prazo. Some-se a isso a **capitalização
mensal**, também restrita a quem não é instituição financeira. Ou seja: a taxa proposta está
exatamente no ponto que se discute em juízo, e a discussão não é teórica — é o argumento padrão
de quem quer revisar o contrato depois de 18 parcelas pagas.

**Saídas possíveis, em ordem de segurança:**
1. **Ficar em 1% a.m. simples** (12% a.a. exatos) e deixar a correção monetária (IPCA) fazer o
   resto — juro e correção são coisas juridicamente distintas, e a correção não é ganho.
2. **Manter 1% capitalizado com o risco declarado no contrato** e ciência expressa do comprador.
3. Estruturar via instituição financeira parceira — aí o teto não se aplica, mas o produto deixa
   de ser nosso.

> ↪️ **A saída 3 deixou de ser hipotética:** o dono está avaliando **abrir a financeira**. Isso
> resolve este bloqueio — e cria outros. Ver **4a-ter**, logo abaixo.

##### 🟠 O segundo ponto: de quem é o dinheiro no caminho

É aqui que a escolha do Inter decide a exposição regulatória, e **a diferença não aparece na
tela — só no CNPJ do boleto**:

| Estrutura | Como funciona | Exposição |
|---|---|---|
| **A. Boleto na conta do VENDEDOR** *(recomendada)* | a plataforma orquestra a emissão via API do Inter **na conta dele**; o dinheiro vai direto do comprador para o vendedor e **nunca passa por nós** | menor. Somos prestador de serviço, não meio de pagamento |
| **B. Boleto na conta da BidPro + repasse** | recebemos e transferimos | **gestão de recursos de terceiros** — territorio de arranjo/instituição de pagamento (Lei 12.865/2013 e regulamentação do BCB). Há limiares para autorização obrigatória, mas as regras de conduta valem antes deles |
| **C. Escrow / conta garantida** | terceiro custodia | mais seguro para as partes, mais caro, e exige parceiro habilitado |

**Recomendação: A.** O dinheiro do comprador não deve tocar a nossa conta. Isso resolve de uma
vez o risco regulatório, o risco de crédito e a pergunta "quem é o credor?" da armadilha 4.

##### 🟢 O terceiro ponto: a taxa administrativa é serviço, não juro

A analogia com o financiamento bancário é boa para explicar ao cliente e **perigosa se virar a
estrutura jurídica**. No banco, a taxa administrativa remunera o *credor*, que empresta dinheiro
próprio. Nós não emprestamos nada: prestamos um serviço de **emissão, correção mensal, cobrança,
conciliação e prestação de contas**.

Isso é bom — e precisa aparecer assim: contrato de **prestação de serviços** com o vendedor,
percentual sobre o valor administrado, **nota fiscal de serviço e ISS**. O que não pode é a taxa
figurar como parte do custo do crédito do comprador, porque aí ela vira encargo de uma operação
de crédito que não somos autorizados a fazer.

> Consequência prática: **a taxa é cobrada do vendedor** (que contratou o serviço), mesmo que
> economicamente ele a repasse no preço. Cobrar do comprador nos coloca na operação de crédito.

##### Sobre a integração em si

- API de **Cobrança** do Inter (boleto + PIX no mesmo documento), com **mTLS** (certificado
  cliente) e OAuth2 — diferente dos gateways que já usamos, que são só chave de API. O
  certificado é do titular da conta: na estrutura A, é **do vendedor**, e isso muda o
  onboarding (ele precisa gerar e nos autorizar) e vira o item mais atritoso do fluxo.
- **Boleto gratuito** é condição comercial da conta PJ e tem limites por faixa — confirmar no
  contrato vigente antes de prometer "sem custo" ao cliente.
- Webhook de baixa → conciliação automática, virando lançamento `realizado` (armadilha 1).
- **O que já temos ajuda:** `api/_webhook-core.js` (HMAC), o padrão de conciliação do Asaas/MP e
  o `honorarios-split.js` (distribuição por percentual). O Inter entra como **mais um provedor**,
  não como substituto — o MP continua no checkout de assinaturas.

##### O que levar ao advogado (a lista, pronta)

1. Juros de 1% a.m. **capitalizado** entre particulares × Lei de Usura e Súmula 596.
2. Estrutura A (boleto na conta do vendedor): confirma que ficamos fora do conceito de arranjo
   de pagamento?
3. Taxa administrativa como serviço ao **vendedor** — minuta, ISS, nota.
4. Correção por IPCA em contrato de compra e venda: periodicidade mínima e índice substituto se
   o IBGE deixar de publicar.
5. Inadimplência: garantia (alienação fiduciária do próprio imóvel?), quem executa, e o que a
   plataforma **não** faz.
6. Se o comprador for consumidor: CDC, direito à informação do CET e à quitação antecipada com
   redução proporcional dos juros (art. 52, §2º) — **isto o simulador precisa saber calcular.**

#### 4a-ter. A financeira própria, a aprovação de crédito e o percentual da intermediação (dono, 14/08)

> "Essa parte não é pra colocar nada em efetivo — estamos fazendo apenas um **planejamento**.
> Ainda teria a questão de fazer uma **aprovação de crédito** e outras funções nesse fluxo. Estou
> desenhando para, no momento certo, fazer a implantação. Estou avaliando **abrir um CNPJ de
> financeira** justamente para poder fazer essas cobranças, mantendo o fluxo pela plataforma —
> o **BidPro seria o moderador** e a **operação seria pela financeira**. A intenção é **ganhar um
> percentual da intermediação financeira**."

**Nada aqui vira código.** Esta seção existe para que a decisão, quando vier, já esteja tomada em
cima do mapa certo. Continua valendo: **não sou advogado, e isto não é parecer.**

##### O que a financeira muda no que está escrito em 4a-bis

| Ponto | Sem financeira (4a-bis) | Com financeira |
|---|---|---|
| Teto de juros | 🔴 1% a.m. capitalizado = **12,68% a.a.** contra o teto de **12%** da Lei de Usura | 🟢 **resolvido** — Súmula 596 do STF afasta o teto para instituição financeira, e a capitalização passa a ser admitida |
| Caminho do dinheiro | 🟠 recomendei o boleto **na conta do vendedor**, só para o dinheiro não nos tocar | 🟢 a recomendação **cai**: passar dinheiro de terceiro é exatamente o que uma IF é autorizada a fazer |
| Taxa administrativa | 🟢 serviço prestado ao **vendedor**, com NF e ISS | 🔴 **piora** — ver abaixo |

##### 🔴 A inversão que ninguém espera: virar financeira LIBERA o juro e TRAVA a taxa

A analogia do dono ("como funciona no financiamento bancário: o cliente recebe o valor corrigido e
a gente recebe um percentual administrativo em cima") tem um problema que só aparece **depois** de
virar banco: instituição financeira **não pode cobrar de pessoa física a tarifa que quiser**. A
lista de tarifas é **taxativa** (Res. CMN 3.919/2010), e a antiga TAC — Taxa de Abertura de
Crédito, que é literalmente "percentual administrativo em cima" — foi **proibida** (Res. CMN
3.518/2007) e a proibição confirmada pelo **STJ em recurso repetitivo** (REsp 1.251.331), com
devolução do que foi cobrado.

O paradoxo, então:

> **Hoje**, sem ser financeira, a taxa administrativa é fácil (serviço ao vendedor) e o juro é
> difícil (teto de 12%). **Como financeira**, o juro fica fácil e a taxa administrativa
> — cobrada do comprador PF — fica difícil.

Isso não mata a ideia; **muda de onde sai a receita**. As três origens legítimas do "percentual da
intermediação", em ordem de solidez:

1. **Spread** — a financeira empresta a X% e capta/remunera o investidor a Y%; a diferença é a
   receita. É o modelo bancário de verdade, e o único que **não depende de tarifa nenhuma**.
2. **Serviço ao VENDEDOR** — administração do recebível, correção, cobrança, prestação de contas.
   É o que já está desenhado em 4a-bis e continua valendo **com ou sem** financeira.
3. **Comissão da instituição** — se a IF for de terceiro, a BidPro é **correspondente** e recebe
   dela, não do cliente (ver a tabela seguinte).

O que **não** funciona: um percentual administrativo cobrado do comprador PF dentro da operação
de crédito. É esse desenho específico que a Res. 3.919 e o repetitivo do STJ bloqueiam.

##### As quatro figuras possíveis — e só uma exige milhões

"Abrir um CNPJ de financeira" tem quatro leituras muito diferentes de custo. **Financeira** com
nome e sobrenome é **SCFI** (Sociedade de Crédito, Financiamento e Investimento), e é a mais cara
das quatro:

| Figura | Autorização BCB | Capital mínimo | O que pode | Como a BidPro ganha |
|---|---|---|---|---|
| **Correspondente bancário** (Res. CMN 4.935/2021) | **não precisa** — quem responde é a instituição contratante | **zero** | originar, cadastrar, receber e encaminhar propostas para uma IF parceira | **comissão paga pela IF** — e é a única remuneração admitida (não pode cobrar do cliente) |
| **SEP** — Sociedade de Empréstimo entre Pessoas (Res. CMN 4.656/2018) | sim | **R$ 1 milhão** | conectar credor e devedor em plataforma eletrônica, **sem emprestar dinheiro próprio** | **tarifa de intermediação** — é literalmente "BidPro moderador, ganhando percentual da intermediação" |
| **SCD** — Sociedade de Crédito Direto (Res. CMN 4.656/2018) | sim | **R$ 1 milhão** | emprestar **capital próprio** por plataforma eletrônica; ceder o crédito a FIDC/securitizadora | **juro/spread** — e o risco de crédito é dela |
| **SCFI / "financeira"** (Res. CMN 4.970/2021 e anteriores) | sim, processo completo | **na casa dos milhões** (confirmar a faixa vigente com o BCB) | financiamento amplo, captação via LF/RDB, funding institucional | spread + carteira |

> **A figura que descreve exatamente a frase do dono é a SEP**, não a SCFI: moderador que conecta
> quem tem o recebível a quem paga, ganhando percentual da intermediação, **sem** pôr capital
> próprio nem assumir o calote. A SCFI só é necessária se a intenção for **emprestar dinheiro
> nosso** — e aí a pergunta deixa de ser jurídica e vira de caixa.

**E há um caminho antes de todos:** enquanto a operação for **eventual**, a venda a prazo é do
vendedor e o recebível pode ser **cedido** (cessão de crédito civil) sem instituição nenhuma. O
que atrai a exigência de autorização é a **habitualidade e a profissionalidade** — fazer disso um
negócio recorrente. Ou seja: dá para provar o produto com 5, 10 operações antes de decidir a
figura. **Essa é a recomendação de sequência.**

##### O que "abrir um CNPJ de financeira" realmente pede

Não é abertura de empresa; é **processo de autorização**, e ele não termina no dia do alvará:

- **Fit & proper** dos controladores e administradores (idoneidade, comprovação de origem do
  patrimônio) — o BCB analisa pessoa por pessoa.
- **Capital integralizado** e mantido — não é caixa de giro, é requisito permanente.
- **PLD/FT** completo (Circular BCB 3.978/2020): política, KYC próprio, monitoramento, comunicação
  ao COAF. Isto é **estrutura de pessoas**, não um módulo.
- **Contabilidade COSIF**, auditoria independente, **ouvidoria** (Res. CMN 4.860/2020), SCR e
  reportes periódicos ao BCB.
- **Prazo realista:** meses a mais de um ano entre protocolo e autorização.

> Custo recorrente de conformidade é o item que mais surpreende: ele existe **mesmo com zero
> operação no mês**. Antes de decidir, o número que importa não é o capital mínimo — é o
> **custo fixo anual de estar autorizado** contra a receita que 24 parcelas de um lote geram.

##### 🟠 O conflito que ameaça o ativo principal

O produto inteiro se sustenta em uma coisa: **a análise da BidPro é isenta**. É o que faz o
relatório valer, e é o que o item 4c já protege ("informar, nunca aconselhar").

Se a mesma plataforma que diz "este lote vale a pena" também **ganha percentual do financiamento
da venda dele**, o incentivo passa a existir — e basta existir para contaminar. Duas travas para
desenhar desde já, antes de qualquer linha:

1. **Divulgação obrigatória** da remuneração na tela onde a proposta aparece. Não em termos: na
   tela.
2. **Separação dura**: nenhum dado do motor de crédito pode entrar no relatório, e nenhuma meta
   de originação pode alcançar quem gera análise. É candidato natural a **invariante em
   `qa_invariantes()`** — o rastro é verificável: relatório cujo conteúdo mudou depois de haver
   proposta de crédito no mesmo imóvel.

##### A aprovação de crédito — o fluxo que o dono apontou como faltante

Sem ela, "50% em 24×" é uma aposta feita com o dinheiro do vendedor. O desenho, em sete passos,
marcando o que **já existe** na base:

| # | Passo | O que usa hoje | O que falta |
|---|---|---|---|
| 1 | **Identificação** do comprador | KYC já existe: `usuario_docs`, `api/validar-selfie.js`, o gate do saque | reaproveitar como gate da proposta |
| 2 | **Consulta a bureau** (Serasa/Boa Vista/SPC) | — | contrato + **custo por consulta** (é despesa variável por proposta, entra no preço) |
| 3 | **Capacidade de pagamento** | — | renda declarada × comprometimento máximo; regra escrita, não critério de quem olha |
| 4 | **Garantia** | — | ver a armadilha de sequência, abaixo |
| 5 | **Decisão** | — | motor de regras + **política de crédito escrita**. Pela regra §2b do `CLAUDE.md`, a política vive em `regra_negocio` com `aplicada_por` — senão a auditoria acusa, que é o ponto |
| 6 | **Formalização** | módulo de contratos (`contratos_link`, assinatura eletrônica) | anexar o plano aprovado e, havendo garantia, o registro |
| 7 | **Registro da decisão** | — | **por que** aprovou ou negou, com data e versão da política. É o que se pede em auditoria e o que o cliente tem direito de saber |

**Três obrigações que nascem junto com o passo 2, e não depois:**

- **LGPD art. 20** — decisão automatizada que afeta interesses do titular dá direito a **revisão**.
  Motor automático exige caminho humano disponível, não como exceção.
- **Motivo da negativa** — negar crédito sem dizer por quê não se sustenta (CDC art. 43 e Lei do
  Cadastro Positivo 12.414/2011). O passo 7 existe também por isso.
- **Base legal para consultar bureau** — consentimento específico no fluxo, não enterrado no termo
  de uso. Cai bem no aceite único que acabamos de unificar no cadastro.

Esboço de dado (**planejamento, nenhuma migração escrita**): `credito_solicitacao` (proposta,
comprador, imóvel, valor, prazo) · `credito_analise` (consulta, score, capacidade, decisão,
motivo, política aplicada) · `credito_politica` (versionada — a decisão de ontem tem que continuar
explicável pela política de ontem).

##### A armadilha de sequência da garantia — específica de imóvel arrematado

A alienação fiduciária (Lei 9.514/1997) é o que torna 24× financiável sem assumir risco de verdade:
inadimplindo, retoma-se o bem. **Só que ela só existe depois de registrada no RI** — e não se dá em
garantia o que ainda não está no nome do devedor.

No nosso caso o imóvel vem de **arrematação**: entre a carta e o registro há prazo, custo (ITBI,
emolumentos) e, às vezes, disputa. Quer dizer que **existe uma janela em que o parcelamento já
começou e a garantia ainda não vale** — e é exatamente a janela em que a inadimplência inicial
acontece. É a mesma família de defeito do item 4a, armadilha 1: **o papel diz que está garantido
antes de estar**.

Saídas a considerar no desenho: exigir registro concluído como condição da liberação; sinal maior
enquanto a garantia não existe; ou seguro/fiança cobrindo só a janela.

##### A pergunta que decide tudo: quem come o calote?

| Se… | Então… |
|---|---|
| **o vendedor** assume | somos plataforma; capital ~zero; a receita é serviço/intermediação; é a SEP ou o correspondente |
| **nós** assumimos (antecipando ao vendedor) | vira operação de crédito de verdade: **funding** (capital próprio ou FIDC), provisão, cobrança, e a SCD/SCFI deixa de ser opção e vira requisito |

**Toda a conta de capital sai desta linha.** É a primeira coisa a responder — antes de figura
jurídica, antes de Inter, antes de contrato.

##### O que levar ao advogado / consultor de BCB (continuação da lista de 4a-bis)

7. Qual figura cabe na operação pretendida: **correspondente, SEP, SCD ou SCFI** — e a partir de
   qual volume a habitualidade exige autorização.
8. O "percentual da intermediação": **de quem** pode ser cobrado em cada figura, e como se
   documenta (tarifa da SEP × comissão de correspondente × serviço ao vendedor × spread).
9. Res. CMN 3.919/2010 e o repetitivo do STJ (REsp 1.251.331): confirmar que a taxa administrativa
   cobrada do comprador PF é inviável dentro de IF — e se muda algo sendo PJ.
10. **BidPro "moderadora" × financeira operadora do mesmo grupo**: partes relacionadas, conflito
    de interesse e o que precisa ser divulgado ao cliente.
11. Alienação fiduciária de imóvel arrematado: momento em que pode ser constituída e como cobrir
    a janela sem garantia.
12. Custo fixo anual de conformidade da figura escolhida — o número que decide se vale.

##### As decisões que faltam (somam-se às de 4a)

5. **Quem assume o risco de crédito** — a linha acima. Decide tudo.
6. **Financeira própria ou IF parceira** — o correspondente entrega quase a mesma experiência ao
   cliente por custo próximo de zero; a financeira própria só se paga com volume.
7. **Onde entra o "investidor"** — captação (a financeira remunera quem põe dinheiro) ou o próprio
   vendedor recebendo à vista pela cessão? São produtos diferentes.
8. **Volume mínimo que justifica** — quantas operações por mês pagam o custo fixo de estar
   autorizado? Sem esse número, a decisão é de gosto.

#### 4a-quater. Prazo longo, seguro, retomada — e o módulo como assinatura (dono, 14/08)

> "Pretendo colocar esse **módulo de contratos e o módulo de cobrança** com um **adicional cobrado
> do cliente mensalmente**, servindo tanto para **locação** quanto para **venda de patrimônio**.
> Isto ainda é planejamento — **não é para aparecer para nenhum cliente**.
> Operar como funciona um banco, só que arrematando o imóvel: o sinal abate, e a diferença
> parcela em **10, 20 anos** — os 24 meses foram só sugestão da compradora. **O valor é garantido
> porque foi arrematado muito mais em conta.** Precisaria de ponte com uma **seguradora** para
> quitar em caso de falecimento, e das medidas para **reencaminhar o imóvel a leilão** em caso de
> inadimplência."

##### São dois produtos, e misturá-los é o primeiro erro a evitar

| | **Módulo por assinatura** | **Crédito imobiliário próprio** |
|---|---|---|
| O que é | SaaS: contrato + cobrança recorrente + conciliação, mensalidade por contrato administrado | operação financeira de 10–20 anos |
| Capital | zero | alto, ou funding de terceiro |
| Regulador | nenhum (mas CRECI na locação — ver adiante) | BCB, e a figura de 4a-ter |
| Prazo até faturar | **semanas** — a máquina já existe | trimestres |
| Risco | churn | crédito, prazo, índice, jurídico |

**Recomendação de sequência: o módulo por assinatura sai primeiro, sozinho.** Ele usa a mesma
máquina que o crédito vai precisar (contrato assinado, régua de cobrança, conciliação, régua de
inadimplência), fatura sem capital nenhum, e produz a coisa que **qualquer investidor ou
securitizadora vai pedir depois**: histórico de adimplência medido em contratos reais. Construir
o crédito antes é pagar caro para descobrir o que a assinatura ensinaria de graça.

##### 🔴 Quando o prazo sobe, a taxa tem que CAIR — e é o contrário da intuição

Sobre R$ 225 mil financiados (metade de uma venda de R$ 450 mil), a 1% a.m.:

| Prazo | Parcela | Total pago | Múltiplo do emprestado |
|---|---|---|---|
| 24× | R$ 10.591 | R$ 254.197 | 1,13× |
| 120× (10 anos) | R$ 3.228 | R$ 387.372 | 1,72× |
| 240× (20 anos) | R$ 2.477 | R$ 594.587 | **2,64×** |

**E isso é sem IPCA nenhum.** Com IPCA por cima, o saldo ainda é multiplicado à parte: 4,5% a.a.
por 20 anos multiplica por **2,41×**.

O ponto não é o total nominal — é a taxa **real**. Correção monetária não é ganho; o ganho é o
juro. Então:

| | Juro real ao ano |
|---|---|
| Nossa proposta (1% a.m. capitalizado, IPCA à parte) | **12,68%** |
| Financiamento bancário típico (~10,5% a.a. nominal, inflação ~4,5%) | **≈ 5,7%** |

**Cobraríamos mais que o dobro do juro real de um banco, por 20 anos.** Em 24 meses isso passa
— é venda a prazo, e o comprador aceita pela conveniência. Em 240 meses é outro produto: é o
perfil exato de contrato que vira ação revisional, e o cliente vê o número no CET antes de
assinar. **1% a.m. é preço de prazo curto.** Se o prazo vai a 10 ou 20 anos, ou a taxa cai para
perto do real de mercado, ou o produto não fecha — nem comercial, nem juridicamente.

##### 🔴 A armadilha do saldo corrigido: amortização negativa

O desenho de 4a mencionava **parcela fixa pré-calculada com IPCA projetado**. Em 24 meses o erro
é pequeno. Em 240, esse desenho tem nome e história no Brasil:

> Se o **saldo devedor** é corrigido por um índice e a **parcela** por outro (ou por nenhum),
> chega o mês em que a correção do saldo supera a amortização embutida na parcela. **A pessoa
> paga e deve mais do que devia antes.** É o resíduo que o SFH acumulou nos anos 80 e que o FCVS
> teve que absorver.

Não é hipótese remota: com IPCA a 4,5% e prazo longo, é o comportamento **esperado** de parcela
fixa. É a mesma família dos defeitos que o `CLAUDE.md` cataloga — número com aparência de certo.
A regra a fixar no desenho: **parcela e saldo corrigidos pelo mesmo índice, na mesma data**, e o
simulador precisa exibir a evolução do saldo, não só a parcela. Se em algum mês o saldo sobe, o
plano está errado — e isso é candidato a **invariante**, não a revisão manual.

Some-se: **SAC ou Price**. O SFH/SFI usa SAC em prazo longo exatamente porque Price + correção +
240 meses é o cenário que gera a discussão de anatocismo. Decisão de produto, não de código.

##### A premissa do deságio — o que ela garante, e o que não

"O valor é garantido porque foi arrematado muito mais em conta" é a premissa que sustenta o
produto inteiro, e ela é **boa** — mas garante uma coisa específica:

- ✅ **Garante LTV baixo.** Se o custo de aquisição foi R$ 300 mil e o financiado é R$ 225 mil, a
  dívida está bem coberta pelo bem. É a melhor posição que um credor pode ter.
- ❌ **Não garante liquidez.** O deságio só vira dinheiro num evento de liquidação: consolidação,
  dois leilões, eventual desocupação. Isso tem prazo e custo.
- ❌ **Não garante que ele exista quando for preciso.** O risco é **correlacionado**: se a
  inadimplência vier de queda de mercado, o deságio encolhe exatamente no mês em que dependemos
  dele. É a lição de 2008 em uma linha.
- ⚠️ **O deságio protege NÓS, não o comprador.** Ele comprou a preço de mercado. Isso está certo,
  mas precisa estar dito — inclusive porque é o que responde "por que a plataforma financia?".

> **Vantagem que quase ninguém tem:** o **Índice BidPro** já mede deságio de arremate. Dá para
> **calcular** o deságio histórico e a sua dispersão por região e tipo, em vez de supor. Um
> originador de crédito normalmente compra esse dado; nós o produzimos. É argumento de funding.

##### O funding é o gargalo real — e ele responde à pergunta da receita

Crédito de 20 anos exige dinheiro de 20 anos. **E o vendedor não quer esperar 20 anos** — ele
quer o dinheiro. Alguém tem que pôr o principal na mesa hoje:

| Fonte | O que exige | Observação |
|---|---|---|
| **Capital próprio** | caixa parado por 240 meses | cada operação consome capital que só volta em 20 anos: não escala |
| **Cessão a banco/fundo** | recebível padronizado, com garantia registrada | o caminho mais curto |
| **CRI via securitizadora** (Lei 14.430/2022) | securitizadora + agente fiduciário + lastro | **feito sob medida** para recebível imobiliário de prazo longo |
| **FIDC** | volume, gestor e administrador habilitados, estrutura de cotas | faz sentido depois de escala |

> **A síntese que fecha o desenho de 4a-ter:** originar e **ceder** — em vez de carregar — é o que
> permite ganhar o percentual da intermediação **sem** imobilizar capital por 20 anos. A resposta
> do funding e a resposta da receita são a mesma resposta. E note: **nenhuma dessas fontes compra
> recebível sem alienação fiduciária registrada.** A garantia não vale só na inadimplência; ela é
> pré-requisito para o dinheiro existir.

##### 🟢 A retomada é a nossa casa — e é o ponto mais forte da ideia

A Lei 9.514/1997 já desenha exatamente o que o dono descreveu: inadimplindo, o devedor é intimado
a purgar a mora; não purgando, **consolida-se a propriedade** no fiduciário, que é obrigado a levar
o bem a **leilão extrajudicial** — primeiro pelo valor de avaliação do contrato, segundo pelo valor
da dívida. Não vendido no segundo, a **dívida se extingue** e o imóvel fica com o credor; havendo
sobra, ela é **do devedor**. (A constitucionalidade do rito extrajudicial foi reconhecida pelo STF
— confirmar a citação com o advogado.)

**O encaixe estratégico é raro:** o remédio do inadimplemento é literalmente o nosso negócio e o
nosso canal. Quem empresta não tem público de leilão; nós temos, com o acervo, a base e a
audiência. Isso reduz o custo e o prazo do pior cenário — que é onde crédito imobiliário ganha ou
perde dinheiro.

> ⚠️ **O contrapeso é de marca, e é sério.** Hoje a BidPro é quem *ajuda a comprar* em leilão.
> Retomar o imóvel de um cliente e releiloá-lo na nossa própria vitrine é uma posição diferente,
> e ela aparece no pior dia da vida da pessoa. Não é impeditivo — é decisão consciente, com
> política de cobrança escrita antes do primeiro contrato, não no primeiro atraso.

##### O seguro: são dois, e vêm com três regras

O que o dono pediu é o **prestamista / MIP** (morte e invalidez permanente), que quita o saldo. Em
financiamento imobiliário ele nunca anda sozinho: vem com o **DFI** (danos físicos ao imóvel) —
porque se a garantia pega fogo, não há garantia.

1. **Vender seguro é atividade habilitada.** Receber comissão exige **corretora registrada na
   SUSEP**, ou parceria em que a corretora/seguradora é quem vende. É uma linha de receita real,
   e tem porta de entrada.
2. **Venda casada é proibida** (CDC art. 39, I). Pode-se **exigir** o seguro; não se pode exigir
   que seja o *nosso*. Apólice equivalente de outra seguradora tem que ser aceita.
3. **O prêmio entra no CET** e tem que aparecer na simulação, mês a mês — ele encarece a parcela.

> **E há um limite que morde justamente o prazo longo:** prestamista encarece muito com a idade e
> tem teto de idade final. **Comprador de 55 anos + 20 anos de prazo pode simplesmente não ser
> segurável.** Ou seja, o prazo máximo não é decisão só nossa — a seguradora decide junto, por
> idade. Isso entra na política de crédito (passo 3 de 4a-ter), não no fim do fluxo.

##### O módulo por assinatura — locação e venda de patrimônio

**O que já existe:** módulo de contratos com assinatura eletrônica (`contratos_link`), recorrência
no Mercado Pago, o padrão de conciliação de webhook do Asaas/MP e o `honorarios-split.js` para
distribuição por percentual. **A máquina está construída; falta o produto em volta dela.**

**O que falta, e é pequeno:** régua de reajuste anual, régua de inadimplência (aviso → notificação
→ providência), repasse ao proprietário com extrato, e a mensalidade em si.

##### ✅ DECISÃO DO DONO (14/08): é software para o dono administrar o PATRIMÔNIO PRÓPRIO

> "A ideia é ser um software para administração de **imóveis próprios**. O dono pode locar e vender
> o seu imóvel e **não precisa de CRECI**. E ele pode contratar a plataforma para fazer isso."

**Está certo, e resolve a Decisão 11.** Quem vende ou aluga imóvel **seu** não exerce corretagem: a
Lei 6.530/1978 regula a **intermediação de negócio alheio**. Proprietário agindo em nome próprio
não intermedeia nada — e ferramenta que ele usa para isso é software, sem regulador nenhum.

O enquadramento ainda encaixa melhor do que parece: **o nosso cliente já é exatamente esse
proprietário.** Ele arremata para si, e o produto serve a pessoa que já está na base — não exige
conquistar imobiliária.

**A linha fica no "contratar a plataforma para fazer isso", e ela tem um lado de cada:**

| A plataforma faz… | Enquadramento |
|---|---|
| emitir contrato a partir dos dados que o dono informa, gerar boleto, cobrar, conciliar, avisar atraso, prestar contas, publicar o anúncio **em nome dele** | **execução administrativa** — apoio operacional, não intermediação |
| achar inquilino/comprador, mostrar o imóvel, negociar preço e condições, opinar sobre a comercialização | **intermediação** — é corretagem (CC art. 722 + Lei 6.530), e aí CRECI volta |

> 🔴 **O detalhe que decide, e é o mesmo item da precificação:** o que mais caracteriza corretagem
> não é o rótulo do contrato — é a **forma de remuneração**. Mensalidade fixa por imóvel
> administrado reforça "software/serviço administrativo". **Percentual sobre o negócio fechado é a
> definição econômica de comissão**, e atrai a caracterização de corretagem por mais que o
> contrato se chame outra coisa. Ou seja: a **Decisão 12 (fixo × percentual) não é comercial, é a
> principal prova do que a atividade é.**

**Consequência prática na seção 5 (portais), que muda o desenho técnico:** se o anúncio sai **em
nome do proprietário**, o feed precisa publicar **por conta de cada dono** — credencial por
cliente, anunciante = ele. Uma conta profissional única da BidPro publicando imóvel de terceiro em
volume é justamente o perfil a que os portais pedem CRECI. **Multi-conta é mais trabalho que
conta única, e é a diferença entre software e corretagem.** Melhor descobrir agora, no papel.

**Os dois pontos que continuam de pé:**

1. **Repassar aluguel é dinheiro de terceiro outra vez** — a armadilha B de 4a-bis, idêntica, e
   agora com um segundo motivo: reter dinheiro de aluguel alheio é o que mais se parece com
   **administradora**. Boleto na conta do proprietário mantém o produto como software; cair na
   nossa e repassar é custódia, e enfraquece o enquadramento que a decisão acima acabou de
   estabelecer. **As duas razões apontam para o mesmo desenho.**
2. **Lei do Inquilinato (8.245/1991)**: periodicidade mínima anual de reajuste, formas de garantia
   (fiança, caução, seguro-fiança) e o rito de despejo. A régua tem que nascer sabendo disso — o
   fato de o dono ser o locador não afasta a lei, só afasta o CRECI.

**Precificação (Decisão 12, agora com peso jurídico):** valor fixo por imóvel administrado ×
percentual sobre o negócio. Na venda de patrimônio, a mensalidade convive com os 0,5% de 4a —
e vale notar que **os 0,5% sobre a venda são exatamente a forma de remuneração que a tabela acima
sinaliza.** Se a plataforma só executa o que o dono decidiu, defensável; se também aproxima o
comprador, é o ponto a levar ao advogado (item 17).

> ⚠️ **Um alerta que é do CLIENTE, não nosso — e que este produto torna mais provável:** vender
> imóvel próprio é ganho de capital; **comprar e revender com habitualidade** pode ser tratado
> pela Receita como atividade empresarial, com tributação inteiramente diferente. O "Meus
> Arrematados" incentiva exatamente a repetição. Vale a mesma disciplina do item 4c: **informar,
> nunca aconselhar** — e mandar para o contador.

##### O que levar ao advogado (continuação)

13. **Prazo de 10–20 anos**: até onde uma venda a prazo com alienação fiduciária vai sem ser
    operação privativa de instituição financeira.
14. **Índice e forma de amortização** em contrato longo: IPCA × IGP-M × TR, SAC × Price, e o que
    o contrato precisa dizer sobre amortização negativa.
15. **Rito da Lei 9.514** aplicado a imóvel de origem em arrematação — e a nossa posição de
    releiloar na própria plataforma (conflito? divulgação?).
16. **Seguro**: figura para receber comissão (corretora SUSEP própria × parceria) e redação que
    exige o seguro sem configurar venda casada.
17. **Administração de patrimônio próprio × corretagem**: até onde a plataforma pode **executar**
    pelo proprietário (contrato, cobrança, anúncio em nome dele) sem virar intermediação — e se
    remuneração percentual sobre o negócio contamina esse enquadramento.
18. **Cessão do recebível** a securitizadora/FIDC: o que o contrato de origem precisa conter desde
    a primeira via para ser cedível depois (é mais barato nascer cedível do que virar).

##### Decisões que faltam (somam-se às de 4a e 4a-ter)

9. **Prazo máximo do produto** — e a taxa correspondente. 24 meses e 240 meses não são o mesmo
   produto com outro número de parcelas.
10. **Parcela e saldo pelo mesmo índice** (sim, provavelmente) e **SAC × Price**.
11. ~~**Quem administra a locação**~~ — ✅ **decidida em 14/08**: software para o dono administrar
    o **patrimônio próprio**. Sem CRECI, porque não há negócio alheio. O que resta é a fronteira
    execução × intermediação, na tabela acima.
12. **Mensalidade fixa × percentual**, e como ela convive com os 0,5% da venda. **Subiu de
    importância:** é a principal evidência de que a atividade é serviço e não corretagem.
13. **Idade máxima e prazo máximo por idade**, herdados da regra da seguradora.

### 4b. Rateio entre sócios
Arremate em conjunto é comum. Hoje o portfólio é de um `user_id` só.

### 4c. Fechamento fiscal da venda
Ganho de capital, custos dedutíveis, DARF. É o que fecha a operação de verdade — e é assunto
sensível: **informar, nunca aconselhar**, com a mesma disciplina dos relatórios.

---

## 5. Divulgação nos portais (caso Rafael) — o que é possível hoje

**Pedido:** permitir que a plataforma divulgue o imóvel arrematado nos principais portais, para
ganharmos em cima do posicionamento de venda.

**O que há hoje:** nada. Não existe integração de saída com portal nenhum — todo o pipeline é de
**entrada** (scrapers lendo leiloeiro). Publicar anúncio é a direção contrária.

> **Direção do dono (14/08):** "conectar com a OLX, por exemplo, ou outro portal, e ver como
> podemos monetizar."

**Como funciona esse mercado, na prática:**

| Caminho | O que exige | Prazo realista |
|---|---|---|
| **Feed XML / integração de parceiro** (OLX, ZAP, VivaReal) | conta de anunciante **profissional** + contrato + homologação do feed. A OLX exige plano de imobiliária/corretor para volume; a ZAP/VivaReal (Grupo OLX) trabalha com integradores | semanas, e a parte lenta é **comercial**, não técnica |
| **Vitrine própria** (`/venda/:id` no nosso domínio) | só nosso código; indexável como as 33 mil páginas de acervo | **dias** |

O **feed é o mesmo dado noutro formato**: um XML gerado do banco, exatamente como já fazemos com
o `sitemap-leiloes.xml`. Tecnicamente é o item mais barato do plano. O que custa é o contrato e a
figura de quem anuncia.

**Onde está o dinheiro — quatro modelos, e eles não são exclusivos:**

| Modelo | Como cobra | Observação |
|---|---|---|
| **Comissão de venda** | % sobre a venda concretizada | é o maior ticket e o que mais exige: intermediação imobiliária no Brasil é atividade **regulada (CRECI)** |
| **Taxa de anúncio** | fixo por imóvel/mês para publicar nos portais | previsível, não depende de vender, e não configura corretagem |
| **Destaque pago** | posição privilegiada na vitrine própria | receita pequena, custo zero |
| **Originação da venda parcelada** | os 0,5% do item 4a | **é o que já está desenhado**, e não passa por portal nenhum |

**Recomendação: começar pela vitrine própria + feed**> ⚠️ **Antes do código, três definições suas:** (a) a BidPro anuncia como **intermediária** — e
> aí entra CRECI e responsabilidade de corretagem —, ou hospeda anúncio **do cliente**?
> (b) qual a nossa remuneração: comissão sobre a venda, taxa de anúncio, ou destaque pago?
> (c) o cliente autoriza a divulgação por escrito? Isso é cláusula, não checkbox.
> **Nenhuma linha de código deve ser escrita antes destas três.**
>
> ✅ **(a) respondida em 14/08** (ver 4a-quater): anúncio **do cliente**, publicado em nome dele.
> **Isso muda o desenho do feed**: em vez de uma conta profissional única da BidPro, é
> **credencial por proprietário**, com ele como anunciante. Dá mais trabalho — e é exatamente a
> diferença entre software e corretagem. Conta única publicando imóvel de terceiro em volume é o
> perfil a que o portal pede CRECI.

---

## 6. Situação do Rafael, hoje

Como o dono relatou: o cliente **contratou outra assessoria**, a **carta de arrematação saiu** e
ainda não subiu à plataforma; e há uma **compradora** com proposta de 50% + 50% em 24×.

O que a plataforma precisa suportar para não perder este caso:

1. **Subir a carta de arrematação** — o tipo `carta_arrematacao` já existe no `upload-anexo.js`.
   Funciona hoje, e é o primeiro passo. **Não depende de nada deste plano.**
2. **Registrar a proposta parcelada** — depende de 4a. É o item mais urgente.
3. **Anunciar para venda** — depende da seção 5, que depende das suas três definições.
4. **Assessoria de terceiro:** o caso mostra que o arrematado precisa existir no portfólio do
   cliente **mesmo quando a assessoria não é nossa**. Reforça a Decisão 1: `arrematacao_id`
   NULO tem que ser um estado de primeira classe, não uma exceção.

---

## 7. Ordem sugerida

| # | O quê | Depende de | Por que nesta ordem |
|---|---|---|---|
| 1 | Fluxo de arremate (Decisão 3) | sua resposta sobre o DELETE | sem entrada, o resto é vitrine |
| 2 | `situacao` previsto/realizado + card do realizado (2 e 4a mínimo) | — | impede o lucro falso; é pequeno |
| 3 | `arrematados.arrematacao_id` + `imovel_id` UUID (Decisão 1) | — | destrava documentos e evita fazer tudo duas vezes |
| 4 | **Simulador** de parcelamento (sem cobrança) | 2 | responde "essa proposta é boa?" — a pergunta do Rafael hoje. Barato, não move dinheiro e não depende de advogado |
| 4.5 | **Parecer jurídico** sobre as listas de 4a-bis e 4a-ter | — | a taxa de 1% a.m. capitalizado entre particulares excede o teto da Lei de Usura; decidir isso ANTES de emitir o primeiro boleto |
| 4.6 | **Decidir quem come o calote** (4a-ter) | — | é a linha de onde sai toda a conta de capital. Vem antes de figura jurídica, de Inter e de contrato — não custa nada e destrava as outras |
| 4.7 | **Módulo de contratos + cobrança como assinatura** (4a-quater) | **nada** — o CRECI saiu do caminho com a decisão de 14/08 (patrimônio próprio) | **o item de melhor relação custo-benefício do plano inteiro**: a máquina já existe, fatura sem capital, sem regulador financeiro, e produz o histórico de adimplência que qualquer funding vai exigir depois. **É o único item grande do plano que não depende de decisão nenhuma para começar** |
| 5 | Contrato + cobrança (Inter, boleto na conta do vendedor) + conciliação | 4 + 4.5 + 4.6 | vira produto financeiro; só depois do simulador e do parecer |
| 5.5 | **Aprovação de crédito** (os 7 passos de 4a-ter) | 5 | sem ela, 24× é aposta com o dinheiro do vendedor. Os passos 1 e 6 já existem (KYC, contratos); o custo novo é bureau + política escrita |
| 6 | Vitrine `/venda/:id` | suas 3 definições da seção 5 | receita nova, sem depender de terceiro |
| 7 | Feed XML para portais (OLX etc.) | 6 + contrato comercial | o XML é barato; o contrato é o caminho crítico |
| 8 | Rateio entre sócios · fechamento fiscal | — | valor real, sem urgência |

**O que já dá para fazer hoje, sem decisão nenhuma:** subir a carta de arrematação do lote do
Rafael pela tela de Arrematados. O tipo existe e o upload funciona.

> **Trilha paralela, longa e que não bloqueia nada:** a decisão da figura jurídica de 4a-ter
> (correspondente · SEP · SCD · SCFI). Autorização do BCB leva meses; a conversa vale começar
> cedo. Mas **as 5 ou 10 primeiras operações não dependem dela** — venda a prazo do vendedor,
> com cessão de crédito, não exige figura nenhuma enquanto for eventual. É assim que se prova o
> produto antes de pagar por estrutura.
