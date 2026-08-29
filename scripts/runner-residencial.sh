#!/usr/bin/env bash
# Runner RESIDENCIAL — roda os scrapers de leiloeiro de um IP RESIDENCIAL (grátis, sem Bright Data).
# Muitos sites bloqueiam só IP de datacenter (CI/Vercel) → de casa o navegador/fetch funciona.
#
# ANTI-BLOQUEIO (concorrência de um mesmo IP): 3 camadas —
#   1) SEQUENCIAL: uma fonte por vez (nunca vários sites ao mesmo tempo pelo mesmo IP);
#   2) flock: trava de instância única (a mesma máquina não roda dois runners em paralelo);
#   3) gate no banco (coleta_cliente_claim/concluir): 2x/semana por fonte + trava de 15 min +
#      coordenação ENTRE MÁQUINAS (duas máquinas/staff nunca raspam a mesma fonte ao mesmo tempo).
#
# Setup e roadmap: docs/RUNNER_RESIDENCIAL.md.
#
# CADÊNCIA — agendar DIARIAMENTE (decisão do dono, 29/08). E rodar todo dia NÃO significa
# raspar todo leiloeiro todo dia: o gate `rodar()` continua segurando cada fonte em 72 h, então
# os scrapers seguem 2x/semana e a rodada diária sai barata. Quem aproveita o dia a dia são os
# passos que NÃO passam pelo gate — o radar de editais (o DJEN publica todo dia; é isso que
# tira o radar do Bright Data) e a triagem dos bloqueados.
set -uo pipefail
# Caminho ABSOLUTO de mim mesmo, capturado ANTES do cd — o re-exec da auto-atualização
# depende dele, e depois do cd um "$0" relativo pode não resolver mais.
_SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$0")/.." || exit 1
[ -f "$HOME/.bidpro-runner.env" ] && { set -a; . "$HOME/.bidpro-runner.env"; set +a; }

if [ -z "${SUPABASE_SERVICE_KEY:-}" ] || [ -z "${VITE_SUPABASE_URL:-}" ]; then
  echo "[$(date)] ERRO: defina VITE_SUPABASE_URL e SUPABASE_SERVICE_KEY em ~/.bidpro-runner.env" >&2
  exit 1
fi

# ─── INTERPRETADORES NO PATH (29/08, ao entrar no cron) ──────────────────────────────────────
# O cron NÃO herda o PATH do seu shell: ele roda com algo como /usr/bin:/bin. Node instalado por
# nvm/fnm/asdf vive em ~/.nvm/versions/... e **desaparece** ali dentro.
#
# Por que isto é um `exit` e não um aviso: sem `node`, o `rodar()` abaixo falha logo no
# `coleta-gate.mjs claim`, o `if` dá falso e a fonte é **PULADA EM SILÊNCIO**. O runner
# terminaria "sem erros", com zero coleta, exatamente como o RJ que saía com exit 0 em 0,6 s por
# 12 dias. Rodada que não roda tem que gritar.
for _bin in node python3; do
  command -v "$_bin" >/dev/null 2>&1 || {
    echo "[$(date)] ERRO: '$_bin' não está no PATH ($PATH)." >&2
    echo "  No cron o PATH é mínimo. Rode 'which $_bin' no seu shell e ponha o diretório na" >&2
    echo "  linha PATH=... do crontab, ou exporte PATH no ~/.bidpro-runner.env." >&2
    exit 1
  }
done

# (2) Trava de INSTÂNCIA ÚNICA na máquina: se já há um runner rodando, sai sem duplicar.
exec 9>"$HOME/.bidpro-runner.lock"
if command -v flock >/dev/null 2>&1; then
  flock -n 9 || { echo "[$(date)] já há um runner em execução nesta máquina — saindo."; exit 0; }
fi

