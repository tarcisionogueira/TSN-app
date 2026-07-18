# 📏 Linha de base da captura por leiloeiro (referência de monitoramento)

> **Para que serve:** dar ao **agente responsável pelo monitoramento** (`api/monitor-fontes-cron.js`)
> uma **linha de base** — quantos imóveis e quais informações/documentos cada leiloeiro
> costuma entregar — para ele **ver o que está funcionando e o que não está**. Sem esta
> referência, o monitor só percebe scraper *parado/zerado*; com ela, percebe também
> **regressão silenciosa** (o scraper roda, mas passa a trazer menos imóveis ou perde um
> campo que antes vinha 100%). Foi o tipo de degradação que atingiu assinantes (relatórios
> com avaliação/área/data faltando).
>
> **Fonte da verdade em código:** a cópia legível por máquina desta tabela vive em
> `api/monitor-fontes-cron.js` na constante **`BASELINE_FONTES`**. Ao mudar aqui, mude lá
> (e vice-versa). Cada fonte também carrega a meta no seu `leiloeiro_conhecimento.observacao`.
>
> **Última medição da linha de base:** 2026-07-18 (acervo ativo).

---

## 1. Campos essenciais — o que NÃO pode faltar

### 🔴 Críticos (sem eles o lote é inútil — nunca gravar sem)
| Campo | Coluna | Por quê |
|---|---|---|
| Título | `titulo` | identifica o lote |
| Origem + link | `fonte` + `fonte_id` + `url_lote` | rastreabilidade e "ir ao leiloeiro" |
| Cidade + UF | `cidade` + `estado` | é a **praça** — filtro/monitoramento por região |
| Lance mínimo | `valor_minimo` | é o número sobre o qual o usuário decide |
| Foto | `link_foto` | ≥ 1 imagem; lote sem foto quase não converte |
| Tipo | `tipo` | apartamento/casa/terreno/comercial |
| Modalidade | `modalidade` | 1º/2º leilão, venda direta |

### 🟡 Esperados (devem vir na grande maioria; ausência **em massa** = falha do parser)
| Campo | Coluna | Observação |
|---|---|---|
| Área útil | `area_m2` | **sempre a área ÚTIL/privativa, nunca a total** — a total superestima o valor de mercado do relatório |
| Data do leilão | `data_leilao` | data da praça |
| Edital | `link_edital` | ⚠️ ver caveat abaixo — hoje aponta para a **página do lote** na maioria das fontes, não para o PDF |
| Matrícula | `link_matricula` | onde a fonte publica a matrícula (ver por-fonte) |

### ⚪ Condicionais por fonte (ausência é **NORMAL**, não é bug — não alertar)
| Campo | Coluna | Quem entrega |
|---|---|---|
| Avaliação | `valor_avaliacao` | **A maioria dos leiloeiros NÃO divulga.** 100%: CEF, MEGA, ZUK, PECINI, RJLEILOES, (LEILOTECH ~95). 0%: LJUD, GrupoLance, Pestana, Biasi, Frazão, VIP, Sodré. Quando falta, o relatório **ancora no valor de mercado** (correto). |
| Regras de venda on-line | `link_regras_venda` | Poucas fontes expõem em link separado (WEBLEILOES ~56, CEF ~63, BIASI ~25); nas demais a regra está no edital. |

---

## 2. ⚠️ Caveats conhecidos (ler antes de "consertar" um número)

1. **`link_edital` = ~100% na maioria é ENGANOSO.** Para quase todas as fontes esse campo
   guarda a **URL da página do lote** (que contém o edital embutido), **não o PDF do edital**.
   Foi por isso que "o edital não abriu" para um lote ZUK mesmo com `edital=100%`. **CEF é a
   exceção** (`edital≈37%` é o **PDF real** separado). ➡️ O **recon ZUK** (workflow grátis
   `recon-zuk-edital`) existe para achar o padrão do link do PDF na página e então plugar a
   captura do edital de verdade.
2. **`area_m2` = 0% em BIASI / FRAZAO / PECINI / VENDASGOV** — o parser ainda não extrai a
   área nessas fontes. Gap conhecido (não é regressão). Quando entrar, **usar a útil**.
3. **`data_leilao` baixa em GRUPOLANCE (1%) / WEBLEILOES (0%) / VIP (0%) / BIASI (0%)** —
   parser não extrai a data. Gap conhecido. CEF ~35% é normal (só parte publica data).
4. **`link_matricula` = 0–5% em SUPERBID / SOLD / SBID9 / PECINI / VENDASGOV** — essas fontes
   **não publicam matrícula** no lote (normal na rede Superbid/SOLD). ZUK ~31% é captura em
   andamento. **Não alertar** matrícula onde o baseline já é baixo.
5. **`link_foto` < 100% em LJUD (62%)** — parte do acervo LJUD não tem `og:image`; há backfill
   por foto de capa. Abaixo de 62% seria regressão.

---

## 3. Linha de base por leiloeiro (quantidade + cobertura esperada)

