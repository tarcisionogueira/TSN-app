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
   > -- BRIGHT DATA: o que a cota PAGA comprou nesta semana. As duas colunas NÃO são a mesma coisa
   > -- e essa diferença é o ponto: `requests` = permissão concedida (reserva atômica, ANTES do
   > -- fetch); `sucessos` = chamada que chegou ao fornecedor — é ISSO que o painel cobra. Foi a
   > -- confusão entre as duas que abriu a distância entre o nosso ledger (~2.549 desde 29/06) e os
   > -- ~780 créditos que o painel mostrava. Verde = `sucessos + falhas_rede ≈ requests` e ninguém
   > -- sozinho comendo o total. Duas ressalvas ANTES de gritar: (a) `sucessos` só existe desde
   > -- 11/08 — request anterior à migração aparece sem desfecho, e a semana de 10/08 é a única
   > -- meio-a-meio; (b) `scripts/recon-*.mjs` e `scripts/scraper_vlance.py` chamam a Web Unlocker
   > -- DIRETO, fora deste ledger: rodou recon na semana, o painel cobra mais do que aparece aqui.
   > select p.proposito, p.requests, p.sucessos, p.falhas_rede, r.reserva, r.teto,
   >        (select requests from brightdata_uso u where u.semana = p.semana) as total_semana
   >   from brightdata_uso_proposito p left join brightdata_reserva r on r.proposito = p.proposito
   >  where p.semana = date_trunc('week', now())::date order by p.requests desc;
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

## 🚨 A PERGUNTA DE REVISÃO (10/08) — "este vazio é resposta, ou é falha que não sabe que falhou?"

> A varredura de 10/08 achou 28 bugs e **seis eram o mesmo defeito com roupas diferentes**:
> *resposta de erro entregue como conteúdo válido*. Extrato carimbando `completo: true` sobre um
> 403 · proximidades gravando "nenhum ponto de interesse" para 51% do acervo · lixeira dizendo
> que apagou o que a RLS não deixou · assinante rebaixado a explorador por um 500 transitório.
> **Nenhum apareceu em varredura de código anterior** — todos são código que PARECE certo.
> Ao revisar ou escrever qualquer leitura externa, faça a pergunta do título.

**As quatro formas que já morderam esta base — decore:**
1. **`.ok` checado não basta.** O Overpass devolve erro de runtime em **HTTP 200 com `remark`**
   no corpo. API que erra dentro de um 200 existe; procure o campo de erro do fornecedor.
2. **`{data, error}` do postgrest-js.** Ele **não lança** em não-2xx. `const { data } = await …`
   funde "não achou" com "não consegui ler".
3. **RLS que filtra linhas NÃO é erro.** `delete`/`update` que não alcança nada devolve
   `error: null`. Só `.select()` prova o que mudou.
4. **`null` como "acabou".** Helper que devolve `null` em falha, dentro de um laço de paginação,
   vira "fim das páginas" — e o total sai completo e errado.
5. **O FREIO DE CUSTO entregue como conteúdo (11/08).** Quando o teto de gasto recusa a chamada,
   o helper devolve a MESMA coisa que devolveria num erro de rede — e o chamador entende "a fonte
   não tem nada". O teto do Bright Data ficou **saturado 4 semanas seguidas** e o scraper do RJ
   saía com **exit 0 em 0,6 segundos**, check verde, acervo congelado há 12 dias. Se a sua função
   pode dizer "não" por decisão de ORÇAMENTO, ela tem que dizer **qual** não (`e.semCota`), e um
   coletor jamais pode carimbar sucesso sem ter gravado (`coleta_cliente_concluir` exige prova).

**Corolário do dia:** quando a operação for paralela e competitiva (`Promise.any` entre
espelhos), a corrida **premia o mais rápido — e quem desiste na hora é o mais rápido de todos**.
Falha tem que LANÇAR dentro do competidor, senão a otimização de latência passa a preferir o erro.

