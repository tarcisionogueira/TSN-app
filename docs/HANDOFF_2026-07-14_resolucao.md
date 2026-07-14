# Handoff — 2026-07-14 (resolução priorizada) — branch `claude/handoff-access-ny7wy7`

Continuação após `HANDOFF_2026-07-14_auditoria.md`. Sessão retomou o handoff e
resolveu **as 4 frentes pendentes, em ordem de dificuldade** (pedido do dono).
Verificações "de manhã" feitas ao vivo (Supabase + GitHub Actions).

> ⚠️ **Ativação em produção:** todo o código está na branch
> `claude/handoff-access-ny7wy7` (8 commits à frente da main). As mudanças de
> **DADOS** (backfill de fotos, url_lote, enfileiramento, migração) já foram
> aplicadas ao banco e **valem agora**. As mudanças de **CÓDIGO** (crons 504,
> scrapers, workflows) só entram em produção **após merge na main** (os crons
> rodam na Vercel/main e os workflows agendados rodam da branch default). Falta
> **abrir PR / merge na main** (não fiz por não ter sido pedido explicitamente).

## 1. 🖼️ Fotos da Caixa — backfill falhou de madrugada, CORRIGIDO e re-rodado
- **Causa:** a run de 02:24 morreu em ~20k processados com `select falhou: 500` —
  um 500 transitório do PostgREST em `proximoLote` lançava **sem retry** e o loop
  não capturava, matando tudo. Ficaram ~3.014 atrativos (desconto 40–49%) na Caixa.
- **Fix:** `fetchRetry` (5 tentativas, backoff, AbortSignal novo/tentativa) em
  `scripts/backfill-fotos-caixa.mjs`. Re-disparado no ref da branch.
- **Resultado:** Storage 16.339 → **26.785**; ainda na Caixa **369** (era 11.207),
  todos de desconto <40. **Atrativos (≥40) na Caixa = 0** — gap do e-mail fechado.
  (E-mail geral só dispara segunda; hoje é terça — sem risco.)

## 2. 🔧 Crons 504 — export GET/POST nos 4 crons node afetados
- Mesma causa já corrigida no `enviar-alertas-cron`: `export default` no runtime
  Node vira assinatura Express `(req,res)` e o `Response` retornado é ignorado →
  trava até o `maxDuration` (504 a cada run).
- Corrigidos: `reconciliar-assinaturas-cron`, `laudo-retry-cron`,
  `monitor-fontes-cron`, `renovacao-avisos-cron` (nodejs + `new Response` + só `req`).
- Auditado: os `(req,res)` que usam `res.status().json()` são Express-style e já
  funcionam (não tocados); `cnj-monitor-cron` e `limpar-documentos-cron` são **edge**
  (imunes — o handoff os listou por engano).

## 3. 🧾 Matrículas / editais / fotos SODRE
- **Vazão da fila (não estava travada):** 517 pendentes semeados às 08:35; `*/15`
  é throttled pelo GitHub p/ ~1–2h e processava LOTE=15. → **LOTE 15→40** + timeout
  30→45 min (`captura-documentos`). Editais CEF: cron **2h→de hora em hora** (o
  gargalo é o IP-block da Caixa; mais runs = mais cobertura).
- **url_lote SUPERBID/SBID:** a URL do lote já vinha da API (`linkURL`, em
  `link_edital`) mas não ia p/ `url_lote` — travava a captura de matrícula. Fix no
  scraper (`scraper-puppeteer.mjs` + backup `api/scraper-leiloeiros.js`) **e backfill
  SQL imediato** (`url_lote = link_edital`) em **1.543** existentes (SUPERBID 1.432 +
  SBID9 72 + SBID21 39). Migração `add_sbid_enfileirar_docs.sql` adiciona SBID9/SBID21
  ao whitelist de `enfileirar_docs_faltantes`; **+1.541 enfileirados**.
- **LJUD (~1.044) NÃO alterado de propósito:** é agregador sem página de lote
  própria (`nm_url_leiloeiro` é só o domínio); gravar url_lote=home encheria a fila
  de lixo. Caso de integração oficial, não de scraping.
- **SODRE 0 fotos:** o scraper de listagem chutava `r.lot_image`/`r.image` (campos
  inexistentes no `search-lots`). A rede do dev bloqueia a Sodré (não deu p/ achar a
  chave real). Fix confiável: capturar **og:image** na página do lote em
  `captura-docs-sodre.mjs` (que já visita cada lote) + filtro ampliado p/ pegar
  lotes sem foto. Disparado → **0 → 19** com foto (os 16 restantes são lotes de
  leilão encerrado, fora do search-lots — sem página p/ abrir).

## 4. 🕸️ Scraper PECINI (novo) — sitemap + detalhe via Bright Data
- `scripts/scraper-pecini.mjs` + `.github/workflows/scraper-pecini.yml`
  (dispatch-only). Enumera `/sitemap.xml` (1 request) e busca o detalhe de cada
  lote; reusa `extrairGenerico`/`checarQualidade` do `scraper-core.mjs`.
- **Quota-safe:** `PECINI_MAX_LOTES` (40/run) + `fetchViaBrightData` (teto semanal).
- **`PECINI_DRYRUN` default 1:** a 1ª run é SECA (só loga o que inseriria); depois
  `PECINI_DRYRUN=0` p/ gravar.
- **Não testável ao vivo daqui** (rede bloqueia o Pecini; workflow novo só dispara
  após estar na main). Validados a cadeia de imports e os regexes de sitemap/detalhe
  com amostras. **Falta:** 1 run seca no Actions (pós-merge) p/ conferir o parsing
  contra o HTML real + decisão do dono sobre a cota Bright Data.

## ✅ Estado verificado no fim
| Métrica | Antes | Depois |
|---|---|---|
| CEF fotos ainda na Caixa | 11.207 | **369** (atrativos: 0) |
| SUPERBID/SBID com url_lote | ~150 | **1.693** |
| documentos_fila pendente | 517 | 2.018 (backlog SUPERBID/SBID enfileirado, drenando 40/run) |
| SODRE com foto | 0 | **19** |

## ⏭️ Pendências / follow-ups
1. **Merge na main** p/ ativar em produção: crons 504, vazão (LOTE/editais), fixes de
   scraper, workflows novos (`scraper-pecini`, `recon-sodre-searchlots`). Abrir PR.
2. **Pecini:** run seca (`scraper-pecini` dryrun=1) no Actions após merge; conferir o
   log; decidir cota Bright Data; ligar `dryrun=0` (+ cron modesto se estabilizar).
3. **VAPID** (do handoff anterior, fora de código): setar as 3 env vars na Vercel +
   redeploy; validar push.
4. **Fila:** drena ~2k em alguns dias a 40/run; dá p/ disparar `captura-documentos`
   manualmente algumas vezes p/ acelerar.
5. **SODRE:** os 16 sem foto são de leilão encerrado (não recuperável); os novos
   lotes ganham foto quando o `captura-docs-sodre` roda.
6. **Geocoding** (do handoff anterior): `refazer` seguia drenando (21.798) — conferir.