> **Como ler:** `Ativos` = ordem de grandeza esperada do acervo. `Piso` = abaixo disso o
> monitor **alerta** (scrape encolheu). As colunas de campo mostram a **cobertura de referência
> (%)**; o monitor alerta se um campo **que deveria vir** cair muito abaixo do baseline
> (folga de ~15 pontos). Células `—` = campo **não esperado** nessa fonte (não alerta).

| Fonte | Ativos | Piso | Foto | Valor | Área | Data | Matríc. | Edital* | Aval. | Atualiza |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|---|
| CEF (Caixa) | 28.012 | 20.000 | 99 | 100 | 100 | 35 | 100 | 37(PDF) | 100 | 2×/sem (seg/qui) |
| SUPERBID | 1.404 | 900 | 99 | 100 | 67 | 100 | — | 100 | — | 2×/sem |
| LJUD | 990 | 600 | 62 | 100 | 75 | 100 | 93 | 100 | — | 2×/sem |
| ZUK | 862 | 550 | 100 | 100 | 71 | 86 | 31 | 100 | 100 | 2×/sem |
| MEGA | 607 | 400 | 100 | 100 | 89 | 100 | 100 | 100 | 100 | 2×/sem |
| GRUPOLANCE | 403 | 250 | 100 | 100 | 87 | — | 92 | 100 | — | 2×/sem |
| PESTANA | 201 | 120 | 93 | 100 | 87 | 100 | 89 | 100 | — | 2×/sem |
| BIASI | 173 | 150 | 100 | 100 | — | — | 98 | 100 | — | 2×/sem (meta ~370)** |
| FRAZAO | 142 | 90 | 100 | 100 | — | 100 | 100 | 100 | — | 2×/sem |
| WEBLEILOES | 94 | 60 | 100 | 100 | 93 | — | 93 | 100 | 52 | 2×/sem |
| LEILOTECH | 94 | 60 | 87 | 100 | — | 100 | 84 | 100 | 95 | 2×/sem |
| SOLD | 88 | 55 | 100 | 100 | 85 | 100 | — | 100 | — | 2×/sem |
| VIP | 68 | 40 | 100 | 100 | 74 | — | 91 | 100 | — | 2×/sem |
| SBID9 | 40 | 20 | 100 | 100 | — | 100 | — | 100 | 73 | 2×/sem |
| LEILOFY | 28 | 15 | 100 | 100 | — | 100 | 100 | 100 | 79 | 2×/sem |
| SODRE | 25 | 15 | 100 | 100 | 96 | 100 | 96 | 100 | — | 2×/sem |
| PECINI 💲 | 23 | 15 | 100 | 100 | — | — | — | 100 | 100 | 1×/sem (seg) — pago |
| RJLEILOES 💲 | 12 | 8 | 100 | 100 | — | 100 | 92 | 100 | 100 | 1×/sem (ter) — pago |
| VENDASGOV | 4 | 2 | 100 | 100 | — | 75 | — | 100 | — | 2×/sem |
| SBID21 | 2 | 1 | 100 | 100 | 100 | 100 | — | 100 | 100 | 2×/sem |

`*` **Edital**: percentuais são de `link_edital` preenchido (na maioria = URL do lote, não PDF — ver caveat 1). CEF é o único com PDF real.
`**` **BIASI**: em investigação — correção de paginação pode elevar para ~370. Piso 150 até validar; se ficar ~173, é o acervo real do site.
`💲` fonte **paga** (Bright Data): coleta parada = pagar sem coletar → o monitor cobre por **frescor** (`FONTES_SEM_SAUDE`).

`SUPORTE` (11) é fonte **interna** (não é leiloeiro) — nunca alertar.

---

## 4. Como o agente responsável usa esta linha de base

- **`api/monitor-fontes-cron.js`** (diário) compara o acervo vivo com `BASELINE_FONTES`:
  1. **Piso de quantidade** — `ativos < Piso` ⇒ alerta "acervo abaixo da linha de base".
  2. **Regressão de campo** — um campo esperado (baseline alto) que cai abaixo de
     `baseline − 15pts` ⇒ alerta "campo X regrediu".
  3. Continua cobrindo scraper **parado / zerado / degradado** e o **frescor** das pagas.
  Só envia e-mail se houver problema (idempotente).
- **`leiloeiro_conhecimento.observacao`** guarda a meta por fonte para o **agente scraper**
  saber o alvo (quantidade + campos esperados + gaps conhecidos).
- **Ao evoluir** (novo leiloeiro, parser que passa a extrair área/data, recon do edital
  concluído): **re-medir** e atualizar esta tabela + `BASELINE_FONTES` + o `leiloeiro_conhecimento`.

## 5. Gaps abertos que a linha de base torna visíveis (backlog priorizado)
1. **Edital = PDF de verdade** (não a URL do lote) — começar por ZUK após o recon; replicar padrão.
2. **Área útil** em BIASI, FRAZAO, PECINI, VENDASGOV (0%).
3. **Data do leilão** em GRUPOLANCE, WEBLEILOES, VIP, BIASI (0–1%).
4. **Matrícula** onde é pública mas não capturada: ZUK (31% → subir).
5. **BIASI** confirmar acervo real (~173 vs meta ~370) após a correção de paginação.
