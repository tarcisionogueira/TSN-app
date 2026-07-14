# Segurança — mitigações conhecidas e riscos aceitos

Este arquivo é lido pela auditoria automática (`scripts/auditoria-claude.mjs`) e
injetado no prompt. Os padrões abaixo já foram **revisados** e têm controle
compensatório ou são intencionais — a auditoria **não deve** reportá-los como
crítica/alta. Se um achado for exatamente um destes padrões, rebaixe para "baixa"
ou omita. **Não** liste aqui bugs reais ainda abertos (esses devem continuar
aparecendo).

> Cada item traz a evidência e por que é aceito. Ao mitigar de fato (ex.: setar
> um segredo), mantenha o item — ele documenta a decisão.

---

## 1. Variáveis `VITE_*` são públicas por design
- **Padrão:** literais/fallbacks de `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` no bundle do front (`src/utils/supabase.js`).
- **Por que é aceito:** `VITE_*` vai para o bundle do cliente por definição do Vite; a **chave anon** do Supabase é pública e o acesso é protegido por **RLS** no banco. Não é "credencial vazada/hardcoded".
- **Severidade justa:** informativo. Só vira risco se uma variável **de servidor** (service key, tokens de gateway) tiver prefixo `VITE_` — isso sim reporte.

## 2. Webhook do Mercado Pago sem HMAC quando `MP_WEBHOOK_SECRET` ausente
- **Padrão:** `api/mp-webhook.js` processa o evento mesmo sem `MP_WEBHOOK_SECRET` (fail-open, `verificarAssinatura` retorna `sem_secret`).
- **Controle compensatório:** o corpo do webhook só traz `type` + `data.id`. **Todo** dado que decide a ativação (status, `external_reference`, valor, pagador) é **re-buscado na API do MP com o nosso token** (`mpGet('/preapproval/…')`, `fetch('/v1/payments/…')`), que é a fonte de verdade. A ativação exige `status==='authorized'`/`'approved'`, estados que só existem após pagamento real na nossa conta. **Não** há "ativação gratuita/forjável".
- **Risco residual real:** integridade/griefing (rebaixar um assinante via um `authorized_payment` `rejected` real de outro pagador) — exige conhecer um id interno do MP e o secret estar ausente. **Severidade justa: média** (hardening).
- **Ação registrada:** setar `MP_WEBHOOK_SECRET` na Vercel + painel MP e, após o setup, falhar-fechado. O próprio código já loga `CRÍTICO` pedindo isso.

## 3. Verificação de identidade por selfie é fail-safe-para-revisão-manual
- **Padrão:** `api/validar-selfie.js` retorna `ok:true` quando falta `CLAUDE_KEY` ou há exceção técnica ("Verificação será feita pela equipe").
- **Por que é aceito:** o `ok:true` **não concede** plano/role/rota/compra. Em `Perfil.jsx` só pinta um badge auto-atestado (`identidade_validada` **nunca** é lido no `api/`); em `ConviteEquipe.jsx` o role vem 100% do **token de convite** (RPC `SECURITY DEFINER`), não da selfie. É fail-safe intencional que apenas adia para conferência humana.
- **Severidade justa:** baixa/informativo. Só vira risco se um dia `identidade_validada` passar a **gatear** algo sensível no servidor — aí exija a checagem server-side.

## 4. GitHub Actions em repositório público para scrapers
- **Padrão:** workflows de scraping/auditoria rodam em GitHub Actions.
- **Por que é aceito:** decisão de custo (repo público = minutos ilimitados). Segredos ficam em GitHub Secrets, não no código.
- **Severidade justa:** informativo.

---

## Decisão do dono sobre o checkout (2026-07-06) — acesso na 1ª parcela é INTENCIONAL
Modelo confirmado (preços reais — a tabela `planos_config` é a fonte da verdade; o
`PLANOS_CONFIG` hardcoded em `api/mp.js` está DESATUALIZADO e deve passar a LER do banco):
- **Assessoria:** R$ 6.000 em até **12× de R$ 500**, OU **R$ 4.800 à vista**. Sem recorrência.
- **Leilão Club:** R$ 60.000 em até **12× de R$ 5.000**, OU **R$ 48.000 à vista**, OU recorrência.
- **Investidor Pro / Leilão Club:** podem ser **recorrência** (monitorar parcela mês a mês; em inadimplência, rebaixar para explorador). À vista libera por **12 meses**.

Consequências para a "sub-precificação": **não** é um bug a bloquear — o acesso é liberado a cada
pagamento válido (inclusive a 1ª parcela), por decisão de negócio. O guard correto NÃO é exigir o
valor cheio; é validar que `valor` é um **valor válido do plano** (parcela, à vista ou total) e
**monitorar as parcelas na tela do Financeiro** (adimplência/inadimplência) — trabalho FUTURO,
junto da revisão da tela de contratos. Enquanto isso, corrigir os preços do `mp.js` (que estão em
R$ 5.000 para assessoria e club) para os valores acima, ou lê-los de `planos_config`.

