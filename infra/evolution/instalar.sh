#!/usr/bin/env bash
# Instala a Evolution API numa VPS Ubuntu/Debian limpa e conecta o WhatsApp da BidPro.
#
#   curl -fsSL https://raw.githubusercontent.com/tarcisionogueira/TSN-app/main/infra/evolution/instalar.sh | sudo bash
#
# Pode rodar de novo quando quiser: não apaga nada, só completa o que falta.
#   sudo bash /opt/evolution/instalar.sh qr        → mostra o QR de novo (sessão caiu)
#   sudo bash /opt/evolution/instalar.sh codigo    → código de 8 letras em vez do QR
#   sudo bash /opt/evolution/instalar.sh envs      → reimprime os valores para a Vercel
#   sudo bash /opt/evolution/instalar.sh status    → estado da conexão
set -euo pipefail

DIR=/opt/evolution
RAW=https://raw.githubusercontent.com/tarcisionogueira/TSN-app/main/infra/evolution
INSTANCIA=bidpro
NUMERO=5511964079726
WEBHOOK_URL=https://www.bidprobrasil.com.br/api/whatsapp-evolution-webhook
API=http://127.0.0.1:8080

ok()   { printf '\033[32m✔ %s\033[0m\n' "$*"; }
info() { printf '\033[36m→ %s\033[0m\n' "$*"; }
erro() { printf '\033[31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || erro "Rode como root (sudo)."

env_valor() { grep -E "^$1=" "$DIR/.env" | head -1 | cut -d= -f2-; }
chave()     { env_valor AUTHENTICATION_API_KEY; }
api()       { curl -sS -H "apikey: $(chave)" -H 'Content-Type: application/json' "$@"; }

mostrar_envs() {
  cat <<EOF

================ COLE NA VERCEL (Settings → Environment Variables) ================
EVOLUTION_URL=https://$(env_valor EVOLUTION_DOMINIO)
EVOLUTION_APIKEY=$(chave)
EVOLUTION_INSTANCIA=$INSTANCIA
WA_EVOLUTION_WEBHOOK_TOKEN=$(env_valor BIDPRO_WEBHOOK_TOKEN)
WA_CANAL=evolution
WA_BOT_ATIVO=1
VITE_WHATSAPP_NUMERO=$NUMERO
==================================================================================
Estes valores ficam também em $DIR/.env (só nesta VPS). Não mande por chat público.
EOF
}

estado() { api "$API/instance/connectionState/$INSTANCIA" | jq -r '.instance.state // .state // "desconhecido"'; }

mostrar_qr() {
  info "Abra no celular: WhatsApp Business → ⋮ → Aparelhos conectados → Conectar aparelho."
  for i in $(seq 1 8); do
    [ "$(estado)" = open ] && { ok "WhatsApp conectado."; return 0; }
    code=$(api "$API/instance/connect/$INSTANCIA" | jq -r '.code // empty')
    [ -n "$code" ] || { sleep 3; continue; }
    clear 2>/dev/null || true; echo "QR $i/8 — vale ~40 s; um novo aparece sozinho."; qrencode -t ansiutf8 "$code"
    for _ in $(seq 1 20); do sleep 2; [ "$(estado)" = open ] && { ok "WhatsApp conectado."; return 0; }; done
  done
  erro "Não conectou. Rode: sudo bash $DIR/instalar.sh qr   (ou 'codigo' para parear pelo número)"
}

mostrar_codigo() {
  pc=$(api "$API/instance/connect/$INSTANCIA?number=$NUMERO" | jq -r '.pairingCode // empty')
  [ -n "$pc" ] || erro "A Evolution não devolveu código de pareamento. Use: sudo bash $DIR/instalar.sh qr"
  echo; echo "   CÓDIGO: $pc"; echo
  info "No celular: Aparelhos conectados → Conectar aparelho → 'Conectar com número de telefone' → digite o código."
  for _ in $(seq 1 60); do sleep 3; [ "$(estado)" = open ] && { ok "WhatsApp conectado."; return 0; }; done
  erro "Ainda não conectou. Gere outro: sudo bash $DIR/instalar.sh codigo"
}

case "${1:-instalar}" in
  qr)     mostrar_qr; exit ;;
  codigo) mostrar_codigo; exit ;;
  envs)   mostrar_envs; exit ;;
  status) echo "Conexão: $(estado)"; (cd "$DIR" && docker compose ps); exit ;;
  instalar) ;;
  *) erro "Uso: instalar.sh [qr|codigo|envs|status]" ;;
esac

# 1. Pacotes
info "Instalando pacotes (Docker, jq, qrencode, firewall)…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl jq qrencode openssl ufw ca-certificates dnsutils >/dev/null
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh >/dev/null
docker compose version >/dev/null 2>&1 || erro "docker compose não ficou disponível."
ok "Docker $(docker --version | cut -d' ' -f3 | tr -d ,)"

