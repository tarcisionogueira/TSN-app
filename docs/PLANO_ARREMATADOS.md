# Plano — Meus Arrematados (14/08/2026)

> Aberto a pedido do dono. **Ponto de partida que muda tudo: a maior parte disto já existe.**
> `src/pages/Arrematados.jsx` (719 linhas), tabelas `arrematados` e `arrematado_lancamentos`,
> tipos de documento de arremate já no `upload-anexo.js`, e o registro de revenda alimentando o
> Índice BidPro. **O acervo tem 2 arrematados e 2 lançamentos.** O plano não é construir a
> funcionalidade — é descobrir por que ela não é usada, fechar as pontas e cobrir dois casos
> reais que o dono trouxe do cliente do Rafael.

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
| 4.5 | **Parecer jurídico** sobre a lista de 4a-bis | — | a taxa de 1% a.m. capitalizado entre particulares excede o teto da Lei de Usura; decidir isso ANTES de emitir o primeiro boleto |
| 5 | Contrato + cobrança (Inter, boleto na conta do vendedor) + conciliação | 4 + 4.5 | vira produto financeiro; só depois do simulador e do parecer |
| 6 | Vitrine `/venda/:id` | suas 3 definições da seção 5 | receita nova, sem depender de terceiro |
| 7 | Feed XML para portais (OLX etc.) | 6 + contrato comercial | o XML é barato; o contrato é o caminho crítico |
| 8 | Rateio entre sócios · fechamento fiscal | — | valor real, sem urgência |

**O que já dá para fazer hoje, sem decisão nenhuma:** subir a carta de arrematação do lote do
Rafael pela tela de Arrematados. O tipo existe e o upload funciona.