## Achados de segurança já RESOLVIDOS (versionados)
- **RLS de `perfis` sem `WITH CHECK` por coluna** — RESOLVIDO: o trigger `proteger_campos_sensiveis_perfil` (a barreira contra auto-escalada de `role`) foi **versionado** em `supabase/migrations/proteger_campos_sensiveis_perfil.sql` (antes só existia em produção via MCP). Um reprovisionamento a partir do repo não perde mais a proteção.

---

## 5. Anti-SSRF dos fetchers de enriquecimento — JÁ EXISTE (`_allowed-hosts.js`)
- **Padrão:** `enriquecer-lote.js` (`fetchLote`/`lerCartorioMatricula`), `geocodificar-imovel.js` (`infoDoDocumento`) e `gerar-documental.js` (`lerDoc`) buscam URLs vindas do banco/body do cliente.
- **Controle compensatório:** TODOS chamam `hostExternoSeguro(url)` de `api/_allowed-hosts.js` ANTES do fetch. `ehHostInterno` bloqueia loopback, redes privadas (10/172.16-31/192.168), link-local/metadados de nuvem (169.254.169.254), CGNAT, IPv6 loopback/ULA/link-local e IPv4-mapeado — tratando URL ilegível/protocolo não-http como interna (fail-closed). O vetor "url_lote/link_edital → 169.254.169.254" **não** alcança a rede interna.
- **Severidade justa:** informativo/baixa. Só reporte se aparecer um fetcher NOVO de URL do banco/cliente **sem** `hostExternoSeguro`.

## 6. Gate de plano do documental é FAIL-CLOSED
- **Padrão:** `gerar-documental.js` checa `perfis.role` antes de gerar a análise paga.
- **Controle compensatório:** o `try/catch` da checagem **não** libera em falha — o `catch` retorna **503** ("não foi possível validar seu plano"), sem gerar o laudo. Não há "bypass por exceção silenciosa".
- **Severidade justa:** informativo.

## 7. `asaas.js` — operação de assinatura por e-mail exige que o e-mail seja do próprio usuário
- **Padrão:** `criar_assinatura`/`gerenciar_assinatura`/`cancelar_assinatura` localizam o customer no Asaas por `body.email`.
- **Controle compensatório:** o guard único no topo (`if (emailBody && authUser.email !== emailBody) → 403`) roda para TODAS as `userActions`. Como as três ações usam `body.email`, um atacante que informe o e-mail da vítima é barrado (403) antes de qualquer chamada ao Asaas; omitir o e-mail cai em "cliente não encontrado" (404). Não há cancelamento/gerência de assinatura de terceiros.
- **Severidade justa:** informativo.

## 8. `asaas.js transferir_pix` — teto de valor + role admin no servidor
- **Padrão:** transferência PIX a partir da tela do Financeiro.
- **Controle compensatório:** o handler exige `role==='admin'` (buscado com service key, não confia no front) para `financas`/`extrato`/`transferir_pix`, e a transferência valida `0 < valor <= PIX_TRANSFER_MAX` (default R$ 10.000). Uma sessão admin comprometida não esvazia o saldo numa única transferência.
- **Severidade justa:** baixa (hardening — ajustar `PIX_TRANSFER_MAX` conforme a operação).

## 9. Filtros PostgREST por `id`/`user_id` usam `encodeURIComponent`
- **Padrão:** vários endpoints montam `...?id=eq.${encodeURIComponent(x)}`.
- **Por que é aceito:** `encodeURIComponent` codifica `&`, `=`, `,` e demais metacaracteres do PostgREST (viram `%26`/`%3D`/`%2C`), então não dá para injetar operadores/colunas extras na query string. Não é "SQL/PostgREST injection".
- **Severidade justa:** informativo. (Hardening desejável: validar UUID quando o campo é um id; isso é "baixa", não "alta".)

## 10. Web Push — VAPID + criptografia aes128gcm (CORRIGIDO)
- **Estava quebrado:** `push-send.js` importava a chave privada VAPID com `format:'raw'` (só vale p/ chave pública EC → o import lançava e o JWT nunca era gerado) e mandava o payload em JSON puro sob `Content-Encoding: aes128gcm` (sem cifrar) → o navegador não decifrava e a notificação era descartada. Push **nunca** chegava.
- **Correção (versionada em `api/_webpush.js`):** JWT VAPID assinado importando a chave privada via **JWK** (`d/x/y`); payload cifrado conforme **RFC 8291 + RFC 8188** (ECDH efêmero + HKDF + AES-128-GCM, `keyid` no cabeçalho). Round-trip validado por teste local. **Não** reportar mais como pendente.
