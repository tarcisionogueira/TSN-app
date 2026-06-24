# TSN App — Guia para Claude Code

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
