# Handoff — Tela de Análise + Busca (sessão 2026-06-30)

Âncora: apresentação/demo **quarta, ~2026-07-01**.
Branch de desenvolvimento: `claude/bidpro-brasil-handoff-check-1qxd0m` → fast-forward para `main`.

---

## 1. O que foi feito nesta sessão

### 1.1 Busca — correção dos filtros (✅ em produção)
Arquivos: `src/pages/Busca.jsx`, `src/data/pagamento.js`, `api/busca-raio.js`, `supabase/migrations/busca_raio_v2.sql`.

- **Raio reativo**: ligar o raio / mexer na distância agora re-dispara a busca (antes só `filtros` disparava; `raioAtivo`/`raioKmAtivo` entraram no debounce).
- **Mapa não "some" mais com vários filtros**: pagamento passou de `.or(ilike)` para igualdade exata `.in()` nos valores canônicos do banco (`a_vista|financiado|hipotecado`), deixando um único `.or()` (cidades). Cidades agora entre aspas (suporta nomes com espaço/acento/parênteses).
- **Financiado + Hipotecado juntos** = união (parcelável), via `.in()`.
- **Modo raio aplica todos os filtros** no servidor: nova RPC `buscar_por_raio_v2` (arrays de tipos/modalidades/pagamento + `total` exato). A v1 foi mantida por compatibilidade. No mapa, em modo raio a cidade vira só o centro (área = raio).

### 1.2 Tela de Análise `/analise` — reestruturação orientada a relatórios (✅ enviada à branch)
Arquivo: `src/pages/Analise.jsx`.

- **Centro inicia só com os botões de gerar** (launcher limpo).
- **Dois relatórios consolidados e separados**:
  - **A — Mercadológico + Viabilidade Financeira**: mercado (níveis 1/2), custos, **cenários de disputa**, ROI/ROE, teto, fluxo de caixa, laudo.
  - **B — Análise Documental + Processo**: edital/matrícula (ônus/gravames), CNJ (processo), certidões fiscais, riscos.
- **Barra lateral**: Documentos do leiloeiro (edital/matrícula/regra com link direto) + Relatórios (✓ quando gerados; clicar abre no centro com cabeçalho na marca BidPro) + workflow.
- **Entradas automáticas** (decisão do cliente): usa dados/anexos do próprio imóvel — extrai edital por URL e consulta CNJ pelo nº de processo. Colar edital/matrícula manualmente ficou **restrito à equipe** (fallback).
- **Gating do workflow**: "Solicitar reunião com analista" só habilita após **os dois** relatórios → **analista/admin marcam reunião realizada** → só então libera **"Encaminhar ao jurídico"**.

### 1.3 Relatório mercadológico — cenários de disputa (✅ nesta sessão)
- Novo bloco **"Cenários de Disputa"** na viabilidade:
  - **Sem disputa**: arremata pelo lance base.
  - **Com disputa (pior caso)**: a concorrência empurra o preço até o **teto que ainda preserva 40% de lucro líquido** (piso). Acima disso = parar de dar lances.
  - Tudo na **melhor condição de pagamento** (compara à vista × financiado e escolhe o maior ROI no lance base).
  - Linha de **validação** explicando o limite de lance.
- Constante `PISO_LUCRO = 40` em `Analise.jsx` (ajustar se o piso mudar).

---

## 2. Relatório jurídico — com o que mais integrar além do CNJ

Hoje: **CNJ DataJud** (processos/movimentações) + **Receita Federal** (situação cadastral) + **PGFN** (Dívida Ativa da União). Sugestões para aprofundar, em ordem de impacto/custo:

### Prioridade alta (alto valor, viável sem certificado/credencial restrita)
1. **BNDT — Banco Nacional de Devedores Trabalhistas (TST)** / **CNDT**: as penhoras trabalhistas são um dos maiores riscos (têm natureza alimentar e podem não ser sub-rogadas no preço). Consulta pública por CPF/CNPJ do executado. Complementa o que o DataJud cobre parcialmente dos TRTs.
2. **CNIB — Central Nacional de Indisponibilidade de Bens**: detecta indisponibilidade decretada (apareceu no relatório-exemplo como AV-9/AV-16). Consulta por CPF/CNPJ. Crítico antes de arrematar.
3. **CENPROT / IEPTB — Protesto de títulos (nacional)**: forte indicador de insolvência do devedor; consulta pública por documento.
4. **Diários Oficiais / DJE (ex.: via DJEN/Comunica do CNJ ou agregadores)**: detectar **suspensão/cancelamento/adiamento do leilão** e embargos — especialmente no **extrajudicial**, onde não há processo no DataJud. Casa com o pedido anterior de "ver se o devedor tem movimento jurídico para cancelar/atrasar o leilão".