# ─── AUTO-ATUALIZAÇÃO (11/08) ────────────────────────────────────────────────
# O runner roda de um clone LOCAL na máquina de casa, então correção feita no repositório só
# chegava aqui quando alguém lembrava de dar `git pull`. Foi assim que o `RJ_DRYRUN=0` ficou
# corrigido no repo e o RJ continuou rodando em dry-run em casa — o pior tipo de pendência,
# porque some da vista de quem corrigiu.
#
# `--ff-only`: só avança se for avanço limpo. Se a cópia local tiver alteração manual, o pull
# falha e o runner segue com o que tem — nunca sobrescreve trabalho local nem para a coleta
# por causa de git. E registra a versão que está rodando, para "está atualizado?" virar dado
# em vez de suposição.
# ⚠️ E O PULL PRECISA REINICIAR O RUNNER (29/08) — defeito REAL, medido no log do dono.
# O bash lê o script SOB DEMANDA, por posição de BYTE. Quando o `git pull` reescreve o arquivo
# que está sendo executado, o bash continua lendo no MESMO offset do arquivo NOVO — e o commit
# que insere linhas no topo desloca tudo. Na 1ª rodada diária (8be909fa) isso **pulou o passo do
# radar inteiro em silêncio**: o log foi de VLANCE direto para a triagem, sem uma linha do radar,
# e ainda assim terminou com "fim." e exit 0.
# Reproduzido em seco: script que se sobrescreve no meio ou salta bloco ou quebra em linha
# partida. Ou seja: **quanto maior a correção que eu mandar, maior a chance de ela não rodar** —
# o pior tipo de bug, porque some justamente na rodada que traz o conserto.
# O `exec` resolve na raiz: relê o arquivo do zero. `RUNNER_REEXEC` impede laço infinito, e o
# `exec 9>` lá em cima reabre a trava (fecha a antiga, então não conflita consigo mesmo).
if [ "${RUNNER_SEM_AUTOUPDATE:-0}" != "1" ]; then
  _antes="$(git rev-parse HEAD 2>/dev/null || echo '?')"
  if git -C "$(pwd)" pull --ff-only --quiet 2>/dev/null; then
    _depois="$(git rev-parse HEAD 2>/dev/null || echo '?')"
    if [ "$_depois" != "$_antes" ]; then
      if [ "${RUNNER_REEXEC:-0}" = "1" ]; then
        echo "[$(date)] AVISO: código mudou DE NOVO no mesmo ciclo ($_antes → $_depois); seguindo sem reiniciar."
      else
        echo "[$(date)] código atualizado ($(git rev-parse --short "$_antes" 2>/dev/null || echo '?') → $(git rev-parse --short HEAD)) — reiniciando na versão nova"
        export RUNNER_REEXEC=1
        exec "$_SELF" "$@"
      fi
    else
      echo "[$(date)] código já atualizado ($(git rev-parse --short HEAD))"
    fi
  else
    echo "[$(date)] AVISO: git pull não avançou — rodando com $(git rev-parse --short HEAD 2>/dev/null || echo 'versão desconhecida'). Alteração local pendente?"
  fi
fi

echo "===== [$(date)] runner residencial ($(git rev-parse --short HEAD 2>/dev/null || echo '?')) ====="

# rodar <FONTE> <comando...> : só executa se o GATE liberar (2x/semana, sem overlap); conclui no sucesso.
#
# ATENÇÃO (lição de 11/08): `exit 0` do scraper NÃO é prova de coleta. O RJ rodava em
# dry-run por falta de uma variável, saía com 0, o gate carimbava "coletei" e o carimbo
# bloqueava o caminho pago — 12 dias de acervo congelado, tudo verde. O `concluir` agora
# consulta o acervo antes de carimbar (migração coleta_gate_concluir_exige_prova.sql) e
# sai 4 quando não houve gravação; a linha abaixo torna isso VISÍVEL no log do runner.
rodar() {
  local fonte="$1"; shift
  if node scripts/coleta-gate.mjs claim "$fonte"; then
    if "$@"; then
      node scripts/coleta-gate.mjs concluir "$fonte" \
        || echo "  ⚠️ ($fonte saiu com sucesso mas NÃO gravou no acervo — janela segue aberta; investigue o scraper)"
    else
      echo "  ($fonte falhou — NÃO concluído; o gate retenta em ~15 min / próxima janela)"
    fi
    sleep 5   # respiro entre fontes (uma de cada vez, IP tranquilo)
  fi
}

# SOLEON (calil/vegas/3torres) — sem Cloudflare: fetch direto do IP residencial = grátis (SOLEON_NO_BD).
rodar SOLEON env SOLEON_NO_BD=1 SOLEON_DRYRUN=0 node scripts/scraper-soleon.mjs

# GESTAOLEILOES (granado/vinco/…) — Cloudflare: Chromium real (puppeteer) de IP residencial, sem BD.
rodar GESTAO env GESTAO_HEADLESS=1 GESTAO_DRYRUN=0 node scripts/scraper-gestao.mjs

