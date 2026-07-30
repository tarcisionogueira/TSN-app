# 🎯 Backlog — Leiloeiros homologados TRT-15 (integrar aos poucos até zerar)

> Objetivo do dono: **mais imóveis** na plataforma, com **máxima segurança, eficiência e economia** na extração. Lista de leiloeiros homologados do TRT-15 (Campinas/SP). Marque `[x]` ao integrar/confirmar.

## 🔑 Estratégia (economia máxima — NÃO fazer 58 scrapers)
A maioria dos leiloeiros judiciais de SP **publica em portais AGREGADORES que já raspamos**:
- **LJUD** (`leiloesjudiciais.com.br`) — portal NACIONAL, já traz **40+ leiloeiros / ~1.000 imóveis**. É a maior alavanca.
- **LEILOTECH** (white-label), **SUPORTE** (white-label), **SUPERBID/SOLD** (rede).

**Ordem de ataque (custo crescente):**
1. **Confirmar cobertura via portal** — antes de escrever qualquer scraper novo, checar se o leiloeiro já cai no LJUD/LEILOTECH/SUPORTE/SUPERBID (muitos judiciais publicam em vários portais). Se sim: **custo ZERO** (só garantir que o agregador captura tudo).
2. **Detectar a plataforma** do site independente. Vários usam a MESMA base white-label (ex.: a mesma do LEILOTECH/SUPORTE) → integrar a plataforma **onboarda vários de uma vez**.
3. **Scraper dedicado** só para o que sobrar de fato independente. Reusar o framework `scripts/scraper-puppeteer.mjs` (mesmos guards: só-BR, sem sentinela, `reforcarTipo`, baseline auto-aprendido cobre o novo automaticamente).

Regra de segurança/economia: **sem proxy pago** por padrão (Puppeteer grátis); respeitar `robots`/rate; nunca derrubar o site; dedup por `fonte_id`.

---

## 📊 30/07 — STATUS ATUAL (runner RESIDENCIAL validado; auditoria fresca no banco)
Acervo em **26 fontes**. Desde 25/07, TODO o custo Bright Data das fontes dedicadas virou
coleta GRÁTIS de IP residencial (runner do dono, WSL, 2 tarefas agendadas + marco de 72h no
gate; CI/Bright Data = rede de segurança de 7 dias):
- **SOLEON** ✅ residencial — calil (CALIL 100) + vegas (VEGAS 42) + 3torres (TORRES3 8);
- **GESTAOLEILOES** ✅ residencial (188) — granado, lancenoleilao, extrajust, lancetotal, vinco;
- **VLANCE** ✅ residencial (29) — verdeamarelo, sudeste, capitalvalor; **sanches + destak
  ADICIONADOS como tenants em 30/07** (recon-2 já provara que são Vlance — validar no próximo run);
- **RJLEILOES** ✅ residencial (16) · **PECINI** ✅ residencial (45).
Do backlog de 58: **~15 domínios com scraper dedicado**, ~20 fluem via agregador (LJUD 39
leiloeiros, LEILOTECH ~13, SUPORTE, SUPERBID, MEGA/ZUK parciais).

**ROUND 35 (30/07, recon das homes via Actions — debug_fetch ofv35-%) — CLASSIFICAÇÃO FECHADA.**
Plano de ataque em ordem de retorno×esforço (evidências no relatório do round):
1. ✅ **total → SUPERBID storeId 16091** VIVO 30/07 (8 imóveis, 100% uf/valor/link/foto —
   o resto das 65 ofertas é veículo, filtrado) e **crepaldi → SUPERBID storeId 16139**
   ARMADO (loja sem ofertas hoje; `fonte_saude` vai acusar "falhou total 0" até publicarem —
   é esperado, não é bug). Lição do 1º teste: a offer-query em modo loja EXIGE
   `portalId=[2,15]` + `requestOrigin=store` (sem isso volta 0 em silêncio).
2. **gustavoreis → tenant SUPORTE** (static.suporteleiloes.com.br/gustavoreisleiloescombr/):
   config de tenant; cuidado com eventos EXTERNOS (Comprei/PGFN) para não contar como lote.
