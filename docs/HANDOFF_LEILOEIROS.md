# Handoff — Captação de leiloeiros (estado e próximos passos)

_Última atualização: 2026-06-29 (sessão BidPro)._

## Estado atual (ativos por fonte)
| Fonte | Ativos | Situação |
|---|---|---|
| **CEF** (Caixa) | ~31.829 | ✅ Completo (cron diário `scraper.yml` 06h/09h UTC). tipo/área corrigidos. |
| **SUPERBID** | ~1.472 | ✅ Completo (API offers, portal 2, paginação cheia). |
| **MEGA** | ~637 | ✅ Completo (HTML server-rendered, `?pagina=N`, só `card open`). |
| **SOLD** | ~98 | ✅ OK (mesma rede Superbid, portal 15). |
| **ZUK** (PortalZuk/Zukerman) | ~30 | 🔧 CORRIGIDO (aguarda validação no workflow) — ver abaixo. |
| **SODRE** (Sodré Santoro) | ~20 | 🔧 CORRIGIDO (aguarda validação no workflow) — ver abaixo. |
| **FREITAS** | 0 | ❌ URL de listagem errada — ainda pendente. |
| **BB** | — | Descartado (não expôs dados); substituído por Freitas/Sodré. |

Coletores: `scripts/scraper-puppeteer.mjs` (workflow `leiloeiros-puppeteer.yml`, diário 10h UTC).
Capturas de estrutura: tabela `debug_fetch` (fontes `ZUK-*`, `SODRE-*`, `FREITAS-*`).

## Pendentes — diagnóstico e próximo passo

### PortalZuk (ZUK) — 🔧 CORRIGIDO (validar no workflow)
- **Causa raiz achada** (via captura `ZUK-render` em `debug_fetch`): a listagem tem um
  botão **"Carregar mais"** `#btn_carregarMais` que dispara a rota Ziggy
  **`carrega.mais` → `POST leilao-de-imoveis/mais`**. O `scrollTo` puro NÃO aciona
  esse botão — por isso parávamos em 30.
- **Fix aplicado** (`scraperPortalZuk`): clicar `#btn_carregarMais` em loop (o próprio
  JS do site faz o POST + CSRF + append), com `scrollTo` como fallback, até parar de
  crescer. Parser dos cards inalterado (já mapeava corretamente).
- **Validar:** rodar `leiloeiros-puppeteer.yml` e conferir se ZUK sobe bem acima de 30.

### Sodré (SODRE) — 🔧 CORRIGIDO (validar no workflow)
- **Causa raiz achada** (via `SODRE-xhr-1` em `debug_fetch`): a resposta do
  **POST `/api/search-lots`** é `{ results:[], total, page, perPage }`. A versão
  anterior tentava incrementar `page` DENTRO do body interceptado, mas essas chaves
  não vinham no body (eram defaults do servidor) → `setPagina` retornava false e não
  paginava (parava em 20).
- **Fix aplicado** (`scraperSodre`): reaproveita o body interceptado (preserva
  filtros/segmento) e sobrescreve `page`/`perPage` (100) EXPLICITAMENTE; loopa até
  atingir `total` ou página vazia.
- OBS: no snapshot de captura o `total` de imóveis ativos era ~24 (condiz com "~20").
  O ganho é pequeno mas a coleta fica correta/completa.
- **Validar:** rodar o workflow e conferir se SODRE chega ao `total` (ex.: 24).

### Freitas (FREITAS) — 0 — AINDA PENDENTE
- `/lotes/imoveis` retorna **404**. A captura em `debug_fetch` (`FREITAS-render`) é só a
  página de erro (1126 bytes) — não há HTML útil para achar a URL real, e os sites dos
  leiloeiros estão **bloqueados pela política de rede** do ambiente de dev (não dá para
  sondar daqui).
- **Próximo (precisa de acesso ao site ou um debug run):** capturar a **home**
  `freitasleiloeiro.com.br` e seguir o link real de "imóveis"; testar `/busca`,
  `/imoveis`, `/Site/Busca`. Depois mapear cards/API e escrever o parser.

## Observações
- O agendador (cron) **não persiste de forma confiável** neste ambiente; o avanço foi manual (disparos de `leiloeiros-puppeteer.yml`).
- Estratégia que funcionou nos grandes: **capturar a estrutura real** (`debug-leiloeiros.yml` → `debug_fetch`) antes de escrever o parser. Repetir para ZUK/SODRE/FREITAS capturando **request payloads**, não só responses.
- Melhoria futura (qualidade dos relatórios): extrair o **PDF de edital/matrícula por lote** (hoje guardamos só o `link_edital` = URL do lote).