# RJ Leilões — 100% Cloudflare: idem, Chromium real residencial.
# RJ_DRYRUN=0 é OBRIGATÓRIO: o default do scraper-rj.mjs é dry-run, e esta linha ficou sem
# ele desde sempre — o residencial parseava e descartava, sem nunca gravar uma linha (as
# outras fontes já traziam SOLEON_DRYRUN=0 / GESTAO_DRYRUN=0 / PECINI_DRYRUN=0).
rodar RJ env RJ_HEADLESS=1 RJ_DRYRUN=0 node scripts/scraper-rj.mjs

# PECINI — Cloudflare (só saía via Web Unlocker pago): Chromium real residencial, sem BD.
rodar PECINI env PECINI_HEADLESS=1 PECINI_DRYRUN=0 node scripts/scraper-pecini.mjs

# Vlance (verdeamarelo/sudeste/capitalvalor) — API JSON que dá 403 em datacenter, mas do IP
# RESIDENCIAL o fetch DIRETO funciona e é GRÁTIS. VLANCE_NO_BD=1 = 100% residencial (sem Bright
# Data); se preferir BD como rede de segurança quando a casa também falhar, tire o VLANCE_NO_BD
# e exporte BRIGHTDATA_API_TOKEN/ZONE no ~/.bidpro-runner.env.
rodar VLANCE env VLANCE_NO_BD=1 python3 scripts/scraper_vlance.py --supabase --ignorar-robots

# ── RADAR DE EDITAIS DO DJEN/CNJ (29/08) ────────────────────────────────────────────────────
# Migrado do Bright Data para cá por decisão do dono: "vou rodar diariamente, migra o radar;
# caso fique 7 dias sem rodar no residencial, pode rodar pelo Bright Data".
#
# O DJEN bloqueia IP de DATACENTER — o Web Unlocker passava só porque sai por IP residencial.
# Daqui o IP já é residencial e o intermediário PAGO fica dispensável. Era o 2º maior consumidor
# da cota (106 requests na semana de 24/08; 88 num único dia).
#
# NÃO passa pelo `rodar`, e a razão é a mesma da triagem: aquele helper conclui com PROVA DE
# GRAVAÇÃO NO ACERVO, e o radar grava em `editais_leilao`, não em `imoveis_leilao` — pelo gate
# ele imprimiria "saiu com sucesso mas NÃO gravou no acervo" em TODA rodada, e alarme falso
# recorrente é o que treina o dono a ignorar o log.
#
# A convivência com o cron da Vercel é automática: este script grava `monitor_runs` com
# `erro: null` quando o pull passa, e o freio do cron pago só libera o Bright Data depois de 7
# dias sem NENHUM sucesso. Rodando aqui todo dia, o caminho pago simplesmente nunca acorda.
# Falha aqui não derruba a rodada: o acervo do dia já entrou nos passos acima.
# A mensagem de falha NÃO diz "nada foi gravado": um run pode gravar dezenas de editais e ainda
# assim sair 1 porque UM combo tribunal×termo caiu (foi o caso da 1ª rodada real: 98 editais
# gravados, `exit 1` por `TRT15: fetch failed`). Dizer "sem efeito" ali seria o instrumento
# reportando outra coisa — leia os `vistos=/novos=` da linha acima, que são o que de fato entrou.
node scripts/radar-editais-residencial.mjs \
  || echo "  (radar: run PARCIAL ou falho — o que entrou está no 'novos=' acima; não conta como sucesso, e a rede de segurança paga entra após 7 dias sem NENHUM sucesso)"

