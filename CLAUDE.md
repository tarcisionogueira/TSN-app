# TSN App — Guia para Claude Code

## Stack
- **Frontend:** React + Vite → Vercel (Hobby)
- **Backend:** Vercel Serverless Functions (Edge + Node.js)
- **Banco:** Supabase (PostgreSQL + Auth + Storage)
- **Pagamentos:** Asaas
- **Email:** Resend
- **Vídeo:** Daily.co

## Regras de Deploy — IMPORTANTE

### Limite de pushes por sessão
- **Máximo 3 pushes para `main` por sessão**
- Agrupe todas as mudanças da sessão em **1 commit** antes de fazer push
- Só faça push para `main` quando o trabalho estiver completo e testado localmente (`npm run build`)
- Para trabalho em progresso, use a branch `claude/friendly-meitner-hj4683`

### Fluxo correto
1. Faça todas as edições necessárias
2. Rode `npm run build` para validar (deve concluir sem erros)
3. Agrupe em 1 commit descritivo
4. Push para `main` UMA VEZ
5. Se precisar disparar deploy manualmente: abrir no navegador:
   `https://api.vercel.com/v1/integrations/deploy/prj_E0tUYhPJN9IteuNI8spS0CEgZuxo/saLCcQwzMK`

### Por que esse limite?
O plano Hobby do Vercel enfileira builds. Muitos pushes em sequência causam backlog e deploys que não aparecem. Em operação normal (1-2 pushes/dia) o webhook funciona perfeitamente.

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
- [ ] Não é o 4º+ push da sessão
- [ ] Commit message em português descrevendo O QUÊ e POR QUÊ