**6. A COLUNA DE DATA NÃO É A MESMA EM TODAS AS TABELAS (11/08).** `chamados`, `sdr_leads`,
`atividade_log` e a maioria das antigas usam `criado_em`; `casos`, `comissoes`, `solicitacoes`,
`perfis`, `relatorios` e as nascidas depois usam `created_at`. Filtrar/ordenar pela errada dá
**400 do PostgREST**, e o `{ data }` sem `error` transforma isso em lista vazia: a fila da equipe
apareceu SEM NENHUMA solicitação, e o painel de produtividade contou zero comissão para todo
mundo. Escrever as consultas juntas num `Promise.all` faz a inconsistência sumir da vista — foi
exatamente assim que passou. **Ao escrever consulta nova, confira a coluna no schema**, e para
varrer o acervo compare código × `information_schema` (ache todos os `from('tabela')` e valide as
colunas de data usadas). Achados de 11/08 por esse método: `Admin.jsx` (2 telas) e `Caso.jsx` —
esta última era a consulta de RESGATE do `/caso`, ou seja, o conserto tinha o defeito que veio
consertar.

**7. A MIGRAÇÃO ESCRITA NÃO É A MIGRAÇÃO APLICADA (12/08).** Três defeitos do mesmo dia tinham
essa causa única: **código correto cujo banco nunca recebeu o objeto**. `solicitacoes.reuniao_em`
(nunca criada) fazia o `update` do Admin dar 400 sem ninguém checar `error` — e o sistema seguia,
criava a sala no Daily.co e mandava ao **cliente** um e-mail dizendo que a reunião estava marcada,
com o banco sem registro nenhum. `onr_protocolos` tinha o `.sql` no repo desde 10/08 e nunca foi
aplicado: `/registro-imovel` abria vazia, com cara de funcionando. `proxy_uso` nunca existiu, e o
limitador de custo que dependia dela respondia "pode gastar" para sempre. **Nenhum aparece em
revisão de código, lint ou teste de front — o código está certo; o que falta está no banco.**

## 🔒 As duas travas automáticas (custo zero, sem IA)

| Trava | Onde roda | O que pega |
|---|---|---|
| `npm run verificar:padroes` | `prebuild` (todo `npm run build` e o deploy da Vercel) + CI `verificar-padroes.yml` | As formas 1–6 acima **e**, desde 12/08: `mutacao-sem-binding` (update/insert cujo resultado é descartado — a forma que mandou o e-mail de reunião fantasma) e `notify-sem-cancelled` (passo de alerta com `if: failure()` sem `cancelled()`, que deixou 3 dias de coleta truncada sem aviso) |
| `npm run verificar:schema` | CI `verificar-schema.yml` — push, PR e **diário 11h UTC** | A forma 7: toda tabela em `.from('x')` e toda coluna de data em filtro/ordenação, conferidas contra o schema REAL (RPC `schema_inventario()`) |

Ambas são **linha de base por arquivo**: só reprovam ocorrência NOVA, o acervo histórico fica como
está. Exceções deliberadas: `// padrao-ok: <motivo>` e `// schema-ok: <motivo>` — motivo obrigatório.

Duas decisões de projeto que valem entender antes de mexer:
- **O verificador de schema NÃO está no `prebuild`.** Ele precisa falar com o banco, e pôr isso no
  caminho do build faria o deploy da Vercel depender da disponibilidade do Supabase — trocaria uma
  classe de falha por outra. Fica no CI, e roda **também por agendamento**, porque a deriva
  nasce dos dois lados (renomear uma coluna quebra código que ninguém tocou).
- **Ele reprova quando NÃO CONSEGUE verificar** (saída 2, sem credencial ou banco fora). Tratar
  "não consegui checar" como "está tudo bem" seria cometer, dentro da própria trava, o defeito que
  ela existe para pegar.

**Ao criar leitura externa nova, é mais barato acertar do que explicar depois.**

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
