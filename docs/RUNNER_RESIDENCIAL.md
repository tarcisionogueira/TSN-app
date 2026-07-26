# 🏠 Runner residencial + roadmap para ZERAR o Bright Data

> Objetivo do dono: economizar a cota do Bright Data (BD) rodando as buscas de **IP real** (grátis),
> deixando o BD só como **último caso**. Frequência: **máx. 2x/semana** por fonte.

## Por que funciona
Muitos leiloeiros bloqueiam **só IP de datacenter** (CI/Vercel) — de um **IP residencial** o fetch
direto funciona. Duas vias grátis, nesta ordem, antes do BD:

1. **Client-side (navegador do STAFF)** — só p/ fontes com **API JSON e CORS aberto** (o navegador
   não lê HTML de outro domínio). Já ativo p/ **Vlance** (`api/coleta-cliente.js` + gate 2x/semana).
2. **Runner residencial** (este) — um script rodando numa máquina residencial (seu PC/Mac/Pi/VPS
   residencial), agendado por `cron` 2x/semana. Resolve fontes **sem Cloudflare** com fetch direto,
   e as **com Cloudflare** com Chromium headless (tier abaixo).

## Anti-bloqueio (concorrência do mesmo IP)
Vários scrapers/máquinas usando o mesmo IP ao mesmo tempo dispararia anti-bot. Três camadas evitam isso:
1. **Sequencial** — o wrapper roda **uma fonte por vez** (nunca vários sites em paralelo pelo mesmo IP);
   `flock` garante **instância única** por máquina (dois runners não rodam juntos).
2. **Gate no banco** (`coleta_cliente_claim/concluir`) — **2x/semana por fonte**, trava de 15 min e
   **coordenação entre máquinas**: se duas máquinas (ou o client-side) tentarem a mesma fonte, só uma
   passa; a outra pula. Sem overlap → sem bloqueio por concorrência.
3. **Paceamento** — jitter (0,6–1,8 s) antes de cada requisição headless; o cookie do Cloudflare
   (`cf_clearance`) persiste entre páginas → as requisições seguintes quase não são desafiadas.

*(O client-side do staff também é gate-coordenado: mesmo com vários staff logados, só **um** coleta por
janela — e cada um usa o próprio IP residencial, então não há sobrecarga de um único IP.)*

## Setup do runner (uma vez)
1. Numa máquina residencial sempre ligada: `git clone` do repo (ou copie `scripts/`), depois `npm ci`.
2. Crie `~/.bidpro-runner.env`:
   ```
   VITE_SUPABASE_URL=https://zuwfiwokkdytvjixiwac.supabase.co
   SUPABASE_SERVICE_KEY=<service key — Supabase > Settings > API>
   ```
3. `chmod +x scripts/runner-residencial.sh`
4. `crontab -e` e adicione (seg e qui, 08:00 — **2x/semana**):
   ```
   0 8 * * 1,4  /CAMINHO/TSN-app/scripts/runner-residencial.sh >> $HOME/bidpro-runner.log 2>&1
   ```
5. Confira o `~/bidpro-runner.log` após a 1ª rodada (deve dizer `via: gratis`, sem Bright Data).

O `SOLEON_NO_BD=1` (já no wrapper) **garante zero BD**: se o direto falhar, pula a página em vez de
gastar cota. A frequência é do `cron` (2x/semana) — não roda a cada acesso.

## Estado por fonte (o que já está grátis e o que falta)
| Fonte | BD/sem hoje | Via grátis | Status |
|---|---|---|---|
| **Vlance** (verdeamarelo/sudeste/capitalvalor) | — | client-side (staff) | ✅ **feito** |
| **SOLEON** (calil/vegas/3torres) | ~150 | runner residencial (fetch direto, sem CF) | ✅ **no runner** (`SOLEON_NO_BD=1`) |
| **LJUD** + MEGA/ZUK/GRUPOLANCE/SUPERBID/SODRÉ/FRAZÃO | ~0 | `scraper-puppeteer.mjs` já usa **navegador real** (0 BD) | ✅ **já grátis** (na própria CI) |
| **GESTAOLEILOES** (granado/vinco/…) | ~150 | runner residencial **headless** (`GESTAO_HEADLESS=1`) | ✅ **no runner** |
| **RJ Leilões** | ~120 | runner residencial **headless** (`RJ_HEADLESS=1`) | ✅ **no runner** |
| **radar / docs** | 250 / 150 | — (autocomplete-geo / download de PDF) | manter (propósito distinto, baixo volume) |

## 🗺️ Próximos passos para ZERAR o Bright Data
Praticamente **tudo já está resolvido no código** — falta só ATIVAR o runner residencial:
1. **[DONO] Subir o runner residencial** (setup acima) — ao rodar, zera **SOLEON** (direto) +
   **GESTAOLEILOES** e **RJ** (Chromium headless). É o único passo que falta para o BD chegar a ~0.
   `npm ci` já instala o Chromium do puppeteer (o headless usa ele).
2. **[DONO] 1ª rodada de validação:** rode `scripts/runner-residencial.sh` na mão uma vez e confira o
   `bidpro-runner.log` — as fontes devem gravar sem tocar no Bright Data. (Não deu p/ testar daqui: o
   egress deste ambiente é bloqueado e o Cloudflare exige IP residencial + navegador real.) Se GESTAO/RJ
   não passarem o Cloudflare de primeira, me manda o log que eu ajusto a espera/heurística do headless.
3. **[CLAUDE] Confirmar Vlance** na 1ª coleta client-side (o que entrou no acervo) — na próxima sessão.
4. **docs/radar**: `docs` (PDF) e `radar` (geo) não são listagem de lote; ficam com BD (baixo volume) —
   é o "resíduo" que o dono aceitou como último caso.

**Já grátis sem runner:** LJUD, MEGA, ZUK, GRUPOLANCE, SUPERBID, SODRÉ, FRAZÃO — o `scraper-puppeteer.mjs`
já usa navegador real (0 Bright Data) na própria CI. **Vlance** — client-side (staff).

**Resultado ao ativar o runner:** Vlance (client-side) + LJUD/MEGA/ZUK/… (puppeteer CI) + SOLEON/GESTAO/RJ
(runner residencial) → **Bright Data só para o resíduo** `docs`/`radar`, exatamente como você pediu.