3. **bomnegocio + paulistana → tenants Vlance** ✅ ADICIONADOS 30/07 (paulistana só tem leilão
   de SIMULAÇÃO hoje — armado p/ quando publicar).
4. ✅ ⭐ **sato → dedicado BARATO** VIVO 30/07 (`scripts/scraper-sato.mjs` + workflow
   `scraper-sato.yml`): dry-run validou 119 leilões em 9 págs da API, egress datacenter OK
   (roda na CI grátis, sem Bright Data), rota `/leilao/{id}` válida; 30 imóveis lote-único
   prontos gravados no 1º run live. PENDENTE: 38 leilões multi-lote aguardam recon do
   endpoint de detalhe (lotes individuais) + decidir cron.
5. **picelli + shiokawa → cluster NOVO "PostgREST white-label"**: ambos expõem
   `api.<dominio>/rest/v1/auctions|lots` (Supabase/PostgREST aberto, schema idêntico) — 1
   scraper genérico atende os 2 e futuros sites da plataforma (centenas de lotes no picelli).
6. **econfianca → raspar a ORIGEM e-leiloes.com.br** (cards apontam p/ lá; convenção de path
   igual à do SUPORTE — 1 mini-recon confirma se o scraper SUPORTE serve; cobriria o portal todo).
7. **alfa → dedicado** (Django server-rendered + /filters/; leiloeiro relevante de imóveis SP).
8. **sumare → dedicado** HTML /leiloes/{id} (médio; capturou no round apesar do timeout inicial).
9. **hisa + osvaldo + saocaetano → cluster "Plataforma Leiloar"** (server-rendered, sem API) —
   por último; só osvaldo mostrou imóveis relevantes (515m² Osasco TRT-2).
10. **delano (Cloudflare 522 — site fora do ar) e elizabeth (render falhou)**: reagendar no
    Round 36, junto dos portais (e-leiloeiro, centraljudicial, leilaobrasil, hastapublica,
    judhastas) + confirmar brunoleiloes via LJUD + albertomacedo 0 no Superbid.

## 📊 25/07 — STATUS VIVO da cobertura (auditoria no banco)
Acervo total **~33,5 mil ativos** em **25 fontes**. Boa parte do backlog de 58 domínios já
FLUI pelos agregadores (não exige scraper novo):
- **LJUD** — 1.035 ativos, **39 leiloeiros distintos** (Álvaro, Thaís, Planalto/Ana Blasczyk,
  Verde Amarelo/Arthur, família Fixer, Rigolon, Carlo Ferrari, Giordano, Francisco Freitas,
  Akimoto, etc. — cobre a maioria dos judiciais de SP da lista).
- **LEILOTECH** — 84 ativos, **13 leiloeiros** (Topo, AL, AM, Bringel, KS, Spencer, Túlio, VM…).
- **SUPORTE** — 27 ativos, 3 (Gustavo Reis, Líder, Valero). **GESTAOLEILOES** — 123 (Granado,
  Lance no Leilão). **SOLEON** — CALIL/VEGAS/TORRES3 (48). **SBID9** — LiderProp/NarvaezBid.

