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

### 4a. Parcelamento com correção (o caso concreto de hoje)

A compradora do lote do Rafael propôs **50% à vista + 50% em 24× com IPCA + 1% a.m.**

Hoje isso **não cabe** na estrutura: `arrematado_lancamentos` tem um valor e uma data — uma
linha por evento. Registrar 24 parcelas manualmente é inviável, e sem a correção o total fica
errado. Pior: como o lançamento não distingue **previsto** de **realizado**, um plano de 24 meses
entraria como se já tivesse entrado no caixa, e o "lucro" da operação sairia inflado no dia da
assinatura.

*O que fazer:*
- `arrematado_lancamentos.situacao` (`previsto` | `realizado`) — e o saldo passa a somar **só
  realizado**, com o previsto exibido à parte, como fluxo futuro. É a mudança mínima e é a que
  impede o lucro falso.
- Tabela de **plano de pagamento** (`arrematado_parcelas`): entrada, nº de parcelas, índice de
  correção (IPCA/IGPM/nenhum), juros a.m., data da primeira. Gera as parcelas como lançamentos
  `previsto`; ao receber, vira `realizado` com o valor efetivo.
- **A correção precisa de dado externo.** IPCA vem do IBGE — e nós **já ingerimos IBGE**
  (`socio_fontes`). Reaproveitar a mesma trilha; sem índice publicado no mês, a parcela mostra o
  valor **projetado pela última taxa conhecida**, declarado como projeção (nunca como fato).
- **Valor presente:** 50% em 24× com IPCA + 1% a.m. **não é** 50% do preço. A tela precisa dizer
  quanto vale hoje esse recebível, senão o vendedor compara uma proposta à vista com uma
  parcelada como se fossem o mesmo número.

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

**Como funciona esse mercado, na prática:**

| Caminho | O que exige | Prazo realista |
|---|---|---|
| **API de parceiro (OLX/ZAP/VivaReal)** | contrato comercial + CRECI da imobiliária anunciante + homologação | semanas a meses, e **depende de decisão comercial, não de código** |
| **XML/feed padrão do mercado** | gerar um feed com os imóveis e cadastrá-lo no portal | é o caminho barato: o feed é HTML/XML gerado do banco, como já fazemos no sitemap |
| **Vitrine própria** (`/venda/:id` no nosso domínio) | só nosso código; indexável pelo Google como as 33 mil páginas de acervo | **dias** |

**Recomendação: começar pela vitrine própria + feed**, nesta ordem. A vitrine não depende de
ninguém, reaproveita `api/publico.js` (que acabou de entrar no código da marca) e já nasce
indexável — e o feed XML é o mesmo dado noutro formato, pronto para quando houver contrato.

> ⚠️ **Antes do código, três definições suas:** (a) a BidPro anuncia como **intermediária** — e
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
| 4 | Plano de parcelas + IPCA + valor presente (4a completo) | 2 | é o caso do Rafael |
| 5 | Vitrine `/venda/:id` | suas 3 definições da seção 5 | receita nova |
| 6 | Feed XML para portais | 5 + contrato comercial | quando houver acordo |
| 7 | Rateio entre sócios · fechamento fiscal | — | valor real, sem urgência |

**O que já dá para fazer hoje, sem decisão nenhuma:** subir a carta de arrematação do lote do
Rafael pela tela de Arrematados. O tipo existe e o upload funciona.
