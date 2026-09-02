# Workflow — Bug bounty de abertura (item 6 + item 4 do ritual)

> Script para a ferramenta `Workflow` do Claude Code (multi-agente, `ultracode`). Escrito em
> 02/09 (sessão 19). Os 14 caçadores morreram no teto de uso da conta ("session limit") —
> **rodar 1 workflow por vez, 3–4 lentes cada**, depois que o teto resetar. Guardado aqui para
> não ser reescrito. Numa máquina de 4 CPUs o orquestrador roda só 2 agentes por workflow.

## Como invocar

`Workflow({ script: <conteúdo abaixo>, args: {...} })`, com um destes `args`:

```json
{"lentes":["pre-login","telas-analise","telas-comercial","admin-e-equipe"],"critic":false}
{"lentes":["api-geradores","api-dinheiro","api-crons"],"critic":false}
{"lentes":["mudancas-recentes","rpc-contrato","schema-deriva"],"critic":false}
{"lentes":["seguranca-auth","seguranca-injecao","seguranca-rls","qa-p0-recheck"],"critic":true}
```

Sem `args`, roda as 14 lentes de uma vez (só faça isso com cota de sobra).

## Script

```js
export const meta = {
  name: 'bidpro-bug-bounty-abertura',
  description: 'Bug bounty do código BidPro por camada (14 caçadores) + ofensiva de segurança, com 3 refutadores por achado',
  phases: [
    { title: 'Find', detail: '14 caçadores, um por camada/lente, com acesso read-only ao banco' },
    { title: 'Verify', detail: '3 refutadores por achado (código · histórico · impacto)' },
    { title: 'Critic', detail: 'o que ficou de fora' },
  ],
}

const FINDINGS = {
  type: 'object', required: ['findings'],
  properties: { findings: { type: 'array', items: { type: 'object',
    required: ['file','line','title','category','severity','description','evidence','fix','ja_conhecido'],
    properties: {
      file: { type: 'string' }, line: { type: 'integer' }, title: { type: 'string' },
      category: { type: 'string', enum: ['logica','erro-silenciado','gate','cota','dedup','schema','seguranca','rpc-contrato','outro'] },
      severity: { type: 'string', enum: ['P0','P1','P2'] },
      description: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' },
      ja_conhecido: { type: 'boolean' },
    } } } } }

const VERDICT = { type: 'object', required: ['refuted','reason','confidence'],
  properties: { refuted: { type: 'boolean' }, reason: { type: 'string' },
    confidence: { type: 'string', enum: ['alta','media','baixa'] },
    corrected_severity: { type: 'string', enum: ['P0','P1','P2'] } } }

const PREAMBULO = `Você é um caçador de bugs no repositório BidPro Brasil (cwd /home/user/TSN-app: React+Vite em src/, Vercel serverless em api/, migrações em supabase/migrations/, scripts em scripts/). Leia docs/CLAUDE.md? NÃO — leia /home/user/TSN-app/CLAUDE.md (raiz) primeiro: ele lista as "10 formas" de defeito que já morderam esta base.
REGRAS: (a) trabalhe SOMENTE lendo (Read/Grep/Glob/Bash read-only) — NÃO modifique nenhum arquivo, não faça git commit. (b) Você PODE consultar o banco de PRODUÇÃO em modo somente-leitura: carregue com ToolSearch "select:mcp__Supabase__execute_sql" e chame execute_sql com project_id "zuwfiwokkdytvjixiwac" — apenas SELECT / information_schema / pg_get_functiondef / pg_get_function_result; NUNCA insert/update/delete/DDL. Use isso para confirmar colunas, retorno de RPCs e se o cenário existe em dados reais. (c) Antes de reportar, grep em docs/HANDOFF.md pelos termos do achado: se já consta como CORRIGIDO e o código atual não tem mais o defeito, NÃO reporte; se consta mas o defeito ainda está no código, reporte com ja_conhecido=true. (d) Cada achado exige file:line REAL (abra o arquivo e confirme a linha), evidência concreta (trecho do código) e fix proposto. Sem especulação: reporte só o que você confirmou lendo. (e) Severidade: P0 = entrega resultado errado/vazio ao cliente, dinheiro, segurança; P1 = falha silenciosa operacional; P2 = gap. (f) Comentários "// padrao-ok:" e "// schema-ok:" são exceções deliberadas — não reporte.
PADRÕES-ALVO: (1) fetch/anthropicFetch → .json() sem checar .ok, ou API que erra dentro de um 200 (campo de erro no corpo); (2) "const { data } = await supabase..." sem checar error — funde "não achou" com "não consegui ler"; (3) delete/update sem .select() tratado como sucesso mesmo quando a RLS filtrou tudo; (4) helper que devolve null em falha dentro de laço de paginação ("acabou"); (5) freio de custo (sem cota Bright Data) devolvido como "fonte sem nada"; (6) coluna de data errada (criado_em × created_at) em filtro/ordenação; (7) migração escrita mas não aplicada / objeto usado no código que não existe no banco; (8) contar não-nulos como validação; (9) .limit() por tabela e depois cruzar por chave; (10) instrumento que mede uma coisa e reporta com nome de outra. Mais: botão/ação sem gate; cron/e-mail sem dedup ou sem excluir contas internas (admin); cobrança de cota em fluxo que falhou; chave lida do retorno de uma RPC que a função não devolve (undefined===true escolhe o ramo errado, em silêncio); Promise.any onde falha rápida vence.
Retorne SÓ o JSON do schema. Se não achar nada confirmado, devolva findings: [].`

const LENTES = [
  { key: 'pre-login', prompt: `ESCOPO: fluxo PRÉ-LOGIN. Arquivos: src/pages/Login.jsx (cadastro, login, recuperação de senha, confirmação e reenvio de e-mail), src/contexts/*Auth*, src/utils/*captura*/*marketing*, api/boas-vindas.js, api/assinar-com-cadastro.js, api/verificar-cpf*.js, api/_telefone.js, api/_nome.js, api/_rate-limit.js, api/log-erro-cliente.js, api/track.js, api/clique.js. Procure: erro do Supabase Auth engolido; cadastro que grava perfil pela metade; origem de marketing (mkt_*) perdida; telefone duplicado; rate limit contornável; e-mail de verificação sem dedup; redirecionamento pós-confirmação.` },
  { key: 'telas-analise', prompt: `ESCOPO: telas logadas do PRODUTO. Arquivos: src/pages/Analise.jsx, src/pages/ImovelDetalhe.jsx, src/pages/Busca.jsx, src/contexts/AnalisesContext*.jsx, src/components/*Relatorio*, *Mapa*, *Upload*. Procure: gates ("Arrematei"/"Revenda"/"Gerar" aparecendo sem os relatórios prontos), erro de RPC/Supabase virando "nenhum resultado", estado do imóvel anterior vazando ao trocar de imóvel (corrida), uploads sem checar resultado, .limit() cruzado entre tabelas, {data} sem error.` },
  { key: 'telas-comercial', prompt: `ESCOPO: telas de DINHEIRO e conta. Arquivos: src/pages/Planos*.jsx, src/pages/Checkout.jsx, src/pages/Indice*.jsx, src/pages/Caso.jsx, src/pages/Perfil*.jsx, src/pages/Indicacao*.jsx, src/pages/Saque*.jsx, src/pages/*Kyc*/*Documentos*, src/pages/Contrato*.jsx. Procure: MP→Asaas fallback errado, cobrança dupla, plano aplicado antes do webhook, saque sem gate de pagante, KYC "sucesso" sem persistir, contratos/assinaturas sem verificação de linhas afetadas.` },
  { key: 'admin-e-equipe', prompt: `ESCOPO: telas de ADMIN/EQUIPE. Arquivos: src/pages/Admin*.jsx, src/pages/admin/**, src/pages/Cliente360*.jsx, src/pages/*WhatsApp*, src/pages/*Instagram*, src/pages/Advogado*.jsx, src/pages/Consultor*.jsx, api/admin-*.js. Procure: coluna de data errada por tabela (confira contra information_schema no banco), {data} sem error deixando painel vazio, ação (update/insert) cujo resultado é descartado, e-mail ao cliente disparado antes de o banco confirmar, filtros de role no cliente sem checagem no servidor.` },
  { key: 'api-geradores', prompt: `ESCOPO: geradores de relatório. Arquivos: api/gerar-analise.js, api/gerar-documental.js, api/gerar-laudo.js, api/processar-analise-jobs-cron.js, api/_claude.js, api/_gemini.js, api/_doc-*.js, api/_edital-extrato.js, api/_valor-mercado.js, api/_certidoes-fontes.js, api/certidoes.js, api/_uso.js. Procure: resposta de erro entregue como conteúdo; cache reaproveitado com valor nulo salvo como concluída e cobrado; laudo concluído sobrescrito com status erro por timeout do pós-salvamento; certidões "sem apontamentos" indistinguível de "3 fontes falharam"; cota debitada em fluxo que falhou; JSON não utilizável marcado como definitivo/indefinido errado.` },
  { key: 'api-dinheiro', prompt: `ESCOPO: DINHEIRO. Arquivos: api/saque.js, api/checkout*.js, api/mp-*.js, api/mercadopago*.js, api/asaas.js, api/asaas-webhook.js, api/_webhook-core.js, api/indicacao*.js, api/comissao*.js, api/_ancora-cdc.js, api/ativar-*.js, api/cancelar-*.js, api/backfill-mp-pagamentos-cron.js, api/financeiro-extrato.js, api/admin-chargebacks.js, api/_honorarios.js, api/_nfse.js. Procure: idempotência de webhook, HMAC, PATCH com return=minimal sem conferir linhas afetadas (recusar saque já pago), plano ativado sem pagamento aprovado, reembolso/CDC, receita contada sem cliente, fallback Asaas.` },
  { key: 'api-crons', prompt: `ESCOPO: todos os api/*-cron.js (liste com Glob). Procure: e-mail/nudge sem dedup ou sem excluir contas internas (admin/equipe); run que carimba sucesso sem ter gravado; cota (Bright Data/IA) tratada como conteúdo; timeout de 25s/300s sem chunking (ex.: cnj-monitor-cron para em 25s TODO DIA — confirme se o trabalho é perdido); notify com if: failure() sem cancelled(); crons que competem entre si; CRON_SECRET ausente.` },
  { key: 'mudancas-recentes', prompt: `ESCOPO: o que mudou desde 26/08 (rode: git log --since=2026-08-26 --name-only --pretty=format: origin/main | sort -u). Priorize: api/instagram-webhook.js, api/_ig-motor.js, api/admin-ig-caixa.js, api/ig-*-cron.js, api/admin-whatsapp-fila.js, api/_convite-live.js, api/convidar-live-cron.js, api/live-*.js, api/live-lead-retro.js, src/pages/LiveInscricao.jsx, src/utils/rotaCampanha.js, src/pages/admin/Instagram*, src/pages/admin/WhatsApp*, api/_cidade-do-titulo.js, api/meta-insights-cron.js, api/ads-metrics-ingest.js. Procure defeitos de lógica introduzidos nesses commits, contratos JS×RPC (chaves lidas do retorno que a função não devolve — confira com pg_get_functiondef no banco), e datas/prazos (lembretes da live 02/09 22:00 UTC).` },
  { key: 'rpc-contrato', prompt: `ESCOPO: CONTRATO JS × RPC. Liste TODAS as chamadas .rpc('nome' em src/ e api/ (grep -rn "rpc(" src api). Para cada RPC, colete as chaves que o JS lê do resultado (data.x, row.y, p.z) e compare com o retorno REAL da função no banco: select pg_get_function_result('public.nome'::regproc) e, para retornos json/jsonb, pg_get_functiondef. Reporte cada chave lida que a função NÃO devolve (é a forma que atingiu 64 de 66 pessoas em 01/09), e RPCs chamadas que NÃO existem no banco (select proname from pg_proc where pronamespace='public'::regnamespace). Seja exaustivo: percorra a lista inteira, não amostre.` },
  { key: 'schema-deriva', prompt: `ESCOPO: DERIVA código × banco. (1) Para cada supabase/migrations/*.sql com data >= 2026-08-20, verifique se os objetos criados/alterados (tabelas, colunas, funções, políticas, índices) EXISTEM no banco (information_schema.tables/columns, pg_proc, pg_policies, pg_indexes). (2) Para cada .from('tabela') em src/ e api/, confira que a tabela existe e que as colunas usadas em .eq/.order/.gt/.lt/.in/.select existem (information_schema.columns). Percorra TODOS os arquivos, não amostre. Reporte objeto ausente no banco (forma #7) e coluna inexistente (400 silencioso).` },
  { key: 'seguranca-auth', prompt: `LENTE OFENSIVA A — auth/tokens/contratos/KYC/convites. Liste todos os api/*.js e classifique: quais NÃO chamam getUser/getAuthUser de api/_auth.js nem verificam CRON_SECRET nem HMAC de webhook, e ainda assim leem/escrevem dado de usuário (com service key)? Procure IDOR (user_id/email vindo do body em vez do token), endpoints admin sem checar role no servidor, tokens de convite/assinatura/descadastro previsíveis ou sem expiração, KYC/validar-selfie/baixar-doc/anexo-url servindo arquivo de outro usuário, rate limit ausente em login/cadastro/verificar-cpf, JWT em logs. Confirme lendo o código; ataque concreto por achado.` },
  { key: 'seguranca-injecao', prompt: `LENTE OFENSIVA B — injeção/SSRF/XSS. Foque: api/instagram-webhook.js (assinatura, parse, payload cru gravado), api/admin-ig-caixa.js, api/_ig-motor.js (prompt injection de DM para o modelo → ação), api/chat-suporte.js, api/admin-chat.js, api/cnj-chat.js, api/claude.js, api/_allowed-hosts.js + qualquer fetch(url) com host controlado pelo usuário (SSRF), api/_sanitize.js e usos de dangerouslySetInnerHTML em src/, open redirect (returnTo/next), SQL montado por string em api/ ou em funções SQL com EXECUTE format sem %L/%I, storage signed URLs com path controlado. Confirme lendo o código; ataque concreto por achado.` },
  { key: 'seguranca-rls', prompt: `LENTE OFENSIVA C — verificação + lacunas no BANCO (consulte o banco read-only). (1) Tabelas em public sem RLS ou com RLS sem política e com grant a anon/authenticated (pg_tables, pg_policies, information_schema.role_table_grants). (2) Funções SECURITY DEFINER executáveis por anon/authenticated (pg_proc.prosecdef + has_function_privilege) — para cada uma, o corpo permite ler/escrever dado de outro usuário? (3) Buckets storage públicos e políticas amplas em storage.objects. (4) Tabelas criadas desde 26/08 (ig_*, whatsapp_disparo_log, live_*, planos_config.publico, ig_rascunho, intervencao) — quem lê/escreve? (5) Compare com o que public.auditoria_seguranca() cobre (pg_get_functiondef) — o que ela NÃO vigia? Reporte só lacunas concretas.` },
  { key: 'qa-p0-recheck', prompt: `ESCOPO: RECONFERIR os 7 P0 do QA semanal de 31/08 contra o código ATUAL (a sessão 16 diz ter corrigido "12 bugs do QA" em 31/08; confirme um a um): (1) api/gerar-analise.js — relatório reaproveitado de cache com valorMercado nulo salvo como concluída, cobrado e fora do self-heal (condição "!reaproveitado &&" em mercadoVazio); (2) src/pages/Busca.jsx — erro do Supabase na busca principal (sem raio) não checado → "Nenhum resultado"; (3) api/saque.js — PATCH pagar/recusar com Prefer: return=minimal sem conferir linhas afetadas (recusar saque já pago); (4) src/pages/ImovelDetalhe.jsx — abre Edital/Matrícula do imóvel ANTERIOR ao trocar sob erro/corrida; (5) src/pages/Analise.jsx — avaliação do imóvel anterior sob relatório novo; (6) api/gerar-documental.js — sobrescreve laudo CONCLUÍDO com status erro se o pós-salvamento estoura timeout; (7) certidões fiscais "sem apontamentos" quando as 3 fontes falharam. Mais os P1 citados: indicação de cliente perdida em silêncio, KYC de equipe "sucesso" sem aplicar role, race na busca. Reporte APENAS os que ainda estão presentes no código atual, com file:line.` },
]

const ativas = (args && Array.isArray(args.lentes)) ? LENTES.filter(l => args.lentes.includes(l.key)) : LENTES
const TODAS = (args && Array.isArray(args.todas)) ? args.todas : LENTES.map(l => l.key)

phase('Find')
const rounds = await parallel(ativas.map(l => () =>
  agent(`${PREAMBULO}\n\n${l.prompt}`, { label: `find:${l.key}`, phase: 'Find', schema: FINDINGS })
    .then(r => (r && r.findings ? r.findings.map(f => ({ ...f, lente: l.key })) : []))))
const all = rounds.filter(Boolean).flat()
log(`Find: ${all.length} achados brutos em ${ativas.length} lentes (${ativas.map(l => l.key).join(', ')})`)

const seen = new Map()
for (const f of all) {
  const k = `${f.file}:${Math.round((f.line || 0) / 12)}`
  if (!seen.has(k)) seen.set(k, f)
  else { const p = seen.get(k); p.lentes = (p.lentes || [p.lente]).concat(f.lente); if (f.severity < p.severity) p.severity = f.severity }
}
const unique = [...seen.values()]
log(`Dedup: ${unique.length} únicos (${all.length - unique.length} duplicados)`)

const VERDICT2 = { type: 'object', required: ['refuted','reason','confidence','lente_codigo','lente_historico','lente_impacto'],
  properties: { refuted: { type: 'boolean' }, reason: { type: 'string' },
    confidence: { type: 'string', enum: ['alta','media','baixa'] },
    corrected_severity: { type: 'string', enum: ['P0','P1','P2'] },
    lente_codigo: { type: 'string' }, lente_historico: { type: 'string' }, lente_impacto: { type: 'string' } } }

phase('Verify')
const verified = await parallel(unique.map((f, i) => () =>
  agent(`Você é um revisor cético do repositório BidPro Brasil (cwd /home/user/TSN-app; leia CLAUDE.md na raiz se precisar de contexto). NÃO modifique arquivos. Tente REFUTAR o achado abaixo por TRÊS lentes, e preencha uma linha para cada:
(1) lente_codigo — abra o arquivo e a linha citados: o caminho de código faz mesmo isso? Existe checagem em outro lugar (helper/wrapper, trigger/constraint/RLS no banco, teste em scripts/testes) que o achado ignorou? A linha existe e é essa?
(2) lente_historico — grep em docs/HANDOFF.md pelos termos do achado; git log -S"<trecho>" -- <arquivo>; comentários "padrao-ok:"/"schema-ok:"; decisões do dono documentadas. Já foi corrigido depois? É comportamento intencional? É duplicata de item já resolvido?
(3) lente_impacto — alcança cliente, dinheiro ou segurança em PRODUÇÃO? Você pode consultar o banco read-only (ToolSearch "select:mcp__Supabase__execute_sql", project_id "zuwfiwokkdytvjixiwac", só SELECT) para ver se o cenário ocorre em dados reais. Teórico sem caminho alcançável = refutar.
REGRA: refuted=true SOMENTE com motivo concreto (file:line que contradiz, commit que corrigiu, ou consulta que mostra que o cenário não ocorre). Se você confirmou o defeito lendo o código, refuted=false e ajuste corrected_severity. Se não conseguiu verificar, refuted=false com confidence "baixa" e diga o que faltou.

ACHADO #${i}:
${JSON.stringify(f, null, 2)}

Responda só o JSON do schema; reason curta e concreta.`,
    { label: `verify:${(f.file || '').split('/').pop()}:${f.line}`, phase: 'Verify', schema: VERDICT2 })
    .then(v => ({ ...f, verdict: v, survives: !!v && !v.refuted, severity_final: (v && v.corrected_severity) || f.severity }))))
const confirmed = verified.filter(Boolean).filter(v => v.survives)
const refuted = verified.filter(Boolean).filter(v => !v.survives)
log(`Verify: ${confirmed.length} confirmados · ${refuted.length} refutados`)

let critic = null
if (args && args.critic) {
  phase('Critic')
  critic = await agent(`Você é o crítico de completude de uma varredura de bugs no repositório BidPro Brasil (cwd /home/user/TSN-app; leia CLAUDE.md na raiz, seção "Ritual de início de sessão", item 6). NÃO modifique arquivos. As lentes rodadas (em 4 workflows paralelos) foram: ${TODAS.join(', ')} — as descrições de escopo de cada lente estão neste script: ${LENTES.map(l => l.key + ': ' + l.prompt.slice(0, 220)).join(' || ')}. Pergunta: o que ficou DE FORA? Liste (a) arquivos/endpoints de api/ e src/pages/ que nenhuma lente cobriu (confira com Glob quais existem), (b) padrões-alvo do CLAUDE.md que nenhuma lente procurou, (c) até 5 verificações concretas e baratas que valeriam a próxima rodada. Responda em português, markdown curto (máx. 30 linhas).`, { label: 'critic', phase: 'Critic' })
}

return { lentes: ativas.map(l => l.key), confirmed, refuted, critic, stats: { brutos: all.length, unicos: unique.length, confirmados: confirmed.length, refutados: refuted.length } }
```
