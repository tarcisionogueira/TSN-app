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
   # Dependência do scraper_vlance.py. Em Debian/Ubuntu recentes o `pip3 install` recusa com
   # "externally managed environment" (PEP 668) — o jeito limpo é o pacote do sistema:
   sudo apt install -y python3-requests
   # (alternativa, se preferir pip: pip3 install --break-system-packages requests)
   ```
   > ⚠️ **Não é bloqueante.** `requests` só é usado pelo Vlance. Sem ela, o runner roda todas as
   > outras fontes normalmente e só o Vlance falha — dá para validar o resto antes de resolver isto.
2. **Credenciais** — crie `~/.bidpro-runner.env` e proteja o arquivo (contém a SERVICE KEY).
   **Use um editor, não copie-e-cole um bloco com placeholder:**
   ```bash
   nano ~/.bidpro-runner.env      # ou vim/mcedit
   chmod 600 ~/.bidpro-runner.env # só o seu usuário lê
   ```
   Duas linhas, com a **chave de verdade** no lugar do `eyJ…`:
   ```
   VITE_SUPABASE_URL=https://zuwfiwokkdytvjixiwac.supabase.co
   SUPABASE_SERVICE_KEY=eyJhbGciOi…
   ```
   Onde pegar: **Supabase → Settings → API → Project API keys → `service_role` → Reveal**. É a
   que avisa que ignora RLS — **não** a `anon`/`publishable`. É um JWT: começa com `eyJ`.

   > ⚠️ **O erro que já aconteceu (29/08):** o passo trazia
   > `SUPABASE_SERVICE_KEY=<service key — Supabase > Settings > API > service_role>` dentro de um
   > heredoc, e o placeholder foi gravado **literalmente**. Como `<` e `>` são redirecionamento no
   > bash, o `source` do runner quebrava com `syntax error near unexpected token 'newline'` — e a
   > mensagem apontava para o arquivo de env, não para a causa. Placeholder que parece comando é
   > armadilha de documentação, não erro de quem executa.

   **Conferir sem imprimir a chave:**
   ```bash
   ( set -a; . ~/.bidpro-runner.env; set +a; \
     echo "URL=${VITE_SUPABASE_URL:-VAZIA} · chave com ${#SUPABASE_SERVICE_KEY} caracteres" )
   ```
   Esperado: a URL e algo como **`chave com 200+ caracteres`**. Se der erro de sintaxe ou
   `chave com 0 caracteres`, o arquivo ainda está com o placeholder.

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

## 🔎 TRIAGEM RESIDENCIAL — trazer os leiloeiros que o Cloudflare esconde (29/08)

O runner deixou de servir só para COLETAR: ele agora também **descobre**, e é assim que os
leiloeiros de MG entram sem gastar Bright Data.

**O problema medido:** a triagem da JUCEMG classificou 141 sites e deixou **53 como
`bloqueado`**. Em **51 deles `plataforma` ficou NULA** — e esse null não quer dizer "não roda
plataforma conhecida": quer dizer que o Cloudflare devolveu *"Just a moment..."* e **o HTML nunca
foi lido**. São 53 leiloeiros contados como "custa dinheiro" sem que ninguém saiba se já teriam
parser pronto. Dois já se sabe que sim — `adrianoleiloeiro.com.br` e `angelabecharaleiloes.com.br`,
ambos **Superbid**, plataforma que já parseamos.

**O que mudou:** `recon-triagem-jucemg.mjs` ganhou duas chaves, e o passo entrou no runner:

| Env | O que faz |
|---|---|
| `TRIAGEM_HEADLESS=1` | quando o fetch simples é bloqueado, repete no **Chromium real** (o mesmo `fetch-residencial.mjs` que GESTAO e RJ usam). Nunca por padrão: navegador só entra onde o simples não serviu |
| `TRIAGEM_BLOQUEADOS=1` | a lista vem do **banco** (`leiloeiro_triagem where bloqueado`), não do JSON — a rodada custa ~53 páginas em vez de 141, e serve **JUCESP/JUCERJA/JUCEES** sem editar nada |

**Bright Data continua fora**, como sempre esteve neste script: descobrir o que existe segue
custando R$ 0. O que mudou é que o "de graça" agora alcança quem estava atrás do Cloudflare.

**Como ler o resultado:** ao fim da rodada o script imprime `DESTRAVADOS pelo residencial: N de
53` e, entre eles, **quais já têm parser** — que é a diferença entre *configurar um tenant* e
*escrever parser novo*. Quem seguir bloqueado mesmo pelo navegador residencial é o resíduo que
realmente custa dinheiro.

> ⚠️ **Plataforma descoberta NÃO é lote coletado — dry-run antes de subir tenant.** Em 29/08, 11
> sites classificados como Superbid enumeraram **ZERO** lotes: a assinatura de HTML provava que o
> site *menciona* a plataforma, não que *roda* o catálogo dela. O script imprime esse aviso ao
> final de propósito.

**Detalhe de implementação que vale saber:** o passo **não** passa pelo helper `rodar`. Aquele
gate conclui com **prova de gravação no acervo**, e a triagem grava em `leiloeiro_triagem` — pelo
`rodar` ela imprimiria *"saiu com sucesso mas NÃO gravou no acervo"* em toda rodada. Alarme falso
recorrente é o que treina o dono a ignorar o log. Descoberta tem contrato diferente de coleta.

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