**Ainda pendente (0 acervo → exige scraper dedicado, recon vivo via Bright Data na CI):**
crepaldi, e-confianca, sato/hisa, osvaldo/elizabeth (Seoanes), alfaleiloes ⭐, destak ⭐,
totalleiloes, delano, picelli, shiokawa, bomnegocio, paulistana, e o cluster **Vlance /v3/**
(verdeamarelo/sudeste/capitalvalor/sanches). **Não dá para construir/testar daqui** — o egress
do ambiente de dev está bloqueado (HTTP 000 nos sites); a construção roda na CI (`recon-deep.yml`
→ scraper dedicado), e **consome cota Bright Data** (teto 450/sem), então precisa do go-ahead do dono.

**Próximo lever de melhor retorno (ordem):** (1) **SUPORTE tenant enumeration** (cunha, vinco —
tenants `static.suporteleiloes.com.br/{dominio}/`, o mais barato); (2) **Vlance /v3/** (1 scraper
onboarda verdeamarelo+sudeste+capitalvalor+sanches); (3) grau-3 de alto valor unitário: **alfaleiloes**
(só imóveis, nacional, provável API) e **destak**.

---

## 🚀 23/07 — RECON VIVO (Bright Data) + INTEGRAÇÃO POR CLUSTER
O recon-1 (`recon-leiloeiros-backlog`) classificou a plataforma pela home; o recon-2
(`recon-deep`, listing+detalhe) revelou a estrutura viva. Os 0-acervo se agrupam em POUCOS
clusters de plataforma — **1 scraper onboarda vários**:

| Cluster | Domínios | Estrutura | Acesso | Scraper |
|---|---|---|---|---|
| **SOLEON** | 3torres, calil, vegas (+ RJ Leilões já vivo) | listagem `/lotes/imovel?tipo=imovel&page=N`; detalhe `/item/{id}/detalhes` | Bright Data (bloqueiam datacenter mesmo sem CF aparente) | `scraper-soleon.mjs` ✅ |
| **Gestão de Leilões (PHP)** | extrajust, lancetotal, lancenoleilao, granado | `leilao.php?idLeilao=N` = EVENTO multi-lote inline; latin1; filtra `CATEGORIA` | Bright Data (Cloudflare) | `scraper-gestao.mjs` ✅ |
| **Vlance /v3/** | verdeamarelo, sudeste, capitalvalor | `/leilao/index/imoveis`, hasApi | — | ⏳ próximo |
| **SUPERBID rede** | zaccarino, crepaldi | loja oficial Superbid | rede já raspada | verificar cobertura |
| **WordPress/Nuxt** | e-confianca, (osvaldo/sanches/hisa? backend comum `/leilao/N`) | SPA Vue `LoteCard.vue` | — | ⏳ investigar |

**Correções de plataforma vs. recon-1 (por evidência viva):** destak=**Vlance** (não indep.);
verdeamarelo/sudeste/capitalvalor=**Vlance+LJUD**; zaccarino/crepaldi=**Superbid**;
e-confianca=**WordPress+Nuxt**; gustavoreis/valero=**SUPORTE** (já integrados, #201).

**Sub-cotas Bright Data** adicionadas: `soleon`=150/sem, `gestao`=150/sem (o teto global de
450/sem no banco segue como trava dura de custo).

---

## ✅ JÁ COBERTOS (via portal que já raspamos — confirmar cobertura, custo ~0)
Match por NOME do leiloeiro no nosso acervo (⚠️ confirmar que é o mesmo CPF/leiloeiro):
- [x] `webleiloes.com.br` → **WEBLEILOES** (direto, 92 ativos)
- [x] `liderleiloes.com.br` → **SUPORTE** (Líder Leilões, 11)
- [x] `topoleiloes.com.br` → **LEILOTECH** (Topo Leilões, 12)
- [x] `alessandroteixeiraleiloes.com.br` → **LJUD** (Alessandro de Assis Teixeira, 13)
- [x] `thaisteixeiraleiloes.com.br` → **LJUD** (Thaís Costa Bastos Teixeira, 53)
- [x] `alvaroleiloes.com.br` → **LJUD** (Álvaro Sérgio Fuzo, 100) ⚠️confirmar
- [x] `giordanoleiloes.com.br` → **LJUD** (Giordano Bruno Coan Amador, 117)
- [x] `franciscofreitasleiloes.com.br` → **LJUD** (Francisco Freitas, 101)
- [x] `rigolonleiloes.com.br` → **LJUD** (Rodrigo Aparecido Rigolon, 33)
- [x] `carloferrarileiloes.com.br` → **LJUD** (Carlo Ferrari, 8)
- [x] `danieloliveiraleiloes.com.br` → **LJUD** (Daniel Oliveira Júnior, 10)
- [x] `fabiobarbosaleiloes.com.br` → **LJUD** (Fabio Gonçalves Barbosa, 5)
- [x] `gilsonleiloes.com.br` → **LJUD** (Gilson Keniti Inumaru, 6)
- [x] `verrileiloes.com.br` → **LJUD** (Helton Verri, 4)
- [x] `akimotoleiloes.com.br` → **LJUD** (Zuleika Matsumura Akimoto, 2)
- [x] `cidafixerleiloes.com.br` / `mariafixerleiloes.com.br` → **LJUD** (família Fixer: Aparecida/Conceição/Leonice, ~36) ⚠️confirmar qual
- [ ] `brunoleiloes.com.br` → **LJUD provável** (Bruno Henrique Lopes / Bruno Fernando Meireles) ⚠️confirmar
- [ ] `albertomacedoleiloes.com.br` → **SUPERBID** (Alberto Macedo, **0 ativos** hoje) ⚠️por que 0? verificar

## 🔲 A INTEGRAR / VERIFICAR (sem match no acervo — checar portal antes de scraper dedicado)
> Passo 1 para CADA: recon rápido — plataforma? já está no LJUD/outro portal? tem JSON/API?
- [x] `calilleiloes.com.br` → **SOLEON** (`scraper-soleon.mjs`, 23/07)
- [x] `vegasleiloes.com.br` → **SOLEON** (`scraper-soleon.mjs`, 23/07)
- [x] `3torresleiloes.com.br` → **SOLEON** (`scraper-soleon.mjs`, 23/07)
- [~] `extrajustleiloes.com.br` / `lancetotal.com.br` / `lancenoleilao.com.br` / `granadoleiloes.com.br` → **Gestão de Leilões PHP** (`scraper-gestao.mjs`, 23/07)
- [~] `crepaldileiloes.com.br` → **SUPERBID loja 16139** (armado 30/07 — loja sem ofertas hoje)
- [ ] `planaltoleiloes.com.br`
- [ ] `e-leiloeiro.com.br`  *(pode ser plataforma white-label — alto valor se onboarda vários)*
- [ ] `centraljudicial.com.br`  *(nome sugere portal agregador — verificar)*
- [ ] `extrajustleiloes.com.br`
- [ ] `lancetotal.com.br`
- [x] `satoleiloes.com.br` → **SATO** (API pública, `scraper-sato.mjs`, 30/07)
- [ ] `sanchesleiloes.com.br`
- [ ] `verdeamareloleiloes.com.br`
- [ ] `lancenoleilao.com.br`
- [ ] `eduardosorgileiloeiro.com.br`
- [ ] `leilaobrasil.com.br`  *(possível plataforma — verificar)*
- [ ] `alfaleiloes.com`
- [ ] `sudesteleiloes.com.br`
- [ ] `delanoleiloes.com.br`
- [ ] `hastapublica.com.br`  *(nome de plataforma — verificar)*
- [ ] `zaccarino.com.br`
- [ ] `gustavoreisleiloes.com.br`
- [ ] `sumareleiloes.com.br`
- [ ] `vegasleiloes.com.br`
- [ ] `cunhaleiloeiro.com.br`
- [ ] `picellileiloes.com.br`
- [ ] `valeroleiloes.com.br`
- [ ] `saocaetanoleiloes.com.br`
- [ ] `calilleiloes.com.br`
- [ ] `capitalvalorleiloes.com.br`
- [ ] `paulistanaleiloes.com.br`
- [ ] `3torresleiloes.com.br`
- [ ] `elizabethseoanes.com.br`
- [ ] `destakleiloes.com.br`
- [ ] `e-confianca.com.br`
- [ ] `shiokawaleiloes.com.br`
- [ ] `bomnegocioleiloes.com.br`
- [ ] `osvaldoleiloes.com.br`
- [ ] `judhastas.com.br`  *(nome sugere portal — verificar)*
- [ ] `granadoleiloes.com.br`
- [x] `totalleiloes.com.br` → **TOTALLEILOES** (SUPERBID loja 16091, 30/07)
- [ ] `hisaleiloes.com.br`
- [ ] `vincoleiloes.com.br`

## 📌 Notas
- Lista original tinha duplicatas (`leilaobrasil` ×3, `hastapublica` ×2) — deduplicadas para **58 domínios únicos**.
- Match "via LJUD" é por **nome** — confirmar CPF/leiloeiro no 1º recon (homônimos existem).
- Ao integrar cada um: registrar em `leiloeiro_conhecimento` + o **baseline auto-aprendido** (monitor) já passa a vigiá-lo após alguns runs, sem hardcode.
- **Não** captar equipamento/veículo, parte ideal, direito creditório (regras do dono).

---

## 🔎 Recon dos 34 domínios restantes (22/07 — sessão de diagnóstico)
**Método:** cross-check no `imoveis_leilao` (fonte/leiloeiro/url) + WebSearch por domínio. ⚠️ WebFetch dos sites deu **403 em 100%** (anti-bot/proxy deste ambiente) → detecção de plataforma é por pistas incidentais (CDN de edital, links "loja-oficial", telefones em bloco, taglines) = **leads fortes, não verificados tenant-a-tenant**. Só `planalto` e `verdeamarelo` aparecem literalmente no acervo (via LJUD).

**Contagem por grau:** Grau 1 (custo ~0) = **5** · Grau 2 puro confirmado = 0 (mas **5 alavancas de plataforma** rebaixam 7+ de 3→2) · Grau 3 (scraper dedicado) = **29**.

| Domínio | Leiloeiro | Plataforma (lead) | No acervo? | Grau |
|---|---|---|---|---|
| planaltoleiloes.com.br | Planalto (Ana C. Blasczyk) | LJUD | **Sim** | 1 |
| verdeamareloleiloes.com.br | Verde Amarelo (Arthur Vieira) | LJUD | **Sim** | 1 |
| zaccarino.com.br | Zaccarino (JUCESP 1025) | Superbid (loja oficial) | não | 1 |
| cunhaleiloeiro.com.br | Cunha (JUCESP 870) | SUPORTE (white-label, já raspamos) | não | 1 |
| vincoleiloes.com.br | Vinco = rebrand Frazão | SUPORTE + grupo FRAZAO | não | 1 |
| sanchesleiloes.com.br | Sanches (SP) | Vlance | não | 3→2 |
| calilleiloes.com.br | Calil (TRT-2/15) | NYX (plataformadeleiloes.com.br) | não | 3→2 |
| extrajustleiloes.com.br | Extra Just (JUCESP 1144) | cluster "Gestão de Leilões" SP | não | 3→2 |
| lancetotal.com.br | Lance Total (A. M. Inoue) | cluster "Gestão de Leilões" SP | não | 3→2 |
| lancenoleilao.com.br | Lance no Leilão (JUCESP 826) | cluster "Gestão de Leilões" SP | não | 3→2 |
| granadoleiloes.com.br | Granado (JUCESP 974) | cluster "Gestão de Leilões" SP | não | 3→2 |
| sumareleiloes.com.br | Sumaré (hospeda 3os) | mini-plataforma | não | 3→2 |
| eduardosorgileiloeiro.com.br | C. E. Sorgi (JUCESP 1039) | via Sumaré | não | 3 |
| satoleiloes.com.br | Sato (S. Caetano) | independente | não | 3 (par c/ HISA) |
| hisaleiloes.com.br | HISA (Tatiana Hisa Sato) | independente | não | 3 (par c/ Sato) |
| osvaldoleiloes.com.br | Osvaldo Seoanes (JUCESP 340) | independente `/externo/` | não | 3 (par c/ Elizabeth) |
| elizabethseoanes.com.br | M. E. Seoanes = Sublime | independente | não | 3 (par c/ Osvaldo) |
| alfaleiloes.com | Alfa (Davi B. de Aquino) | independente (provável API) | não | 3 ⭐ só imóveis, nacional |
| gustavoreisleiloes.com.br | Gustavo Reis | independente | não | 3 ⭐ unificados TRT-2 |
| 3torresleiloes.com.br | 3 Torres (Rib. Preto) | independente | não | 3 ⭐ faz CAIXA |
| destakleiloes.com.br | Destak (fam. Uebara) | independente | não | 3 ⭐ site limpo |
| crepaldileiloes.com.br | Crepaldi (Bauru) | independente | não | 3 |
| e-confianca.com.br | e-Confiança (Rib. Preto) | independente | não | 3 |
| totalleiloes.com.br | Total (SP) | independente | não | 3 |
| sudesteleiloes.com.br | Sudeste (SP) | independente | não | 3 |
| delanoleiloes.com.br | Delano (Santo André) | independente | não | 3 |
| vegasleiloes.com.br | Vegas (Rib. Preto) | independente | não | 3 |
| picellileiloes.com.br | Picelli (Jaguariúna) | independente | não | 3 |
| valeroleiloes.com.br | Valero (JUCESP 809, 5 UFs) | independente | não | 3 |
| saocaetanoleiloes.com.br | São Caetano Leilões | independente `/externo/` | não | 3 |
| shiokawaleiloes.com.br | Shiokawa (Praia Grande) | independente | não | 3 |
| bomnegocioleiloes.com.br | Bom Negócio (SP) | independente (S3) | não | 3 |
| capitalvalorleiloes.com.br | Capital Valor | independente | não | 3 |
| paulistanaleiloes.com.br | Paulistana | independente | não | 3 |

**5 alavancas de plataforma (ordem de retorno):**
1. **SUPORTE (já raspamos!)** — `cunha` e `vinco` são tenants `static.suporteleiloes.com.br/{dominio}/`. Ação **mais barata do backlog**: estender a enumeração de tenants do scraper SUPORTE → pega cunha+vinco (e possivelmente outros dos 29) de graça.
2. **Cluster "Gestão de Leilões" SP** (Inoue/back-office 3393-31XX) — extrajust, lancetotal, lancenoleilao, granado compartilham telefone sequencial + tagline "Gestão de Leilões" → **1 template cobre os 4+**.
3. **Vlance** (sanches) — `s3.amazonaws.com/vlance-cdn-v2/`.
4. **NYX / plataformadeleiloes.com.br** (calil) — `cms.plataformadeleiloes.com.br/{tenant}/`.
5. **Sumaré** — mini-plataforma (Sumaré + Sorgi + externos).

**Grau-3 de maior valor unitário (priorizar):** alfaleiloes (só imóveis, nacional, provável API), gustavoreisleiloes (unificados TRT-2), 3torres, destak.

**Próximo passo p/ fechar leads:** um recon de CDN por domínio (`static.suporteleiloes.com.br`, `vlance-cdn`, `plataformadeleiloes`) **em ambiente com egress liberado** — pode converter vários Grau 3 em 1/2. Aqui o WebFetch está bloqueado.

---

## ✅ Verificação no ACERVO (banco, 22/07) — corrige os chutes de plataforma da recon
A captura é **dirigida por agregador**: um leiloeiro entra quando os lotes dele estão numa
plataforma que já raspamos (CEF, SUPERBID, MEGA, ZUK, LJUD, LEILOTECH, WEBLEILOES, FRAZAO…).
**Não há "config de leiloeiro" para adicionar** — daí não dá para "ligar de graça" um que não
aparece. Situação real dos alvos checados:

| Domínio | No acervo | Via (fonte real) | Status |
|---|---|---|---|
| frazao / **vinco** | 132 | FRAZAO | ✅ já flui |
| sumaré | 12 | LEILOTECH/MEGA/WEBLEILOES | ✅ parcial |
| planalto | 8 | MEGA/ZUK *(não LJUD como a recon supôs)* | ✅ parcial |
| cunha | 4 | MEGA/ZUK *(não SUPORTE)* | ✅ parcial |
| sanches | 2 | ZUK | ✅ parcial |
| sato | 1 | ZUK | ✅ parcial |
| verdeamarelo, zaccarino, alfaleiloes, gustavoreis, 3torres, destak, calil, extrajust, granado, lancetotal, valero, hisa, sorgi | 0 | — | ⏳ pendente (scraper dedicado) |

**Conclusão:** os "gratuitos" (que ridem em agregador) **já estão entrando** — nada a construir.
Os **0-acervo** exigem scraper dedicado (site do leiloeiro ou novo agregador), o que precisa de
**recon da estrutura viva via Bright Data** — roda na Vercel/CI (o ambiente de dev bloqueia os
sites). Não dá para construir/validar um scraper novo de dentro do dev.
