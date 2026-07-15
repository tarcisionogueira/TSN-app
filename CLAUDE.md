# TSN App — Guia para Claude Code

## 🩺 Ritual de início de sessão (diagnóstico — fazer ANTES dos próximos passos)
Ao começar uma sessão nova e ler o HANDOFF (`docs/HANDOFF.md`), produza um diagnóstico
curto (5–8 linhas) antes de seguir:

1. **Saúde** (MCP Supabase/Vercel): imóveis ativos e atualizados nas últimas 24h, fila de
   geocode, últimos deploys (`state=READY`?), crons com timeout recente.
2. **Segurança — postura**: rode `select public.auditoria_seguranca();` (ou leia a última
   linha de `seguranca_auditoria`). `0 crítico / 0 atenção` = íntegro; qualquer achado =
   investigar e corrigir ANTES de seguir. Este auditor cobre AUTOMATICAMENTE qualquer
   objeto novo de banco (tabela com PII sem RLS, função SECURITY DEFINER exposta a anon,
   bucket sensível público, política ampla no bucket `documentos`, trigger anti-escalação
   sumindo) — **não precisa lembrar de incluir nada**.
3. **Segurança — ofensiva** (quando houve mudança substancial): se desde a última auditoria
   entraram rotas novas OU mudanças em pagamento/webhook/RLS/upload/tokens, rode os 3 agentes
   ofensivos (verificação+lacunas · auth/tokens/contratos/KYC/convites · injeção/SSRF/XSS) e
   só considere "seguro" depois. Lógica de NEGÓCIO nova NÃO é coberta pelo item 2 — exige isto.
4. **Escala (rumo a 10 mil usuários)**: relembre os gaps pendentes do HANDOFF (índices,
   chunking de crons, quotas) e sinalize o que precisa antes de crescer.

## Stack
- **Frontend:** React + Vite → Vercel (Pro)
- **Backend:** Vercel Serverless Functions (Edge + Node.js)
- **Banco:** Supabase (PostgreSQL + Auth + Storage)
- **Pagamentos:** Asaas
- **Email:** Resend
- **Vídeo:** Daily.co

## Regras de Deploy

### Fluxo correto
1. Faça todas as edições necessárias
2. Rode `npm run build` para validar (deve concluir sem erros)
3. Commit descritivo em português
4. Push direto para `main` (plano Pro — sem limite de builds)
5. Se precisar disparar deploy manualmente: abrir no navegador:
   `https://api.vercel.com/v1/integrations/deploy/prj_E0tUYhPJN9IteuNI8spS0CEgZuxo/saLCcQwzMK`

## Branches
- `main` → Production (deploy automático via webhook Vercel)
- `claude/friendly-meitner-hj4683` → Preview (branch de desenvolvimento)

## Variáveis de ambiente (Vercel)
Todas configuradas no painel Vercel. Para adicionar nova variável:
Settings → Environment Variables → Add New → marcar Production + Preview + Development

## Banco de dados
- Migrações SQL: `supabase/migrations/`
- Executar manualmente no painel Supabase → SQL Editor
- Tabelas críticas: `perfis`, `imoveis`, `planos_config`, `verificar_cpf_rate`

## APIs — Segurança
- Edge Runtime: usar `getAuthUser(req)` de `api/_auth.js`
- Node.js Runtime: usar `getUser(req)` de `api/_auth.js`
- Webhooks externos (Asaas): verificar HMAC via `api/_webhook-core.js`
- Cron jobs: verificar `CRON_SECRET` no header `x-cron-secret`

## Antes de fazer push — checklist
- [ ] `npm run build` passou sem erros
- [ ] Mudanças testadas localmente (se possível)
- [ ] Commit message em português descrevendo O QUÊ e POR QUÊ