# ── TRIAGEM RESIDENCIAL DOS BLOQUEADOS (29/08) ──────────────────────────────────────────────
# NÃO coleta lote: descobre QUAL PLATAFORMA rodam os sites que recusaram o acesso grátis.
#
# A triagem da JUCEMG deixou 53 sites como `bloqueado`, e em 51 deles `plataforma` ficou NULA
# — o Cloudflare devolveu "Just a moment..." e o HTML nunca foi lido. Ou seja: 53 leiloeiros
# hoje contados como "custa Bright Data" sem que ninguém saiba se já teriam parser pronto.
# Dois já se sabe que sim (adrianoleiloeiro e angelabecharaleiloes, ambos Superbid).
#
# Daqui — Chromium real, IP de casa — o desafio do Cloudflare cai, e a descoberta continua
# custando R$ 0. Quem se revelar rodando plataforma que já parseamos entra por CONFIGURAÇÃO
# (um tenant), não por parser novo. A lista vem do BANCO (só os bloqueados), então a rodada
# custa ~53 páginas e não 141 — e serve JUCESP/JUCERJA/JUCEES do mesmo jeito, sem editar nada.
#
# Sai por último de propósito: é DESCOBERTA, não coleta. Se o Chromium engasgar aqui, o acervo
# do dia já entrou.
# NÃO passa pelo `rodar`, e a razão importa: aquele helper conclui com PROVA DE GRAVAÇÃO NO
# ACERVO (`coleta_gate_concluir_exige_prova.sql`). A triagem grava em `leiloeiro_triagem`, não
# em `imoveis_leilao` — pelo gate ela imprimiria "saiu com sucesso mas NÃO gravou no acervo"
# em TODA rodada. Alarme falso recorrente é o que treina o dono a ignorar o log (lição da
# CREPALDI). Descoberta tem contrato diferente de coleta, então roda direto.
# Falha aqui não derruba a rodada: o acervo do dia já entrou nos passos acima.
env TRIAGEM_HEADLESS=1 TRIAGEM_BLOQUEADOS=1 node scripts/recon-triagem-jucemg.mjs \
  || echo "  (triagem residencial falhou — sem efeito no acervo; roda de novo na próxima janela)"

# VENDASGOV — Imóveis da União (SPU/SERPRO). Veio do GitHub Actions em 29/08: o WAF do SERPRO
# não deixa IP de DATACENTER nem carregar a página — as 5 rotas davam "Navigation timeout of
# 45000 ms" e a fonte colhia ZERO desde pelo menos 15/08 (15 dias de `falhou` seguidos), com
# 22 min por dia queimados no caminho. Daqui o IP já é residencial, que é o mesmo remédio de
# HASTA, RJ e PECINI. Custo: zero (puppeteer local, sem Bright Data).
# ⚠️ AINDA NÃO VERIFICADO NA PRÁTICA — a hipótese do WAF é a mais provável pelo padrão (as 5
# rotas, todo dia, só timeout), mas não deu para provar daqui. Se ELE TAMBÉM estourar timeout
# nesta máquina, o problema não é o IP e sim o site: aí o próximo passo é recon da SPA, não
# outra troca de runner. A fonte falha rápido agora (aborta nas demais rotas), então testar
# custa ~1 min em vez de 22.
rodar VENDASGOV env SCRAPER_FONTES=VENDASGOV node scripts/scraper-puppeteer.mjs

# ── ÚLTIMA DA FILA: HASTA (é a rodada longa) ────────────────────────────────────────────────
# HASTA (hastaleiloes.com.br — comitente CAIXA) — SPA que só renderiza no navegador E bloqueia
# IP de datacenter; do IP residencial o motor `dom` (Puppeteer) resolve os dois de uma vez.
# Acervo real ≈ 579 lotes em ~20 páginas (CSV do dono, 21/08): MAX_LOTES=600 cobre o acervo
# inteiro — e agora esse teto é USADO. Até 29/08 o motor era tudo-ou-nada (`novos.length ? novos
# : urls`): como quase toda rodada traz ao menos um lote novo, o refresh completo que este
# comentário prometia **nunca acontecia** — medido, 5 lotes tocados em 36 h contra 584 ativos.
# Agora a rodada gasta a sobra do teto relendo o acervo (praça próxima primeiro), então ela
# passa a levar ~40-60 min de verdade. É tempo, não dinheiro: `dom` = Chromium residencial,
# zero Bright Data. Gate 2x/semana.
# ⚠️ POR ISSO ELA É A ÚLTIMA (29/08, decisão do dono). Rodando ~1 h, ela empurrava tudo o
# que vinha depois: Vlance, o radar do DJEN (que tem caminho PAGO se ficar 7 dias sem
# rodar aqui) e a triagem. No fim da fila, uma rodada longa não custa nada a ninguém —
# e se um dia precisar encurtá-la, o ajuste é baixar HASTA_MAX_LOTES aqui, não mexer no motor.
rodar HASTA env HASTA_DRYRUN=0 HASTA_MAX_LOTES=600 node scripts/scraper-hasta.mjs

echo "[$(date)] fim."