if iptables -S INPUT 2>/dev/null | grep -q -- '-j REJECT'; then
  # Imagem Ubuntu da Oracle Cloud: já vem com iptables fechado (só 22). Abrir 80/443 nele;
  # ligar o ufw por cima brigaria com o netfilter-persistent da imagem.
  for p in 80 443; do
    iptables -C INPUT -p tcp --dport $p -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p tcp --dport $p -j ACCEPT
  done
  command -v netfilter-persistent >/dev/null && netfilter-persistent save >/dev/null 2>&1 || true
  ok "Firewall (Oracle): 80 e 443 liberadas no iptables. Libere também na Security List da VCN."
else
  ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
  ok "Firewall: só 22, 80 e 443 abertas."
fi

# 2. Arquivos
mkdir -p "$DIR"; cd "$DIR"
for f in docker-compose.yml Caddyfile env.modelo instalar.sh; do
  curl -fsSL "$RAW/$f" -o "$f.novo" && mv "$f.novo" "$f"
done
chmod +x instalar.sh

if [ ! -f .env ]; then
  cp env.modelo .env
  pg=$(openssl rand -hex 24)
  sed -i "s/^AUTHENTICATION_API_KEY=__GERAR__/AUTHENTICATION_API_KEY=$(openssl rand -hex 32)/" .env
  sed -i "s/^POSTGRES_PASSWORD=__GERAR__/POSTGRES_PASSWORD=$pg/" .env
  sed -i "s/__POSTGRES_PASSWORD__/$pg/" .env
  sed -i "s/^BIDPRO_WEBHOOK_TOKEN=__GERAR__/BIDPRO_WEBHOOK_TOKEN=$(openssl rand -hex 32)/" .env
  chmod 600 .env
  ok "Chaves geradas em $DIR/.env"
else
  ok ".env já existe — mantido."
fi

# 3. DNS precisa apontar para esta VPS, senão o HTTPS não sai
DOM=$(env_valor EVOLUTION_DOMINIO)
MEU_IP=$(curl -fsS -4 https://api.ipify.org || true)
DNS_IP=$(dig +short A "$DOM" | tail -1)
if [ "$DNS_IP" != "$MEU_IP" ]; then
  echo
  echo "  O domínio $DOM aponta para '${DNS_IP:-nada}', e esta VPS é $MEU_IP."
  echo "  No Registro.br: DNS → Nova entrada → tipo A, nome 'wa', valor $MEU_IP."
  echo "  Depois rode de novo:  sudo bash $DIR/instalar.sh"
  erro "DNS ainda não aponta para cá."
fi
ok "DNS: $DOM → $MEU_IP"

# 4. Subir (se a tag fixa não existir no Docker Hub, cai para latest e avisa)
if ! docker compose pull -q; then
  info "Tag $(env_valor EVOLUTION_TAG) indisponível; usando latest."
  sed -i 's/^EVOLUTION_TAG=.*/EVOLUTION_TAG=latest/' .env
  docker compose pull -q
fi
docker compose up -d
info "Esperando a API responder…"
for _ in $(seq 1 60); do curl -fsS "$API/" >/dev/null 2>&1 && break; sleep 3; done
curl -fsS "$API/" >/dev/null || { docker compose logs --tail 40 api; erro "A API não subiu (logs acima)."; }
ok "Evolution no ar: $(curl -fsS "$API/" | jq -r '.version // "?"')"

for _ in $(seq 1 30); do curl -fsS "https://$DOM/" >/dev/null 2>&1 && break; sleep 3; done
curl -fsS "https://$DOM/" >/dev/null && ok "HTTPS ok: https://$DOM" \
  || info "HTTPS ainda emitindo certificado; confira em 1–2 min: curl https://$DOM/"

# 5. Instância + webhook
if api "$API/instance/fetchInstances?instanceName=$INSTANCIA" | jq -e 'length > 0' >/dev/null 2>&1; then
  ok "Instância '$INSTANCIA' já existe."
else
  api -X POST "$API/instance/create" \
    -d "{\"instanceName\":\"$INSTANCIA\",\"integration\":\"WHATSAPP-BAILEYS\",\"qrcode\":false,\"rejectCall\":true,\"msgCall\":\"No momento não atendemos ligações por aqui. Mande sua mensagem que respondemos!\",\"groupsIgnore\":true,\"alwaysOnline\":false,\"readMessages\":false}" \
    | jq -e '.instance.instanceName' >/dev/null || erro "Falha ao criar a instância."
  ok "Instância '$INSTANCIA' criada (recusa ligações, ignora grupos)."
fi

TOKEN=$(env_valor BIDPRO_WEBHOOK_TOKEN)
api -X POST "$API/webhook/set/$INSTANCIA" -d "{\"webhook\":{\"enabled\":true,\"url\":\"$WEBHOOK_URL\",\"headers\":{\"x-webhook-token\":\"$TOKEN\"},\"byEvents\":false,\"base64\":false,\"events\":[\"MESSAGES_UPSERT\",\"MESSAGES_UPDATE\",\"CONNECTION_UPDATE\"]}}" \
  | jq -e '.url // .webhook.url' >/dev/null || erro "Falha ao configurar o webhook."
ok "Webhook → $WEBHOOK_URL"

# 6. Conectar o WhatsApp
[ "$(estado)" = open ] && ok "WhatsApp já conectado." || mostrar_qr

mostrar_envs
