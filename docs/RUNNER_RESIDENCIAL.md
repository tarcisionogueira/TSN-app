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
| **LJUD** (agregador, ~40 leiloeiros) | ~180 (o maior) | client-side SE tiver API CORS-aberta | 🟡 **recon** (rodar o mapper — ver playbook) |
| **GESTAOLEILOES** (granado/vinco/…) | ~150 | runner residencial **headless** (tem Cloudflare) | ⏳ tier headless |
| **RJ Leilões** | ~120 | runner residencial **headless** (100% Cloudflare) | ⏳ tier headless |
| **radar / docs** | 250 / 150 | — (autocomplete-geo / download de PDF) | manter (propósito distinto) |

## 🗺️ Próximos passos para ZERAR o Bright Data
1. **[DONO, 30s] Recon do LJUD** (maior economia): rode o mapper (`docs/RECON_LEILOEIROS_PLAYBOOK.md`)
   em `leiloesjudiciais.com.br`. Se aparecer uma chamada `/api/...` JSON e o fetch cross-origin
   funcionar de `bidprobrasil.com.br` → me avise que eu ligo o LJUD no **client-side** (como o Vlance)
   → corta a MAIOR sub-cota.
2. **[DONO] Subir o runner residencial** (setup acima) → já zera **SOLEON** (fetch direto).
3. **[CLAUDE] Tier headless** no runner (Playwright/Chromium local) p/ **GESTAOLEILOES** e **RJ**
   (Cloudflare) — quando você pedir; roda residencial, grátis.
4. **[CLAUDE] Confirmar Vlance** na 1ª coleta client-side (o que entrou no acervo).
5. **docs/radar**: avaliar caso a caso — `docs` (PDF) e `radar` (geo) não são listagem de lote;
   podem seguir com BD (baixo volume) ou migrar sob demanda.

**Resultado ao fim:** Vlance (client-side) + SOLEON/GESTAO/RJ (runner residencial) + LJUD (client-side
se tiver API) → **BD só para o resíduo** (docs/radar), como o dono pediu.
