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
| 4 | **Simulador** de parcelamento (sem cobrança) | 2 | responde "essa proposta é boa?" — a pergunta do Rafael hoje. Barato e não move dinheiro |
| 5 | Contrato + cobrança MP + conciliação | 4 + as 4 decisões de 4a | vira produto financeiro; só depois do simulador |
| 6 | Vitrine `/venda/:id` | suas 3 definições da seção 5 | receita nova, sem depender de terceiro |
| 7 | Feed XML para portais (OLX etc.) | 6 + contrato comercial | o XML é barato; o contrato é o caminho crítico |
| 8 | Rateio entre sócios · fechamento fiscal | — | valor real, sem urgência |

**O que já dá para fazer hoje, sem decisão nenhuma:** subir a carta de arrematação do lote do
Rafael pela tela de Arrematados. O tipo existe e o upload funciona.
