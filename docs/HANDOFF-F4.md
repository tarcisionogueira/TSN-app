# 🗺️ HANDOFF — BidPro · continuar no F4 (scraping de leiloeiros + análise)

> Cole este link no início da nova sessão do Claude Code e diga **"vamos ao F4"**.
> O contexto também está na memória (carrega sozinho), este doc é o backup.

## Infra
- **Repo:** `tarcisionogueira/TSN-app` · branch `main` → produção (deploy automático Vercel). `main` e a branch de dev estão sincronizadas.
- **Supabase:** `zuwfiwokkdytvjixiwac` (sa-east-1, Pg17) · **Vercel:** projeto `tsn-app` · Produção: `bidprobrasil.com.br` / `tsn-app-two.vercel.app`.
- **Sem Node local** na máquina do dev → validar `api/*` pelo deploy; front pelo build da Vercel.

## ✅ Já em produção (sessão 28/06/2026)
- **F0 — Fotos:** Caixa via **hotlink direto** `https://venda-imoveis.caixa.gov.br/fotos/F{numero}21.jpg` (a Vercel é bloqueada pela Caixa; o navegador do usuário não). Em `Busca`, `ImovelDetalhe`, `MapaImoveis`. `onError`→placeholder.
- **F1 — Análise destravada:** `processar-analise.js` e `baixar-doc.js` agora usam **`imovel_id`** (a coluna `caso_id` NÃO existe em `imovel_anexos` → era o bug que mantinha a análise dormente). Dedup por `(imovel_id,tipo)` (índice único parcial). Retenção **30 dias** (não arrematados); arrematado → docs permanentes (`arrematacoes.js` marca `arrematado=true`).
- **F2 — Bright Data infra:** `api/_brightdata.js` → `fetchViaBrightData(url)` (Web Unlocker, opcional/fail-safe, respeita teto). Tabela `brightdata_uso` + RPC `registrar_uso_brightdata(p_teto)`. `baixar-doc` já usa BD como **fallback** quando a fonte bloqueia o servidor.
- **F3 — Indicadores na busca:** R$/m² + 📄 edital/matrícula disponíveis + ★ score no card da grade; R$/m² no card lista+mapa; R$/m² + edital/matrícula no popup do mapa.

## 🔑 Bright Data (configurado)
- Conta com **5.000 créditos grátis/mês**. Env vars na Vercel: `BRIGHTDATA_API_TOKEN`, `BRIGHTDATA_ZONE` (Prod+Preview), `BRIGHTDATA_MAX_REQ_SEMANA=450` (teto = trava de custo; ao atingir, BD para e cai no fetch comum). API key = permissão **Ops**. **Ativa no próximo deploy.**
- Marcadores agendados: `bidpro-brightdata-teto-check` (alerta a 80% do teto = **360**), `bidpro-cota-pro-check` (Pro/leaked-password).

## ⏳ F4 — fazer (objetivo: trazer imagens/edital/matrícula/anexos dos outros leiloeiros p/ a análise automática)
1. **Validar BD ativo** (1º deploy ativa). Teste de conectividade.
2. **Sold + Mega (piloto):** descobrir a fonte de dados (Sold = SPA → API interna; Mega = anti-bot HTML), escrever **parser por leiloeiro** normalizando p/ `imoveis_leilao` (`fonte`, `fonte_id` estável, valores, modalidade, `link_foto`, `link_edital`, `link_matricula`), usando `fetchViaBrightData()`. **Preferir Bright Data via Vercel function** (testável: dispara → confere DB) a Puppeteer no GitHub Actions (não testável daqui).
3. **Cron 2x/semana** + upsert `on_conflict(fonte,fonte_id)` + sweep dos que saíram.
4. **"Gerar análise" sob demanda:** auto-baixar edital/matrícula via `baixar-doc` (já tem fallback BD) antes do `processar-analise`; **upload manual** de fallback (Caixa: matrícula só no portal).
5. **Custo:** 1 req ≈ 1 página (~50 imóveis). Caixa = grátis (CSV + hotlink). BD só p/ leiloeiros extras + docs de análise → cabe no free.

## Validação do F4
Usuário dispara o scraper (botão no Admin ou cron) → conferir:
`SELECT fonte, count(*) FROM imoveis_leilao GROUP BY fonte;`
Acervo atual: **CEF 31.829** (grátis), **SUPERBID 50** (API quebrou — `categoryId` inválido → tratar render-based), **SOLD 56** (parado 24/06). Scrapers antigos (fetch+regex) em sua maioria retornam 0.

## Pendências do usuário (não-bloqueantes)
- Validar no browser fotos + indicadores. 
- Ativar "Leaked Password Protection" só quando o Supabase virar **Pro**.
