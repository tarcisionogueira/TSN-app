# TSN App — Guia para Claude Code

## 🩺 Ritual de início de sessão (diagnóstico — fazer ANTES dos próximos passos)
Ao começar uma sessão nova e ler o HANDOFF (`docs/HANDOFF.md`), produza um diagnóstico
curto (5–8 linhas) antes de seguir:

1. **Saúde** (MCP Supabase/Vercel): imóveis ativos e atualizados nas últimas 24h, fila de
   geocode, últimos deploys (`state=READY`?), crons com timeout recente.
2. **Captura — bug bounty dos leiloeiros (AUTO-APRENDIDO)**: o monitor APRENDE o "normal" de
   cada leiloeiro do próprio histórico (`fonte_baseline_aprendida()` = mín. dos runs saudáveis
   × 0,65) e alerta quando o último scrape cai abaixo — **auto-calibra os ATUAIS e ONBOARDA os
   FUTUROS, sem hardcode** (NÃO recalibre pisos de acervo na mão; deixe o histórico aprender).
   O `monitor-fontes-cron` faz isso todo dia (Seção C3) + grava o snapshot em `fonte_metricas_hist`.
   Cheque rápido no início:
   `select b.fonte,b.ativos_piso,b.ativos_mediana,u.total from public.fonte_baseline_aprendida() b
   join lateral (select total from fonte_saude s where s.fonte=b.fonte order by executado_em desc limit 1) u on true
   where b.tem_baseline and u.total < b.ativos_piso;` → vazio = íntegro. Rode a **OFENSIVA de
   captura** (recon da estrutura VIVA do site × premissas do scraper — como o recon que achou a
   regressão do BIASI: dedup global + `?pagina` desconhecido) quando: uma fonte regredir, um
   leiloeiro NOVO for integrado, ou houver suspeita de mudança estrutural. Depois, atualize
   `leiloeiro_conhecimento` + `docs/BASELINE_CAPTURA_LEILOEIROS.md`. A Rotina mensal
   **"Bug bounty dos leiloeiros"** já faz essa ofensiva sozinha e notifica o dono.
3. **Segurança — postura**: rode `select public.auditoria_seguranca();` (ou leia a última
   linha de `seguranca_auditoria`). `0 crítico / 0 atenção` = íntegro; qualquer achado =
   investigar e corrigir ANTES de seguir. Este auditor cobre AUTOMATICAMENTE qualquer
   objeto novo de banco (tabela com PII sem RLS, função SECURITY DEFINER exposta a anon,
   bucket sensível público, política ampla no bucket `documentos`, trigger anti-escalação
   sumindo) — **não precisa lembrar de incluir nada**.
4. **Segurança — ofensiva** (quando houve mudança substancial): se desde a última auditoria
   entraram rotas novas OU mudanças em pagamento/webhook/RLS/upload/tokens, rode os 3 agentes
   ofensivos (verificação+lacunas · auth/tokens/contratos/KYC/convites · injeção/SSRF/XSS) e
   só considere "seguro" depois. Lógica de NEGÓCIO nova NÃO é coberta pelo item 3 — exige isto.
5. **Escala (rumo a 10 mil usuários)**: relembre os gaps pendentes do HANDOFF (índices,
   chunking de crons, quotas) e sinalize o que precisa antes de crescer.
6. **Bug bounty do CÓDIGO (multi-agente) — cada botão e função, do pré-login ao backend**:
   ao ler o HANDOFF, rode uma varredura com vários agentes em paralelo procurando bugs de
   COMPORTAMENTO/lógica (não só segurança), por camada: (a) pré-login (cadastro, login,
   recuperação de senha, e-mails de verificação); (b) cada tela/botão logado (gera relatório,
   sinaliza arremate/revenda, uploads, Índice, planos/checkout); (c) cada endpoint `api/`
   (auth, RLS, tratamento de erro, cotas, webhooks, idempotência). PADRÕES-ALVO já conhecidos:
   **erro de API silenciado** (`fetch/anthropicFetch` → `.json()` SEM checar `.ok` → resultado
   falso-vazio — causa-raiz do "relatório vazio"; corrigido em gerar-analise/documental/laudo,
   varrer novos); **botão/ação sem gate** (ex.: "Arrematei" aparecia sem os 3 relatórios
   prontos); **cron/e-mail sem dedup ou sem excluir contas internas** (retenção nudava o admin);
   **cobrança de cota em fluxo que falhou**. Cada achado: confirmar (repro/queries), corrigir na
   raiz, e registrar no HANDOFF. A intenção do dono: essa varredura é ROTINA de abertura, não
   pontual.

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

> 🔴 **O repositório `tarcisionogueira/TSN-app` é PÚBLICO** (confirmado em 03/08 via API do
> GitHub: `visibility: public`). **NUNCA escreva o VALOR de um segredo em arquivo do repo** —
> nem em `docs/*.md`, nem em comentário de código. Cite sempre o NOME da variável
> (`RESEND_WEBHOOK_SECRET`) e diga "definido no painel". Um valor commitado continua visível
> no HISTÓRICO do git mesmo depois de removido do arquivo: a única correção real é **rotacionar
> o segredo**. Achado de 03/08: `RESEND_WEBHOOK_SECRET` estava em texto puro no HANDOFF.

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
