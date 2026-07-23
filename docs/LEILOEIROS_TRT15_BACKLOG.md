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
- [ ] `crepaldileiloes.com.br`
- [ ] `planaltoleiloes.com.br`
- [ ] `e-leiloeiro.com.br`  *(pode ser plataforma white-label — alto valor se onboarda vários)*
- [ ] `centraljudicial.com.br`  *(nome sugere portal agregador — verificar)*
- [ ] `extrajustleiloes.com.br`
- [ ] `lancetotal.com.br`
- [ ] `satoleiloes.com.br`
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
- [ ] `totalleiloes.com.br`
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
