# 🏠 Runner residencial + roadmap para ZERAR o Bright Data

> ⚡ **ATUALIZAÇÃO (sessão 18): coleta OPORTUNISTA ao abrir o app.** Agora, quando o STAFF abre o
> app (celular ou PC), o servidor dispara na NUVEM os scrapers das fontes pagas (SOLEON/GESTAO/RJ/
> PECINI) **respeitando um espaçamento de ~20h** (gate atômico `coleta_oportunista_claim` +
> `api/coleta-oportunista.js`, acionado no login pelo `AuthContext`). Quem acessa todo dia mantém
> essas fontes frescas **sem PC ligado e sem app aberto o tempo todo**, e sem gastar Bright Data a
> cada abertura. A **rede de segurança dos 7 dias** = os workflows dessas fontes já rodam 1x/semana
> na CI (dispara mesmo que ninguém abra o app). **Isso usa Bright Data** (na nuvem). O runner
> residencial abaixo continua sendo o caminho para **ZERAR** o Bright Data — é OPCIONAL agora.

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

## ✅ PASSO A PASSO PARA LIGAR O RUNNER (ativação)

### Pré-requisitos (na máquina residencial)
- Uma máquina **num IP residencial**, **sempre ligada** no horário do cron (PC/Mac/Raspberry Pi ou
  VPS de IP residencial — **não** serve VPS de datacenter: o objetivo é justamente o IP de casa).
- **git** + **Node 18+** (roda os scrapers `.mjs` e instala o Chromium do puppeteer) + **Python 3**
  (só para o Vlance — `scraper_vlance.py`). Bash com `flock` (Linux tem; no macOS o script apenas
  pula a trava de instância única, sem problema).

### Passos
1. **Clonar e instalar** (uma vez):
   ```bash
   git clone https://github.com/tarcisionogueira/tsn-app.git
   cd tsn-app
   npm ci        # instala tb. o Chromium do puppeteer (headless de GESTAO/RJ)
   pip3 install requests   # dependência do scraper_vlance.py (Vlance)
   ```
2. **Credenciais** — crie `~/.bidpro-runner.env` e proteja o arquivo (contém a SERVICE KEY):
   ```bash
   cat > ~/.bidpro-runner.env <<'EOF'
   VITE_SUPABASE_URL=https://zuwfiwokkdytvjixiwac.supabase.co
   SUPABASE_SERVICE_KEY=<service key — Supabase > Settings > API > service_role>
   EOF
   chmod 600 ~/.bidpro-runner.env    # só o seu usuário lê (a service key é sensível)
   ```
   > Não comite esse arquivo. A **service_role key** dá acesso total ao banco.
3. **Permissão de execução**: `chmod +x scripts/runner-residencial.sh`
4. **Teste manual (validação da 1ª rodada)** — rode UMA vez na mão e leia o log:
   ```bash
   ./scripts/runner-residencial.sh 2>&1 | tee ~/bidpro-runner.log
   ```
   Esperado: cada fonte (SOLEON, GESTAO, RJ, VLANCE) grava **sem tocar no Bright Data**. Se GESTAO/RJ
   não passarem o Cloudflare de primeira, me mande o `~/bidpro-runner.log` que eu ajusto a espera/heurística.
5. **Agendar no cron** (seg e qui, 08:00 — casa com o gate de 2x/semana):
   ```bash
   crontab -e
   # adicione (troque /CAMINHO pelo caminho real do repo):
   0 8 * * 1,4  /CAMINHO/tsn-app/scripts/runner-residencial.sh >> $HOME/bidpro-runner.log 2>&1
   ```
6. **DEPOIS de validar (passo que zera o Bright Data)** — desligar os workflows **pagos** da CI para
   não gastarem BD em paralelo com o runner. Me avise que eu comento os `cron:` de
   `scraper-soleon.yml`, `scraper-gestao.yml`, `scraper-rj.yml`, `scraper-pecini.yml` e
   `scraper-vlance.yml` (deixando `workflow_dispatch` como reserva manual). **Não desligue** os
   grátis (`scraper.yml` CEF e `leiloeiros-puppeteer.yml`) — esses não usam BD e já rodam diários.

O `SOLEON_NO_BD=1` / `*_HEADLESS=1` (já no wrapper) **garantem zero BD**: se o direto/headless falhar,
pula a página em vez de gastar cota. A frequência é do `cron` + do gate no banco (2x/semana) — não roda
a cada acesso.

> **Quer as fontes pagas mais frequentes que 2x/semana?** O limite é o gate `coleta_cliente_claim`
> (hardcoded 2x/sem). Posso relaxar para 3x/sem ou diário e ajustar o cron — recomendo validar em
> 2x/semana primeiro (menos risco de anti-bot no seu IP) e subir depois.

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
