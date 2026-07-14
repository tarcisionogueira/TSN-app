# Handoff — 2026-07-14 (sessão auditoria/BidPro) — branch `claude/bidpro-audit-review-vh0z4m`

Continuação após o HANDOFF_2026-07-14.md. Sessão focada em **revisar a auditoria
automática**, corrigir bugs reais e ajustar **geocoding** e **preços**.

## 🔎 Auditoria (auditoria_sistema id=8, 13/07 — 31 "altas")
Verificado achado a achado: **a maioria das "altas" era falso-positivo/já-mitigada**
(SSRF já tem `hostExternoSeguro`/`_allowed-hosts`; gates já são fail-closed; `asaas`
valida e-mail do usuário; PIX tem teto + role admin; RLS tem o trigger
`proteger_campos_sensiveis_perfil`). Documentado em `docs/SEGURANCA_MITIGACOES.md`
(itens 5-10) para a auditoria parar de re-sinalizar como alta.

## 🔔 Push notifications — estava 100% quebrado (CORRIGIDO)
`push-send.js` importava a chave privada VAPID como `raw` (só vale p/ pública) e
mandava JSON puro sob `Content-Encoding: aes128gcm` sem cifrar → nada chegava.
- Novo `api/_webpush.js`: JWT VAPID via JWK + criptografia RFC 8291/8188 (ECDH+HKDF+
  AES-128-GCM). Round-trip validado em teste local.
- **PENDENTE (config, sem código):** setar na **Vercel** (não no GitHub):
  `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (servidor) e `VITE_VAPID_PUBLIC_KEY`
  (front) — os três com o MESMO par de chaves. Já existe uma pública hardcoded em
  `src/utils/push.js`; se a privada na Vercel casar com ela, basta conferir. Trocar
  as chaves invalida as subscriptions atuais (usuários re-assinam).

## 🗺️ Geocoding — pino no bairro errado na 1ª vista (CORRIGIDO)
Causa: ~23k imóveis ativos em nível `bairro`/`cidade`; o mapa da busca lê a coord
gravada e só corrigia quando alguém abria a página (on-demand `geocodificar-imovel`
sobe p/ `endereço`). O reprocessador só marcava 500/dia (~46 dias/ciclo).
- `regeocod-imprecisos`: limite 500→2000, ordena por **desconto desc** (atrativos
  primeiro); `vercel.json`: cron diário → a cada 6h.
- **Kickoff manual feito:** 23.224 imóveis marcados `geocod_nivel='refazer'` — o cron
  `/api/geocodificar` (10 min) drena em ~1-2 dias. Conferir: `select geocod_nivel,
  count(*) from imoveis_leilao where ativo group by 1`.
- Custo: cada reprocessamento de endereço é 1 chamada Google (cabe no crédito grátis
  mensal); ajustar `REGEOCOD_LIMITE`/frequência se estourar cota.

## 💰 Preços = admin > configurações (CORRIGIDO)
Fonte da verdade: tabela `planos_config` (+ `cursos_admin`/`ebooks_admin`).
- **Planos.jsx / Checkout.jsx / EbookPage / ProdutoPublico / ProdutoLanding**: já
  liam do banco ✅.
- **Membros.jsx (área de membros):** usava o `PLANOS` **estático** (`cursos.js`) →
  não refletia o admin. Trocado por `fetchPlanosComConfig()` (ao vivo). ✅
- **`api/mp.js`:** `PLANOS_CONFIG` hardcoded estava errado — `assessorado` 5.000→**6.000**,
  `clube_vista` 5.000→**48.000** (alinhado ao admin). `clube` recorrente segue 5.000/mês
  (=60.000÷12, correto). ⚠️ Não deu p/ ler o `planos_config` de forma ingênua no mp.js
  por causa da semântica mensal×total (o clube cobraria 60.000/mês). Se mudar preço no
  admin, atualizar esses valores no mp.js também (ou fazer o refactor com essa ressalva).
- Combo `PACOTE` (R$497) em `Membros.jsx` é **estático** (não há controle no admin).

## ✅ Pendências
1. **VAPID:** setar as 3 env vars na Vercel (ver acima).
2. **mp.js:** se ajustar preços no admin, replicar no `PLANOS_CONFIG` (mensal×total).
3. **Geocoding:** conferir a drenagem do `refazer` nos próximos 1-2 dias.
4. Combo `PACOTE`: decidir se vira configurável no admin.
