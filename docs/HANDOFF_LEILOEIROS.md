# Handoff — Captação de leiloeiros (estado e próximos passos)

_Última atualização: 2026-06-29 (sessão BidPro)._

## Estado atual (ativos por fonte)
| Fonte | Ativos | Situação |
|---|---|---|
| **CEF** (Caixa) | ~31.829 | ✅ Completo (cron diário `scraper.yml` 06h/09h UTC). tipo/área corrigidos. |
| **SUPERBID** | ~1.472 | ✅ Completo (API offers, portal 2, paginação cheia). |
| **MEGA** | ~637 | ✅ Completo (HTML server-rendered, `?pagina=N`, só `card open`). |
| **SOLD** | ~98 | ✅ OK (mesma rede Superbid, portal 15). |
| **ZUK** (PortalZuk/Zukerman) | ~30 | ⚠️ PARCIAL — só a 1ª leva. |
| **SODRE** (Sodré Santoro) | ~20 | ⚠️ PARCIAL — só a 1ª página. |
| **FREITAS** | 0 | ❌ URL de listagem errada. |
| **BB** | — | Descartado (não expôs dados); substituído por Freitas/Sodré. |

Coletores: `scripts/scraper-puppeteer.mjs` (workflow `leiloeiros-puppeteer.yml`, diário 10h UTC).
Capturas de estrutura: tabela `debug_fetch` (fontes `ZUK-*`, `SODRE-*`, `FREITAS-*`).

## Pendentes — diagnóstico e próximo passo

### PortalZuk (ZUK) — parar em 30
- Listagem **server-rendered** (`.card-property`), mas usa **scroll infinito / "carregar mais"** que **não dispara em headless** (scroll de window e clique genérico em botões não funcionaram).
- Card decifrado: `a[href*="/imovel/uf/cidade/..."]`, `title` rico (tipo/endereço/cidade-UF/comitente), `.card-property-price-lote` (tipo), `.card-property-address`, `.card-property-news` (ocupação), R$ no corpo (praças), `img`.
- **Próximo:** capturar o **request AJAX** que o site faz ao rolar (provável endpoint de "mais imóveis" com `?page=`/offset) via `page.on('request')` e replicar; ou achar a URL paginada real.

### Sodré (SODRE) — parar em 20
- **Nuxt SPA**. Lotes vêm de **POST `https://www.sodresantoro.com.br/api/search-lots`** (JSON rico: `lot_title`, `lot_category`, `lot_description`, `bid_initial`, `lot_city/state`, `auction_status`, `lot_is_judicial`, datas).
- Interceptação pega só a **1ª página (20)**. O replay do POST incrementando `page/offset/from` **não destravou** (o campo de paginação do body não foi detectado).
- **Próximo:** salvar o **postData real** do `search-lots` em `debug_fetch` e inspecionar o **schema do body** para achar o campo de paginação; ou usar `prd-api.sodresantoro.com.br/api/v1/auctions?segmentName=imoveis&limit=...&page=...`.

### Freitas (FREITAS) — 0
- `/lotes/imoveis` retorna **404** ("Ops! Página não encontrada"). Domínio certo: `freitasleiloeiro.com.br`.
- **Próximo:** capturar a **home** e seguir o link real de "imóveis"; testar `/busca`, `/imoveis`, `/Site/Busca`, etc. Depois mapear cards/API.

## Observações
- O agendador (cron) **não persiste de forma confiável** neste ambiente; o avanço foi manual (disparos de `leiloeiros-puppeteer.yml`).
- Estratégia que funcionou nos grandes: **capturar a estrutura real** (`debug-leiloeiros.yml` → `debug_fetch`) antes de escrever o parser. Repetir para ZUK/SODRE/FREITAS capturando **request payloads**, não só responses.
- Melhoria futura (qualidade dos relatórios): extrair o **PDF de edital/matrícula por lote** (hoje guardamos só o `link_edital` = URL do lote).
