#!/usr/bin/env bash
# Runner RESIDENCIAL — roda os scrapers de leiloeiro de um IP RESIDENCIAL (grátis, sem Bright Data).
# Muitos sites bloqueiam só IP de datacenter (CI/Vercel) → de casa o fetch direto funciona.
# Agendar via cron 2x/SEMANA (a frequência é controlada aqui, não a cada acesso).
#
# Setup (uma vez):
#   1) git clone do repo (ou copie a pasta scripts/) numa máquina residencial sempre ligada.
#   2) npm ci   (instala deps dos scrapers .mjs)
#   3) crie ~/.bidpro-runner.env com:
#        VITE_SUPABASE_URL=https://zuwfiwokkdytvjixiwac.supabase.co
#        SUPABASE_SERVICE_KEY=<service key — Supabase > Settings > API>
#   4) chmod +x scripts/runner-residencial.sh
#   5) crontab -e  e adicione (seg e qui, 08:00):
#        0 8 * * 1,4  /CAMINHO/TSN-app/scripts/runner-residencial.sh >> $HOME/bidpro-runner.log 2>&1
#
# Ver docs/RUNNER_RESIDENCIAL.md para detalhes e o roadmap de zerar o Bright Data.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
[ -f "$HOME/.bidpro-runner.env" ] && { set -a; . "$HOME/.bidpro-runner.env"; set +a; }

if [ -z "${SUPABASE_SERVICE_KEY:-}" ] || [ -z "${VITE_SUPABASE_URL:-}" ]; then
  echo "[$(date)] ERRO: defina VITE_SUPABASE_URL e SUPABASE_SERVICE_KEY em ~/.bidpro-runner.env" >&2
  exit 1
fi

echo "===== [$(date)] runner residencial ====="

# SOLEON (calil, vegas, 3torres) — sem Cloudflare: fetch direto do IP residencial = grátis.
# SOLEON_NO_BD=1 garante que NUNCA cai no Bright Data (pula a página se o direto falhar).
echo "[$(date)] SOLEON…"
SOLEON_NO_BD=1 SOLEON_DRYRUN=0 node scripts/scraper-soleon.mjs || echo "  (soleon falhou — segue)"

# Vlance (verdeamarelo, sudeste, capitalvalor) — opcional aqui (já coletado client-side pelo staff).
# Descomente para redundância residencial:
# echo "[$(date)] Vlance…"
# python3 scripts/scraper_vlance.py --supabase || echo "  (vlance falhou — segue)"

# GESTAOLEILOES / RJ (Cloudflare) — AINDA precisam de Bright Data OU Chromium headless residencial.
# Ver o roadmap em docs/RUNNER_RESIDENCIAL.md (tier headless). Não incluídos aqui por padrão.

echo "[$(date)] fim."
