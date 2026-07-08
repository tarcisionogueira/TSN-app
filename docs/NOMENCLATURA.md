# Nomenclatura canônica de siglas — BidPro Brasil

Referência única das siglas usadas para **fontes de lotes**, **bancos**, **tribunais**
e **modalidades**. Validada por auditoria cruzando código × banco de produção
(`imoveis_leilao`, `sancoes_federais`, `api/_cnj.js`) em 2026-07-08.

> Regra de ouro: a Busca filtra por **igualdade exata** (`.in('fonte'|'tipo'|'modalidade', [...])`).
> Qualquer valor gravado fora do conjunto canônico (grafia/caixa diferente) **some do filtro**.
> Todo caminho de ingestão deve normalizar antes de gravar (`api/_tipo.js`, `api/_modalidade.js`).

## 1. Fontes de lotes — `imoveis_leilao.fonte` (SEMPRE MAIÚSCULO)

| Sigla canônica | Nome de exibição | Writer (produção) | Rows (2026-07-08) |
|---|---|---|---|
| `CEF` | Caixa (CEF) | `scripts/scraper.js` (GH Action `scraper.yml`) | 33.100 |
| `SUPERBID` | Superbid | `scripts/scraper-puppeteer.mjs` + `api/scraper-leiloeiros.js` | 2.050 |
| `MEGA` | Mega Leilões | idem | 1.379 |
| `LJUD` | Leilões Judiciais (agregador) | `api/scraper-leiloeiros.js` (backup) + puppeteer | 1.158 |
| `ZUK` | Portal Zuk / Zukerman | `scripts/scraper-puppeteer.mjs` | 990 |
| `FRAZAO` | Frazão Leilões (sem acento) | idem | 190 |
| `SOLD` | Sold Leilões | `api/scraper-leiloeiros.js` + puppeteer | 185 |
| `SODRE` | Sodré Santoro (sem acento) | `scripts/scraper-puppeteer.mjs` | 32 |
| `webhook_<uuid>` | (nome real em `leiloeiro`) | `api/leiloeiro-webhook.js` | dinâmico |
| `parceiro_<id>` | (nome real em `leiloeiro`) | `api/leiloeiro-feed.js` | dinâmico |

**Caixa = `CEF`.** `caixa` (minúsculo) é **legado** e não existe mais em produção
(0 rows). `fonte_id` da Caixa é `cef_<numeroImovel>`.

Siglas presentes só no **código legado/inativo** (0 rows — não usar): `BB` (Banco do
Brasil), `BIASI`/`BIASSI`, `HASTA`, `ELEILOES`, `KCLEILOES`, `PATIOROCHA`,
`ALBERTOMACEDO`, e `JUDICIAL` (esta última era erro — `JUDICIAL` é modalidade, não fonte).

## 2. Modalidade — `imoveis_leilao.modalidade`

Conjunto canônico (existe no banco e tem label em `src/pages/Busca.jsx`):

| Valor | Significado | Eixo |
|---|---|---|
| `venda_direta` | Venda direta/online (sem data) | forma de venda |
| `licitacao_aberta` | Licitação aberta | forma de venda |
| `judicial` | Leilão judicial (há processo) | natureza jurídica |
| `extrajudicial` | Leilão extrajudicial | natureza jurídica |

**Caixa (CEF) é SEMPRE `extrajudicial`** (SFI/alienação fiduciária, Lei 9.514 — o
"executado" é o ex-mutuário, não há processo judicial). Normalizadores:
`scripts/scraper.js → normalizarModalidadeCEF()` e `api/_modalidade.js`
(usado por webhook/feed de parceiros).

> ⚠️ **Dívida técnica conhecida:** a coluna mistura dois eixos (natureza × forma de
> venda). O ideal é separar em `natureza` (judicial/extrajudicial) e `fase_leilao`
> (praça/venda direta). Ver Recomendações.

## 3. Tribunais — `api/_cnj.js`

- **Interno (slug do endpoint DataJud `api_publica_<x>`):** minúsculo.
  - Estaduais: `tj<uf>` — exceção **DF = `tjdft`**.
  - Federais: `trf1`..`trf6`. **MG = `trf6`** (instalado em 2022; base legada em `trf1`).
  - Superiores: `stj`, `tst`, `tse` (STF/STM não têm API pública).
- **Exibição (UI/e-mail/monitor):** MAIÚSCULO do slug — `TJSP`, `TJDFT`, `TRF6`, `STJ`.

## 4. Bancos

- **Caixa Econômica Federal → `CEF`** (label de certidão: `CEF / FGTS`).
- **Banco do Brasil → `BB`** (coleta hoje inativa — 0 rows).

## 5. Sanções federais — `sancoes_federais.fonte` (minúsculo)

`ceis`, `cnep`, `pgfn`. ⚠️ Existe grafia legada `PGFN` (maiúsculo) em produção que
duplica chave no upsert — ver Recomendações.

---

## Correções aplicadas nesta auditoria (2026-07-08)

- ✅ **Caixa nunca é judicial:** `scripts/scraper.js` (leilão/praça genérico → `extrajudicial`,
  antes `judicial`) + backfill de 4.516 rows CEF `judicial`→`extrajudicial`.
- ✅ **Modalidade de parceiros** (`leiloeiro-webhook`/`leiloeiro-feed`) passou a normalizar
  via `api/_modalidade.js` (antes gravava texto cru → sumia do filtro).
- ✅ **TRF6/MG:** MG passou a consultar `trf6` (+ `trf1` legado); nacional cobre `trf1..trf6`.
- ✅ **`api/scraper-caixa.js` desativado (410):** legado, parsing por índice fixo + `fonte='caixa'`.

## Recomendações (não aplicadas — decisão do dono)

1. **Consolidar leitores da Caixa** em um único helper `ehCaixa(fonte)` (regex `/caixa|cef/i`,
   já existe em `src/utils/caixa.js`) — hoje ~15 pontos repetem `fonte==='CEF'||fonte==='caixa'`.
2. **Separar `modalidade`** em `natureza` + `fase_leilao` (a mistura quebra
   `processar-analise.js` — `ehExtrajudicial` dá `false` para CEF `venda_direta`/`primeiro_leilao`).
3. **Busca:** oferecer filtro `licitacao_aberta` (existe em produção, sem opção na UI).
4. **`sancoes_federais`:** padronizar `PGFN`→`pgfn` e migrar linhas legadas (dedup de chave).
5. **Derivação de UF em `Admin.jsx:8394`:** `TJDFT→DFT`/superiores quebram o alerta de
   processo monitorado — derivar UF do número CNJ.
6. **Remover ramos mortos** do `scripts/scraper.js` (BB/BIASSI/HASTA/etc.) e unificar `BIASI`/`BIASSI`.
7. **Exibição de fontes dinâmicas:** `ImovelDetalhe` mostra `webhook_<uuid>` cru; usar o campo `leiloeiro`.