### Prioridade média
5. **ONR / SREI — matrícula e certidão de ônus reais atualizada**: hoje lemos a matrícula que o leiloeiro fornece; a consulta direta traz ônus atualizados (R-/AV-) e é a fonte da verdade. Já temos `api/...onr...` parcial — avaliar ampliar para pedido de certidão.
6. **CENSEC (Colégio Notarial)**: escrituras, procurações, testamentos e **inventários** (relevante quando o executado faleceu / espólio).
7. **Tribunais estaduais em tempo real (e-SAJ / PJe / Projudi)**: o DataJud tem **lag** (já explicado ao cliente). Para o monitoramento 1x/dia, um scraping leve do tribunal complementa movimentações recentes.
8. **IPTU / Prefeitura (por município)**: débitos de IPTU e situação fiscal do imóvel (propter rem). Sem API nacional — integrar os municípios-alvo prioritários.
9. **JUCESP / Juntas Comerciais**: quando o executado é PJ — sócios, situação, falência/recuperação.

### Restritas (NÃO acessíveis por nós — registrar como limitação)
- **SISBAJUD / RENAJUD / INFOJUD**: exclusivos do Judiciário (juiz). Não dá para integrar; mencionar como limite e cobrir via due diligence do advogado.

> Recomendação para amanhã: começar por **CNDT/BNDT + CNIB + CENPROT** (consultas públicas por CPF/CNPJ, encaixam no mesmo padrão das certidões já existentes em `api/certidoes.js`) e por **Diários Oficiais** para o caso extrajudicial.

---

## 3. Pendências / decisões para a próxima sessão

### 3.0 ⭐ PRIORIDADE — Habilitação manual de leiloeiro pelo cliente (pedido 30/06, fim do dia)
Hoje a tela de análise é **automática** (usa só imóveis já scrapeados/integrados). Falta um caminho para o cliente analisar um imóvel de um **leiloeiro ainda não integrado**.

Especificação:
- **Campo/botão no launcher de `/analise` (visível ao cliente)**: "Analisar de outro leiloeiro" → o cliente cola o **link do leiloeiro/lote** e/ou **anexa arquivos** (edital, matrícula em PDF/imagem).
- Com isso, libera a geração dos relatórios normalmente (a IA extrai do link/anexos — reaproveitar `extrairDadosDocumentoUrl` e `extrairDadosDocumento`/upload que hoje estão restritos à equipe).
- **Notificar o admin** quando isso acontecer, para avaliar a viabilidade de **integrar esse leiloeiro** para casos futuros (mapear volume/recorrência).
  - Implementar via `solicitacoes` (tipo novo, ex. `leiloeiro_sugerido`) ou tabela `leiloeiros_sugeridos` com: user_id, link, domínio do leiloeiro, imóvel (nome/cidade), data. Agregar por domínio para priorizar integração.
  - Surfacing no Admin: lista "Leiloeiros sugeridos pelos clientes" com contagem por domínio.
- UX: deixar claro que é uma análise "fora da base" — os dados dependem do que o cliente forneceu (sem garantia da curadoria BidPro).
- Observação: as caixas de colar edital/matrícula já existem em `Analise.jsx` (hoje sob `isStaffAnalise`); parte do trabalho é **expor uma versão ao cliente** + a notificação ao admin.

### 3.x Outras pendências
- [ ] **Persistência do workflow** (`/analise`): hoje "relatório gerado / reunião realizada / jurídico enviado" vivem na **sessão** (recarregar zera). Para valer entre sessões e entre usuários (analista abrindo depois), ligar ao banco — provavelmente convergir com o fluxo `/caso` (que já tem `casos`, `reunioes`, `analise_juridica` e o envio jurídico por e-mail pronto).
- [ ] **Duas telas de análise** (`/analise` calculadora local × `/caso` workflow em banco): decidir se unificam. O "Encaminhar ao jurídico" real (e-mail com anexos) já existe em `/caso` via `api/enviar-juridico-email.js`; em `/analise` hoje só cria uma `solicitacoes` tipo `juridico`.
- [ ] **Form "Dados do imóvel"** ainda aparece editável dentro do relatório Documental — avaliar deixar **somente leitura** para o cliente (mantendo edição p/ equipe).
- [ ] **Integrações jurídicas** acima (seção 2).
- [ ] Layout dos dois relatórios pode evoluir para ficar ainda mais próximo do HTML do Claude-web (cabeçalho com nº do documento, selo CONFIDENCIAL, grid de metadados) — hoje reusa as seções existentes sob um cabeçalho na marca.

### Tarefas antigas ainda abertas (do board)
- Leiloeiros: Mega Leilões (em progresso), Sold, Superbid.
- P2: guarda de métricas por fonte (volume/qualidade + alerta).
- Auditar checkout: MercadoPago (principal) + Asaas + cancelamento de renovação.

---

## 4. Arquivos tocados nesta sessão
- `src/pages/Busca.jsx` — filtros (raio reativo, `.in` pagamento, raio v2).
- `src/data/pagamento.js` — `PAGAMENTO_CANON` + `pagamentoParaCanon`.
- `api/busca-raio.js` — usa `buscar_por_raio_v2` (arrays + total).
- `supabase/migrations/busca_raio_v2.sql` — nova RPC (aplicada no banco).
- `src/pages/Analise.jsx` — reestruturação para relatórios + cenários de disputa.
- `docs/HANDOFF-SESSAO-ANALISE.md` — este arquivo.
