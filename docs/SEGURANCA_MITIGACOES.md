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

## NÃO são mitigados (bugs reais — devem continuar sendo reportados)
- **Sub-precificação no checkout (EM ABERTO — depende de decisão do dono):** `api/mp-checkout.js` aceita `valor` do corpo do cliente e o webhook mapeia o plano por **valor**, então em tese dá para pagar um valor baixo e reivindicar um role de tier superior. **Não corrigido ainda** porque `assessorado` é `parcelado_fixo` (12×) e um pagamento de ~R$500 pode ser uma **parcela legítima** — um guard rígido de preço quebraria o parcelamento. Correto: definir o modelo (o role é concedido na 1ª parcela? o acesso é proporcional ao pago?) e então validar `valor` contra `planos_config` ou conceder acesso só após o total quitado.

## Achados de segurança já RESOLVIDOS (versionados)
- **RLS de `perfis` sem `WITH CHECK` por coluna** — RESOLVIDO: o trigger `proteger_campos_sensiveis_perfil` (a barreira contra auto-escalada de `role`) foi **versionado** em `supabase/migrations/proteger_campos_sensiveis_perfil.sql` (antes só existia em produção via MCP). Um reprovisionamento a partir do repo não perde mais a proteção.
