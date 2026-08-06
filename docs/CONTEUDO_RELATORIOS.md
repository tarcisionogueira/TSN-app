# 📋 O que cada relatório apresenta — e de onde vem cada informação

> Inventário campo a campo dos 3 relatórios e do Índice, com a PROCEDÊNCIA de cada dado.
> Levantado do código em 06/08/2026. Serve para: material de vendas, treinamento do time,
> resposta a cliente que pergunta "de onde veio esse número" e auditoria interna.

## Legenda de origem

| Marca | Significado |
|---|---|
| 🌐 **Busca web** | Pesquisa ao vivo na internet (Gemini grounding; Claude web_search como reserva). Custa por chamada. |
| 📄 **Documento** | Leitura do edital/matrícula do próprio lote. Determinística (regex sobre o PDF, custo zero) ou por IA de visão. |
| 🏦 **Base própria** | O que a plataforma já capturou: `indice_amostra`, `indice_amostras`, `cidade_indicadores`. Custo zero. |
| 🔢 **Cálculo** | Conta determinística feita pelo sistema. Sem IA, reproduzível. |
| 🤖 **IA (redação)** | Texto escrito pela IA a partir dos dados acima. Não inventa número; interpreta. |
| 🏛️ **Fonte pública** | Órgão oficial (IBGE, DataJud/CNJ, DJEN, Receita/PGFN/FGTS). |
| 🕷️ **Acervo do leiloeiro** | O que o scraper capturou da página do lote (`imoveis_leilao`). |
| ✍️ **Informado pelo cliente** | Preenchido na tela pelo próprio usuário. |

---

## 1. Relatório Mercadológico + Viabilidade Financeira

### 1.1 Identificação do imóvel
- **Tipo, endereço, cidade/UF, bairro** — 🕷️ acervo; quando o card vem genérico, 📄 documento (o edital/matrícula completa o endereço) e o bairro é derivado do título.
- **Área privativa / de terreno** — 📄 **matrícula** tem prioridade sobre o anúncio. Divergência acima de 10% vira **aviso explícito** no relatório (anúncio × matrícula, com o percentual).
- **Nº da matrícula** — 📄 matrícula (e é persistido no acervo).
- **Nome do condomínio / empreendimento** — 📄 edital ou matrícula. Nenhum leiloeiro publica esse campo; quem o tem é o documento.
- **Lance mínimo, avaliação, datas das praças** — 🕷️ acervo, completado por 📄 edital quando o leiloeiro não publica.

### 1.2 Comparáveis de mercado
- **Nível 1** (mesmo condomínio/rua, ~250 m) e **Nível 2** (~1 km) — 🌐 busca web **ou** 🏦 base própria (modo base, quando a praça já tem ≥12 amostras em nível fino). Cada amostra traz **valor, área, R$/m², bairro, fonte, mês de referência** e, nas novas, **link**.
- **Preço médio/mín/máx por m²** — 🔢 mediana e extremos sobre os comparáveis do nível.
- **Locações comparáveis** — mesma origem. Amostra sem metragem é **descartada** (sem área não vira R$/m²).
- **Aluguel médio** — 🔢 **mediana** das locações; com menos de 3 amostras, fica **sem número** (regra: não publicar valor infundado).
- **Valor estimado do imóvel** — 🔢 pelo método do TIPO: m² privativo × área (residencial/comercial/industrial), m² de terreno × área (terreno), R$/hectare (rural), unidade (vaga/box). Margem conservadora de 10% para revenda.
- **Padrão do imóvel** (popular/médio/médio-alto/alto/luxo) — 🤖 classificado a partir dos comparáveis e do condomínio.
- **Origem declarada** — o relatório diz se os comparáveis vieram de busca ao vivo, da base própria ou do Índice BidPro. Nunca omite isso.

### 1.3 Referências externas de mercado
- **FipeZAP** (R$/m² da localidade + valorização 12m) — 🌐 busca web.
- **Zoneamento / uso permitido** — 🌐 busca web; sem base, vem "não encontrado" com o caminho para obter.
- **Perfil da região** (tier, atratividades, fragilidades, turismo sazonal) — 🌐 busca web.
- **Segurança pública** (nível, indicadores, tendência, período) — 🌐 busca web, com fonte e período citados.
- **Outros bairros da cidade** (mesmo tipo) — 🌐 busca web. Alimenta o Índice, não o valor do imóvel-alvo.

### 1.4 Base própria BidPro (o que só nós temos)
- **Índice BidPro** — venda e locação R$/m² da microrregião, com o nível (rua/bairro/cidade) — 🏦.
- **Valorização BidPro** — curva de R$/m² por ano da microrregião, com variação no período e a.a. — 🏦.
- **Composição temporal** — quantitativo por períodos de 4 meses, valor recente ou projetado a hoje — 🏦.
- **Aviso de frescor** — sinaliza quando não há anúncio recente na região — 🔢.
- **Corpus da região** e **calibração por arremates reais** (previsto × realizado) — 🏦, entram como lição no parecer.

