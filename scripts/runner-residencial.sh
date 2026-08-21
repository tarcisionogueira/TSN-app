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
# Setup e roadmap: docs/RUNNER_RESIDENCIAL.md. Agendar 2x/semana via cron (ex.: seg e qui).
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
[ -f "$HOME/.bidpro-runner.env" ] && { set -a; . "$HOME/.bidpro-runner.env"; set +a; }

if [ -z "${SUPABASE_SERVICE_KEY:-}" ] || [ -z "${VITE_SUPABASE_URL:-}" ]; then
  echo "[$(date)] ERRO: defina VITE_SUPABASE_URL e SUPABASE_SERVICE_KEY em ~/.bidpro-runner.env" >&2
  exit 1
fi

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
if [ "${RUNNER_SEM_AUTOUPDATE:-0}" != "1" ]; then
  if git -C "$(pwd)" pull --ff-only --quiet 2>/dev/null; then
    echo "[$(date)] código atualizado ($(git rev-parse --short HEAD))"
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

# HASTA (Flávio Costa, agrega TRT-5/TJPE) — SPA que só renderiza o dado no navegador E devolve
# 403 a IP de datacenter (DRY-RUN de 21/08). Do IP residencial o motor `dom` (Puppeteer) do
# scraper resolve os dois problemas de uma vez. ~19 páginas por rodada, gate 2x/semana.
rodar HASTA env HASTA_DRYRUN=0 node scripts/scraper-hasta.mjs

# Vlance (verdeamarelo/sudeste/capitalvalor) — API JSON que dá 403 em datacenter, mas do IP
# RESIDENCIAL o fetch DIRETO funciona e é GRÁTIS. VLANCE_NO_BD=1 = 100% residencial (sem Bright
# Data); se preferir BD como rede de segurança quando a casa também falhar, tire o VLANCE_NO_BD
# e exporte BRIGHTDATA_API_TOKEN/ZONE no ~/.bidpro-runner.env.
rodar VLANCE env VLANCE_NO_BD=1 python3 scripts/scraper_vlance.py --supabase --ignorar-robots

echo "[$(date)] fim."
