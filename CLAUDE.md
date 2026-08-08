# TSN App — Guia para Claude Code

## 🩺 Ritual de início de sessão (diagnóstico — fazer ANTES dos próximos passos)
Ao começar uma sessão nova e ler o HANDOFF (`docs/HANDOFF.md`), produza um diagnóstico
curto (5–8 linhas) antes de seguir:

> **0. HEARTBEAT (primeira query da sessão, antes do diagnóstico):**
> `select public.registrar_heartbeat('sessao_claude', 'ritual de abertura');`
> **Por que importa:** a auditoria completa do código (`auditoria-claude.yml`) roda
> SEMANAL mas só se ninguém abriu sessão há 7+ dias — ela custa ~R$ 43-59 por execução
> (API cobrada por token), enquanto o ritual aqui roda na assinatura. Este carimbo é o
> que faz o workflow PULAR e não pagar por cima do que já foi checado. Esquecer disso
> não quebra nada (a data do último commit é a rede de segurança), mas numa sessão só
> de diagnóstico, sem commit, é o ÚNICO sinal — e aí a auditoria gasta à toa.

1. **Saúde** (MCP Supabase/Vercel): imóveis ativos e atualizados nas últimas 24h, fila de
   geocode, últimos deploys (`state=READY`?), crons com timeout recente.

   > **1b. O QUE ESTÁ QUEBRADO AGORA — rode SEMPRE, é uma query só e custa zero** (decisão do
   > dono, 08/08). O que custa é a auditoria do Claude; ler o estado do banco não custa nada, e
   > foi assim que apareceram, num dia só: 3 telas com consulta quebrada falhando em silêncio, o
   > KYC que nunca validou ninguém e um selo verde jurídico dado sem consulta. **Nenhum deles
   > tinha aparecido em varredura de código** — só no rastro que deixaram no banco.
   > ```sql
   > -- erros de runtime que o CLIENTE tomou (tabela/coluna inexistente, 400, Failed to fetch)
   > select rota, ocorrencias, left(msg,120) as erro, ultima_em from erros_cliente
   >  where not resolvido and ultima_em > now() - interval '14 days' order by ultima_em desc limit 20;
   > -- incoerências que chegam ao relatório do cliente
   > select tipo, count(*), max(atualizado_em) from relatorio_anomalias where not resolvido group by 1;
   > -- chamado DO CLIENTE sem resposta (proativo da IA sem retorno NÃO conta — não é dívida nossa)
   > select c.id, c.titulo, c.criado_em from chamados c where c.status='aberto'
   >   and c.criado_em < now() - interval '3 days'
   >   and exists (select 1 from chamados_mensagens m where m.chamado_id=c.id and m.autor_tipo='cliente');
   > -- KYC: documento que o SERVIDOR não consegue abrir (trava saque). O critério espelha
   > -- `pathDoNossoBucket` em api/validar-selfie.js: path cru é FORMATO VÁLIDO desde 08/08
   > -- (quem assina é o servidor, com a service key) — só é problema o que não casa com
   > -- nenhuma das duas formas. Verde = 0. (O antigo `url not like 'http%'` acusava 8 sadios.)
   > select count(*) from usuario_docs
   >  where url !~ '^https?://' and url !~ '^pj/[0-9a-f-]{36}/[A-Za-z0-9._-]+$';
   > -- fontes no PONTO CEGO do monitor: têm lote ativo e nenhum registro em fonte_saude
   > select fonte, count(*) from imoveis_leilao i where ativo
   >   and not exists (select 1 from fonte_saude s where s.fonte=i.fonte) group by 1 order by 2 desc;
   > -- inventário de documentos por leiloeiro (0% = documental sem o que ler)
   > select fonte, count(*) ativos,
   >   round(100.0*count(*) filter (where link_matricula is not null
   >     or jsonb_array_length(coalesce(anexos,'[]'::jsonb))>0)/count(*),0) as pct_com_doc
   >   from imoveis_leilao where ativo and fonte not in ('CEF','caixa') group by 1 having count(*)>=20 order by 2 desc;
   > ```
   > **Duas checagens automáticas convivem, e elas NÃO são a mesma coisa:**
   > `/api/health-check` (2×/dia, **custo zero** — não usa IA; só manda e-mail quando há
   > problema) **continua ligado e deve continuar**. A auditoria do Claude
   > (`auditoria-claude.yml`, ~R$ 43-59) é a que só roda com 7+ dias sem sessão.
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
2b. **REGRAS DE NEGÓCIO — a regra que o planejamento cita é a que o código aplica?**
   `select public.auditoria_regras_negocio();` → `0 crítico` = íntegro. **Por que existe
   (08/08):** a regra do dono "Explorador indica, mas só saca sendo pagante" estava escrita
   no comentário de `api/saque.js`, tinha até uma função (`podeReceber`) — e não bloqueava
   NINGUÉM: a tela decidia por um caminho e o banco por outro. Planejamento inteiro em cima
   de uma regra que não existia. Agora as regras vivem em `regra_negocio` (dado, não
   comentário) e esta auditoria acusa (a) regra ativa que nenhuma função aplica e (b) função
   de dinheiro que parou de delegar ao avaliador único. **Ao criar regra nova de negócio:
   grave em `regra_negocio` com `aplicada_por` preenchido — senão a auditoria acusa, que é
   exatamente o ponto.** Para ver as regras vigentes (é a fonte para planejar):
   `select chave, valor, descricao from regra_negocio where ativo order by chave;`
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
- **Pagamentos:** **Mercado Pago = gateway PRINCIPAL** · **Asaas = BACKUP** (o checkout tenta o MP
  primeiro e só cai no Asaas quando o MP falha ou recusa — `src/pages/Checkout.jsx`; o admin pode
  desligar o MP em `config_financeira`). ⚠️ Ao conferir o financeiro, **sempre verifique o fluxo**:
  extrato só com Mercado Pago é o NORMAL, não um buraco — Asaas vazio significa que o principal
  não falhou. (Corrigido em 08/08: esta linha dizia só "Asaas" e me levou a diagnosticar como
  falha o que era o funcionamento correto.)
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