### 1.5 Demografia e pressão habitacional
- **População, crescimento, domicílios, vagos, moradores/domicílio, densidade, nascimentos, saldo de emprego** — 🏛️ IBGE (base própria alimentada do IBGE), cada número com **fonte e ano**.
- **Déficit habitacional oficial** — 🏛️ Fundação João Pinheiro. Só aparece se o número oficial existir para a cidade.
- **Leitura BidPro de pressão habitacional** — 🔢 leitura NOSSA derivada do Censo, comparada aos tercis do país, e **rotulada como nossa** (nunca apresentada como FJP).

### 1.6 Condições do leilão (lidas no documento)
- **Praças** (nº, valor, data) — 📄 edital; completa as colunas vazias do acervo, nunca sobrescreve o que o leiloeiro publicou.
- **Praça de referência** — 🔢 a mais descontada entre as **futuras**; é a que sustenta as projeções.
- **Forma de pagamento (texto original do edital)** — 📄, citado sem paráfrase.
- **Regras estruturadas**: à vista, nº de parcelas, sinal, caução, **comissão do leiloeiro**, prazo de pagamento, financiável, FGTS — 📄. Edital que não abre herda o **consenso aprendido daquele leiloeiro × modalidade**, sempre rotulado como estimativa.
- **Custos declarados**: taxa administrativa (% e valor fixo), IPTU (mensal/anual), condomínio mensal — 📄. Entram nos campos da viabilidade.
- **Débitos em aberto** (IPTU/condomínio) — 📄, em bloco **separado**: não são despesa mensal, e quem os assume depende de cláusula do edital.
- **Avaliação do edital** — 📄, usada quando o card não tem avaliação (com travas de sanidade).

### 1.7 Viabilidade financeira (tudo 🔢, sem IA)
- Lance sem disputa e **teto de lance** que preserva o piso de lucro.
- Taxa do leiloeiro, honorários, ITBI/registro, taxa administrativa, despesas administrativas, débitos assumidos, manutenção, laudêmio, foro.
- Carrego mensal (IPTU + condomínio) × prazo de venda.
- Capital mobilizado, valor de referência de saída, comissão de venda, IR sobre ganho de capital, receita líquida, **lucro, ROI/ROE**.
- Cenário **à vista** e **parcelado** (SAC ou PRICE), com tabela de amortização, sinal, parcelas pagas, saldo devedor.
- **VPL, TIR, payback (nominal e descontado), múltiplo (MOIC)**.
- **Fluxo de caixa mensal** e projeção de rentabilidade por locação (yield mensal/anual).
- Entradas: ✍️ informadas pelo cliente + 📄 sobrescritas pelo edital quando ele declara (comissão é o caso em que o documento sempre prevalece).

### 1.8 Leituras e textos
- **Adequação por objetivo** (revenda / locação / temporada) — 🔢 a partir de desconto, yield e turismo da cidade; 🤖 defendida no parecer.
- **Parecer executivo** — 🤖 sobre todos os blocos acima, com foco no **perfil do investidor** (revenda, locação, uso próprio, incorporação). Cita fonte e ano de cada número que usa.
- **Alertas**: divergência de área, incoerência entre R$/m² e avaliação, mercado não estimado, comparáveis vindos da base.

---

## 2. Análise Documental + Processo (Jurídico)

### 2.1 Extração dos documentos — 📄 por IA de visão
Nº da matrícula, cartório/serventia e comarca, áreas (privativa/total/terreno), nº do edital,
nº do processo (padrão CNJ), **nome e CPF/CNPJ do executado**, data de consolidação (alienação
fiduciária), indisponibilidade/penhora, nome e CNPJ do condomínio, endereço/bairro/município/UF/CEP
do imóvel, origem (judicial/extrajudicial), data do leilão, **ocupação** e responsável pela
desocupação, débitos discriminados (tipo, valor, responsável, se consta na doc), responsabilidade
por débitos, forma de pagamento, comissão do leiloeiro, taxa administrativa e despesas.

### 2.2 Riscos e parecer
- **Riscos** com categoria, descrição, **severidade** (bloqueante/alerta/informativo) e se **consta na documentação** — 🤖 sobre 📄.
- **Parecer jurídico em 6 seções** — 🤖, em formato de checklist item a item, linguagem para leigo:
  1. Identificação básica (processo, vara, partes, matrícula, edital)
  2. Análise das regras do edital (pagamento, comissão, ocupação, venda ad corpus, responsabilidade por débitos)
  3. Análise da propriedade pela matrícula (titularidade, penhoras concorrentes, hipoteca/alienação fiduciária, gravames, descrição)
  4. Análise processual e risco de anulação (citação, intimações, recursos, efeito suspensivo, preço vil, art. 891 CPC)
  5. Custos e responsabilidades (IPTU, condomínio, hierarquia de pagamento, custo e prazo de desocupação)
  6. Parecer final (red flags, nível de risco, ações pós-arremate, recomendação)
- **Lacunas / diligências pendentes** — 🤖, com onde confirmar cada uma.
- **Nível de risco** (verde/amarelo/vermelho) — 🤖 + 🏛️ CNJ.

### 2.3 Raio-X jurídico — 🤖 sobre 📄
Cadeia dominial (atos, datas, partes), certidões recomendadas (nome, órgão, se é online, motivo),
risco de fraude à execução, detalhe da ocupação (tipo, direitos, procedimento, prazo e custo de
desocupação), direito de preferência, débitos separados em **propter rem × pessoais** com total
assumido pelo arrematante, e cronograma do leilão (praças, prazo de pagamento, prazo de embargos).

### 2.4 Consultas automáticas — 🏛️ fontes públicas
- **Processos no CNJ/DataJud** — por número **ou pelo nome da parte**; traz total, tribunais consultados e até 12 processos.
- **Andamentos (DJEN / Comunica CNJ)**.
- **Certidões fiscais** — Receita Federal, PGFN e FGTS, com link do comprovante.
- *(CNDT, CNIB e CENPROT ficaram fora do automático: exigem portal pago/captcha — são diligência do jurídico.)*

### 2.5 Antifraude e checklist — 🔢 determinístico
- Procedência do lote (leiloeiro reconhecido e monitorado pela plataforma, plataforma técnica).
- Modalidade (judicial/extrajudicial/indefinida).
- **Dígito verificador do número CNJ** e confirmação do processo no DataJud.
- Verificação no site oficial do leiloeiro para extrajudicial.
- **Checklist de 5 itens** com status (feito / pendente / diligência / não se aplica) e detalhe.
- **Documentos efetivamente lidos** (rótulo, tipo, se veio do cache).
- **Divergências de identidade** — quando os documentos descrevem outro imóvel (não é risco jurídico: é aviso próprio, com opção de regerar).

---

## 3. Laudo de Viabilidade (Parecer Final)

**Não reprocessa nenhuma fonte paga.** Lê os dois relatórios anteriores e sintetiza — 🤖 sobre 🏦.

- **Veredito**: aprovado / condicional / reprovado.
- **Resumo executivo** em 2–3 frases para leigo.
- **Pontos fortes** (3 a 5) e **pontos de atenção** (3 a 5), cruzando mercado × jurídico, cada um com o número concreto e a origem.
- **Condições objetivas** para o "condicional" e **diligências pendentes**.
- **Resumo da operação** (4 a 6 tópicos): o que se arremata, mercado × aquisição e desconto real, custos assumidos, investimento total, retorno esperado, **teto de lance**.
- **Controle de qualidade**: confiança de cada relatório (0–100), **contradições entre eles**, lacunas críticas e se recomenda revisão. Veredito "aprovado" com recomendação de revisão é rebaixado automaticamente para "condicional" — 🔢.
- **Parecer de defesa em 6 seções**, incluindo o resumo de cada relatório anterior.
- **Aprendizado**: correções que analistas fizeram em vereditos anteriores voltam ao prompt.

---

## 4. Índice BidPro

Consulta **gratuita e sem IA** (só leitura da base). A **geração** (que pesquisa) é dos planos pagos.

- **Venda R$/m²** e **locação R$/m²·mês** da região — 🏦.
- **Nível do recorte**: rua/condomínio (~250 m), microrregião (~1 km) ou cidade — e o rótulo é sempre exibido.
- **Nº de amostras** (venda + locação).
- **Bandas de padrão**: popular (p25), médio (p50), alto (p75) — 🔢 percentis da cidade.
- **Aluguel indisponível**: quando não há locação medida, o campo vem **vazio com o motivo** ("não localizamos anúncios"; em terreno, "não se aluga"). Nunca há estimativa por regra de bolso.
- **Procedência do aluguel** quando ele veio de recorte mais largo (selo **MEDIDO NA CIDADE**).
- **Valorização por ano** (mediana de R$/m² de venda) — 🏦.
- **Composição por período** de 4 meses: total de anúncios, quantos são recentes, se o valor foi projetado a hoje e a taxa a.a. — 🏦 + 🔢.
- **Aviso de frescor** quando não há amostra recente.
- **Mapa por bairro** da cidade (classificação por região) na consulta ampla.
- **Amostras** com valor, área, tipo, bairro, data e — nas novas — **link do anúncio**.

**De onde a base se enche:** cada pesquisa do Índice e cada relatório mercadológico gravam as
amostras que colheram. Uma pesquisa = um tipo (apartamento, casa, terreno ou comercial).

---

## Regras que valem em todos

1. **Número inventado não entra.** Sem amostra, o campo vem vazio com o motivo — nunca uma regra de bolso apresentada como mercado.
2. **Cada número diz de onde veio.** Busca ao vivo, base própria, documento ou fonte pública — e, quando é leitura nossa (ex.: pressão habitacional), isso é dito.
3. **O documento prevalece** sobre o anúncio na metragem, e sobre a premissa da tela na comissão.
4. **Divergência não é escondida**: anúncio × matrícula, edital × lote, documento × imóvel — todas viram aviso.
5. **Terreno não tem mercado de locação** — não há aluguel nem yield para lote.
6. **O documental exige o mercadológico** (trava no servidor); o laudo exige os dois.
