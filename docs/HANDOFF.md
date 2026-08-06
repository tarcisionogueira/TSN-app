# 🗺️ HANDOFF — BidPro Brasil (continuação em nova sessão)

> Cole este documento no início de uma nova sessão do Claude Code (com o **conector Supabase ativo**) para continuar com acesso total ao banco. Peça primeiro uma **auditoria completa dos fluxos** e depois siga pelos "Próximos passos".

> 📋 **Pendências que dependem do DONO** (painéis/planos): ver `docs/PENDENCIAS_DONO.md`. Ao iniciar sessão, se o dono perguntar "o que falta que depende de mim?", liste de lá. **Topo da fila em 02/08: (-4) Google Search Console + Perfil da Empresa** — as 33 mil páginas novas estão no ar e o Google ainda não sabe; e **(-3) Cloudflare R2**, único item que protege contra perda definitiva de arquivo de cliente. Depois: Resend (URL com `www` + Re-enable), Google Ads (verificação até 31/08), Asaas (reativar webhook), Upstash (grátis).

> ⏰ **VALIDAR NO PRÓXIMO CICLO (fontes corrigidas em 18/07):**
> 1. **PECINI** — o cron gravava em DRY-RUN (fallback `|| '1'` no workflow); corrigido p/ `'0'`. Próximo cron **seg 07-20 09h UTC** deve GRAVAR. Conferir: `select count(*) from imoveis_leilao where fonte='PECINI' and atualizado_em > now()-interval '1 day';` (esperado > 23) **e o gasto Bright Data** (é pago).
> 2. **BIASI** — paginação estava presa na 1ª página (dependia do atributo `total`); tornei robusta. Conferir se o scrape volta a ~370 (não 173): `select total, status from fonte_saude where fonte='BIASI' order by executado_em desc limit 3;`. Se seguir ~173, é acervo real do site.
> 3. Ambas as fontes agora entram no **monitor-fontes-cron** (expandido para todas as fontes + falha silenciosa dos scrapers pagos) — o e-mail avisa se regredir.
> 4. **LINHA DE BASE por leiloeiro (novo):** `docs/BASELINE_CAPTURA_LEILOEIROS.md` + `BASELINE_FONTES` no monitor + RPC `fonte_cobertura()`. O monitor agora alerta **regressão silenciosa** (acervo abaixo do piso OU campo que vinha alto sumindo). Calibrado para **0 falso-positivo** no acervo atual. Ao evoluir um parser (área/data/edital), **re-medir e atualizar** os dois + `leiloeiro_conhecimento`.
> 5. **Recon edital ZUK: EXECUTADO (não precisa do dono p/ rodar).** Padrão do PDF descoberto — ver bloco 18/07. Próximo passo é **código** (plugar a captura), não uma ação manual do dono.
> 6. **Cobertura documental por leiloeiro — VERIFICADA + BUG CORRIGIDO (23/07):** varredura da matrícula/edital por fonte. (a) **BUG real:** o classificador só via "matr[ií]cul" → matrícula com nome QUEBRADO por charset (mojibake "matrãâ­cula" do SUPERBID), SEM acento ("matrcula") ou ABREVIADO ("matr-15964") era gravada como `anexo` genérico → no laudo documental caía pro fim da fila e o GATE dizia "matrícula faltando" mesmo com o PDF no acervo. Corrigido em `api/_doc-scan.js` (captura) + `api/gerar-documental.js` (leitura/gate; `anexo` genérico não ofusca mais o tipo do nome) + backfill de **1.496** elementos jsonb (`supabase/migrations/anexos_reclassificar_matricula_mislabel.sql`, idempotente). (b) **CEF edital 43% = NÃO é bug:** os 21,7 mil de `venda_direta` não têm edital — usam "Regras da Venda Online" (PDF padrão, montado na hora por `caixaRegrasVendaUrl`); extrajudicial+licitação = 100%; matrícula 100% (URL montada). (c) **PHP-cluster (GESTAOLEILOES/SBID/PECINI) 0% `link_matricula` = genuíno:** o site não publica PDF de matrícula avulso — o scraper já extrai o **número** (GESTAOLEILOES 116/123) + edital 100%; o laudo usa o número p/ orientar cartório. (d) **ZUK 19%/SUPERBID 30% parcial = por design:** matrícula é buscada **sob demanda** na geração do laudo (login-on-demand + doc-scan), p/ poupar Bright Data — não pré-capturar em massa. Melhoria futura (baixa prioridade): extrair `numero_matricula` p/ PECINI/SBID/SOLD como o GESTAOLEILOES faz.
> 7. **Matrícula — resolução GENERALIZADA (24/07, gatilho: terreno ZUK `zuk_36771-229309` "sem matrícula"):** a `documentos_fila` era LEDGER, não fila de TRABALHO → **1.889 lotes ativos ficavam PRESOS** (562 erro 4× + 1.327 "ok" que só pegaram o edital) e nunca re-tentados, porque `enfileirar_docs_faltantes()` excluía qualquer lote já na fila. **Correção** (`matricula_resolucao_generalizada` + `matricula_enfileirar_pago_proxima_coleta`): a fila vira TRABALHO (purga processados/resolvidos); enfileirador **ciente da fonte** — pula não-publicadoras (`docs_status='esperado'`: SUPERBID/SOLD/SBID9/21/VENDASGOV), login-gated com pipeline próprio (ZUK/GRUPOLANCE, `matricula-*.yml` 4×/dia), **fontes PAGAS** (`custo='pago'`: PECINI/RJLEILOES/GESTAOLEILOES → próxima coleta + on-demand no laudo) e lotes que **já têm `numero_matricula`**; cooldown 30d via negative-cache (`matricula_checada_em`) — a re-checagem captura o link novo da **próxima coleta paga**. `captura-documentos.mjs` passa a marcar `matricula_checada_em` quando checa e a matrícula não sai (lacuna CONHECIDA, não silenciosa). Auditoria: `select * from matricula_cobertura();` (grátis×pago×publica). **Resultado:** fila 2.971 presos → **147 pendentes 100% grátis**; regra do dono cumprida (**grátis=agora, pago=próxima coleta**). Enfileirar (`enfileirar-documentos.yml` 10h UTC) + drenar (`captura-documentos.yml` 30/30min) + ZUK/GL login 4×/dia já disparados.

> 8. **Plano de carreira / RANKS — fundação no ar (24/07, nome GENÉRICO a renomear):** cálculos e regras prontos (`comissao_ranks_fundacao`): tabela `comissao_ranks` (6 faixas "Nível 1..6", qualificação por rede paga, `pool_peso`), `rank_config` (pool_pct=2%, carência 2 meses), colunas `perfis.rank_key/rank_desde/rank_meses_abaixo`, e funções `rank_do_parceiro`/`rede_metricas_parceiro`/`recalcular_ranks` (sobe na hora, cai só após carência)/`distribuir_pool_rank` (pool FECHADO, idempotente por competência, bounded por definição). Estrutura **service-only** (RLS + EXECUTE revogado de anon) — **não divulgar**. **Falta o dono:** (a) **NOME final dos ranks — COMEÇAR POR AQUI (o dono vai amadurecer):** linha *história+liderança*, manter Pioneiro·Fundador·Mestre·Lenda + títulos de LÍDER no topo; candidatos em `docs/PLANO_COMISSIONAMENTO_MLM.md` §11.1.3 — só um `update comissao_ranks.nome`; (b) validar os **percentuais** (§11.1.2 — exposição máx. assinatura ~20,5% / produto 32,5% / venda 19,5%; honorário e recarga NÃO comissionam) e o % do pool (2%); (c) go-live do pool (**agendar** `recalcular_ranks`+`distribuir_pool_rank` mensais — ainda SEM cron). **SAQUE UNIFICADO — JÁ FEITO (24/07):** `saldo_usuarios` agora inclui o cliente pagante → **toda venda saca pela mesma regra** (sexta 12h, mesmos pré-reqs KYC/PIX); §11.1.1.
> 9. **Segurança — hardening RPC (24/07):** `rpc_definer_revogar_anon` tirou o EXECUTE de anon/PUBLIC de 16 funções SECURITY DEFINER (crédito, comissão de rede, índice, ranks) que só o backend (service_role) ou o cliente autenticado chamam. `relatorio_comissoes_rede`+`vincular_upline` → só `authenticated`; as demais → só `service_role`. `auditoria_seguranca()` de volta a **0 crítico / 0 atenção**.

> 🩺 **Segurança — automação em 2 camadas (não depende de sessão manual):**
> 1. **DB/RLS/grants (determinística):** cron `seguranca-auditoria-cron` (semanal, servidor) roda `auditoria_seguranca()` e **e-mail só se regredir**. Cobre AUTOMATICAMENTE objetos novos de banco.
> 2. **Código (ofensiva):** Rotina agendada `Auditoria de segurança BidPro (mensal)` acorda uma sessão sozinha, roda os 3 agentes ofensivos sobre o repo e **notifica o dono** (sem MCP → não faz a parte de banco, coberta pela camada 1; não faz push automático).
> Checagem rápida a qualquer momento: `select public.auditoria_seguranca();` → `0 crítico / 0 atenção` = íntegro.
> **Auditorias ofensivas completas: 15/07/2026 (×2).** Total de correções: 15 (1ª rodada) + escalonamento por convite (CRÍTICO) + IDOR do MP (ALTO) + escala. Refazer a ofensiva quando entrarem rotas/pagamento/RLS novos (a Rotina mensal já faz isso sozinha).

## 🔔 VALIDAR NA ABERTURA DA SESSÃO DE 05/08 (combinado com o dono no fim do dia 04/08)

> Cinco verificações. **Todas dependem só do tempo passar** — nada foi deixado pela metade. Rodar
> ANTES de qualquer outra coisa e reportar em bloco. As três primeiras têm prazo.

| # | O que validar | Como | Verde é |
|---|---|---|---|
| 1 | **Aviso de renovação da Alessandra** ⏰ *cobrança dia 07* | `select * from webhook_eventos_processados where evento like 'renov_aviso%';` | Deixar de ser VAZIO pela 1ª vez. Se vazio, o contador `sem_email` na resposta do cron diz o porquê |
| 2 | **Gatilho do edital CEF** ⏰ *prova de fogo* | `select count(*) filter (where public.eh_edital_pdf(link_edital)) com_pdf, count(*) total from imoveis_leilao where fonte='CEF' and ativo and modalidade in ('extrajudicial','licitacao_aberta');` | ~10.010/10.035 **depois** do scraper das 09:00 UTC. Se cair para centenas, o gatilho sumiu |
| 3 | **Endereço derivado do título** ⏰ *idem* | `select count(*) from imoveis_leilao where ativo and fonte='ZUK' and coalesce(btrim(endereco),'')<>'';` e `select count(*) filter (where geocod_nivel='refazer') from imoveis_leilao where ativo and public.endereco_do_titulo(titulo,cidade) is not null;` | Continuar **722** depois do scrape (prova que o gatilho segurou) e a fila de regeocode DRENANDO (< 722) |
| 4 | **Geocode do lote do Rafael** | `select endereco, latitude, longitude, geocod_nivel from imoveis_leilao where fonte_id='zuk_37094-231508';` | Coordenada **diferente** de `-23.4675941, -46.5277704` (o fallback de cidade) e `geocod_nivel` ≠ 'refazer'. **Depois disso, regerar o mercadológico dele e conferir se o Nível 1 traz amostras** — é o fechamento do caso |
| 5 | **IBGE + fotos órfãs** | `select chave, ultimo_em, ultimo_ok from socio_fontes;` · `select count(*) from public.fotos_orfas_para_limpeza(100000);` | Agregados 6579 e 2612 saírem de NULL · órfãs abaixo de **24.811** |

### 📌 As 2 coisas a AGENDAR logo na abertura (o dono aprovou em 04/08 — só faltava a permissão)

As permissões **já estão versionadas** em `.claude/settings.json` (commit 82e964c) e passam a valer
nesta sessão, porque agora o arquivo existe desde o início. Assim que confirmar que `send_later`
responde, **agendar as duas** — em 04/08 as chamadas ainda voltavam `requires approval`, porque a
aprovação é do runtime e o arquivo tinha acabado de ser criado:

1. **18/08 — Search Console, "Snippets do produto".** Passadas 2 semanas do deploy com `sku` +
   `priceValidUntil`, pedir ao dono os **nomes exatos** dos campos que sobraram no painel
   (Aprimoramentos → Snippets do produto). Critério de decisão já resolvido no **item 6**: sumiram
   → encerrado; sobrou aviso NÃO crítico → não mexer; ERRO crítico → aí sim reavaliar
   `RealEstateListing`, lembrando que a troca custa o rich snippet de preço.
2. **Heartbeat da manhã seguinte** — mesmo bloco de validações acima, se algum item ficar vermelho
   hoje e depender de novo ciclo de cron.

### 🔓 Permissões MCP — o que ficou liberado (e o que NÃO)

`allow`: leitura da Vercel (`get_runtime_logs`, `get_runtime_errors`, `get_deployment`,
`get_deployment_build_logs`, listagens) + agendamento (`send_later` e gestão dos triggers).
`ask` (segue pedindo aprovação a cada uso): `deploy_to_vercel`,
`update_project_deployment_protection` e tudo que gasta dinheiro (`buy_domain`, `buy_credits`,
`buy_addon`, `buy_pro`). **Escolha deliberada:** ler log não muda nada no mundo; publicar e comprar
mudam. `.claude/` segue ignorada no git — só o `settings.json` abre exceção (`.claude/*` +
`!.claude/settings.json`, porque o git não reabre arquivo dentro de diretório excluído).

**Também nesta sessão:** decidir a **Camada 2 do endereço** (edital/matrícula, item 7).

---

## ✅ COMEÇAR AQUI (05/08 — sessão 26: o rótulo mentia em três lugares diferentes)

> Branch `claude/bidprobrasil-system-checks-u1lrl6` → **JÁ EM `main`** (fast-forward
> `4547c23..682c29c`, autorizado pelo dono). Deploy `dpl_qmmNVu2sJFbuRsL7UuPbU1cjW79t`
> **READY** em 32s, alias `bidprobrasil.com.br` ativo, `lambdaRuntimeStats {"nodejs":96}`.
> `npm run build` OK · `auditoria_seguranca()` **0 crítico / 0 atenção** (as tabelas novas
> nasceram com RLS). Caminho de push: `git push origin <branch>:main` — o `main` LOCAL
> de história não relacionada continua existindo, **não use**.

### As 5 validações combinadas para hoje (resultado)

| # | Item | Resultado |
|---|---|---|
| 1 | Aviso de renovação da Alessandra | ✅ 1 registro — saiu do vazio antes da cobrança do dia 07 |
| 2 | Gatilho do edital CEF | ✅ **10.010 / 10.035** — exato, sobreviveu ao scraper das 09h |
| 3 | Endereço derivado do título | ✅ gatilho segurou **100%**: dos 450 ZUK ativos, 418 derivam do título e 418 têm endereço (zero vazios). O "722" de ontem era sobre 840 lotes — a proporção SUBIU (86% → 93%). Fila de regeocode 722 → 4 |
| 4 | Geocode do lote do Rafael | 🔴 abriu um bug maior — ver abaixo |
| 5 | IBGE + fotos órfãs | ✅ órfãs 23.341 (< 24.811). `caged_emprego` NULL **não é bug**: desligada de propósito (o Novo CAGED não expõe API por município; caminho documentado = Action mensal que baixa o arquivo nacional) |

### 🔴 1) O geocode rotulava pela INTENÇÃO, não pelo resultado — 3.458 lotes

O endereço do Rafael passou a existir (correção de 04/08) e mesmo assim a coordenada não
mudou: continuou `-23.4675941,-46.5277704`, agora com `geocod_nivel='rua'`. Prova de que o
rótulo mentia: **duas ruas ZUK diferentes** com a MESMA coordenada de 7 casas decimais, e um
lote CEF `nivel='cidade'` no mesmo ponto. Quando a rua não existe no OSM, o Nominatim
devolve o **nó da cidade** — e a cascata rotulava pelo INPUT ("pedi rua+número → endereco").
O guarda `nivelReal` só pegava resultado a <250 m do centróide IBGE; este caía a **1,6 km**.

**Escala:** 3.458 lotes ativos rotulados `rua`/`endereco` com coordenada exata compartilhada
entre **logradouros diferentes** (685 grupos) — e, por parecerem precisos, **nunca entravam
na fila de refazer**. Corrigido em `api/_geo.js` (`nivelNominatim` classifica o
class/type/addresstype do RESULTADO; `capNivel` vira teto do rótulo em TODOS os retornos —
POI, rua, CEP, bairro). Migração `geocode_pino_generico_detectar_refazer.sql` aplicada:
detecção + requeue (fila 22 → 3.519; detecção zerada). Backstop permanente no
`monitor-dados-cron` (`geocode_pinos_genericos_total()` > 300 alerta).

### 🔴 2) Matrícula abrindo `{"code":"NoSuchKey"}` (achado do dono)

A recaptura troca o objeto canônico da matrícula em `imovel_anexos` (path por hash), o JSONB
`imoveis_leilao.anexos` fica apontando p/ o objeto ANTIGO, e a limpeza do bucket — que só
enxergava `imovel_anexos`/`usuario_docs`/`arrematacoes` — apagava o "órfão" **com o app ainda
linkando**. 14 matrículas GRUPOLANCE mortas. Corrigido em 3 camadas: a função de limpeza
enxerga o JSONB (nem em `dup_extra`), reparo idempotente dos links (**14 → 0**), e
`captura-documentos.mjs` sincroniza o espelho JSONB ao trocar o path.

### 🔴 3) Role errado no painel: o assessorado aparecia como Explorador

Cadeia: `CriarContrato` só listava planos `cobrar=true` — e **assessorado/clube fecham por
CONTRATO** (`cobrar=false`) → contrato sem `plano_key` → a assinatura não tinha o que
promover (e não havia promoção nenhuma). Corrigido: dropdown lista os 4 tiers de cliente;
`assinar-contrato` promove o role do signatário na **mesma escada anti-rebaixamento** dos
pagamentos (equipe intocada), com trilha em `audit_logs`. Rafael reparado
(`plano_key='assessorado'` + perfil promovido). **Bônus:** o e-mail "assinatura registrada"
NUNCA foi enviado — buscava `email` em `perfis`, coluna que não existe (vive em
`auth.users`); falhava em silêncio. Corrigido via `admin/users`.

### 🟢 4) "Leia 1 vez, use em todo lugar" — cache de documento (pedido do dono)

`doc_extracoes` (chave = md5 do CONTEÚDO + URL canônica sem a querystring da signed URL):
mercadológico, documental e laudo consultam ANTES de baixar ou chamar IA. Regenerar
relatório, ou gerar o 2º/3º do mesmo lote, **custa zero**. Merge por CONFIANÇA — o
determinístico (60) nunca sobrescreve o que a visão do documental (90) já leu (write-through).
**Metragem da matrícula** entra no mercadológico SEM depender do documental
(`extratoMatricula`, regex): divergindo >10% do anúncio, o R$/m² usa a MATRÍCULA e a
divergência vira anomalia. **Fluxo de caixa**: `regrasPagamento` estruturado (à vista,
parcelas, sinal, caução, comissão, prazo, financiável, FGTS) + `leiloeiro_pagamento_prior` —
cada leitura VOTA no padrão do leiloeiro × modalidade; edital que não abre herda o consenso
(moda, mín. 2 amostras) rotulado `origem: padrao_leiloeiro`.

### 🔴 5) O aluguel do Índice não era mercado: era `venda × 0,4%`

Barueri/Alphaville mostrava **R$ 28/m²·mês** = `6.985 × 0,004`. As 13 amostras REAIS de
locação (R$ 2.100–3.200/mês) tinham `area_m2` **NULL** — a IA devolve anúncio de aluguel sem
metragem — e eram TODAS descartadas em silêncio, caindo numa regra de bolso que subestima
região de padrão alto (o real de Alphaville dá ~0,6%/mês → ~R$ 42: **33% acima** do exibido).
Corrigido: (a) o prompt exige `m2` nas locações e manda DESCARTAR anúncio sem área;
(b) a API devolve `aluguel_estimado` + `aluguel_estimado_base` + o aluguel mensal mediano
realmente anunciado; (c) a tela marca **ESTIMADO** e explica. **Venda NÃO estava poluída por
tipo** (as 105 amostras são todas apartamento; bandas batem com o painel) — o que houve foi
queda para nível cidade, porque não existe amostra marcada "Alphaville Industrial".
**Terreno não se aluga** (regra do dono de 03/08) agora vale nos DOIS coletores: o do botão
"Gerar índice" (`_indice-core.js`) não aplicava, e por ali entrou locação de terreno a
R$ 3,50/m²·mês em Barueri (amostra removida).

### 🔴 6) CRÍTICO da varredura: serviço avulso suspendia plano de quem está em dia

`mp-webhook` monta `contexto.servico` para pagamento avulso (`metadata.tipo='servico'`:
recarga, assessoria, PIX de anuidade abandonado), mas **`processarRecusado` nem recebia o
campo**. O guard cobria só PRODUTO (`ehProdutoMp`). Assinante EM DIA que desistisse de um PIX
avulso era rebaixado a `explorador`, ganhava `inadimplente_desde`, `role_anterior`
sobrescrito e documentos agendados para expurgo LGPD. Corrigido na raiz + mesma lacuna
gêmea no ramo de REEMBOLSO. **Verificado no banco: nenhum cliente real atingido** — era
latente. `.claude/settings.json` (04/08) permitiu agendar sem atrito: heartbeat 06/08 13:30
UTC (`trig_0131…`) e Search Console 18/08 (`trig_013A…`).

---

## ✅ COMEÇAR AQUI (04/08 — sessão 25: ritual + a correção de ontem estava sendo desfeita todo dia)

> Branch `claude/handoff-verificacoes-uyiufd`, **JÁ EM `main`** (fast-forward `debf99a..1785eac`,
> autorizado pelo dono no fim da sessão). Deploy `dpl_5mY12kVq8BUcK8wryPdtbC9R5RdZ` **READY** em
> 33s nos domínios de produção; `lambdaRuntimeStats: {"nodejs":96}` confirma que não sobrou
> função edge. Migração `preservar_link_edital_pdf.sql` **APLICADA via MCP**. `npm run build` OK,
> `node --check` OK.
>
> ⚠️ **ARMADILHA DE GIT desta sessão:** existe um `main` LOCAL com história NÃO RELACIONADA ao
> `origin/main` (`git merge` responde *refusing to merge unrelated histories*, e o checkout
> reverte a árvore de trabalho). **Não use o `main` local.** O caminho certo é empurrar a branch
> direto para o remoto: `git push origin <branch>:main` — conferindo antes com
> `git merge-base --is-ancestor origin/main <branch>` que é fast-forward.

### 🩺 Ritual de abertura — o resumo

| Item | Estado |
|---|---|
| Acervo | **33.099 ativos**, 32.162 atualizados em 24h · 26 sem geocode |
| Baseline aprendida (bug bounty leiloeiros) | só **SBID21** abaixo do piso (0 < 18) — mesma de ontem, leilão encerrado |
| `auditoria_seguranca()` | **0 crítico / 0 atenção** ✔ |
| Cliente 360 | íntegro — 27 clientes, 80 relatórios, 2 falhas em 24h (`faltam_docs`, "sem comparáveis"), 3 erros abertos |
| Fila de documentos | 764 pendentes, **0 presos** (mais antigo de ontem 12h51, nenhum > 2 dias) |
| Funil público 7d | 363 pageviews / 103 visitantes / 46 na `/planos` |

**Duas pendências do dono FECHARAM sozinhas desde ontem** (conferir com ele, mas o banco já mostra):
- 🟢 **Cloudflare R2 (item -3) NO AR.** `backup_execucoes` id=2, hoje 04:41 UTC: `ok=true`,
  destino `r2:…/bidpro-backup`, **7 tabelas + 45 arquivos, 0 falhas**. A execução de ontem
  (id=1) ainda dizia "R2 não configurado". O item do check-up "Infra — backup off-region"
  deve ter virado 🟢. ⚠️ Vale conferir com ele se `R2_LOCATION` bate com a região real —
  gravou `regiao_destino: "enam"`.
- 🟢 **Resend entregando com confirmação.** `emails_log` tem os 2 primeiros
  `status='entregue'` com `entregue_em` preenchido (hoje 11h). Os 28 anteriores pararam em
  `enviado` — ou seja, o webhook passou a chegar entre ontem 11h e hoje 11h.

**IBGE (pendência da sessão 23): 2 de 4 agregados confirmados.** `censo_populacao` (4709) ok
03/08 e `censo_domicilios` (4712) ok 04/08, 5.570 municípios cada, `rotulos_ignorados: []`.
**`estimativa_populacao` (6579) e `registro_civil_nascimentos` (2612) nunca rodaram**
(`ultimo_em` NULL, sem erro) — pela `ordem` (30 e 40) parece ser um por dia; **conferir amanhã**:
se seguirem NULL, é a fila que não avança, não o agregado.

### 🔴 1) A CORREÇÃO DE ONTEM ESTAVA SENDO DESFEITA TODO DIA (achado do ritual)

Ontem o backfill deixou **10.015 dos 10.035** lotes CEF de leilão com `link_edital` = PDF real
do edital. **Hoje, às 11h16–11h20 UTC, sobraram 549.** Os outros **9.483 voltaram a apontar
para a página HTML do anúncio**, com `numero_edital` zerado junto (549 com número = exatamente
os 549 com PDF — os que o CSV de hoje não trouxe).

**Causa-raiz:** `scripts/scraper.js` (o scraper vivo, cron 09:00 UTC) monta
`link_edital = <página de detalhe>` para todo lote que não é venda direta — o CSV da Caixa não
tem coluna de edital, então essa página é o melhor que ele tem. O upsert por
`(fonte,fonte_id)` com merge-duplicates **sobrescreve o PDF que a captura dedicada havia
conquistado**. Idem `numero_edital: m.numero_edital || null`.

**Por que ninguém viu:** o backfill das 13:25 UTC recuperava tudo. O que aparecia no log era um
backfill *saudável* refazendo 9,5 mil buscas por dia. O dano real era **~4h por dia** em que o
documental lê a página HTML como se fosse o edital — **é exatamente o defeito da demo de
Cuiabá** — mais 9,5 mil requisições diárias desnecessárias contra a Caixa (risco de Radware).

> 🧠 **Isto é a LIÇÃO de ontem se repetindo um nível acima.** Ontem: "medir o ARQUIVO, não o
> status da fila". Hoje: **medir a correção DEPOIS do próximo ciclo do cron**. Uma correção só
> está feita quando sobrevive à rodada seguinte de quem escreve na mesma coluna.

**Correção — gatilho de banco `trg_preservar_link_edital`** (`preservar_link_edital_pdf.sql`,
aplicada), no mesmo espírito do `trg_preservar_data_leilao` que já existia: *documento
conquistado não retrocede*. Se o valor ANTIGO é PDF de edital de verdade (`eh_edital_pdf()`:
`.pdf`, não `/editais/matricula/`, não `regras-VOL`) e o NOVO não é, mantém o antigo, e o
`numero_edital` acompanha. PDF novo diferente passa normalmente. Vale para **qualquer** caminho
de escrita — scraper, endpoint, backfill futuro. Testado em 6 cenários, todos ✔.

**Dois defeitos irmãos, que só apareceriam com o link já corrigido:**
- `captura-documentos.mjs`: a página de navegação do Puppeteer preferia o `link_edital`. Com ele
  virando PDF (o estado normal a partir de agora), o navegador **iria para o PDF em vez da
  página do lote** e nenhum outro documento seria encontrado. Agora cai para `url_lote`.
- `captura-matricula-cef.mjs`: mandava a página ao `baixarPdf`, que garantidamente recusa
  (exige assinatura `%PDF-`) — poluindo justamente o log de recusas onde se enxerga a lacuna
  real (os 4 lotes com matrícula em HTTP 404). Só tenta quando é PDF.

**Reparo dos 9.483 de hoje: FEITO e conferido.** `backfill-edital-cef.yml` disparado à mão (não
esperou as 13:25), run `30906766136` **success**. Cobertura final medida: **10.010 de 10.035**
(99,7%) — extrajudicial 6.134/6.154 · licitação aberta 3.876/3.881; **0 nulos, 0 apontando para
matrícula**, e os 25 restantes são lotes sem edital publicado. `numero_edital` acompanha 1-a-1
(10.010), o que confirma que os dois campos voltaram juntos.

**`leiloeiro_conhecimento` (CEF) atualizado** — o registro que ESCONDEU tudo (dizia "edital 100%"
contando a página HTML) voltou a `docs_status='ok'`, agora com a régua de medição correta
(`public.eh_edital_pdf()`), a cobertura real e o INVARIANTE do gatilho escritos nele.

**Termômetro do gatilho — rodar no início da próxima sessão** (o valor tem que continuar ~10.010
**depois** do scraper das 09:00 UTC; se cair, o gatilho sumiu ou há caminho de escrita novo):
```sql
select count(*) filter (where public.eh_edital_pdf(link_edital)) as com_pdf, count(*) as total
from imoveis_leilao where fonte='CEF' and ativo and modalidade in ('extrajudicial','licitacao_aberta');
```
### 🔴 2) O AVISO DE RENOVAÇÃO NUNCA FOI ENVIADO A NINGUÉM (pedido do dono na mesma sessão)

O dono pediu para conferir a cobrança da **Neuma** (cadastro dia 30, "não cobrou") e garantir a da
**Alessandra** (dia 7). **As cobranças estão certas** — o que não existe é o aviso prévio.

**Cadastros × cobrança (dado do próprio MP, espelhado 04/08 11:30):**

| Cliente | Conta criada (BRT) | Assinatura autorizada | Dia da cobrança | Situação |
|---|---|---|---|---|
| Neuma Nogueira | 30/06 21:37 | 01/07 17:45 | **1º** | 2 cobranças, R$ 99,80 · última **01/08 18:22 aprovada** · próxima 01/09 |
| Alessandra de Jesus dos Santos | 07/07 18:06 | 07/07 18:06 | **7** | 1 cobrança · próxima **07/08 18:06** · authorized, semáforo verde |

⚠️ **Neuma foi cobrada sim.** O que confunde: **o dia dela é o 1º, não o 30** — ela criou a conta
em 30/06 21:37 mas só autorizou o cartão em 01/07 17:45 (~20h depois), e o MP ancora a recorrência
no dia da AUTORIZAÇÃO, não no do cadastro. O webhook funciona: a cobrança de 01/08 entrou em
`mp_pagamentos` **1 segundo** depois de o MP aprovar.

**O defeito:** `webhook_eventos_processados` não tem **UMA** linha `renov_aviso:` desde que o cron
existe. Causa-raiz: `/preapproval/search` do MP devolve `payer_id` e **nunca a chave
`payer_email`** — confirmado no espelho (`dados_mp ? 'payer_email'` = false; as 19 chaves do
payload estão lá e ela não está). O cron lia `sub.payer_email` e caía num `continue` **silencioso**:
todo assinante na janela era pulado. A Alessandra deveria ter recebido o aviso em **04/08 de manhã**
(3 dias antes) e não recebeu. É o MESMO padrão do item 1 — um skip que não gera erro nenhum.

**Corrigido:** o e-mail passa a vir do nosso `auth.users`, pelo `userId` do `external_reference`
(`<userId>|<plano>`), que os outros crons de MP já usam como chave; `payer_email` fica como atalho
se um dia voltar. `sem_email` virou contador **devolvido na resposta** — o skip não pode voltar a
ser invisível. **Mesma raiz, outro cron:** `reconciliar-assinaturas-cron` buscava com
`payer_email=` vazio; o MP ignora o filtro vazio e devolve qualquer assinatura autorizada da conta,
então o `continue` disparava sempre e a **rede de rebaixamento nunca agiu**. Passa a usar `payer_id`.

⏰ **JANELA REAL:** o cron roda 09:00 UTC. Com o deploy até **05/08 09:00 UTC (06:00 BRT)** a
Alessandra ainda recebe o aviso (a 2 dias). Depois disso ela é cobrada em 07/08 sem ter sido avisada.

**Observação de produto (não corrigida — decisão do dono):** **nenhuma tela mostra última/próxima
cobrança de um cliente.** O painel calcula MRR *estimado* (preço do `planos_config` × assinantes
ativos) e o front **não lê `mp_pagamentos` nem `mp_assinaturas` em lugar nenhum** — por isso não
dava para ver que a Neuma tinha pago. `mp_assinaturas.proxima_cobranca` existe como coluna e é
**morta**: nada escreve, nada lê, embora `dados_mp->>'next_payment_date'` esteja preenchido ao lado.
Candidato natural para o Cliente 360.

### 🟢 3) Fotos órfãs: subiram, mas a causa já tinha sido resolvida ontem

`fotos_orfas_para_limpeza()` = **24.811** (era 21.760 em 02/08) — subiu, apesar do faxineiro
diário. **Não é regressão nova:** era o pingue-pongue `cef/` × `caixa/` que a sessão 24 corrigiu
em `backfill-fotos-caixa.mjs`. A prova está no próprio Storage: escritas na pasta `caixa/` por
dia — 31/07: 12 · 01/08: 169 · 02/08: 21 · **03/08: 468 · 04/08: 0**. Parou. O backlog agora é
estático e o cron (1.500/dia) drena em ~17 dias. **Só acompanhar**: se em 3 dias não estiver
caindo, aí sim é o faxineiro que não está rodando.

### 🔴 4) CONTRATO POR IA — três defeitos empilhados na MESMA tela (achado do dono, ao vivo)

O dono foi gerar um contrato e tomou erro. Foram **três** camadas, descobertas uma a uma — cada
correção revelou a seguinte. Todas em produção, e o dono confirmou que **funcionou**.

1. **Rota pesada no Edge.** `gerar-contrato-ia` rodava com `runtime: 'edge'` (teto ~25s) e gera
   contrato inteiro (`max_tokens` 4000). A Vercel matava a função e devolvia página de erro em
   TEXTO PURO → o front dava `.json()` e mostrava `Unexpected token 'A', "An error o"...`. Era a
   ÚNICA rota pesada de IA fora do padrão (gerar-analise/documental já eram nodejs+300s).
2. **`export default` junto com `export const POST`** (erro MEU, na correção do item 1). No runtime
   Node o default export é tratado como Express `(req,res)`: o `Response` é DESCARTADO, a função
   nunca sinaliza fim e pendura até o `maxDuration` → **300s de spinner**. Regra do projeto,
   confirmada por varredura: rota que devolve `Response` exporta **só** método nomeado; as com
   `export default` usam `res.status().json()`. **Nunca misturar.**
3. **O anexo nunca chegava na IA.** A tela promete "anexe documentos para a IA extrair as
   informações", mas os arquivos só subiam no passo FINAL, como link para o signatário. A geração
   levava só `{descricao,tipo,partes}` — o modelo NUNCA via o documento. Por isso o contrato saiu
   com `[NOME COMPLETO]`/`[CPF: XXX...]` mesmo com o contrato anterior anexado. A rota **já
   aceitava** `documentos`; faltava preencher. Novo `src/utils/extrairTextoDoc.js` (pdf.js, o
   mesmo singleton dos leitores). Limite honesto: **só PDF com camada de texto** — Word, imagem e
   PDF digitalizado devolvem MOTIVO na tela, nunca são ignorados calados. O prompt ganhou a regra
   de TRANSCREVER o que vem do anexo e tratar contrato anterior como MODELO A RENOVAR; o item 11
   do system prompt (que mandava usar `[NOME COMPLETO]` sem ressalva) passou a valer só para o
   que NÃO foi informado. Anexos 6k→24k chars, saída 4k→8k tokens, e `stop_reason: max_tokens`
   virou aviso — contrato cortado no meio PARECE completo na caixa de revisão.

### 🔴 5) HEALTH CHECK (0 erro / 5 avisos) — 4 defeitos reais + 1 falso positivo

- **Upload com acento falhava CALADO** (o mais grave; erro do próprio dono às 18h56). A chave do
  Storage era montada com o nome do arquivo CRU: `CONTRATO PRESTAÇÃO DE SERVIÇO…pdf` → `Invalid
  key` (400). E o `error` era DESCARTADO → o contrato seguiria para assinatura **sem o anexo**.
  Novo `nomeArquivoSeguro()` em `src/utils/arquivo.js` (7 casos testados), aplicado no contrato e
  no ONR (mesmo padrão). Anexo que não sobe agora ABORTA o envio.
- **`r.rpc(...).catch is not a function`** — o builder do supabase-js é *thenable*, não Promise:
  `.catch()` direto (sem `.then()` antes) não existe. O botão de aplicar sugestão não fazia nada.
- **DUAS telas do Admin em HTTP 400 por FK faltando** — transcrições de reunião
  (`solicitacoes.user_id→perfis`) e links promocionais (`links_promo.criado_por→perfis`). O
  PostgREST monta embed a partir de FK declarada. Migração `fks_embed_perfis_e_allowlist_uso.sql`
  APLICADA, `ON DELETE SET NULL` (preserva histórico e não trava exclusão de conta — LGPD),
  0 órfãos conferidos antes, + `notify pgrst, 'reload schema'`.
- **O aviso de RLS era FALSO POSITIVO.** `eventos_atividade` e `cota_concessoes` são só-servidor
  (medido: 4.722 linhas via `/api/track`, última 19h; a outra o front só LÊ). Política de INSERT
  para `authenticated` seria REGRESSÃO — usuário logado forjaria evento e **concederia cota a si
  mesmo**. Entraram na allowlist do `auditoria_uso`, como a própria checagem sugeria. Resultado:
  `auditoria_uso` **0 gaps**, `auditoria_seguranca` **0/0**.
- Sobraram 2 avisos de QUALIDADE DE DADO, **não corrigidos**: Índice com 1 cidade fora da faixa de
  R$/m² (contaminação de área) e 11 anomalias de relatório (cnj_vazio 7 · avaliacao_ausente 3 ·
  mercado_area_incoerente 1).

### 6) SEARCH CONSOLE — a verificação FUNCIONOU; 2 avisos não críticos respondidos

O e-mail chegar já prova que a propriedade foi verificada (item **-4** do dono, fechado). Os 2
problemas de "Snippets do produto" são os clássicos (identificador global e `priceValidUntil`
ausentes) e foram preenchidos com dado REAL em `api/publico.js`: `sku` = id do lote no leiloeiro,
`priceValidUntil` = `data_fim`. **NÃO** foram acrescentados `aggregateRating`/`review` (nota falsa
viola política do Google e rende penalidade) nem `shippingDetails`/`hasMerchantReturnPolicy` (não
há frete nem devolução de imóvel).

> ⚠️ **DECISÃO DE FUNDO — e a recomendação (04/08, perguntado pelo dono):** `Product` é o tipo de
> PRODUTO DE VAREJO, e é por isso que o Google cobra identificador/frete/devolução/nota de uma
> casa. O tipo semanticamente correto é `RealEstateListing`. **MAS a recomendação é NÃO trocar
> agora**, por um motivo concreto: o Google **não gera rich result** para `RealEstateListing` —
> trocar zera os avisos e, junto, **perde o snippet de preço/disponibilidade** no resultado de
> busca, que é o principal ativo de SEO de um marketplace. Avisos "não críticos" **não bloqueiam
> indexação nem rich result**; o custo de trocar é maior que o do aviso.
> **Caminho certo:** esperar 1–2 semanas a reindexação com `sku`+`priceValidUntil`, abrir
> Search Console → Aprimoramentos → "Snippets do produto" e **ler os nomes exatos dos campos que
> sobraram**. Aí se decide com dado, não com suposição. Só reabrir a troca de tipo se aparecer
> ERRO crítico ou ação manual — aviso não crítico, por si, não justifica.

### 🔴 7) NÍVEL 1 DO MERCADOLÓGICO VAZIO — o endereço não existe no banco (achado do dono, 04/08)

O dono mandou conferir um mercadológico do cliente **Rafael** (casa, Guarulhos/SP, 60,1 m²) em que o
**Nível 1 (mesmo condomínio/endereço, raio ~250 m) voltou 0 amostras** e só o Nível 2 (1 km) trouxe
11. **NÃO está correto** — mas o defeito não é do buscador de amostras, e sim do dado de entrada.

**Lote `zuk_37094-231508`:**
- `titulo` = "Casa em leilão - **Rua José Miguel Ackel, 2252** - Guarulhos/SP …"
- `endereco` = **''** (vazio) · `bairro` = **''** (vazio)
- `latitude/longitude` = `-23.4675941, -46.5277704` — coordenada compartilhada por **4 lotes de 3
  fontes diferentes (CEF, MEGA, ZUK)** e por **3 análises de endereços distintos**. É fallback de
  cidade, não a casa.

**Ou seja:** o raio de 250 m foi medido a partir de um ponto genérico de Guarulhos, e a busca
textual "mesmo endereço" não tinha endereço nenhum para buscar. O relatório diz *"não foram
encontrados comparáveis exatos para o endereço fornecido"* quando, na verdade, **endereço nenhum
foi fornecido**. O Nível 2 (por cidade+tipo+área) funciona porque não depende do endereço — por
isso trouxe 11 e salvou o relatório.

**ESCALA MEDIDA — não é um lote isolado.** Ativos com `endereco` vazio **cujo título traz
logradouro**:

| Fonte | Ativos | Sem endereço | Título TEM o endereço |
|---|---|---|---|
| ZUK | 840 | 840 (100%) | **736** |
| SUPERBID | 1.360 | 1.342 (98,7%) | 174 |
| MEGA | 564 | 563 (99,8%) | 67 |
| LJUD | 1.029 | 1.029 (100%) | 58 |
| LEILOTECH | 76 | 76 (100%) | 22 |
| outras | — | — | ~8 |

**≈1.065 lotes** têm o logradouro disponível no título e simplesmente não foi extraído para a
coluna. Todo mercadológico desses lotes nasce com Nível 1 vazio e geocode de cidade.

**✅ CAMADA 1 FEITA (04/08, migração `endereco_do_titulo_e_preservacao.sql`, APLICADA):**
`endereco_do_titulo()` + gatilho `trg_preservar_endereco` (BEFORE INSERT OR UPDATE).

- **No BANCO, não nos mappers** — por economia e cobertura: um gatilho vale para INSERT e UPDATE,
  todas as fontes e todo caminho de escrita, sem editar 5 scrapers, sem cron novo, sem chamada paga.
- **Resolve de brinde o que teria desfeito tudo:** os mappers gravam `endereco: ''` LITERAL e o
  upsert merge-duplicates APAGA o que estava lá — o backfill de hoje seria perdido no scrape de
  amanhã (mesma família do bug do `link_edital`). Agora vazio nunca sobrescreve preenchido.
- **Auto-validação contra endereço errado:** a cidade que vem DENTRO do título tem que bater com a
  cidade da linha. Ensaio: **722 de 840 casaram, 722 de 722 com cidade conferindo, ZERO divergência.**
  Título fora do padrão é recusado e fica vazio — endereço errado é pior que vazio.
- **Resultado:** 722 lotes ZUK com endereço; `zuk_37094-231508` (o do Rafael) agora tem
  `Rua José Miguel Ackel, 2252`. Os 722 foram para `geocod_nivel='refazer'` — o rótulo antigo não
  valia nada, porque **358 deles dividiam coordenada com outro lote**, impossível para endereços
  distintos, mesmo os marcados 'rua'. O cron horário drena usando **só rotas gratuitas**
  (Nominatim/IBGE/BrasilAPI); o Google, pago, não entra em lote. **Custo: zero.**
- Testado em 6 cenários: vazio do scraper não apaga · endereço melhor passa · cidade divergente
  recusada · título sem logradouro recusado · padrão válido aceito · restauração. 6/6 ✔

**⏭️ CAMADA 2 — EDITAL / MATRÍCULA (pedido do dono, ainda NÃO feita).** Sobram ~343 lotes cujo
título não traz logradouro (e as fontes de padrão irregular: SUPERBID, LJUD, MEGA). A fonte certa
aí é o **edital e a matrícula que JÁ capturamos** — a matrícula é o documento legal com o endereço
completo. **Desenho recomendado, pela regra de economia do dono: ON-DEMAND, na geração do
relatório**, não em massa — só paga o processamento quando alguém realmente pede aquele imóvel, e
o documental já abre esses PDFs de qualquer forma. `api/_edital-extrato.js` hoje extrai praças,
valores e datas, mas **não extrai endereço** — é o que falta escrever (determinístico, sem IA).
Guardar o resultado em `imoveis_leilao.endereco` (o gatilho já protege) para não reprocessar.

### ⏭️ Pendências desta sessão

**Depende do DONO (decisão):**
- **Camada 2 do endereço — edital/matrícula** (item 7). ~343 lotes sem logradouro no título. Ele
  pediu; falta decidir e construir. Desenho recomendado já escrito: **on-demand na geração do
  relatório**, nunca em massa.
- **Schema `Product` → `RealEstateListing`**: **recomendação é NÃO trocar** (item 6). Reabrir só se
  o Search Console acusar ERRO crítico em 18/08.
- `PENDENCIAS_DONO.md`: Google Ads (verificação até **31/08**), Asaas (reativar webhook), Resend
  (URL com `www` + Re-enable), Upstash (grátis).
- ~~Lead de Cuiabá~~ ✅ encerrado · ~~R2_LOCATION~~ ✅ confere (Virgínia = `enam`) ·
  ~~Google Search Console~~ ✅ verificado (o e-mail de 04/08 prova).

**AGENDAR na abertura** (ver bloco 📌 no topo): lembrete de 18/08 do Search Console.

**Backlog técnico (meu):**
- **3 rotas `edge` com chamada de IA** — mesmo defeito do contrato, menor: `admin-chat.js` e
  `inbound-juridico.js` (2048 tokens), `cnj-chat`/`financiamento-ia` (1024). Não mexidas por falta
  de evidência de falha. Sintoma que as denunciaria: o MESMO `Unexpected token 'A'`.
- **Extração de anexo do contrato só lê PDF com texto** — Word, imagem e PDF digitalizado ficam de
  fora (hoje avisando na tela, não mais em silêncio). Ligar visão no servidor resolveria.
- **Cliente 360 — última/próxima cobrança por cliente.** NENHUMA tela mostra hoje: o painel calcula
  MRR *estimado* e o front não lê `mp_pagamentos`/`mp_assinaturas` em lugar nenhum. Foi por isso que
  não dava para ver que a Neuma tinha pago.
- 2 avisos de qualidade de dado do Health Check (Índice: 1 cidade fora da faixa de R$/m²;
  11 anomalias de relatório: cnj_vazio 7 · avaliacao_ausente 3 · mercado_area_incoerente 1).
- Herdadas: 4 lotes CEF com matrícula em HTTP 404; e-mail marketing do Investidor Pro; backlog da
  sessão 23 (8 achados confirmados não corrigidos + 39 não verificados).

### 🧠 O que esta sessão ensinou (vale para as próximas)

1. **Uma correção só está feita quando sobrevive à rodada seguinte de quem escreve na mesma
   coluna.** O edital foi corrigido em 03/08 e desfeito pelo scraper em 04/08. O mesmo padrão
   reapareceu no `endereco`. Sempre perguntar: *quem mais escreve aqui, e o que ele grava?*
2. **Vazio literal (`''`/`null`) num upsert merge-duplicates é uma ARMA.** Três gatilhos já existem
   por isso (`data_leilao`, `link_edital`, `endereco`). Ao ver um mapper gravando `campo: ''`,
   suspeitar antes de o dado sumir.
3. **`export default` + runtime Node = função pendurada até o maxDuration.** Rota que devolve
   `Response` exporta SÓ método nomeado. Nunca misturar.
4. **Erro de API silenciado tem duas caras:** o `.catch` que engole e o `.json()` que estoura em
   cima de texto. As duas escondem a causa real; ler o corpo como texto e parsear com guarda.
5. **Aviso de checagem automática pode ser FALSO POSITIVO** — `eventos_atividade`/`cota_concessoes`
   eram só-servidor. "Corrigir" ali seria abrir escrita para o cliente forjar cota. Medir antes.
6. **Dado errado é pior que dado ausente.** Endereço errado desloca o raio de 250 m sem avisar; por
   isso a extração é auto-validada pela cidade e recusa o que não casa.

---

## ✅ COMEÇAR AQUI (04/08 — sessão 24: o edital da Caixa nunca chegava; 2 loops silenciosos)

> Tudo em `main`. `npm run build` OK, `node --check` OK nos scripts. Migrações: nenhuma nova
> (só UPDATEs de dados via MCP). Verificação em campo via GitHub Actions (a Caixa não atende o
> IP do ambiente de dev — o do runner sim).

### 1) EDITAL DA CAIXA — não tínhamos o de praticamente NENHUM imóvel

**Gatilho:** o dono gerou o documental de um apto em Cuiabá/MT (`cef_8555536754309`,
`df644ecd-7f22-4368-9357-4cc6faae7361`) e o relatório saiu "sem acesso ao edital" — sendo um
leilão da Caixa, que tem edital publicado. Ele mandou olhar **todos** os da Caixa.

**Medição (antes):** dos 27.278 lotes CEF ativos, só **8** tinham `link_edital` apontando para
um PDF real. 7.187 apontavam para a **página** do anúncio (HTML) e 2.843 para a **matrícula**.
Só **2** lotes no acervo inteiro tinham anexo do tipo `edital`.

**Causa-raiz** (recon na página VIVA — `scripts/recon-cef-edital.mjs` + `.github/workflows/recon-cef-edital.yml`):
a Caixa **não põe o PDF no href**. O link é

    <a href='#' onclick=javascript:ExibeDoc('/editais/EA00270326CPVERE.PDF')>
       <strong>Baixar edital e anexos</strong></a>

`href='#'` e o caminho dentro do **ONCLICK**. Todo seletor que lia `a.href` voltava vazio — e a
captura então marcava o lote como concluído (matrícula + condições de venda) **sem o edital e
sem erro nenhum**. Falha silenciosa; foi por isso que sobreviveu meses.

**O CSV oficial não resolve:** colunas são `n do imovel · uf · cidade · bairro · endereco ·
preco · valor de avaliacao · desconto · financiamento · descricao · modalidade de venda ·
link de acesso`. **Não há coluna de edital.** Só existe na página do lote.

**PADRÃO DO EDITAL (confirmado em campo):** `/editais/E<A|L><NNNN><MMYY><UNIDADE>.PDF` —
`EA` para licitação aberta, `EL` para leilão/extrajudicial; bate com o número impresso na
página ("Edital: 0027/0326 - CPVE/RE" → `EA00270326CPVERE.PDF`, 738 KB). O edital é
**COLETIVO**: **20 editais distintos cobrem os ~10 mil lotes de leilão**.

**Correções:**
- `scripts/captura-matricula-cef.mjs` — seletor lê o **onclick** além do href.
- `scripts/backfill-edital-cef.mjs` + `.github/workflows/backfill-edital-cef.yml` (novos,
  diário 13:25 UTC, logo após o scraper) — varre os lotes de LEILÃO, abre a página por HTTP
  simples e grava `link_edital` = PDF real + `numero_edital`. Venda direta **não entra** (não
  tem edital por natureza). Paginação exata (offset só avança pelos que permaneceram no
  filtro). Trata a interstitial do **Radware Bot Manager** como FALHA, nunca como "sem edital".
- `api/gerar-documental.js` — deixa de reabrir a página do lote quando `link_edital` já é o
  PDF (evitava uma ida à Caixa, e possível custo de Bright Data, em toda análise CEF).

**Resultado medido (depois):** `link_edital` = PDF real em **10.015 de 10.035** lotes de leilão
ativos (era 8). Sobraram 17 na página + 3 na matrícula. O backfill completo levou 17 min:
9.709 gravados, 19 sem edital publicado, 1 erro, **0 bloqueios**.

### 2) O ARQUIVO ANEXADO ERA UMA IMPRESSÃO DE TELA (defeito mais grave que o 1)

Ao conferir, o anexo de edital do lote de Cuiabá tinha **63 KB** — o PDF real tem **738 KB**.
O Chrome headless **não navega** para um PDF, ele baixa; o `capturarUrl` só aceitava a resposta
quando o `content-type` vinha exatamente com `pdf`, e quando a Caixa manda `octet-stream` ele
caía no último passo e **imprimia a tela**. Arquivo pequeno, **sem camada de texto** → a IA lê
como vazio. Pior que faltar: o relatório *parece* ter o edital.

**Correção:** `baixarPdf()` (node:https) para os PDFs estáticos (matrícula e edital), com os
cabeçalhos que o recon comprovou (UA enxuto + `Accept-Language`; UA completo de Chrome vindo de
cliente que não é Chrome é sinal de bot). Só aceita resposta com assinatura `%PDF-` de verdade —
interstitial do Radware ou página de erro **nunca** vira "documento". O navegador ficou só com
o que ele faz bem: imprimir as Condições de Venda.

**Prova de ponta a ponta:** matrícula do lote 300 KB → **491 KB**; edital → **738 KB** (exato).
Dos 19 lotes da fila, os **11 com `link_edital` = PDF real receberam o edital**; os 8 sem são
3 de venda direta (não têm edital) + 5 **inativos** (leilão já ocorrido em julho). Correlação
perfeita, nada quebrado.

### 3) DOIS "SILÊNCIOS" ESTRUTURAIS CORRIGIDOS na captura CEF

- **O total mentia:** lote sem matrícula volta para a fila, mas era somado em `ok` — uma rodada
  com várias falhas ainda imprimia `18 ok, 0 erro(s)`. Agora separa *com matrícula ·
  reagendados · erros · sem edital*, e cada linha marca `[SEM EDITAL]`.
- **Fila com órfão:** linha marcada `processando` que nunca volta (job morto/timeout) ficava
  invisível para sempre — a consulta só busca `pendente`. Havia **uma presa desde 07/07**.
  Agora volta para a fila após 2h.
- **`baixarPdf` LOGA toda recusa** (status, content-type, bytes, primeiros bytes, URL). Foi
  isso que revelou 4 lotes com matrícula estática em HTTP 404 (rota alternativa da página
  também não serve — devolve HTML de ~24 KB). Lacuna **conhecida**, não silenciosa.

### 4) "Preparando documentos…" INFINITO na tela de Análise

`src/pages/Analise.jsx`: `relDocumentalPreparando` era só `status==='concluida' &&
result.precisaDocumentos`, **sem limite de tempo e sem estado terminal** — e `travado` incluía
`preparando`, então o botão ficava desabilitado justamente no estado que nunca acabava. Spinner
eterno, zero saída. Adotada a MESMA régua que `MinhasAnalises.jsx` já usava (só é "preparando"
com captura real `emCaptura` E linha recente, 20 min); passado o prazo vira estado **acionável**
("Tentar de novo" + "Anexar"), com um efeito que agenda o re-render na hora que a janela expira.

### 5) A BASE DE CONHECIMENTO ESTAVA ERRADA — e foi ela que escondeu tudo

`leiloeiro_conhecimento` (fonte CEF) afirmava **"edital 100% sobre leilão (10.221/10.221)"**.
Essa métrica contava a **página HTML** como se fosse o edital. Mediu a coisa errada e declarou
vitória — nenhum monitor acusou nada. Registro corrigido (`docs_status='atencao'`) com a
**regra de medição correta**: só conta como edital o `link_edital` que termina em `.pdf` e não
é `/editais/matricula/` nem `regras-VOL`.

> ⚠️ **LIÇÃO PARA O RITUAL DE ABERTURA:** duas das cinco descobertas desta sessão vieram de
> *conferir o artefato*, não o log — o log dizia `✓ edital` e o arquivo era uma tela impressa;
> a métrica dizia 100% e a cobertura real era 0,03%. **Ao auditar captura de documento, medir o
> ARQUIVO (tamanho/assinatura), não o status da fila.**

### 💼 CONTEXTO COMERCIAL — o lote de Cuiabá era uma DEMO (dito pelo dono no fim da sessão)

O apto de Cuiabá **não era análise de investimento do dono**: ele estava **apresentando a
plataforma a um investidor**. Ou seja, **o relatório sem edital aconteceu na frente de um
prospect** — é a segunda vez que uma falha de relatório cai numa demo (a 1ª foi o relatório
vazio de BH, sessão de 30/07). O investidor **disse que criaria conta e ainda NÃO criou**.

➡️ **LEAD QUENTE, não registrado em lugar nenhum ainda** (não tem cadastro, então não aparece
no Cliente 360 nem nos 3 leads pagos do item 8 abaixo). **Perguntar ao dono na próxima sessão
quem é e se quer abordar** — é o lead mais qualificado do funil hoje: viu o produto ao vivo,
com o dono, e demonstrou intenção. O reteste do documental **não é necessário** (o dono
dispensou); a correção já está provada pelo tamanho do arquivo (738 KB).

⚠️ **REGRA PRÁTICA que sai daí:** antes de qualquer demo, gerar os relatórios do imóvel-alvo
**com antecedência** (já valia para o mercadológico — ver o bloco de 30/07 sobre o Rio; agora
vale para o documental também). Uma demo é o pior lugar para descobrir uma lacuna de captura.

### ⏭️ Pendências desta sessão
- Os 4 lotes com matrícula em HTTP 404 (2 SP, 2 BA) seguem sem matrícula; a rota alternativa da
  página devolve HTML. Investigar se a Caixa mudou o caminho estático para esses casos.
- E-mail marketing do Investidor Pro (adiado pelo dono para a próxima sessão).
- Verificação matinal prometida: backup R2, `entregue_em` do Resend, sitemap lido pelo Google,
  conversões do Ads saindo de "Inativo", fotos órfãs caindo.

---

## ✅ COMEÇAR AQUI (02/08 — sessão 23: ritual de abertura + 8 correções de raiz achadas por ele)

> Branch `claude/bidpro-brasil-handoff-je7c30`. Tudo desta sessão está em `main` e **READY** em
> produção (último deploy conferido). `npm run build` OK; endpoints novos passam `node --check`.
> Migrações APLICADAS via MCP. `auditoria_seguranca()` = **0/0** depois de tudo.

---

### 🔴 ONDE PARAMOS — RETOMAR POR AQUI (fim do dia 02/08)

A sessão terminou com **três passo a passo entregues ao dono** e nada bloqueado do meu lado. O
próximo encontro começa cobrando o resultado deles, nesta ordem:

**1. Google Search Console + Perfil da Empresa** (`PENDENCIAS_DONO.md` item **-4**) — o mais
urgente, porque as 33 mil páginas novas já estão no ar e o Google ainda não sabe.
- Perguntar: conseguiu **verificar a propriedade**? Se ele escolheu o método **Tag HTML**, ele
  vai trazer uma linha `<meta name="google-site-verification" content="...">` — **é só publicar
  no `index.html`** e mandar ele clicar em Verificar. O atalho recomendado foi verificar pelo
  **Google Analytics** (o GA4 `G-5YNHQB5F81` já está no site), que não exige mexer em código.
- Depois de verificado: conferir se os **dois sitemaps** foram enviados (`sitemap.xml` e
  `sitemap-leiloes.xml` — ambos conferidos no ar em 02/08) e acompanhar a **cobertura**
  (indexadas subindo semana a semana; "Descoberta — não indexada" alto nos primeiros dias é
  normal com 33 mil URLs de uma vez).

**2. Cloudflare R2** (`PENDENCIAS_DONO.md` item **-3**) — proteção contra perda definitiva de
arquivo de cliente. Caminho no painel confirmado pelo print dele:
**Storage & databases → R2 Object Storage → Overview** (é onde ficam *Create bucket* e
*Manage R2 API Tokens*).
- Quando ele avisar que colou as 5 variáveis e publicou: conferir `backup_execucoes` e o item
  **"Infra — backup off-region (2º servidor)"** do check-up (hoje 🔴 por falta das chaves).
- Lembrar do detalhe que engana: `R2_LOCATION` só **declara** a região; se não bater com a real,
  o painel diz que está tudo certo quando não está.

**3. Leitor de eBook** — ele disse que ia testar. Perguntar como foi. O ebook dele está no
**Supabase Storage** (não no Drive), então usa o leitor paginado novo; a URL assinada vale até
2036, conferido.

**✅ ACHADO DO DONO NO FIM DO DIA (02/08, 22h) — DATA DO LEILÃO. CONFIRMADO E CORRIGIDO NA
MESMA NOITE (deploy em `main`).**
Lote de referência: `GRUPOLANCE` / `gl_28450` (Alphaville Residencial 11, Santana de Parnaíba/SP).
- **Site do leiloeiro:** início `03/08/2026 00:00` · **encerramento `03/11/2026 15:00`** ·
  valor inicial R$ 950.885,17.
- **Nosso banco:** `data_leilao = 2026-08-03` · **`data_leilao_2 = NULL`**.
- **Ou seja:** guardamos o **INÍCIO** e jogamos fora o **ENCERRAMENTO** — que é a data que decide
  (é o prazo para dar lance). A tela mostra "Data do leilão 03/08/26" num leilão que só fecha em
  **novembro**.
- **Causa-raiz (provada no código):** `extrairDataLeilao` (`api/enriquecer-lote.js:55`) casa TODAS
  as datas da página ancoradas em "leilão|praça|encerra|licitação|data" e devolve
  **`Math.min(...futuras)`** — a MAIS CEDO. Numa página com início+encerramento, isso é sempre o
  início. E **nenhum** caminho de leiloeiro escreve `data_leilao_2`: medido, **0%** em todas as
  fontes, exceto CEF (23,5%). O mapper do GRUPOLANCE ainda grava `data_leilao: null` fixo
  (`scripts/scraper-puppeteer.mjs:2820`) — só **5 de 428** lotes GL ativos têm qualquer data.
- **Dano concreto, já medido:** a ordenação **"Encerra em breve"** (`src/pages/Busca.jsx:979`)
  filtra `data_leilao >= hoje`. A partir de amanhã este lote **some** dessa lista embora fique
  aberto até novembro — e a coluna que sustenta um filtro chamado "encerra" guarda a data de
  *começo*, que é o oposto. Hoje há **3.333 lotes ATIVOS com data já no passado** (e 16.561 sem
  data nenhuma, de 33.082).
- **CORRIGIDO em 4 camadas** (`data_fim_leilao_prazo_real.sql` + 6 arquivos):
  1. **Extração** (`api/enriquecer-lote.js`): `extrairDataLeilao` (que devolvia `Math.min`) deu
     lugar a **`extrairDatasLeilao`**, que acha TODA data `dd/mm/aaaa` da página, lê as ~90
     letras ANTES dela e classifica em **FIM** (encerramento/término/limite/2ª praça), **INÍCIO**
     (início/abertura/1ª praça) ou **NEUTRO**. Início = a mais cedo dos INÍCIO (ou dos neutros);
     fim = a mais tarde dos FIM — ou o maior neutro quando há 2+, que é o caso clássico de
     1ª/2ª praça sem rótulo. **A HORA é preservada** ("encerra 15:00" decide lance). Exigir
     palavra-âncora no contexto continua barrando data solta do texto (nº de alvará, matrícula).
     Testado em 6 cenários, incluindo o do dono: início `2026-08-03`, fim `2026-11-03T18:00Z`
     (= 15:00 de Brasília). ✔
  2. **Persistência**: `data_leilao_2` agora é gravado pelos três caminhos
     (`enriquecer-lote`, `enriquecer-datas-cron`, `enriquecer-backfill-cron`) — e o critério de
     "falta data" virou **sem início OU sem encerramento**. Antes, um lote com início parecia
     completo e nunca era revisitado: o prazo real jamais chegava. Bug irmão corrigido no
     caminho: o `select` do `enriquecer-lote` não trazia `data_leilao_2`, então a guarda de
     "não sobrescrever" nunca teria valido.
  3. **Coluna `data_fim`** (banco, mantida por trigger): o **último prazo relevante** —
     encerramento, 2ª praça, ou a única data existente. É ela que a busca ordena/filtra em
     "Encerra em breve", e que o card e o e-mail de oportunidades exibem. Backfill feito.
  4. **Telas**: contagem do card ("Encerra em N dias") passa a contar até o **fim**; a ficha
     mostra as duas datas, e a segunda aparece **sempre que existir** — antes exigia também um
     `valor_minimo_2`, então numa janela de alienação (um preço só) o prazo ficava **escondido**.
     Rótulo honesto: "(2ª praça · R$ …)" quando há segundo lance, "(encerramento — prazo para
     dar lance)" quando é janela.
- O lote `gl_28450` já está com `data_leilao_2 = 2026-11-03 15:00` e `data_fim = 2026-11-03`
  (gravado do print do dono, sem esperar o cron). Os demais entram conforme os crons revisitam.
- ⚠️ **Não verificado (fica para checar):** `valor_avaliacao` = R$ 1.901.770,34 é **exatamente
  2×** o mínimo. Bate com a regra judicial (2ª praça a 50%), então é plausivelmente correto — mas
  há **43 dos 428** lotes GL nesse padrão exato. Confirmar na página se a avaliação é lida de
  verdade (`extrairAvaliacao` ancora na palavra "avaliação") ou se em algum caminho está sendo
  derivada. Não dá para checar deste ambiente (proxy bloqueia o site). **Basta o dono olhar se a
  página do lote mostra "Avaliação: R$ 1.901.770,34"** — isso encerra a dúvida.
- **Acompanhar na próxima sessão:** `select count(*) filter (where data_leilao_2 is not null)
  from imoveis_leilao where ativo and fonte <> 'CEF';` deve sair de 0 e subir a cada rodada dos
  crons de enriquecimento. Se ficar em 0, o problema é acesso à página (Bright Data), não a
  extração — que está testada.

**Do meu lado, o que ficou pendente para a próxima sessão:**
- ⚠️ **Verificar a 1ª ingestão do IBGE**: `select * from socio_ingestao order by executado_em desc;`
  e `select chave, ultimo_ok, ultimo_erro from socio_fontes;`. Os IDs de agregado
  (4709/4712/6579/2612) **não puderam ser testados** — o proxy deste ambiente bloqueia
  `servicodados.ibge.gov.br`. Se algum falhar, o erro traz os rótulos que o IBGE devolveu e o
  conserto é um `update` em `socio_fontes` (**sem deploy**). O dono também pode disparar na hora
  em **Admin → Dados & Fontes → 👥 Demografia → "Atualizar agora"**.
- **Conferir a limpeza de fotos órfãs**: o cron diário (04:20) tira ~1.500/dia dos 21.760.
  `select count(*) from public.fotos_orfas_para_limpeza(100000);` deve cair a cada dia.
- **Backlog aberto** (seção G): 8 achados confirmados e não corrigidos + 39 não verificados.
- **Ruído menor**: 23 imóveis ativos com UF inválida (20 vazias, 3 "NS") — já filtrados nas
  páginas públicas, mas indicam parse sujo em alguma fonte.

---

### ✅ 03/08 (sessão 24) — RITUAL + ANEXO QUE ABRIA CÓDIGO + DATA VINDA DO EDITAL

**Ritual.** Acervo **32.643 ativos**, 30.241 atualizados em 24h. Baseline aprendida: só a
**SBID21** abaixo do piso (0 < 18) — esperado, leilão encerrado. `auditoria_seguranca()` = **0
crítico / 0 atenção**. **Cliente 360 íntegro** (`admin_360_estatisticas` responde): 26 clientes,
75 relatórios, **0 falha de relatório em 24h**, 1 cliente com erro aberto, funil público 7d = 241
pageviews / 72 visitantes. Fila de geocode e de documentos drenando.

**1. 🔴 ANEXO QUE ABRIA CÓDIGO (achado do dono — lote `vegas_7588`, chácara em Ribeirão Preto).**
Ele clicou num anexo do lote e recebeu **código** na tela: era `jquery.min.js` / `global.css` —
o **tema do site do leiloeiro**, listado como "Documento no leiloeiro".
- **Causa-raiz** (`api/_doc-scan.js`): para URL **sem extensão de documento** a varredura aceitava
  o sinal genérico de host (`amazonaws|storage|blob.core|/file`) ou uma palavra-chave no texto da
  âncora. Só que o bucket do leiloeiro hospeda **o site inteiro**; o pixel do Bing carrega o
  TÍTULO do lote na querystring (com a palavra "avaliação"); "ENVIAR PROPOSTA" aponta para
  `/licitante/login`; "Leia atentamente o edital" aponta para `/glossario`.
- **Não era só cosmético:** havia entrada de `bat.bing.com` gravada com **`tipo = matricula`** —
  o laudo documental contava um pixel de rastreio como matrícula presente.
- **Corrigido na raiz**: `ehDocumento` passa a barrar, *só para URL sem extensão de documento*,
  ativo estático (`.js/.css/.map/.woff`, `/assets|/dist|/vendor|_next/`, `*.min.*`), página de
  conta/institucional (login, licitante, glossário, contato…), link com `utm_/gclid`, host de
  analytics/chat/CDN de biblioteca, URL com **preço no caminho** e a **home / a própria página do
  lote** (`#tab-parcelamento`). Qualquer `.pdf/.doc/.xls` continua passando, **mesmo em
  `/assets/`** — arquivo de verdade nunca é ruído. Testado: 10 lixos reais barrados, 6 documentos
  legítimos (resale opaco, PestanaAPI, WebLeilões `/documento`, PDF em `/assets/`) mantidos.
- **Acervo limpo** (`anexos_purgar_ruido_de_pagina.sql`, APLICADA, idempotente): **379 anexos-lixo
  em 311 lotes** removidos — MEGA 204, SODRE 78, SUPERBID 72, VEGAS 13, SUPORTE 11, LEILOTECH 1.
  Restante hoje: **0**. `vegas_7588` ficou com os 3 PDFs reais (matrícula, edital, avaliação).

**2. DATA — confirmado o que o dono suspeitou, e o sistema agora puxa do edital.**
- **O leiloeiro realmente não publica data nesse lote**: `data_leilao/data_leilao_2/data_fim` estão
  NULL, e o scraper (que lê `jsonLd.startDate` + data ancorada no HTML) não achou nada. Não é falha
  de parser: **39 dos 40** lotes VEGAS têm data; só o `vegas_7588` não. Ficamos **de acordo com o
  leiloeiro** — sem data na página, sem data na ficha.
- **Ao gerar relatório, o edital passa a preencher a lacuna** (regra do dono). O extrato do edital
  (`_edital-extrato.js`, determinístico, sem IA) já lia praças; agora devolve também
  `datas:{inicio,fim}` lidas do TEXTO com **âncora estrita** (`leilão|praça|encerr|hasta|aliena|
  licita|término`) — em edital a palavra "data" aparece o tempo todo ("a contar da data do
  pagamento") e não serve de âncora. `extrairDatasLeilao` ganhou o modo `{ estrito:true }`; o
  caminho da página do lote segue idêntico.
- **Bug irmão corrigido no caminho** (`gerar-analise.js`): a data da **2ª praça** só era gravada
  *dentro* do `if` que gravava o **valor** da 2ª praça. Com o valor já preenchido — ou num edital
  que só publica a data — o **prazo real nunca era persistido**. É o mesmo defeito de 02/08 (a 2ª
  data escondida na tela por exigir `valor_minimo_2`), agora do lado da escrita. Datas e valores
  ficaram independentes.
- **Regra mantida**: só preenche **coluna vazia**. Nada sobrescreve o que o leiloeiro publica.
- Testado em 5 cenários: 1ª/2ª praça datadas ✔ · "encerra-se em 03/11/2026 15:00" → só `fim` ✔ ·
  "a contar da data de 20/12/2026" → **ignorado** ✔ · matrícula antiga (passado) → ignorado ✔ ·
  data sem âncora → ignorado ✔.

**3. eBOOK — "capa cortada" em 3 telas + página cortada no leitor (prints do dono, 03/08).**
- **Capa (card de Membros, tela do livro, cabeçalho do leitor): é o ARQUIVO, não o CSS.** A
  `capas/1785075416388-0i1y4q.jpg` (545 KB, inteira no bucket `membros-capas`) está com os
  dados JPEG **quebrados no meio**: o navegador decodifica só o topo e abandona o resto (por
  isso o card mostra o pedaço + fundo cinza, e a tela do livro o pedaço + o gradiente escuro
  de trás — o resto do `<img>` fica transparente). Provável exportação HEIC→JPEG malfeita do
  celular no upload. **Não dá para consertar o arquivo daqui** (proxy nega `supabase.co`).
  **Conserto em 2 partes:** (a) **o dono re-envia a capa** no Admin (2 min); (b) **o upload de
  capa agora decodifica e RE-CODIFICA via canvas** (`Admin.jsx` → `UploadMidia`): só sobe JPEG
  limpo (teto 1400px, q0.87); arquivo que não decodifica dá erro NA HORA em vez de virar capa
  quebrada na loja. O `EbookCapa` (fallback por `onerror`) não pega esse caso — decodificação
  PARCIAL não dispara erro.
- **Leitor paginado: topo da página ficava ESCONDIDO sob a barra (iPhone).** As barras do
  `LeitorPaginado` são absolutas e crescem com `env(safe-area-inset-*)` (notch ≈ +59px), mas o
  espaço reservado à página era fixo (58px cima / 74px baixo) — o começo da página ficava
  ATRÁS da barra, inalcançável por rolagem (scrollTop 0 já era o limite). Padding agora soma o
  safe-area (e o aviso "deslize para ver o resto" subiu junto). Era isso o "layout interessante
  mas com a página cortada".
- ⚠️ A 1ª página do PDF desse ebook tem um banner escuro no topo — **depois do deploy, o corte
  no leitor some; se a CAPA continuar cortada é porque falta o re-upload (item a)**.

**4. TARDE DO DIA 03/08 — SESSÃO AO VIVO COM O DONO NOS PAINÉIS.** Ele sentou no computador e
fomos item a item. Tudo abaixo está CONCLUÍDO e conferido dos dois lados (painel + banco/API):

- **Capas dos 2 eBooks** ✅ — o original íntegro estava no Drive (`capa livro.pdf`, pasta do
  manuscrito). Extraí a página 1 a 3×, converti para JPEG limpo e mandei pronto; ele subiu.
  `Leilões caixa` 545.013 B (quebrado) → **116.180 B** ok; `Lucre Antes de Arrematar` 544.183 B
  (mesmo defeito latente) → **239.566 B** ok. O upload novo re-codifica via canvas, então esse
  defeito não volta.
- **🔴 SECRET VAZADO EM REPO PÚBLICO** ✅ — confirmado pela API do GitHub (`visibility: public`).
  `RESEND_WEBHOOK_SECRET` estava em texto puro no HANDOFF. Removi do arquivo, varri o repo
  inteiro (nenhuma outra chave real; `.env` nunca versionado — histórico completo conferido) e
  gravei a regra no `CLAUDE.md`. O dono **rotacionou** o valor. **Aprendizado que virou
  processo:** o valor continua no histórico do git para sempre — só a rotação resolve.
- **Vercel — armadilha do `Sensitive`** ✅ — variável marcada assim é write-only: não dá para
  ler nem desmarcar, só apagar e recriar. Foi o que travou a 1ª tentativa de rotação (ele
  salvava sem saber se pegou). Vale para `ASAAS_API_KEY`, que segue Sensitive e **não deve ser
  tocada** (é a credencial que o Asaas nos deu, não uma senha nossa).
- **Search Console** ✅ — propriedade de **Domínio** verificada por DNS. Dois tropeços que valem
  registro: (a) no Registro.br o campo *Nome* CONCATENA `.bidprobrasil.com.br`, então para o
  domínio-raiz ele tem de ficar **vazio**; (b) em propriedade de Domínio o sitemap exige **URL
  completa** (`https://www.bidprobrasil.com.br/sitemap.xml`), o caminho curto dá "endereço
  inválido". `sitemap.xml` **Processado** (2 páginas, correto — o acervo está no outro).
  `sitemap-leiloes.xml` deu "Não foi possível buscar", mas **abrindo no navegador o índice
  responde certinho com as 8 partes** (p=0..7) → foi falha momentânea do Google, não nossa.
- **Cloudflare R2** ✅ — bucket `bidpro-backup`, região **ENAM** (fora do Brasil ✔), token
  Object Read & Write restrita ao bucket, 5 variáveis na Vercel + redeploy. Detalhe que
  enganou: a lista de env vars é alfabética e faltavam `R2_BUCKET`/`R2_LOCATION` — peguei
  pela ordem. ⚠️ A única execução em `backup_execucoes` é de 04:40 UTC de hoje, **dormante**
  ("R2 não configurado"), de antes da config. **A 1ª execução real é 04/08 04:40 UTC.**
- **Upstash Redis** ✅ — `bidpro-ratelimit` (us-east-1, free), REST URL+TOKEN na Vercel.
  Consumidor: `api/_rate-limit.js`. Deixa de contar por instância e passa a contar global.
- **Asaas** ✅ **Ativado / 0 eventos penalizados.** Três armadilhas encontradas: (a) o webhook
  tem **DOIS** interruptores — "Este Webhook ficará ativo?" e **"Fila de sincronização
  ativada?"**; com a fila pausada nada é entregue mesmo com o webhook ativo, e é isso que o
  mantinha "Interrompido"; (b) o botão **"Gerar Token"** cria um valor do Asaas que NÃO bate
  com `ASAAS_WEBHOOK_TOKEN` → 401 → fila pausa de novo (aconteceu uma vez); (c) o Asaas pausa
  a fila automaticamente após 15 falhas. Solução: colar no campo o MESMO valor da Vercel.
  Eventos marcados: CONFIRMED, RECEIVED, OVERDUE, REFUNDED, PARTIALLY_REFUNDED,
  CHARGEBACK_REQUESTED, CHARGEBACK_DISPUTE, AWAITING_CHARGEBACK_REVERSAL.
- **Resend** 🔶 — os dois webhooks com `www` e Enabled; secret rotacionado. **Ainda SEM prova de
  ponta a ponta:** os eventos que chegaram (204 ✔) eram de e-mails que não são nossos, e o
  handler casa por `resend_id` — sem linha em `emails_log`, devolve 204 sem gravar. ⚠️ **Erro
  meu a não repetir:** sugeri testar com "esqueci minha senha", mas esse e-mail sai pelo
  **Supabase Auth**, não pelo nosso `_email.js` — nunca cria linha em `emails_log`. O teste
  válido é um e-mail NOSSO (`oportunidades` 11:00 UTC, `boas_vindas` em cadastro novo).

**5. 🔴 O MAIOR ACHADO DA NOITE — O CSP BLOQUEAVA O NOSSO PRÓPRIO RASTREAMENTO.**
Começou com o dono perguntando por que o painel dizia "Pixel do Meta: Pendente" se já tinham
integrado. Terminou noutro lugar.
- **(a) O painel mentia:** `system-status.js` checava `META_PIXEL_ID` e `META_ACCESS_TOKEN`,
  nomes que **nunca existiram**. Os reais são `VITE_META_PIXEL_ID` (marketing.js) e
  `META_CAPI_TOKEN` (_meta-capi.js). Corrigido — e o item do Google ganhou rótulo dizendo
  para que serve ("mede o PIX") em vez de "opcional" seco, que parecia pendência esquecida.
- **(b) A venda INICIAL não era medida:** o Meta CAPI só era disparado em `ativarPlanoDireto`
  (recorrência). O pagamento inicial passa por `processarConfirmado`, e ali não havia envio
  nenhum. O HANDOFF de 29/07 registrava dois pontos de disparo; existia **um**. Agora os dois
  passam por `registrarConversaoAnuncio()`, helper único.
- **(c) `api/_google-ads.js` — conversão OFFLINE (novo, DORMENTE):** resolve o furo do PIX
  pago depois de sair do checkout (o Google não conta; o Meta contava via CAPI). Usa o `gclid`
  já guardado em `perfis.mkt_gclid`; `orderId` = mesmo id do evento do navegador (dedup).
  Trata `partialFailureError`, que chega com **HTTP 200** — sem olhar isso, erro de conversão
  passaria por sucesso. Liga com: `GOOGLE_ADS_DEVELOPER_TOKEN` (API Center — **só existe em
  conta MCC**), `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_CONVERSION_ACTION_ID` (ação do tipo
  *Importar → rastrear conversões de cliques*; o id sai da URL, `ctId=`), `GOOGLE_ADS_REFRESH_TOKEN`.
- **(d) 🔴 A CAUSA RAIZ, achada pelo Tag Assistant do dono:** o `Content-Security-Policy` do
  `vercel.json` **barrava os próprios rastreadores**. Faltavam: `connect.facebook.net` em
  `script-src` (→ **o fbevents.js NUNCA carregou; o Pixel do Meta estava 100% morto desde
  sempre**, apesar do registro de 29/07 dizer "validado em produção" — o que se validou foi o
  ID no bundle, não o script carregando); `googleadservices` + `googleads.g.doubleclick.net`
  em `script-src` (script de conversão do Ads); e, em `connect-src`, os endpoints **regionais**
  do GA4 (`region1.google-analytics.com` — daí o curinga), googletagmanager, googleadservices,
  doubleclick, google.com e facebook.com. Ampliação mínima, por domínio nominal, sem tocar em
  `default-src`/`object-src`/`frame-ancestors`.
- **VALIDADO NA TELA pelo dono, depois do deploy** (aba Rede): `fbevents.js` **200** (106 kB) +
  3 × `tr/?id=683455009174779&ev=PageView` **200** → **Pixel do Meta vivo**; `collect?v=2&tid=
  G-5YNHQB5F81` **204** (204 é o sucesso do GA4); ping do Ads **200**. A única barrada é
  `ad.doubleclick.net/ccm/s/collect`, com status **`blocked:other`** = extensão/navegador, não
  o nosso CSP (seria `blocked:csp`) — e ela não participa da contagem de conversão.
- **Por que as 4 metas do Ads apareciam "Configuração incorreta / Inativo":** soma de duas
  causas. Volume baixíssimo (24 cliques, 0 cadastros com gclid) **e** o canal fechado pelo CSP.
  ⚠️ Eu havia dito ao dono que era "aritmética, não bug" — estava **incompleto**; corrigi na
  sessão. Não recriar ações no Ads: as duas corretas já existem ("Compra de plano — BidPro" e
  "Cadastro — BidPro"), com os rótulos batendo com `src/utils/gtag.js`.
- **Lição para o ritual:** *tag instalada ≠ tag funcionando*. O que prova é **status 200 na aba
  Rede**. Mesmo padrão do backup dormente e do painel com nome de env errado — três casos, no
  mesmo dia, de "o sistema diz configurado e a coisa não acontece".

**6. 🔴 RELATÓRIO MERCADOLÓGICO COM NÚMERO FALSO — 3 CAMADAS, achadas pelo dono na tela.**
Ele gerou um mercadológico de um **LOTE de 486 m² em Santana de Parnaíba/SP** e viu
"ALUGUEL MÉDIO R$ 63.409,17/mês", "YIELD ÍNDICE 79,53% a.a." e, no mesmo relatório,
"RENTABILIDADE BRUTA 0,00%". Três defeitos somados — e ele foi mais fundo que eu em cada volta:

- **(a) Locação nunca teve trava de plausibilidade.** A VENDA sempre teve faixa por tipo
  (`vendaPlausivelTipo`); a locação entrava com `valorMensal > 0` e mais nada. Na base havia
  "aluguéis de terreno" de **R$ 363.000, R$ 150.000 e R$ 135.900/mês** — preço de VENDA que o
  anúncio classificou como locação. Como o aluguel médio é média aritmética, três outliers
  decidiram o número. → `locacaoPlausivel(tipo, mensal)` + 2ª malha por R$/m² (0,50–500).
- **(b) O schema JSON das locações não tinha campo de área.** Sem área não há R$/m², então
  `valor_m2` era NULL em **todas** as locações da cidade — e a tela exibia "Locação R$/m²/mês
  R$ 68,40" mesmo assim, derivado de outra conta. Era daí que saía o yield de 79,53% (e a
  contradição com o 0,00% do card de cima). → `m2` entrou no schema (4 pontos).
- **(c) 🔑 A CORREÇÃO QUE O DONO VIU E EU NÃO: lote NÃO TEM MERCADO DE LOCAÇÃO.** Eu tinha
  tratado os R$ 363 mil como outlier e posto uma faixa — o que deixaria o relatório dizendo
  "aluguel médio R$ 11,5 mil", *menos absurdo e igualmente falso*. Ele apontou: o imóvel é um
  LOTE EM CONDOMÍNIO; lote não se aluga. Os 11 registros restantes confirmaram — **nenhum com
  área**, e os bairros entregando o produto real: `chacaras boa vista`, `fazendinha`,
  `voturuna`, `alphasitio comercial tambore`. Chácara de evento, pátio, área comercial.
  → Regra categórica: alvo do tipo **terreno** devolve `locacoes: []`, `aluguelMedio: 0` e
  yields 0, dizendo na descrição que lote não possui mercado de locação.
  **Princípio que ficou:** *rentabilidade de aluguel para lote não é dado FALTANTE, é dado
  FALSO — e falso é pior.*
- **(d) TETO DE DISTÂNCIA (2ª observação do dono, também corrigida).** O relatório puxou
  comparáveis de **Alphaville (Barueri, >5 km)** — mesma cidade no papel, outra praça na
  prática — havendo **lotes em Aldeia da Serra a 1–3 km, em condomínio**. É o que explica o
  R$/m² do relatório (R$ 1.916) divergir do Índice (R$ 1.032): recortes geográficos diferentes.
  O prompt definia nível 1 (condomínio/rua → ~250m) e nível 2 (~1km), mas **não proibia passar
  disso** — a IA ampliava em silêncio. Agora: **teto duro de 1km**; só com <5 vendas somadas
  pode ir a **2km** (o "nível 3" que o dono propôs), e aí é **obrigatório** marcar
  `distanciaKm`, dar peso menor e **declarar no comentário** que o raio foi ampliado; **acima
  de 2km, nunca**. `distanciaKm` entrou no schema de vendas e locações, e a ingestão do Índice
  tem a trava final (`perto()`, 2 km) — amostra longe não estraga só aquele relatório: entra na
  base com o bairro/grid do ALVO e envenena todos os seguintes da microrregião. Regra do MESMO
  PRODUTO também explicitada: lote em condomínio compara com lote em condomínio.
- **Base limpa:** 3 amostras fora de faixa + as 11 de locação de terreno removidas. Sobram só
  locações de apartamento (91) e casa (38), que têm mercado de verdade.
- ⚠️ **PENDENTE:** o relatório que o dono já gerou está **gravado com os números velhos**.
  Oferecido regenerar e comparar os dois — ele não pediu ainda.

**7. Google Ads — verificação do anunciante REPROVOU por nome (e o dono já sabe o que fazer).**
Ele preencheu como **pessoa física** (`TARCISIO DE SOUZA NOGUEIRA DE ARAUJO`); o Google leu o
site, inferiu **"Bid Pro Brasil"** e recusou por divergência. Correto é refazer como
**Organização** = `Nogueira Empreendimentos LTDA` (CNPJ 02.311.492/0001-61), declarando
**BidPro Brasil** como **nome fantasia** e enviando o Cartão CNPJ (que traz o campo NOME
FANTASIA). ⚠️ Se o nome fantasia no Cartão CNPJ não for "BidPro Brasil", reprova de novo —
aí é atualizar na Receita ou enviar marca no INPI. **Prazo: 02/09.** Ele refaz amanhã.

**8. Marketing — o funil NÃO está vazio (leitura da noite de 03/08).**
**3 cadastros vindos do Google Ads** (corrige o "0 cadastros com gclid" do registro anterior):
Marlene/BH (03/08, **50 min de sessão**, viu /planos 2×, foi ao checkout, filtrou por preço,
abriu 2 imóveis em BH e ficou **37 min** na ficha de um), Charles W. (02/08, chegou ao
checkout) e Charles A. (01/08). Campanha **barateando**: 29/07 R$2,73/clique → 02/08 **R$1,34**,
com cliques subindo de 9 para 21 no mesmo gasto (~R$25–28/dia). **Vazamento identificado:** os 3
receberam chamado proativo automático ("Como está sendo sua experiência?"), **`cliente_visto_em`
NULO nos três** e nenhum atendente — o sistema abriu conversa e ninguém falou. **Ação de maior
retorno, custo zero: o dono falar com a Marlene**, citando o imóvel específico que ela estudou.
Conversão 81 cliques → 3 cadastros = **3,7%** (saudável); 0 pagantes em 3 cadastros é o
**esperado** (0,15–0,3), não sinal de funil quebrado.

**COBRAR NA PRÓXIMA SESSÃO (prometido ao dono para a manhã de 04/08):**
1. `select * from backup_execucoes order by executado_em desc limit 3;` → a de 04:40 UTC tem de
   sair de `dormante=true` para arquivos copiados. Se falhar, o conserto é variável, não código.
2. `select enviado_em, entregue_em from emails_log where tipo='oportunidades' order by 1 desc
   limit 3;` → `entregue_em` preenchido = ciclo do Resend provado.
3. Search Console → `sitemap-leiloes.xml` saiu de "Não foi possível buscar" para "Processado"?
4. **E-MAIL MARKETING DO INVESTIDOR PRO (pedido do dono para 04/08):** campanha para a base
   aproveitar **antes do reajuste de preço**. Ele quer montar na próxima sessão.
5. **Abordar os leads.** Agora são **4**: os 3 pagos do item 8 (Marlene é a mais quente) **+ o
   investidor da demo do lote de Cuiabá** (03/08), que viu a plataforma ao vivo com o dono,
   disse que criaria conta e não criou — sem cadastro, então não aparece em nenhum painel.
   Perguntar ao dono quem é. Ver "CONTEXTO COMERCIAL" no bloco de 04/08.
6. **Fotos órfãs:** conferir se os 21.418 começaram a cair de verdade agora que a origem foi
   fechada (`select count(*) from public.fotos_orfas_para_limpeza(200000);` — antes caía só
   342/dia porque nasciam ~1.150; a expectativa agora é ~1.500/dia líquido).
7. **Investigação que o DONO levantou (não corrigir em massa — é premissa dele):** 2.785 lotes
   ativos com **avaliação MENOR que o lance mínimo**. Ele disse que isso OCORRE em leilão
   (avaliação defasada, lance com débitos embutidos) e que "precisa ter uma consulta apurada do
   leiloeiro para validar". Tratar como recon: agrupar por fonte, conferir amostra na página
   viva, separar praxe de parse errado. (Separado dos 3.831 com avaliação = lance, normal em
   venda direta.)

**Acompanhar na próxima sessão:** `data_leilao_2` fora da CEF segue em **1** (o `gl_28450` gravado
à mão) — os crons de enriquecimento é que devem fazer esse número subir; se ficar em 1, o problema
é acesso à página (Bright Data), não a extração. Cobertura de `data_fim` hoje: GRUPOLANCE 1,2%,
GESTAOLEILOES 0%, VIP 0%, WEBLEILOES 3,4%, PECINI 10,9%, BIASI 15,3%, SUPORTE 17,2%, CEF 43,4% —
o resto das fontes está em 100%.

---

**A. RITUAL (02/08 ~12h UTC).** (1) **Saúde**: 33.062 ativos (**era 28.040 — ver B**), 27.170
atualizados em 24h; deploys READY (prod `053024b`); fila de geocode 1.042 (98,8% do acervo já
geocodificado, cron horário drena); fila de documentos 1.258 pendentes com vazão de 40/run ×
~14 runs/dia (drena em ~2 dias — **não** está parada). (2) **Baseline aprendida**: só a SBID21
abaixo do piso (0 < 18) = **esperado**, leilão encerrado, fonte armada como o CREPALDI.
(3) **Segurança**: `auditoria_seguranca()` 0/0 — mas a ofensiva achou o que ele **não via**
(ver D). (4) **Relatórios**: 0 vazios, 0 presos, 0 erros em 24h. (5) **E-mail de oportunidades
com a regra nova FUNCIONOU**: 3 envios às 11:01 UTC (8h BRT) com 12 oportunidades cada —
Charles (Petrolândia/PE), Arnaldo (Pariquera-Açu/SP) e Fernando (Santana de Parnaíba/SP).
(6) **Marketing**: gasto de 01/08 ingerido às 10:50 UTC (R$27,31 / 19 cliques / 221 impressões,
selo auto) — ciclo D+1 íntegro; a coluna `conversoes` do nosso `marketing_metricas_dia` está
**0** para 01/08 (a conversão do Charles é conferida no painel do Google, item 2 do dono).

**B. 🔴 O MAIOR ACHADO — 5.025 imóveis da CAIXA (18% do CSV) INVISÍVEIS no app.** Estavam à
venda na Caixa, vinham no CSV todo dia, e o app escondia. **Causa**: `desativar_imoveis_cef_vencidos`
tira do ar o lote que sumiu do CSV (certo), mas o upsert do scraper da CEF (`scripts/scraper.js`
→ `salvarImoveis`) **não escreve a coluna `ativo`** — então o lote que VOLTA ao CSV é atualizado
(preço, foto, data) e fica `ativo=false` **para sempre**. O scraper dos leiloeiros já fazia certo
desde sempre (`scraper-puppeteer.mjs:177`: `ativo: true, // coletado agora ⇒ está ativo (reativa
lotes que voltaram)`); só a CEF ficou de fora. **Prova**: o run de hoje (10:30 UTC) tocou 27.278
lotes = exatamente o total do CSV; 22.253 ativos + **5.025 com `ativo=false` e `status='disponivel'`**,
espalhados por TODOS os estados (GO 1.070, RJ 967, SP 760, MG 255…). **Correção**: RPC
`reativar_imoveis_cef(fonte_ids[])` chamada a cada lote salvo (migração `cef_reativar_lotes_do_csv.sql`,
APLICADA) + backfill imediato. **Acervo ativo 28.040 → 33.062.** A guarda `status='disponivel'`
preserva o lote marcado como arrematado pelo cliente. *Por que o monitor não viu: a baseline
aprendida olha `fonte_saude.total` (o que o scraper PROCESSOU, estável em 27.278), não o acervo
ATIVO — para a CEF os dois números são diferentes. Vale reavaliar se o piso aprendido deveria
olhar `fonte_metricas_hist.ativos` também.*

**C. 🔴 CADASTRO PÚBLICO PODIA NASCER ADMIN (escalação de privilégio).** `handle_new_user`
(trigger de `auth.users`, SECURITY DEFINER → ignora RLS) gravava
`perfis.role = coalesce(raw_user_meta_data->>'role','explorador')`, e `raw_user_meta_data` é o
`options.data` do `supabase.auth.signUp` — controlado por quem chama, com a anon key que está no
bundle do site. `data: { role: 'admin' }` no cadastro = conta admin. A proteção existente
(`trg_proteger_perfil`) é BEFORE **UPDATE**; o INSERT estava aberto, e por isso o auditor seguia
0/0. **Correção** (`handle_new_user_role_allowlist.sql`, APLICADA): allowlist — o cadastro só
nasce `explorador`; papel de equipe continua vindo de `usar_convite_equipe` (valida o token no
servidor) e papel de plano do webhook de pagamento. Nenhum fluxo legítimo dependia disso (os 6
caminhos de cadastro já mandavam 'explorador'). **Nunca foi explorado**: 0 perfis com papel
inesperado. **E o auditor aprendeu** (`auditoria_seguranca_role_do_metadado.sql`, APLICADA): novo
check genérico `role_do_metadado_cliente` — qualquer função que derive o papel de
`raw_user_meta_data` sem a allowlist vira CRÍTICO no próximo run, sem precisar lembrar de incluir
nada. Conferido: o check está armado (dispara se a allowlist sumir) e o painel segue 0/0.

**D. OFENSIVA DE SEGURANÇA (3 agentes + céticos) — 2 furos de KYC fechados:**
1. **KYC do saque burlável (`api/validar-selfie.js`)**: chamando o endpoint **sem o campo `tipo`**,
   o servidor julgava UMA foto enviada pelo próprio cliente ("tem rosto? tem documento?") e, se a
   IA dissesse sim, gravava `identidade_validada=true` — **sem nunca comparar com o documento do
   titular**. Foto de outra pessoa segurando o documento dela aprovava a SUA conta, e identidade
   validada é pré-requisito de SAQUE. Agora **todo** caminho passa pelo face match contra o
   documento no acervo; `identidade_validada` é escrito em **um lugar só**. O caminho fraco (prompt
   genérico + campo `aprovado`) foi REMOVIDO, não só bloqueado.
2. **Contrato assinado sem o documento exigido (`api/assinar-contrato.js`)**: `verificacao_identidade`
   e `docs_extras_exigidos` só eram cobrados na TELA (`ContratoLink.jsx:363-374`). Um POST direto
   com o token e sem `docs_identidade` assinava sem documento nenhum — e pulava junto o face match,
   que só roda quando as fotos vêm. Agora a API carrega as duas colunas e devolve 422 listando o
   que falta. Vale para a assessoria (R$ 4.800–6.000), que é o contrato mais caro.
3. **O "documento" do KYC podia ser uma URL do próprio usuário (`api/validar-selfie.js`)** — o mais
   grave da ofensiva, e ele **ficou mais crítico depois do item 1**: com tudo passando pelo face
   match, a força do KYC passou a depender de UMA coisa — a procedência da foto do documento. E a
   linha de `usuario_docs` é escrita pelo CLIENTE (a RLS permite inserir a própria linha —
   `Perfil.jsx:542`, `KycParceiroModal.jsx:62`), então `url` era campo dele: bastava inserir
   `{tipo:'kyc_documento', url:'https://site-do-atacante/rg-forjado.jpg'}` e o servidor comparava a
   selfie com um "documento" fabricado — aprovando identidade e, com ela, o saque. Agora só é aceito
   arquivo do NOSSO Storage (`${SUPABASE_URL}/storage/v1/…`); qualquer outra origem cai em revisão
   manual, nunca em aprovação. Fecha junto o SSRF (o servidor deixou de buscar URL arbitrária).
4. **Link de contrato saindo do domínio do atacante** (`assinar-contrato`, `assinar-testemunha`,
   `gerar-contrato`, `auto-contrato`): o href do e-mail era montado com `req.headers.origin` (ou o
   `Host`) — ambos do cliente. Um POST com `Origin` forjado fazia a BidPro enviar, **do próprio
   domínio**, um e-mail a TODAS as partes com `https://<atacante>/#/c/<token>` — e o token de
   assinatura de cada uma viaja no fragmento, que a página do atacante lê de `location.hash`. Agora
   o link sai sempre de `APP_ORIGIN`. No mesmo commit: nome do signatário/testemunha e título do
   contrato passam por `escapeHtml` (vinham crus do formulário público para o corpo do e-mail).
5. **SSRF por redirect** (`api/img-proxy.js`, `api/gerar-analise.js`): a allowlist anti-rede-interna
   era checada só na 1ª URL e o `fetch` seguia redirect — host liberado podia devolver 302 para
   `169.254.169.254`/`10.x`. Passam a usar `fetchExternoSeguro`, que o projeto já tinha e revalida
   CADA hop (era usado só em `enriquecer-lote`/`_edital-extrato`).
> **Ofensiva completa: 02/08/2026.** 12 agentes, 8 achados confirmados por céticos, 8 não
> verificados (entram no backlog abaixo). **Fica registrado como decisão, não como bug**: o face
> match é *fail-open* por design (sem CLAUDE_KEY, erro técnico ou confiança não-alta NÃO bloqueiam
> o assinante legítimo — só divergência CLARA barra). Se o dono quiser fail-closed, é mudança de
> política, não correção.

**E. BUG BOUNTY DO CÓDIGO (6 agentes por camada + céticos) — corrigidos:**
1. **Webhook Asaas rebaixava assinante em dia (`api/asaas-webhook.js`)**: `PAYMENT_OVERDUE` e
   `PAYMENT_REFUSED` não checavam `ehProduto` (os fluxos de confirmação, chargeback e reembolso
   checavam). Assinante que comprava um curso/e-book no boleto e **não pagava** caía em
   `processarVencido` → role rebaixado para explorador, `inadimplente_desde` marcado,
   `plano_vencimento` zerado e documentos com prazo de expiração — por causa de um boleto de
   produto abandonado. Agora produto avulso vencido/recusado não toca o plano.
2. **Contrato de assessoria self-service SEMPRE dava 502 (`api/auto-contrato.js`)**: `emailUsuario`
   era usado na trava de elegibilidade 10 linhas ANTES do seu `const` → `ReferenceError` (zona
   morta temporal) engolido pelo `catch` fail-closed → `nao_foi_possivel_validar_elegibilidade`.
   Parecia inelegibilidade do cliente; era ordem de declaração. Corrigido + o catch agora **loga**
   a causa (foi o silêncio dele que escondeu isso).
3. **Todo lead público ia para o ralo (`sdr_leads` = 0 linhas)**: os 3 gravadores mandavam colunas
   que **não existem** (`respostas`, `user_id`, `consultor_id` em `sdr-capturar`/`promo-capturar`)
   ou violavam NOT NULL (`duvida.js`, quando o visitante não informa telefone) → 400/constraint →
   `catch {}` vazio → lead evapora. Os leitores pediam as MESMAS colunas e tomavam 400
   (`Admin.jsx:4934` e `:7133`, `health-check.js:292`). Migração
   `sdr_leads_colunas_que_o_codigo_espera.sql` (APLICADA) cria as colunas, torna `whatsapp` nulável
   e acrescenta `sdr_produtos.perguntas` (que o questionário da `ProdutoLanding` lê); os 3
   gravadores agora **logam a falha** em vez de engolir. **Ainda não houve perda real** (0 dúvidas
   enviadas até hoje) — a armadilha estava armada para o primeiro visitante do tráfego PAGO, que
   cai exatamente nos formulários da Landing e da Planos.
4. **Rastreio de entrega do e-mail de oportunidades nunca ia popular (`api/enviar-alertas-cron.js`)**:
   o cron gravava a linha em `emails_log` **sem `resend_id`**, e `resend-webhook.js` casa o evento
   por `resend_id`. Ou seja: mesmo depois de o dono corrigir a URL no Resend (item 1 dele), o
   e-mail de MAIOR volume — o teste natural que ele ia usar hoje — continuaria com
   `entregue_em/aberto_em` vazios para sempre. Agora o id do Resend é capturado e gravado.
   *(Os 3 envios de hoje, 11:01 UTC, saíram antes do fix: seguem sem rastreio. O próximo ciclo já
   valida.)*

**F. CAPTURA — SATO era ponto cego TOTAL (30 lotes com link morto).** `scraper-sato.mjs` inventou
o padrão da URL do lote e **documenta isso**: linha 31 "palpite /leilao/{id} como url_lote; o 1º
run real valida" — nunca foi validado. No run das 11:40 do `captura-documentos`, **12 de 12 lotes
SATO** voltaram `title="Not Found"`: `https://www.satoleiloes.com.br/leilao/<id>` é 404. Ou seja,
"Acessar leiloeiro" levava a lugar nenhum — o mesmo sintoma que o `limpar-imoveis-stale-cron`
corrigiu para a CEF. Agravante: a fonte **não escreve `fonte_saude`**, **não estava** em
`FONTES_SEM_SAUDE` nem em `BASELINE_FONTES`, e `scraper-sato.yml` **não tem cron** (só dispatch
manual) — coleta única em 30/07 e ninguém para avisar. **Feito**: 30 lotes desativados + fila de
documentos purgada + `leiloeiro_conhecimento.docs_status='esperado'` (para de queimar slots do
drenador) + observação com o achado (`sato_lotes_com_url_inexistente.sql`, APLICADA); SATO entra
em `FONTES_SEM_SAUDE` no monitor, com uma lista `FONTES_PARADAS` que evita o alerta diário de
"sem acervo ativo" enquanto a fonte está parada de propósito. **REVERSÍVEL**: `scraper-sato.mjs:198`
já grava `ativo: true` — descoberto o padrão real da URL, os lotes voltam sozinhos.
**Próximo passo (não feito)**: recon do padrão real de URL do lote da SATO antes de religar.

**E2. FECHAMENTO DO BUG BOUNTY (24 agentes; 13 confirmados por céticos, 5 refutados, 31 não
verificados). Corrigidos além dos de cima:**
6. **`perfis.email` NÃO EXISTE — e 7 telas dependiam dele.** O e-mail mora em `auth.users`; pedir
   `email` no select ou no embed (`perfis(email)`) faz o PostgREST devolver **400** e, como o front
   não checava `error`, a tela renderizava **vazia/zerada sem avisar**. É a MESMA causa do "painel
   de Assinaturas tudo 0" da sessão 15 — corrigida lá (`AdminFinanceiro.jsx:331` até documenta a
   lição) e sobrevivente em 7 pontos. Estavam quebrados: **Dashboard → detalhe por plano ("0
   usuários / MRR R$ 0,00" em TODOS os planos)**, detalhe da equipe por papel, lista de
   assessorados, "Salvar e notificar" da ficha (e-mail do cliente nunca carregava), Alertas de
   E-mail do Marketing (sempre vazio), transcrições de reunião, e o **registro de arremate por
   e-mail** (`ImovelDetalhe.jsx:298` dizia SEMPRE "Usuário não encontrado com esse email"). Correção
   na raiz: RPC `admin_emails_por_ids(uuid[])` (migração APLICADA, guard admin/equipe, revoke anon)
   + helper `emailsPorIds()` no Admin.jsx, usado nos 6 pontos; o 7º (arremate) resolve o e-mail no
   **servidor** (`/api/arrematacoes` aceita `arrematante_email`), porque `get_user_id_by_email` é
   service-only de propósito — expor busca por e-mail ao cliente seria oráculo de enumeração.
7. **Regeração de relatório morria em ≤30s e cobrava cota de novo (`AnalisesContext.jsx:103`)**: o
   varredor de "gerando" travado media contra `startedAt`, que vem do `created_at` da linha — a data
   da PRIMEIRA geração, não da atual. Ao regerar um relatório antigo, a tela dizia "excedeu o tempo
   limite" em segundos, o polling parava e o resultado real nunca chegava; clicar de novo consumia
   cota outra vez (o servidor via a linha em 'gerando', não 'concluida'). Agora usa `updatedAt` — a
   mesma régua que o `rowToEntry` logo acima já usava.
8. **Mercado Pago rebaixava assinante em dia (`api/mp-webhook.js:331`)**: gêmeo exato do bug do
   Asaas (item E1) — `rejected`/`cancelled` de compra AVULSA caía em `processarRecusado` sem o guard
   `ehProdutoMp` que os ramos `approved` e `charged_back` já tinham. PIX de produto que expira
   rebaixava o plano de quem paga.
9. **TODO chargeback e TODO reembolso quebravam no fim (`api/_webhook-core.js:428/527/547`)**:
   `alertarErro` é SÍNCRONA e recebe UM objeto `{rota, erro, extra}`; as três chamadas usavam args
   posicionais + `.catch()` sobre o retorno (`undefined`) → **TypeError** logo depois de já ter
   gravado o chargeback e suspendido o acesso. Resultado: a equipe **nunca** recebia o alerta e o
   webhook devolvia 5xx ao gateway em todo chargeback/reembolso (com o evento já marcado como
   processado, a reentrega era descartada). Um gateway que vê 5xx repetido desativa o webhook — foi
   exatamente o que aconteceu com o Resend. Mesma correção em `financiamento-alertas-cron.js:144`.

**I. SEGUNDA ONDA (02/08 tarde — pedido do dono: "resolva na ordem sugerida"). P0→P1→P6→P2/P3→P4.**
- **P0 — MERGE FEITO**: `main` foi de `053024b` a `ea8328d` (fast-forward). ⚠️ **Cuidado achado no
  caminho**: o `main` LOCAL do container aponta para uma história **não relacionada** (`4f76eab`,
  "Aula travada → Comprar real"); o `main` de PRODUÇÃO é o `origin/main`. `git checkout main` traz
  o repo errado — sempre trabalhar contra `origin/main` (`git push origin HEAD:main`).
- **P1 (5)**: gate de custo do Índice agora falha FECHADO (`rpc()` devolvia null tanto para "sem
  limite" quanto para "falhou" — e null era lido como ∞: uma queda do banco liberava a pesquisa web
  paga de graça; vale p/ `indice-mercado` e `indice-gerar`) · link promocional de curso/e-book passa
  a **conceder de verdade** (RPC `conceder_acesso_promo`, chamada após o login = prova de posse;
  produto vem de `links_promo.produto_ref_id`, nunca do cliente; a tela só diz "liberado" quando o
  servidor concedeu) · `garantia-cancelar` recebia `perfil.mp_id` como STRING num parâmetro tratado
  como array (o `for..of` iterava CARACTERE A CARACTERE e tentava cancelar `/preapproval/<letra>`) e
  ignorava o `mp_preapproval_id`; agora cancela de verdade, avisa o cliente quando o gateway NÃO
  confirma e manda e-mail para a equipe cancelar na mão · gate da assessoria no Checkout só
  bloqueia com veredito EXPLÍCITO (o fail-open só valia p/ erro de rede; um 5xx bloqueava a venda
  de R$ 4.800-6.000) · upload de documentos do arremate lista as falhas ao operador.
- **P6 — a correção de MAIOR alavancagem**: o cliente Supabase (`src/utils/supabase.js`) passa a
  reportar QUALQUER resposta ruim do PostgREST para `erros_cliente`, via o `reportarErroCliente` que
  já existia (dedup, teto por sessão, funciona anônimo). Era esta família — coluna inexistente → 400
  → `error` não checado → tela zerada em silêncio — que produziu o "Assinaturas tudo 0" (sessão 15),
  o "MRR R$ 0,00" e os leads perdidos. Agora aparece sozinho no health-check/360, sem varredura.
  Ignora 401/403 (RLS/sessão), 406 (`.single()` sem linha), 409 (upsert) e `/auth/v1` (senha errada
  é negócio, não bug).
- **P2 (3)**: `enviar-alertas-cron` consultava `arrematacoes.user_id` (é `arrematante_id`) — a etapa
  "similares ao que você arrematou" nunca rodou · o aviso "a matrícula corrige a cidade/metragem"
  era gravado em `analises_mercado.correcoes_sugeridas` e **ninguém lia de volta**: sumia no reload;
  agora o contexto expõe e a tela reidrata · "Corrigir e regerar a avaliação" refazia a pesquisa com
  os dados ANTIGOS (o `setTimeout` de 150ms não troca o closure do `setD`) — a correção agora vai
  por parâmetro explícito.
- **P3 (2)**: `documental-retry-cron` media a janela de 48h em `updated_at`, campo que a própria
  retentativa desliza — o teto nunca valia (agora `created_at`, o padrão que
  `regenerar-relatorios-cron` já documentava). *Medido: 0 preliminares hoje — era armadilha
  latente, não vazamento ativo; o cron é de 6h, não de 1h.* · `enfileirar_docs_faltantes` passa a
  purgar o que a REGRA ATUAL não enfileiraria (fonte paga/não-publicadora/login-gated/sem url_lote):
  185 GESTAOLEILOES + 19 PECINI herdados de antes de 24/07 batiam em Cloudflare até esgotar as 4
  tentativas, ocupando slots do drenador. **Fila 1.258 → 46 pendentes**, com a invariante conferida:
  **0** candidatos que a regra quer ficaram fora da fila.
- **P4 — rodada de verificação (o combinado: confirmar antes de virar trabalho).** REFUTADO: "SLA do
  Pipeline sobre `casos.updated_at`" — já usa `max(job, updated_at)` desde a sessão 22; o "parado
  9d" dos casos da Alessandra é VERDADE (0 jobs, equipe nunca começou). CONFIRMADOS e corrigidos:
  ficha do Pipeline personificava TODO cliente como `assessorado` (agora usa o papel real) ·
  `reconciliar-asaas-cron` promovia de plano quem só comprou PRODUTO avulso (o webhook separa por
  `externalReference`, a rede de segurança não separava, e `mapearPlano` decide pelo VALOR: produto
  de R$ 49,90 virava Investidor Pro) e gravava `plano_ciclo='mensal'` para pagamento ANUAL (o ciclo
  vem do sufixo `_anual`, que não era passado) · `daily-webhook` sem idempotência: reentrega
  duplicava a transcrição e repetia o `extrairLicoes()` (Gemini, pago) — índice único por
  `daily_room_name` + upsert `ignoreDuplicates`. CONFIRMADO e NÃO corrigido: `casos.concluido_em` é
  lido (`Admin.jsx:9559`) e nunca gravado — a coluna "Concluído" do Pipeline é inalcançável (0 de 6
  casos têm o campo); decidir COM O DONO qual evento conclui um caso antes de gravar.
**J. OS DOIS ITENS QUE TINHAM FICADO DE FORA — RESOLVIDOS (02/08, pedido do dono).**

**J1. O fluxo de casos nunca teve um FIM (origem, função e impacto do `concluido_em`).**
- **Origem**: `supabase/schema_fluxo_analise.sql` criou `casos` com DUAS coisas — `status_etapa`
  (onde o caso ESTÁ) e um bloco "Timestamps das transições de etapa" (`iniciado_em`,
  `juridico_enviado_em`, `arrematado_em`, `concluido_em` = QUANDO cada passo aconteceu). Só a
  primeira metade virou código: **nenhum dos quatro carimbos era escrito por fluxo nenhum** e o
  CHECK de `status_etapa` terminava em `'pos_arrematacao'` ("acompanhamento em andamento") — a
  máquina de estados **não tinha estado final**.
- **Função**: `concluido_em` é a porta de saída do quadro — `etapaDoCaso` (Admin.jsx) testa
  `if (c.concluido_em) return 'concluido'` ANTES de tudo. É o único caminho para a 5ª coluna.
- **Impacto**: nenhum caso jamais saía do Pipeline. Caso entregue seguia ocupando "Arremate em
  andamento", o relógio "⚠ parado Xd" continuava contando sobre trabalho concluído (justo a
  métrica que o dono usa para cobrar prazo — o sinal se perde no ruído), o WIP real da equipe
  ficava desconhecido e não existia tempo de ciclo (análise → entrega). Com 6 casos é cosmético;
  é dívida que só machuca no volume.
- **Achado irmão, no mesmo lugar**: `casos.updated_at` **nunca se movia** depois do insert (nos 6
  casos `updated_at = iniciado_em`; não havia trigger e os `update` do app não tocavam a coluna).
  Como o relógio do Pipeline usa `max(job, casos.updated_at)`, para caso SEM job o "parado Xd"
  media idade desde a CRIAÇÃO, não desde a última atividade.
- **Resolvido** (`casos_conclusao_e_transicoes.sql`, APLICADA): `status_etapa` ganhou `'concluido'`
  e uma trigger (`casos_carimbar_transicoes`) mantém `updated_at` vivo e carimba as transições
  (`juridico_enviado_em`, `arrematado_em`, `concluido_em` — sempre a PRIMEIRA passagem; reabrir
  limpa o `concluido_em`). No banco, não no call-site: vale para o app, para a API e para
  qualquer fluxo futuro. No Pipeline, cada card ganhou **"✓ Concluir caso"** (com confirmação) e
  **"↩ Reabrir caso"** na coluna Concluído — concluir é decisão HUMANA, não dá para inferir.
  Ciclo testado ponta a ponta num caso real (concluiu → carimbou → reabriu → limpou → estado
  original restaurado).

**J2. Contagem de `perfis` no navegador (corte silencioso de 1.000) — RESOLVIDO.**
`Admin.jsx` Usuários (`:912`) e Comercial (`:7176`) liam `perfis` sem limite explícito: hoje, com
26 perfis, não há corte; a partir de 1.000 a lista e TUDO que se conta sobre ela no navegador
(total/pagantes/sem consultor/inadimplentes) passariam a mentir sem sinal — exatamente o que
produziu o "Assinaturas tudo 0" (s15) e o "1000 buscas" congelado (s22). Agora as duas consultas
pedem `count: 'exact'` com `range` explícito (2.000) e a tela **avisa** quando o lote não cobre a
base: o título vira "Usuários (X de Y)" e o Comercial mostra uma tarja "Mostrando X de Y — os
números abaixo se referem a esses X". Preferi a verdade visível à paginação completa: é o mínimo
que impede número errado silencioso, sem reescrever a UX das duas telas.

**K. ARMAZENAMENTO + DEMOGRAFIA (02/08 noite — pedido do dono: "faça o que traz melhor
eficiência e segurança das informações, sempre o melhor custo-benefício; o que for desnecessário
descarte" + "gostei da estrutura que montou, faça — atenção com a separação das etapas para não
cairmos no mesmo erro anterior de sobrecarregar o tempo de coleta do relatório").**

**K1. Descarte de 1,15 GB de peso morto no Storage — com a trava de segurança primeiro.**
O bucket `imoveis-fotos` tem 61.208 arquivos; **21.760 (1,15 GB) não são apontados por nenhum
imóvel** — o lote saiu do acervo ou o backfill re-hospedou com nome novo. São inalcançáveis pelo
app. A lista do que NÃO pode sumir não veio de memória: **varri toda coluna `text`/`jsonb` do
schema `public`** atrás de `imoveis-fotos`. Só 4 colunas citam o bucket — `imoveis_leilao.link_foto`
(acervo vivo) e os snapshots congelados em `analises_mercado`/`analises_documental`/`analises_laudo`
(relatórios JÁ entregues; apagar uma dessas quebraria o PDF de quem pagou). A RPC
`fotos_orfas_para_limpeza` exclui as quatro e ainda dá **7 dias de carência** a arquivo novo
(upload em voo). Conferido antes de ligar: **0 fotos de relatório na fila**.
`/api/limpar-fotos-orfas-cron` apaga pela **API de Storage** (exclusão por SQL deixaria o arquivo
no bucket e a conta correndo), 500×3 por dia — os 21 mil somem em ~2 semanas, sem pico de I/O.
Exclusão é irreversível: devagar é a escolha certa.
⚠️ **Medido e deliberadamente NÃO tocado:** 1,7 GB de documentos capturados duplicados entre lotes
(3.614 arquivos para 2.493 conteúdos distintos). Dentro de uma cota de 100 GB, o risco de deduplicar
não paga o ganho. Registrado para não ser "esquecido" e sim uma decisão.

**K2. Demografia e pressão habitacional no mercadológico — SEM tocar no tempo de coleta.**
A condição do dono ditou o desenho: **nada disso é pesquisado durante o relatório.**
- **Ingestão separada** (`/api/socio-ingestao-cron`, diário 02:50): grava em `cidade_socio`.
  Processa **UMA fonte por execução** (cada agregado do IBGE devolve os 5.570 municípios de uma
  vez — juntar quatro numa execução só seria repetir o erro em outra camada) e **só toca em fonte
  com mais de 25 dias**. Efeito: a base se preenche sozinha nos primeiros dias após o deploy e
  depois se renova sozinha, sem carga concentrada e sem disparo manual.
- **Leitura no relatório**: `socio_regiao` (bairro > cidade), UMA linha indexada, disparada **em
  paralelo** com as leituras do Índice. Custo de coleta somado ao relatório: **zero**.
- **Autonomia como a do Índice**: não há id de agregado nem nome de variável no código — tudo vem
  de `socio_fontes`, e o casamento é **por NOME (regex)**, não por id. IBGE mudou algo? O conserto
  é um `update` em SQL, sem deploy.
- **Honestidade do número** (o ponto sensível): cada campo sai com **fonte e ano**. O déficit
  habitacional OFICIAL é da **FJP**, não tem API, e tem **colunas próprias** (`deficit_fjp_*`)
  vazias até carregarmos o dado real. O que derivamos do Censo é chamado pelo que é — **"pressão
  habitacional"** — com o método impresso junto, e o prompt **proíbe** chamá-la de déficit da FJP.
  A régua não é chutada: sai dos **tercis de todos os municípios do país**, recalculados a cada
  ingestão (mesma filosofia do `fonte_baseline_aprendida`).
- **CAGED entrou DESLIGADO e documentado** (`socio_fontes.caged_emprego`, `ativa=false`): o Novo
  CAGED não expõe API por município, só o arquivo mensal nacional compactado. O lugar certo é uma
  **GitHub Action** mensal (já temos o padrão dos scrapers), não uma função serverless. Registrado
  para não virar promessa esquecida.
- **BAIRRO**: a chave já tem `bairro_norm` e o relatório já lê bairro > cidade, mas a API do IBGE
  só serve município (N6) — recorte por bairro só existe em agregados de setores censitários, que
  não vêm por API. Fase 1 entrega **cidade**; a estrutura está pronta, sem migração futura.
- **Saúde**: novo item **"Dados socioeconômicos (IBGE)"** — fonte falhando ou parada há mais de 60
  dias vira **erro**. Relatório citando dado vencido como atual é pior que relatório sem o dado.
- **Ensaio antes do deploy**: o caminho de gravação foi testado no banco com 3 cidades sintéticas
  (3 fontes em sequência) — e **pegou uma ambiguidade de coluna no `socio_upsert`** que teria
  quebrado a primeira execução real. Ensaio limpo depois.
- ⚠️ **O que ainda não pude verificar**: os IDs dos agregados do IBGE (4709/4712/6579/2612). O
  proxy deste ambiente bloqueia `servicodados.ibge.gov.br`, então a chamada real só acontece em
  produção. Foi exatamente por isso que a config foi para o banco e o casamento é por nome. **Na
  próxima sessão: ler `socio_ingestao` e `socio_fontes.ultimo_erro`** — se algum agregado errar, o
  erro traz os rótulos que o IBGE devolveu e o conserto é um `update`.

**K2b. 🔴 FURO QUE EU MESMO ABRI HOJE — pego pelo auditor no mesmo dia.** Rodei
`auditoria_seguranca()` depois de subir tudo (item 3 do ritual) e voltou **1 atenção**:
`registrar_erro_cliente` SECURITY DEFINER executável por **anon**. Causa: a migração J/E de hoje
fez `create or replace` **acrescentando `p_stack`** — no Postgres isso não substitui a função,
**cria uma sobrecarga NOVA**, e função nova nasce com EXECUTE para PUBLIC. A versão de 6
parâmetros seguia trancada; a de 7 ficou aberta. Como ela escreve em `erros_cliente` por fora da
RLS, qualquer visitante podia injetar erro falso — **envenenando justamente o check-up de saúde e
o Cliente 360**, que são as telas onde a gente vai olhar quando algo quebrar de verdade.
Corrigido (`registrar_erro_cliente_fecha_anon_e_remove_overload.sql`): revoke de anon/authenticated
e a sobrecarga velha de 6 parâmetros dropada (ninguém a chamava; duas assinaturas quase iguais é
ambiguidade esperando virar bug). Auditoria depois: **0 crítico / 0 atenção**.
**Lição para a próxima vez:** todo `create or replace` que MUDA A ASSINATURA de uma RPC
SECURITY DEFINER precisa vir com os `revoke` na mesma migração.

**K3. O passo a passo do R2 está escrito** (`docs/PENDENCIAS_DONO.md`, item **-3**): criar bucket
com location hint **fora da América do Sul**, token com `Object Read & Write` **escopado ao
bucket**, as 5 variáveis na Vercel, redeploy e como conferir no check-up. Custo **R$ 0** (o backup
copia só os **45 arquivos / 15 MB** irrecuperáveis; o gratuito do R2 dá 10 GB). Inclui o alerta de
que `R2_LOCATION` **declara** a região e precisa bater com a real, e uma nota de LGPD sobre levar
documento de cliente para fora do país — decisão que é dele.

**L. LEITOR DE eBOOK + VISIBILIDADE DA DEMOGRAFIA (02/08 noite — 3 pedidos do dono).**

**L1. Leitor paginado estilo Kindle** (`src/components/LeitorPaginado.jsx`). O "Ler" abria uma
coluna rolável com TODAS as páginas empilhadas, dentro do app, com menu e breadcrumb em volta.
Agora é modo de leitura: overlay em tela cheia escurecendo o entorno · **uma página por vez**
escalada para caber na LARGURA (é isso que deixa o texto legível no celular sem zoom) · quando a
página não cabe na altura ela **rola na vertical** em vez de ser espremida (texto espremido é
ilegível), com aviso "deslize para ver o resto"; ao virar, volta ao topo · vira por **toque** no
terço esquerdo/direito, arrasto horizontal, setas do teclado ou botões — e o toque **só conta se o
dedo não arrastou** (<10px, <400ms), senão rolar para terminar de ler viraria a página sozinho ·
toque no meio esconde/mostra as barras · 3 temas + zoom · **progresso** "pág. X de Y (N%)" salvo
na CONTA (`leitura_progresso`), não no aparelho: começa no desktop e continua no celular, com
localStorage só de espelho e falha de banco nunca travando a leitura. O progresso também aparece
na vitrine de Membros ("62% lido · Continuar →") — senão a contagem só existiria dentro do leitor.
⚠️ **Google Drive segue no `/preview`**: o pdf.js precisa de CORS para desenhar os bytes e o link
de compartilhamento do Drive não dá. PDF do Storage (caso do ebook da Caixa) vai no leitor novo.
Apagado `LeitorEbook.jsx` (código morto que ninguém importava e cujo cabeçalho dizia "estilo
Kindle" sendo um iframe que nem abre em celular — armadilha para a próxima sessão).

**L2. Demografia ganhou tela** — o dono perguntou "onde eu vejo e como é alimentado?" e estava
certo: a base alimentava o parecer e não tinha superfície nenhuma. **Admin → Dados & Fontes →
👥 Demografia**: de onde vem (cada fonte do IBGE com agregado, período e o resultado da última
carga, com o erro visível), o quanto já cobre, as últimas ingestões, e uma **consulta por cidade**
que devolve exatamente o que o relatório vai citar (e diz "sem dado" quando não há — o relatório
simplesmente não cita o bloco). Botão **"Atualizar agora"** dispara a ingestão sem esperar o cron.
As tabelas seguem fechadas: o painel é RPC SECURITY DEFINER que exige `is_admin()`.

**M. SEO — o site tinha UMA página indexável (02/08 noite, a partir do dono: "pesquisando
palavras-chave de leilão o meu site não aparece").**

**M1. A causa raiz.** O app é SPA com **HashRouter**: tudo mora depois do `#`, e o Google
**descarta o fragmento**. Para o buscador, `/#/buscar` e `/#/planos` são a MESMA URL que `/`.
Um site com **33.032 imóveis** tinha exatamente **uma** página indexável. O `sitemap.xml`
declarava 7 URLs com `#` — todas colapsavam na raiz: declarava 7, entregava 1. Não havia como
ranquear para "casa em leilão em Campinas": essa página não existia para o Google. O
`robots.txt` ainda trazia `Disallow: /#/admin`, que nunca fez nada (o navegador não envia o
fragmento ao servidor).

**M2. A correção — sem tocar no roteador do app** (migrar para BrowserRouter mexeria em todo
link, e-mail e PWA; risco alto para o mesmo ganho). Rotas **sem hash, renderizadas no
servidor** (`api/publico.js`), com o conteúdo pronto no HTML:
`/leiloes` · `/leiloes/:uf` · `/leiloes/:uf/:cidade` · `/leilao/:id/:slug`, mais
`/sitemap-leiloes.xml` (índice + partes de 5 mil) gerado do banco. Cache na borda 1h.
**Verificado em produção**: `/leiloes` = 33.008 imóveis em 27 UFs; `/leiloes/sp/campinas` =
120 lotes com foto, preço, desconto, breadcrumb, ItemList e paginação; sitemap com 8 partes.
- **Nível de exposição (decisão consciente)**: essas páginas mostram exatamente o que o
  visitante não logado JÁ vê no teaser (`ImovelGate`) e o que a RLS "Leitura pública" já
  libera. O PRODUTO — análise de viabilidade, parecer jurídico, documentos, Índice — segue
  atrás do cadastro. Funil: o buscador traz pelo imóvel, o cadastro entrega a análise.
- Cidade sem lote ativo sai do índice (`noindex`) mas continua abrindo: página vazia é
  conteúdo raso, e conteúdo raso derruba a reputação do site inteiro.
- `/i/:id` (og-share) **não mudou**: continua sendo preview de link compartilhado, `noindex` e
  com redirect. São coisas diferentes — página que redireciona não indexa.

**M3. 🔴 BUG QUE EU MESMO PUBLIQUEI E PEGUEI NA VERIFICAÇÃO.** A primeira versão foi ao ar
anunciando **"980 imóveis em 5 estados"**. Causa: eu contava no JavaScript, puxando as linhas
com `limit=100000` — e o **PostgREST corta em 1.000 linhas respondendo 200**, sem erro.
Voltaram as 1.000 primeiras (todas de UF em A/B) e a conta saiu errada com cara de certa, no
lugar mais caro possível: o texto que o Google indexa. É o **mesmo padrão** já corrigido hoje
nas telas do Admin. Corrigido na raiz (`acervo_publico_agregados.sql`): contar é trabalho do
banco, e as RPCs devolvem **um valor jsonb** — sem teto de linhas. O sitemap tinha o mesmo
defeito latente (partes de 5.000 entregariam 1.000, e sitemap incompleto não dá erro, só
entrega menos). **Lição:** `select` cru com `limit` alto é teto silencioso; para contar ou
paginar acima de 1.000, sempre RPC com retorno único.

**M4. O "byd".** Pesquisar "bid pro brasil" devolve BYD porque o Google **autocorrige** o termo
("Incluindo resultados para byd pro brasil") — ele não reconhece "BidPro" como marca. Não é
bug do site: é falta de sinal de marca. Feito agora: `alternateName` no schema.org com as
grafias reais ("Bid Pro Brasil", "BidPro", "Bid Pro") em Organization e WebSite, e a forma com
espaço escrita no rodapé. Isso ensina o buscador que o termo existe. O resto é tempo, volume de
busca pela marca e links de fora.
⚠️ **Fica dependendo do dono** (não dá para fazer daqui): cadastrar o site no **Google Search
Console**, enviar os dois sitemaps e pedir indexação; e criar o **Perfil da Empresa no Google**.
São os dois maiores aceleradores tanto do reconhecimento da marca quanto da descoberta das
33 mil páginas novas.

**M5. Achado menor registrado**: 23 imóveis ativos com UF inválida (20 vazias, 3 "NS"). Já são
filtrados nas páginas públicas; não valem correção agora, mas indicam ruído no parse de uma
fonte.

**G. BACKLOG do bug bounty (achado e NÃO corrigido nesta sessão — registrado de propósito):**
- `api/promo-capturar.js:112` (CONFIRMADO) — link promocional de curso/e-book mostra "🎉 Acesso
  liberado!" mas nenhum entitlement é criado (`compras_produtos` nunca recebe linha): o cliente bate
  no paywall. `links_promo` ainda não tem link de curso/ebook em produção — corrigir antes de criar
  o primeiro. Ou concede de verdade, ou muda o texto da tela.
- `api/gerar-documental.js:1602` (CONFIRMADO) — aviso "a matrícula corrige a cidade/metragem do
  mercadológico" é gravado DEPOIS do upsert: some ao recarregar e nunca aparece se a aba fechou.
- `src/pages/Analise.jsx:2763` (CONFIRMADO) — "Corrigir e regerar a avaliação" refaz a pesquisa com
  a cidade/metragem ANTIGAS (closure velha) e não atualiza o relatório persistido.
- `api/garantia-cancelar.js:116` (CONFIRMADO) — cancelamento da recorrência MP inoperante no
  fallback (string iterada char a char) e ignora `mp_preapproval_id`, mas responde "cancelada".
- `src/pages/Admin.jsx` (CONFIRMADO) — upload de documentos do arremate ignora `res.ok`.
- `src/pages/Checkout.jsx:266` (CONFIRMADO) — gate da assessoria falha FECHADO por erro HTTP.
- `api/indice-mercado.js:60` (CONFIRMADO) — gate de custo falha ABERTO (RPC indisponível = ilimitado).
- `api/enviar-alertas-cron.js:210` (CONFIRMADO) — consulta `arrematacoes?user_id=…`, coluna que não
  existe (é `arrematante_id`): a etapa "similares ao que você arrematou" nunca roda.
- `api/gerar-laudo-viabilidade.js:211` — gate do laudo aceita mercadológico vazio/sem parecer e
  emite veredito sobre "valor de mercado R$ 0".
- `api/documental-retry-cron.js:39` — janela de 48h medida por `updated_at`, que desliza a cada
  regeração → re-tenta de hora em hora para sempre.
- `api/indice-mercado.js:60` — gate de custo falha ABERTO: RPC `limite_ia_efetivo` indisponível é
  lido como "ilimitado" (o padrão do projeto é fail-closed em gate de custo).
- `api/enviar-alertas-cron.js:210` — consulta `arrematacoes?user_id=…`, coluna que não existe (é
  `arrematante_id`/`cliente_id`): a etapa "similares ao que você arrematou" nunca roda.
- `src/pages/Admin.jsx:1120` — upload de documentos do arremate ignora `res.ok`: arquivo não grava,
  ninguém é avisado e os 3 relatórios saem sem os documentos.
- `src/pages/Checkout.jsx:266` — gate da assessoria falha FECHADO por erro HTTP (mostra a tela
  errada numa contratação de R$ 4.800–6.000).
- `src/contexts/AnalisesContext.jsx:103` — regeração marcada como "erro/tempo limite" em ≤30s
  porque `startedAt` vem do `created_at` antigo da linha.
- Fila de documentos: ~200 linhas de fontes PAGAS (GESTAOLEILOES 185, PECINI 19) enfileiradas antes
  da regra de 24/07 seguem sendo tentadas pelo drenador genérico e batem em Cloudflare
  ("Just a moment…") até esgotar as 4 tentativas. Desperdício limitado, mas é desperdício.
- **Da ofensiva, achados NÃO verificados por cético** (não confirmados nem refutados — verificar
  antes de mexer): `fetch-url.js:33` e `baixar-doc.js` com o mesmo padrão de redirect do img-proxy
  (mesma correção: `fetchExternoSeguro`) · `enviar-alertas-cron.js:424` `link_foto` do leiloeiro cru
  dentro de atributo HTML do e-mail · `email-alerta.js:83` corpo montado com HTML do request sem
  escape · `chat-suporte.js:81,97` campo `memoria` do cliente concatenado no system prompt e
  endpoint de IA sem rate limit.
- **Do bug bounty, 31 achados NÃO verificados por cético** — os de maior valor aparente, para
  confirmar antes de mexer: `Admin.jsx:9550` relógio de SLA do Pipeline sobre `casos.updated_at`
  (campo que o fluxo não toca) · `Admin.jsx:9512` coluna "Concluído" inalcançável
  (`casos.concluido_em` lida e nunca gravada) · `Admin.jsx:9566` abrir a ficha pelo Pipeline
  personifica TODO cliente como 'assessorado' · `Admin.jsx:7131` Comercial/Assinaturas contam
  `perfis` no navegador sem limite (corte de 1.000 — mesmo padrão já corrigido no Marketing) ·
  `reconciliar-asaas-cron.js:86/90` promove de plano quem só comprou produto avulso e grava
  `plano_ciclo='mensal'` para pagamento ANUAL · `daily-webhook.js:56` sem idempotência (reentrega
  duplica transcrição) · `monitor-dados-cron.js:38` e `monitor-fontes-cron.js:409` engolem falha
  (RPC quebrada vira "0 regressões"; alerta marcado como enviado sem checar o Resend) ·
  `juridico-lembretes-cron.js:120` repõe aviso já escalado · `agendar-reuniao.js:182` devolve
  ok:true com o INSERT falhando (slot queimado) · `gerar-laudo-viabilidade.js:211` aceita
  mercadológico vazio · `documental-retry-cron.js:39` re-tenta para sempre · `duvida.js:69`
  (**já corrigido nesta sessão**, o cético não chegou a rodar).

**H. O QUE DEPENDE DO DONO** — agora encabeçada pelo **R2 (item -3, ~15 min, R$ 0)**, que é o único
item da lista que protege contra perda definitiva de arquivo de cliente. Depois dele, a lista de
ontem continua valendo (`PENDENCIAS_DONO.md`): Resend
(URL com `www.` + Re-enable) · 3 checagens do painel Google Ads + conversão do Charles · atribuir
responsável aos 4 casos da Alessandra (0/4 relatórios, prazo estourado) · aprovar o prompt dos
triggers p/ recriar a Rotina mensal de auditoria · termos de pesquisa na segunda.
⚠️ **Sobre o item do Resend**: corrigir a URL agora passa a valer de verdade — antes do fix E4 o
e-mail de oportunidades nunca teria rastreio, com ou sem webhook ativo.

## ✅ COMEÇAR AQUI (01/08 — sessão 22: ritual de abertura + Cliente 360 + fix resumir-ticket)

**📋 ATIVIDADES DO DONO — SÁBADO 02/08 (lista pedida por ele; detalhes em PENDENCIAS_DONO.md):**
1. **Resend (2 min)**: Webhooks → editar URL acrescentando `www.`
   (`https://www.bidprobrasil.com.br/api/resend-webhook?k=<mesmo secret>`) → **Re-enable**.
   Teste natural: e-mail de oportunidades das ~8h → `entregue_em/aberto_em` preenchendo no 360.
2. **Google Ads — conferir a 1ª conversão**: Metas → Conversões → "Cadastro — BidPro" deve
   mostrar **1** (cadastro do Charles, 01/08). Aproveitar e fazer as 3 checagens: ações
   "Cadastro"/"Compra de plano" como **Principal** e "Registrando conversões" · **Conversões
   otimizadas** (método da tag) LIGADA · Tag Assistant opcional.
3. **Atribuir responsável aos 4 casos da Alessandra** (Equipe → Pipeline: 0/4 relatórios da
   equipe, prazo de 48h estourado há +1 semana) — e disparar os relatórios na ficha.
4. **Aprovar o prompt de permissão dos triggers** quando o Claude pedir — p/ recriar a Rotina
   mensal de auditoria de segurança (hoje aponta p/ ambiente sem o repo).
5. *(Segunda 03/08)* Termos de pesquisa do Google Ads → negativar os ruins.
6. *(Sem prazo apertado, até 31/08 — já iniciada)* Verificação do anunciante: só acompanhar o
   e-mail de aprovação do Google.

**⏹ ENCERRAMENTO 01/08 (~19h UTC) — SMOKE CHECK COMPLETO, TUDO VERDE:**
- **Relatórios**: pareceres vazios 0 · presos "gerando" 0 · erros 24h 0 · 2 concluídos hoje —
  o de Bertioga (18:38, JÁ com o deploy novo) saiu com Índice "21 amostras · grid" (fix do
  n_amostras validado em produção no 1º relatório real) e parecer de 6k chars. O de Feira de
  Santana (18:18, pré-deploy) mostra o card antigo — regenerar atualiza (grátis), opcional.
- **Índice**: base com 1.433 amostras; RPCs ok (usadas hoje nas validações).
- **Busca/geral**: fila de geocode 3,5s → **0,3ms** (EXPLAIN pós-índice); ZERO `api_erro`/
  `pdf_falha` de usuários nas últimas 8h (360 zerado); deploys READY (prod `6298f0c`);
  `auditoria_seguranca()` **0/0**.
- **GOOGLE ADS (dono fez em 01/08)**: ✅ verificação do anunciante CONCLUÍDA (aguardar
  aprovação, até 7 dias úteis — anúncios seguem no ar) + ✅ 1ª fatura R$74 paga, que BATE
  com o rastreado (R$74,94 = 24,55+27,06+23,33, 29-31/07; ciclo de medição íntegro).
  Campanha saudável: cliques 9→15→17/dia, CPC caindo (2,73→1,37, teto 3,00). **Amanhã**:
  dado de 01/08 entra ~07h UTC (D+1) e conferir no painel se "Cadastro — BidPro" registrou
  **1 conversão** (Charles, gclid) — valida o rastreamento ponta a ponta. Pendentes do dono:
  3 checagens do painel (ações Principal / Conversões otimizadas / Tag Assistant) + termos de
  pesquisa na segunda + developer token p/ conversão offline PIX.
- **RESEND webhook DESATIVADO (e-mail do dono 01/08 ~20h; diagnóstico PROVADO)**: a URL
  cadastrada no Resend usa o APEX, que responde **308→www** (testado ao vivo: apex=308,
  www=200 ok) — Resend não segue redirect → falhou desde 27/07 → disable. Envios intactos;
  rastreio entrega/abertura NUNCA populou (`max(entregue_em)=null` na base). Fix é do dono
  (painel Resend: URL com `www.` + re-enable) — `PENDENCIAS_DONO.md` item -2. Validar no
  e-mail de oportunidades de sábado (~8h): `entregue_em/aberto_em` preenchendo.
- **Pendências de sistema em aberto**: item pendente da fila CEF (Apto 53 — CEF sem a seção
  de docs; re-tenta no cron) · Rotina mensal de auditoria a RECRIAR (gatilho sem repo; tools
  de trigger pediram aprovação manual) · backlog leve do relatório (pracaReferencia,
  zoneamento na tela) · e-mail de oportunidades: 1º disparo com a regra nova amanhã 11h UTC
  (Charles incluso — conferir emails_log).
> Branch `claude/handoff-bidpro-brasil-jb378n`. ✅ **Sessão 21 (branch
> `claude/handoff-rotina-inicio-ta1z4a`, 9 commits `8f54882..8a96380`) MERGEADA na `main` em
> 01/08 com aprovação do dono** — Índice cidade_norm composto + ponderação por proximidade,
> KYC face match (parceiro/contratos) e doc avulso selfie_doc foram para produção junto com o
> fix do resumir-ticket desta sessão.

**A0. SBID21 RESOLVIDO (recon Round 36, 01/08 ~14h30):** o 0 em 2 runs NÃO é regressão de
premissa — a sonda (`debug_fetch` fonte `ofv36-sbid21`) provou: portal 21 com filtro de
imóveis = HTTP 200/total 0 (query do scraper funciona); portal 21 SEM filtro = 62 ofertas,
todas veículos internacionais (Trucks & Buses, loja Rimac/Peru, US$); portal 9 controle = 70
"Real Estate" ok. O leilão de imóveis do portal 21 (37 de ontem) ENCERROU — fonte fica ARMADA
como o CREPALDI: quando publicarem imóveis, o scraper capta sozinho. Nenhum código a mudar;
o monitor vai acusar "falhou 0" até voltar acervo (ruído esperado).

**A. RITUAL (01/08 ~12h UTC).** (1) Saúde: 30.262 ativos / 27.085 atualizados 24h; fila geocode 399;
cluster diário rodou (CEF 27,5k, LJUD 1.084, ZUK 596, SUPERBID 1.356, PESTANA recuperou 287, BIASI
207 em 31/07); deploys READY. (2) Baseline: **SBID21 falhou hoje (0<piso 18;
"total 0<5", ontem 37 ok)** — re-scrape SBID21-only disparado (leiloeiros-puppeteer.yml) p/ separar
transitório × regressão; CREPALDI 0 = esperado (armado, loja vazia). (3) `auditoria_seguranca()` =
**0/0**. (4) Pareceres vazios = 0. (5) Runner residencial em dia (últimas coletas 30/07, gate 72h →
próxima ~02/08 18h). (6) Marketing: `marketing_metricas_dia` ingeriu 29-31/07 (31/07: R$23,33/17
cliques) — ciclo auto OK; pendências de conversão (offline PIX + 3 checagens no painel) seguem
abertas na sessão 21. (7) **Rafael (`6b35b390…`) segue explorador, sem contrato** —
⚠️ **WATCH ENCERRADO a pedido do dono (01/08 ~15h)**: "Pode parar de acompanhar o Rafael.
Quando ele assinar eu sinalizo." NÃO re-armar send_later p/ o Rafael em sessões futuras;
quando o dono sinalizar a assinatura, aí sim conferir ativação (role top2 + contrato
assessorado + PIX/cartão no MP).

**B. CLIENTE 360 (pedido do dono).** Rastreio vivo: 724 eventos/24h (click/pageview/change/submit),
funil público com 37 visitantes anônimos/204 eventos 7d. Achados nos `api_erro` de 24h:
1. **BUG corrigido nesta sessão — `resumir-ticket` 403 p/ cliente**: `ChatSuporte.jsx:364` dispara
   `/api/resumir-ticket` ao encerrar o atendimento para QUALQUER usuário, mas a API era staff-only
   → cliente que encerrava o próprio chat levava 403 (caso real: Charles 01/08 03:08) e a
   **memória de IA do atendimento nunca era gerada** nesse caminho (feature silenciosamente morta
   p/ encerramento pelo cliente). Fix na raiz: a API agora permite **staff OU o próprio dono do
   ticket** (dono resolvido server-side — IDOR-safe mantido, rate-limit 10/min mantido).
2. **502 `registrar-aceite` (2 usuários, 31/07 tarde)**: era o bug `aceites_plano.valor` NOT NULL,
   já corrigido na sessão 21 (`0e0eae7`, em produção) — confirmado funcionando: Charles re-aceitou
   termos v3.0 às 03:10 de 01/08. Os 2 usuários afetados ainda não relogaram (0 aceites) — o popup
   cobra no próximo login; sem ação.
3. Falhas de login/cadastro agora deixam rastro anônimo ✓ (`login_falha` com anon_id no 360).

**C. TELA DE MARKETING — diagnóstico a pedido do dono + 2 distorções corrigidas (migração
`admin_funil_captacao_corrigir_contratacao_e_indicacao.sql`, APLICADA):**
1. **"Contrataram 3 / R$ 0" era FALSO**: a RPC contava qualquer linha de `aceites_plano` como
   venda, mas desde os Termos v3.0 (sessão 20) o RE-ACEITE de termos também grava lá com
   `valor` null → 3 re-aceites viravam "contratações" e poluíam "Últimas contratações".
   Agora só conta aceite com **`valor > 0`**. Pós-fix: contratantes 30d = 0 (verdade — nenhuma
   venda de plano no período).
2. **"Indicação (parceiro) 22" era o DEFAULT do dono**: `vincular_owner_default` põe
   `indicado_por`=admin em todo cadastro sem `?ref=` → 22/23 cadastros caíam em "Indicação" e
   o Orgânico zerava. Agora indicação exige indicador NÃO-admin. Pós-fix: Orgânico 21 ·
   Google Ads 1 · Indicação real 1. Auditoria pós-migração: 0/0.
3. **1ª conversão REAL do Google Ads**: Charles Ferreira de Azevedo, cadastro 01/08 03:08 com
   gclid+utm=google (não é teste) — CAC do cadastro ≈R$75 (gasto auto 29-31/07: R$74,94 / 41
   cliques / CPC R$1,83, abaixo do teto R$3). Já abriu chat e aceitou termos. Coleta automática
   de gasto OK (selo "auto", sem dupla contagem); dado de 01/08 entra ~07h UTC de 02/08.
   **Precisão de vocabulário (dono alertou)**: Charles é `role=explorador` (usuário GRÁTIS) —
   "conversão" aqui = CADASTRO vindo de tráfego pago, não cliente pagante. O "chat" dele foi a
   saudação PROATIVA da IA ("Como está sendo sua experiência?", origem='proativo'): 2 mensagens
   da IA, ZERO do cliente, encerrado por ele em 21s ("Auto-resolvido") — por isso não aparece
   no Atendimento (filtro padrão só mostra pendentes; finalizados ficam no filtro "todos").

**D. PIPELINE DE CASOS corrigido + Agenda unificada (pedido do dono após analisar a tela Equipe):**
1. **Etapa "Aguardando reunião/parecer" era inalcançável**: `casos.mercadologico_status` é lido
   em `etapaDoCaso` mas NUNCA gravado por fluxo nenhum → todo caso ficava preso em "Análise
   (relatórios)". Agora o pipeline busca o mercadológico REAL (`analises_mercado` do cliente ×
   `imovel_id` do caso): concluído → etapa "decisão". Os 5 casos ativos (4 Alessandra + Matheus
   pré-arremate) tinham TODOS mercadológico concluído.
2. **"parado Xd" cego à atividade real**: relatório não toca `casos.updated_at` → o relógio agora
   usa a última atividade (max do caso × relatórios). Caso da Rui Barbosa marcava "parado 9d"
   com regeneração em 31/07.
3. **Agenda → sub-aba de Equipe** (Pipeline · Time · Agenda) — menu de topo perde 1 item; chave
   antiga em sessionStorage redireciona (padrão dos renames anteriores).
4. **Dado verdadeiro que a tela revela**: nenhum caso tem analista/advogado atribuído ("Sem
   responsável" nos 6) — atribuir responsáveis é ação do dono/equipe, não bug.

**D2. PAINEL DE BUSCAS congelado em "1000" (achado do dono no print) — CORRIGIDO:** a Seção 1
do MarketingTab puxava as linhas CRUAS de `busca_historico` p/ o navegador; o PostgREST corta
em 1.000 linhas → "Total de buscas" travava em 1000, únicos subcontava (16 vs 17) e o ranking
de cidades/estados era contado na fatia VELHA (1.000 linhas mais antigas — por isso parecia
congelado). Real em 30d: **1.454 buscas / 17 únicos**. Fix no padrão da demografia: RPC
**`admin_marketing_buscas(p_inicio,p_fim)`** (SECURITY DEFINER, guard admin, revoke anon —
migração `admin_marketing_buscas_agregado.sql` APLICADA) agrega total/únicos/cidades/estados/
tipos/pagamentos no servidor; front usa 1 chamada. Escala p/ 10k+ (mesma lição: NUNCA contar
linhas cruas no cliente — auditar outras telas admin com select sem limit explícito).
**v2 + auditoria COMPLETA da tela (pedido do dono):** (a) **Mapa de Oportunidades também
sofria o corte** — contava "imóveis disponíveis por cidade" sobre select cru de 30k+ ativos
(parava nas 1.000 primeiras linhas) → RPC ganhou a chave `oportunidades` (top-10 cidades
buscadas × contagem REAL de ativos, join lower(cidade); migração
`admin_marketing_buscas_oportunidades.sql` APLICADA; Guarulhos=65, Santana=7 conferidos);
(b) **RESPONSIVIDADE**: os 3 blocos de KPI `repeat(4,1fr)` (Buscas/Perfis/SDR) estouravam a
largura no celular (card "19 tipos" deslocado no print do dono) → `auto-fit minmax(150px)`;
os 3 blocos 2-colunas `1fr 1fr` → `auto-fit minmax(260px)` (empilham no mobile); tabelas já
tinham overflowX:auto. Status das demais seções: funil/gastos (corrigidos hoje), demografia
(RPC s20) OK; SDR sem filtro de período e alertas_email select* — hoje 0/25 linhas, entram no
mesmo padrão de RPC QUANDO tiverem volume (backlog leve).

**F. TARDE 01/08 — rodada de achados do dono (5 frentes):**
1. **BOTÃO VOLTAR global** (`App.jsx BotaoVoltar`): pill fixo no canto inferior ESQUERDO
   (chat ocupa o direito), `navigate(-1)`; só aparece quando HÁ tela anterior no app
   (`history.state.idx>0`) e fora de `/` e `/login`. Vale p/ todas as rotas (Admin incluso).
2. **LENTIDÃO — causa raiz achada e corrigida**: o seletor da fila de geocode
   (`api/geocodificar.js:84`, or= latitude null / 0 / geocod_nivel='refazer' + order
   atualizado_em desc) varria o índice INTEIRO a cada chamada — **3.691 chamadas × ~3,5s
   (3,5h de CPU!)** roubando o banco do app todo. Fix: índice PARCIAL
   `imoveis_leilao_geocode_fila_idx` (migração `imoveis_geocode_fila_indice_parcial.sql`,
   APLICADA) casa o predicado exato → seleção instantânea.
3. **PIPELINE DE CASOS v2 (a v1 desta manhã estava ERRADA — corrigida no mesmo dia)**:
   derivar etapa de `analises_mercado` confundia relatório que o CLIENTE gera sozinho com
   trabalho da equipe (os 4 casos da Alessandra são `status_etapa='analise_solicitada'`
   com **0 jobs em `analise_jobs`** — a equipe NUNCA iniciou; a coluna "Aguardando
   reunião/parecer" enganou o dono). Agora: etapa vem de **`casos.status_etapa`**
   (analise_solicitada→Análise · analises_prontas/reuniao_*→Decisão · juridico_*→Jurídico ·
   arrematado/pos→Arremate), card mostra **"Relatórios da equipe: X/4"** e o relógio usa
   o job mais recente. RESPOSTA AO DONO: a Alessandra NÃO pediu reunião — ela **solicitou
   análise** de 4 imóveis (22-24/07) e os 4 relatórios da equipe (mercado/financeira/fluxo/
   jurídica, prazo 48h) estão 0/4 sem responsável há 8-10 dias.
4. **EDITAL CEF ausente no caso (Apto 53 Carapicuíba)**: o lote foi processado pela captura
   CEF em 07/07, ANTES da feature de edital — 9 imóveis nessa condição (matrícula ok, edital
   faltando) re-enfileirados em `cef_matricula_fila` (salvarAnexo pula tipos existentes) +
   `matricula-cef.yml` disparado.
5. **RELATÓRIO MERCADOLÓGICO — auditoria completa (agente; 14 descasamentos tela/PDF ×
   gravado). CORRIGIDOS**: `indiceBidPro` agora leva `n_amostras`+`fonte` nos 3 caminhos e o
   caminho central declara nível 'cidade' (o card dizia "bairro · 0 amostras" com dado da
   cidade — o bug do print do dono); branch 'estado' nos rótulos (tela+PDF; antes exibia
   "cidade"); copy "por microrregião" dinamizada; PDF: "(undefined encontradas)" morto,
   amostras de NÍVEL 1 (condomínio) incluídas (antes só nível 2 — lote só com amostras de
   condomínio saía sem nenhuma); agregados por nível recalculados no SERVIDOR (repair de
   JSON truncado preservava listas e perdia totais → "0 amostras · R$ 0" ao lado de lista
   cheia); composição por período marca "ref. região" quando `fora_padrao`; base de cálculo
   não exibe conta de comparáveis quando a fonte é o Índice. **BACKLOG (registrado, não
   feito)**: exibir `pracaReferencia` (qual praça ancorou projeções); `zoneamento` só existe
   no PDF (tela não mostra); linha "R$/m²×área" do front refaz conta simples que o servidor
   não usou (unidadeValor por tipo); `fontesLocais`/`outrosBairros` gravados e nunca exibidos.

**G. NOITE 01/08 — anexos institucionais + 2 e-mails do dono:**
1. **"Política de Privacidade" como documento do LOTE (print do dono, MEGA Bertioga)**: o
   `RE_DOC_INSTITUCIONAL` do `_doc-scan.js` não cobria privacidade/cookies/termos de uso →
   **6.698 entradas-lixo em 2.340 imóveis** (Política de Privacidade ×2.652, avisos de
   cookies/privacidade/termos/segurança da informação ×1.009 cada — um leiloeiro com 4 links
   institucionais em todo lote — + 10 PDFs de consentimento "adopt/disclaimer"). Blacklist
   estendida (captura) + migração `anexos_remover_lixo_institucional.sql` APLICADA (varredura
   pós = 0; Bertioga ficou com os 3 docs corretos: matrícula/edital/condições).
2. **E-mail Google Ads (verificação do anunciante até 31/08)**: LEGÍTIMO e importante — sem
   concluir, a campanha PAUSA. Registrado em `PENDENCIAS_DONO.md` item -1 (só o dono faz).
3. **E-mail Anthropic (Rotina mensal "Auditoria de segurança BidPro")**: a rotina acordou a
   sessão SEM repositório vinculado (403 nos nomes tsn-app/bidpro) → NÃO rodou nada; não é
   achado de segurança, é config do gatilho. Corrigir: recriar a Rotina apontando p/ um
   ambiente com o repo (a gestão de triggers pediu aprovação manual nesta sessão — pendente).
   Cobertura NÃO ficou zerada no mês: a camada 1 (cron determinístico `seguranca-auditoria-
   cron` + `auditoria_seguranca()`) segue ativa e 0/0 hoje.

**E. E-MAIL DE OPORTUNIDADES agora respeita o PERFIL DO INVESTIDOR (dono confirmou a regra e
escolheu a opção A):** `enviar-alertas-cron` — o complemento por raio (50→400km) fazia a seleção
SÓ por desconto ≥40%; a triagem (faixa_capital/forma_pagamento) e os filtros do alerta eram
ignorados. Agora: **1º passe** dos anéis com tipo+modalidade+pagamento+TETO de capital
(TETO_FAIXA: ate_150k→200k · 150_400k→520k · 400k_1mi→1,3M · acima_1mi→sem teto; valorMax do
alerta prevalece se menor; `buscar_por_raio_v2` já aceitava os filtros — só passamos); **2º
passe** relaxa preferências mas MANTÉM o teto (acima do capital ≠ vaga a preencher). Teto também
aplicado aos fallbacks (nome da cidade, similares, nacional). Validado com o caso real do
Charles: passe 1 = 38 casas venda_direta financiáveis ≤200k desc≥40% em ≤400km de Petrolândia/PE
→ o 1º e-mail dele (sáb 02/08 ~8h BRT) fecha as 12. **AJUSTES FINAIS do dono (mesma sessão):**
(1) **raio MÁXIMO = 200km** (50→100→200; acima disso o investidor não se desloca — já foi 400km);
(2) **as 12 vagas são DIVIDIDAS entre os critérios**: filtros salvos E cidade+perfil presentes →
6+6 (cota dos filtros distribuída entre eles; sobra de um critério vai p/ o outro — passo 2b);
só um critério → leva as 12. Piso desconto 40% mantido. Charles pós-ajuste: 1 casa no perfil
exato + 51 candidatos ≤200k/≥40%/≤200km → fecha 12. Cadência lembrete: trava de 7d faz quem
recebe o 1º e-mail no fim de semana pular a segunda imediata (Charles: próximo em 10/08).

## ✅ COMEÇAR AQUI (31/07 — sessão 21: Índice ponderado por proximidade + KYC face match no parceiro e nos contratos)
> Branch `claude/handoff-rotina-inicio-ta1z4a`. `npm run build` OK. Endpoints de API novos passam `node --check`. Commits: `8f54882` (Índice), `ec08d6d` (ponderação), `ac2307e` (campo doc), `b62b05a` (KYC parceiro), `ae543f7` (KYC contrato), `ad86a6f` (selfie_doc).

**A. ÍNDICE — 2 bugs achados a partir de "gerei índice e não saiu gráfico/PDF" (Vila Mascote/SP):**
1. **"Todos os tipos" era beco sem saída**: o gráfico de valorização e o botão de PDF só existem no detalhe de UM tipo; a visão "Todos os tipos" só mostrava os cards. Agora cada card mapeado é **clicável** (abre o detalhe daquele tipo, com gráfico + PDF) e a dica virou ação. `src/pages/IndiceConsulta.jsx`.
2. **`cidade_norm` divergente (bug de dados sério)**: a base própria `indice_amostra` e o acervo `imoveis_leilao`/`cidade_indicadores` gravam a cidade **SEM espaço** (`saopaulo`), mas `indice-consulta.js` lia **COM espaço** (`sao paulo`). Toda cidade de nome COMPOSTO (praia grande, feira de santana, são bernardo…) tinha **gráfico e lista de amostras vazios** — o valor só sobrevivia caindo no fallback ponderado (tabela geo `indice_amostras`, que usa espaço). Correção: **normalização por destino da tabela** — `cidadeNormDb` (sem espaço) p/ leitura direta de `indice_amostra`, `indice_valorizacao_anual`, `indice_composicao`, `indice_bidpro_regiao`; mantém `cidadeNorm` (com espaço) p/ os RPCs da tabela geo (`indice_regiao_ponderado`, `indice_bairros_cidade`).

**B. ÍNDICE + MERCADOLÓGICO — referência PONDERADA por proximidade+padrão com mistura por credibilidade (pedido do dono: "poucas amostras na localidade → peso por proximidade e mesmo padrão, mas misturar com o ticket médio dos demais").** Novo módulo puro `api/_indice-ponderacao.js`: `valor = cred·V_local + (1−cred)·V_amplo`, onde V_local = mediana ponderada por proximidade (gaussiana ~350m) × padrão (gaussiana log-preço, contém outlier tipo mansão), V_amplo = ticket médio (mediana), cred = massa_de_proximidade/(massa+6) **contando só amostras COM coordenada** (sem geo → puxa ao ticket médio). Simétrico (ajusta p/ cima ou baixo = mais seguro; escolha do dono "melhor eficiência e segurança"). Aplicado em `indice-consulta.js` (amostras da cidade projetadas p/ hoje pela taxa → une temporal+espacial; guarda de sanidade >2,2×) e em `gerar-analise.js` `centralIndiceRegiao` (proximidade ao imóvel-alvo; bandas seguem percentis da cidade). Nota de transparência na tela e no PDF quando houve mistura. **VALIDADO com dados reais** (Praia Grande, 125 amostras): 3 endereços → R$5.867 / R$6.858 / R$7.437 (−16,9% / −2,8% / +5,4% vs. mediana única R$7.059); outlier de luxo não domina.

**C. GEO BACKFILL da base própria (custo ZERO).** A ponderação depende de coordenada, mas `indice_amostra` tinha só 14% com lat/lng. Os 1210 sem geo **tinham `imovel_id`** → backfill por **join com `imoveis_leilao`** (coord já validada), **sem nenhuma chamada externa**. Cobertura dos comparáveis do alvo (`origem='relatorio'`): 14% → **100%** (1342 amostras; níveis endereço/rua/bairro). ⚠️ **Peguei e corrigi um erro meu no caminho**: 70 amostras `relatorio_regiao` (de OUTROS bairros) tinham recebido a coord do imóvel-alvo por engano → revertidas p/ null (o correto: entram só no nível cidade pelo bairro). O insert do `gerar-analise` já grava coord nos comparáveis novos → mantém sozinho, sem cron.

**D. KYC — FACE MATCH selfie × documento (segurança; "evitar foto aleatória para passar"). Motor compartilhado `api/_kyc-match.js`.**
1. **Popup do PARCEIRO** (`api/validar-selfie.js` + `KycParceiroModal.jsx`): antes a selfie (`tipo:'rosto'`) só checava "existe um rosto?" e, havendo QUALQUER documento no acervo, validava — dava p/ subir documento aleatório + selfie de outra pessoa e passar; o documento nem era checado por IA. Agora busca o documento enviado, baixa a imagem e faz o **match das faces** (Claude Vision, 2 imagens, prompt do servidor). Só aprova com rosto + documento válido com foto + **mesma pessoa** + confiança alta; rejeita com motivo; **fail-closed** (sem key / doc em PDF / dúvida / erro → revisão manual `identidade_pendente`, nunca aprova sozinho). Também corrigi um **bug do cliente**: qualquer resposta com `mensagem` fechava o popup como sucesso (até rejeição).
2. **CONTRATOS de assessoria/club** (`api/assinar-contrato.js`): mesma verificação estendida à assinatura, para **qualquer contrato que peça rosto+documento, plano OU avulso**, nos DOIS formatos: **separado** (selfie + foto_doc — plano via `auto-contrato`) e **combinado** (`selfie_doc` — avulso via `CriarContrato` e `contratos-operacional`). **Bloqueia (422) só em divergência CLARA** (confiança alta, rosto+doc ok, pessoas diferentes); incerteza/PDF/indisponibilidade NÃO travam o assinante legítimo — segue e o veredito fica em `audit_logs` (mismatch bloqueado também vai p/ a linha do tempo do criador no 360). **Campo do documento no popup do parceiro** passou a permitir **câmera OU galeria/arquivo/Drive** (removido `capture` forçado) — igual ao contrato; a selfie segue captura ao vivo.

**E. PESSOAS / MONITORES.**
1. **Fernando Takashi** (`5dd2c0af…`): virou parceiro e **concluiu o KYC** (documento + selfie, `identidade_validada=true`) — fluxo OK.
2. **Parceiros com KYC incompleto**: Kaique (só documento, PDF, sem selfie), Álvaro e Jaqueline (nada). O popup os cobra no próximo acesso (condição `parceiro_aceite_em && !identidade_validada && !identidade_pendente`).
3. **Rafael** (`6b35b390…`, rafael-pereira-13@hotmail.com): monitor de contratação — segue **explorador, sem contrato assessorado**. Re-armado (send_later) p/ re-checar a cada 5h; **não avisar o dono até ativar**. Trigger ativo.

**F. FIM DA SESSÃO 21 (indicação, KYC avulso, marketing).**
1. **Indicação Jéssica → Jaqueline — INVESTIGADA e DECIDIDA (dono: "deixar como está").** A Jéssica cadastrou-se com **`ref_codigo` NULO** (em `auth.users.raw_user_meta_data` E no login) → **nenhuma prova no servidor** de que veio pelo link da Jaqueline; só indício (mesmo sobrenome Fonseca + 45min após o compartilhamento). O dono optou por NÃO reatribuir. Se a Jaqueline confirmar externamente, é um `update perfis.indicado_por` simples (como Arnaldo→Kaique). **Causa-raiz (não é bug de código):** a cadeia de captura está robusta — captura global do `?ref=` no `AuthContext` + `localStorage` 30 dias + trigger `handle_new_user` (aceita código de QUALQUER parceiro) + `vincular_upline` no login (com guarda p/ o `vincular_owner_default` não roubar o slot); link no formato certo (`#/?ref=`). A perda ocorre quando o `?ref=` **não chega ao navegador do cadastro** (clique no in-app do WhatsApp e cadastro no Chrome, outro aparelho, storage limpo) — inerente à atribuição client-side; aí o `vincular_owner_default` atribui o dono (padrão pedido pelo dono). **Melhoria oferecida (não feita):** capturar a indicação **server-side por e-mail** num toque pré-cadastro (SDR/landing) e casar no signup — fecha o buraco cross-device.
2. **KYC — foto+documento no AVULSO (FEITO, commit `65c2e10`).** Assessoria/club já eram obrigatórios (auto-contrato: selfie+foto_doc). Agora o **documento avulso (manual OU gerado por IA**, ambos via `CriarContrato`/`gerar-contrato`) vem por padrão com `verificacao_identidade='selfie_doc'` (rosto+documento no mesmo enquadramento, casa com o face match) + **nota informando** o signatário. Continua editável p/ caso pontual.
3. **Marketing — rastreamento de conversão VALIDADO ponta a ponta (código/histórico; site de produção inacessível daqui pela política de rede).** Pipeline correto: tag GA4 `G-5YNHQB5F81` + Ads `AW-16850175262` no `index.html`; `capturarMarketing()` (gclid/utm, 90d) no boot; `trackCadastro` só no cadastro OK (`Login.jsx:336`); `trackPlanContratado` no `pago=true` (MP/Asaas-PIX-polling/inline) com `transaction_id` dedup + Enhanced Conversions; Meta CAPI server-side no webhook. **O 0 conversões é ARTEFATO, não furo:** os rótulos corretos só entraram em **29/07 21:39 UTC** (commit `59f8f1d`) → 29/07 + parte de 30/07 dispararam com rótulo velho (não contabilizado); e foram só **24 cliques / 0 cadastros com gclid** (o único `utm=google` é o teste do dono).

**PENDÊNCIAS PARA AMANHÃ (marketing / conversão):**
1. **Furo real — conversão OFFLINE do Google Ads p/ PIX (implementar).** `trackPlanContratado` é client-side; PIX pago DEPOIS de sair do checkout **não conta no Google** (o Meta conta via CAPI). Não há upload offline p/ Google e o `GOOGLE_ADS_DEVELOPER_TOKEN` nem está setado. **Plano:** o dono obtém o developer token da Google Ads API → implementar o upload de conversão offline no webhook (via `gclid` já capturado em `perfis.mkt_gclid`), **dormente/gated na env** no mesmo padrão do Meta CAPI (`_meta-capi.js`). Posso deixar o esqueleto pronto antes do token.
2. **3 checagens no painel Google Ads (só o dono faz):** (a) as ações **"Cadastro — BidPro"** e **"Compra de plano — BidPro"** estão como **Principal** e "Registrando conversões"? (b) **"Conversões otimizadas / método da tag"** LIGADO? (senão o Enhanced Conversions que já enviamos é ignorado) (c) rodar o **Google Tag Assistant** na home + um cadastro de teste p/ ver o `conversion` disparar com o rótulo novo.
3. **Acompanhar o ciclo pós-fix:** confirmar a ingestão de 31/07+01/08 em `marketing_metricas_dia` (parou em 30/07) e observar se, com rótulo novo + mais volume, as conversões passam a registrar.
## ✅ COMEÇAR AQUI (30/07 — sessão 20: ritual completo + pareceres presos destravados + auditoria de cobertura do tracker)
> Branch `claude/handoff-rotina-inicio-ta1z4a`. `npm run build` OK. `auditoria_seguranca()` = **0/0** ao final.

**A. RITUAL DE INÍCIO (resultados).** (1) Saúde: 31.452 ativos / 25.041 atualizados 24h; deploys READY; sem erro runtime relevante. (2) **Segurança: 1 atenção corrigida** — `admin_funil_captacao` (RPC da sessão 19) estava executável por `anon` (grant default); revoke aplicado no banco + migração `admin_funil_captacao_revogar_anon.sql`; auditoria de volta a 0/0. (3) **Cluster de leiloeiros parado desde 27/07**: o cron diário (sessão 18) só entrou na `main` em 29/07 11:33 UTC — DEPOIS da janela de 10h — e o run de 30/07 atrasou (delay normal do GitHub). Disparado manualmente 30/07 ~11:25 UTC. (4) **Métricas Google Ads: ciclo AUTO 100% validado** — `marketing_metricas_dia` recebeu 29/07 (R$ 24,55 / 9 cliques / 103 impr.) via Google Ads Script; anúncio já veicula. (5) PECINI gravou na seg 27/07 (não está mais em dry-run; 41 ativos).

**B. PARECERES VAZIOS (pergunta do dono; ele viu `relatorio_parecer_vazio` no 360 — ou seja, o rastreio da sessão 14 FUNCIONOU).** Causa: madrugada 28→29/07 a API Anthropic ficou instável (529/abort); o passe "parecer vazio" do `regenerar-relatorios-cron` tinha teto de **2 tentativas** e ambas caíram DENTRO da janela ruim → **4 relatórios presos** (Carapicuíba `82506bdc`, Alagoinhas, Lauro de Freitas, Praia Grande), todos `cota_estornada=true` (cota devolvida ✓). **Remediação:** `regen_tentativas` resetado nos 4 → cron das 12h UTC de 30/07 regenera. **Raiz:** `MAX_PARECER` 2→**4** + **espaçamento ≥5h** entre tentativas (`regen_em`) — nunca mais queima todas na mesma janela ruim. Verificação: `select count(*) from analises_mercado where status='concluida' and length(coalesce(result->>'parecer',''))=0;` → 0 = limpo. ⚠️ Lembrete: `parecer` fica em `result->>'parecer'` (RAIZ), não em `result->'mercado'`.

**C. AUDITORIA DE COBERTURA DO TRACKER (item pendente da sessão 19) — feita com 3 agentes (pré-login · logado · backend/admin). CORRIGIDO nesta sessão (pacote mínimo de alto retorno):**
1. `tracker.js`: flush SEM token **não descarta mais** a fila (re-enfileira, teto 100 → jornada pré-login é enviada quando o usuário loga na mesma sessão SPA); contador não é mais queimado por eventos descartados; eventos levam `ts` da AÇÃO; novos listeners globais de **`submit`** (pega ENTER em form, que não gera click) e **`change`** (select/filtros/arquivo/checkbox — rótulo SEM value, anti-PII).
2. `apiCall.js`: falha de REDE agora registra `api_falha_rede` antes de re-lançar (antes o catch do chamador engolia); regex do peek ganhou `indice-consulta` + detecção de `mapeado:false` ("região não mapeada" = análogo do relatório vazio).
3. `pdfImprimir.js`: `pdf_gerado`/`pdf_falha` no choke point — a ENTREGA dos 6 geradores de PDF aparece no 360, não só o clique.
4. `api/track.js`: allowlist ampliada p/ os novos tipos; `criado_em` = hora da AÇÃO (ts do cliente, validado ±janela) e não da ingestão.
5. `api/_audit.js`: `auditLog` agora RETORNA a promise (call-sites com `await` aguardavam `undefined` → em serverless o insert podia se perder) + loga a própria falha.

**D. BACKLOG PRIORIZADO da auditoria (registrado, NÃO feito — próximas sessões):**
1. **Ingestão anônima com `sessao_id`** (pré-login de verdade): `eventos_atividade` já aceita `user_id` null; aceitar sem token + UUID de sessão + costura retroativa no SIGNED_IN. É o que fecha a diretriz do dono ponta a ponta.
2. **`audit_logs` no 360**: tabela existe, tem IP e sucesso/falha, e NINGUÉM lê (nem RPC nem card). ~30 linhas.
3. **Modo suporte (impersonate) sem trilha**: 100% client-side; eventos do suporte caem no 360 do ADMIN sem marca. Endpoint de início/fim + marcar eventos.
4. **`atribuir-arremate` sem auditoria** (promove role + vencimento +12m sem registrar QUEM); idem 12 mutações do Admin direto no PostgREST (planos, role, bloqueio, signatário, excluir contrato, gastos mkt, toggles curso/ebook) — opção barata: triggers AFTER em `audit_logs` com `auth.uid()`.
5. **Funil ContratoLink**: cobrir link inválido/expirado/reaberto, etapa `tipo`, bloqueios client-side (KYC/foto grande/termos) e mover `trackErro` p/ antes das validações 400/404; sucesso não pode depender de `criadorEmail`. Replicar `rastrear` em TestemunhaLink/ConviteLeiloeiro/Convite/AtivarVendedor.
6. **Login.jsx**: falha de login/cadastro/recuperação/reenvio = ZERO rastro hoje (só sucesso). Com o item C.1, `registrarEvento` nesses ramos já chega ao banco pós-login; anônimo de verdade precisa do backlog 1.
7. Versionar DDL de `atividade_log`/`registrar_atividade`/RPCs (hoje só no banco; "90 dias" não é auditável no repo); retenção do `audit_logs` (sugestão 5 anos); rate-limit em `/api/track` (teto hoje é só client-side); `auto-contrato.js` importa `auditLog` e nunca chama.

**E2. TARDE DE 30/07 (continuação da sessão 20):**
1. **Termos v3.0 + re-aceite EM PRODUÇÃO**: registro central por produto (`utils/termos.js`) com termo amplo de 11-12 cláusulas; aceite grava versão POR FAMÍLIA; compra de curso/ebook ganhou aceite obrigatório (não tinha NENHUM); hash SHA-256 por trigger em `aceites_plano` + comprovante imprimível no modal Auditoria (que agora mostra cadastro/LGPD e adesão); popup de RE-ACEITE no login + trava na geração de relatórios (`TermosAtualizadosModal` + gate no `AnalisesContext`). Jurídico do dono revisa hoje → ressalvas viram v3.1.
2. **Geo on-demand corrigido na RAIZ** (`_geo.js`): `sanearLocalizacao()` (endereço-lixo fora + endereço/bairro extraídos do TÍTULO) + `cepConfereCidade()` (CEP de cidade errada é ignorado — caso real: imóvel de Osasco com CEP do escritório do leiloeiro na capital). Vale p/ on-demand e crons.
3. **PARECER VAZIO — 2ª causa-raiz achada**: além do teto de tentativas (corrigido de manhã), a chamada de REDAÇÃO tinha timeout fixo de **60s** — parecer de até 8k tokens em API lenta estourava e as 2 tentativas morriam em 'aborted' com 4 min de orçamento sobrando (3 casos em 30/07). Teto subiu p/ 150s (guard restante-12s mantido). Os 3 presos re-tentam no cron das 18h UTC (espaçamento 5h ok).
4. **CAPTURA — achados do run diário de 30/07** (2 runs concorrentes, log completo analisado):
   - **ZUK**: 540 cards → 537 mapeados (só 3 sem preço descartados) e 596 no run seguinte → a variação é do PRÓPRIO site (listagem cresce entre runs). A "falta de imóveis" era o cluster parado 27-30/07 (cron diário só entrou na main em 29/07 após a janela). Plataforma espelha a listagem `/leilao-de-imoveis`; se o dono apontar lote específico ausente, verificar se está em seção fora dela (ex.: venda direta).
   - **BIASI ⚠️**: estratégia 1 (listagem agregada `?pagina`) retornou **0** — a premissa REGREDIU (site mudou); o fallback home→leilões segura (135/206, acima do piso) mas é o caminho rotativo/instável. PENDENTE: recon vivo da listagem (Actions `debug-leiloeiros.yml`) p/ reencontrar a URL determinística + atualizar `leiloeiro_conhecimento`.
   - **PESTANA ⚠️ REGRESSÃO REAL**: 385 → 117 (o próprio scraper alertou; 294 desativados; 28/42 leilões com imóveis). Investigar estrutura viva `pestanaleiloes.com.br` (API /api/v2 leilão→lotes) — pode ser acervo real encerrado OU premissa quebrada. Monitor alerta por e-mail.
5. **RUNNER RESIDENCIAL — status confirmado**: NUNCA rodou (coleta_cliente.ultima_em vazio em SOLEON/GESTAO/RJ/VLANCE) e os gates estão **ativo=false** (bloqueados; VLANCE teve 1 tentativa client-side 27/07 sem conclusão). Fontes pagas seguem em Bright Data. Dono está montando WSL no Windows (passo a passo entregue no chat); ao avisar: **reativar os gates** (`update coleta_cliente set ativo=true where fonte in ('SOLEON','GESTAO','RJ','VLANCE');`), acompanhar 1ª rodada e então desligar crons pagos da CI.

**E3. FIM DE TARDE 30/07 — anexos duplicados (7x "Edital"), avaliação ausente e mercadológico lendo o edital:**
1. **BUG "7x Edital" (confirmado no lote GL 27685 Santana de Parnaíba, id b444a949)**: os 7 anexos eram o MESMO PDF com querystring VOLÁTIL (cache-buster `?v=` do CDN GrupoLance; na ZUK é assinatura `?Expires/&Signature` + casos com `&amp;` não-decodificado e até `javascript:_gt(` gravado como edital) — a união diária do scraper comparava URL COMPLETA e somava +1 "Edital" por rodada. Correção na RAIZ: **`chaveDocCanonica()`** em `api/_doc-scan.js` (path com extensão de doc → host+path; senão remove só params voláteis conhecidos) usada no dedup do scan, na união do `scraper-puppeteer` (novo SUBSTITUI variante velha = link vivo), no `jaTem` da revisita ZUK e no `enriquecer-lote` (que antes SUBSTITUÍA o jsonb inteiro — agora une). `ehDocumento` rejeita esquema não-http; `&amp;` decodificado no push; cap de 3 por tipo nomeado no scan. EXIBIÇÃO (`Analise.jsx`): dedup por chave canônica (espelho em `utils/docUrl.js`) + rótulos numerados "Edital (2)" p/ docs distintos legítimos (1ª/2ª praça, retificação). **BACKFILL APLICADO em produção** (`anexos_dedup_url_volatil.sql`): 839 imóveis, 2.391 entradas removidas; verificação pós = 0 duplicatas; lote de Santana ficou com 1 edital. Monitorar 1-2 ciclos do scraper (query: anexos tipo edital >3 por lote).
2. **AVALIAÇÃO "Não informada" — loop fechado**: o servidor até recuperava a avaliação do edital (`garantirValores`) e corrigia o BANCO, mas o valor NUNCA voltava à tela (result sem o campo; snapshot do mount). Agora `result.valorAvaliacao` (avalDb pós-travas) + o front preenche o card SÓ quando vazio (nunca sobrescreve digitação). Duas correções de acervo juntas: (a) `enriquecerDocumentosLote` do scraper agora EXTRAI a avaliação do detalhe renderizado (GL/SODRE/BIASI/VIP/SUPORTE não trazem no card; guard >mín e ≤10x mín) e visita também lotes sem avaliação; (b) o upsert diário PRESERVA `valor_avaliacao` já confirmado quando o scrape do dia vem com 0 (antes ZERAVA o valor recuperado on-demand — desconto/score recalculados junto).
3. **MERCADOLÓGICO LÊ O EDITAL (pedido do dono: endereço/forma de pagamento/melhor praça)** — v1 DETERMINÍSTICA em produção: novo `api/_edital-extrato.js` (fetch direto + pdf-parse + regex, SEM IA/Bright Data; PDF escaneado fica p/ o documental) extrai **praças (nº/valor/data), forma de pagamento (frases originais) e avaliação**; disparado SEM await logo após `garantirValores` (corre em paralelo com a busca de mercado, colhido com race de 3s = custo de tempo ~zero). Uso: completa colunas VAZIAS (valor_minimo_2/datas → `escolherPraca` enxerga a 2ª praça real), cobre avaliação ausente (mesmas travas), bloco "CONDIÇÕES LIDAS NO EDITAL" no prompt do parecer, `mercado.condicoesEdital` no result + card azul "Condições lidas no edital" na tela. **Anti-edital-de-outro-lote**: praça plausível vs lance (0,3x-3,4x) e avaliação 0,5x-2x vs a do card; divergiu → descarta + anomalia `edital_divergente`. Validado com edital sintético GL (praças/datas/pagamento/avaliação ok). PENDENTES v2: cache em coluna (`edital_extrato`) p/ regenerações, fallback IA p/ escaneado, endereço da matrícula como fonte de verdade (hoje só quando falta, via `garantirEnderecoDoc`), seção no PDF exportado. NOTA: proxy do ambiente remoto bloqueia CDNs de leiloeiro — testar extração real só em produção (regerar o mercadológico do lote de Santana e conferir card+parecer).
4. **PENDENTE (achado, não corrigido)**: `imovel_anexos` (tabela relacional) sem índice único — `upload-anexo.js:19` comenta um "índice único parcial (imovel_id,tipo)" que NÃO existe nas migrações; há 831 imóveis com tipo='outro' duplicado. Dedupe + índice exigem cuidado (linhas apontam p/ Storage) — fazer em migração própria com revisão.

**E4. RUNNER RESIDENCIAL VALIDADO 4/4 (30/07 ~15-16h BRT) — Bright Data virou REDE DE SEGURANÇA:**
1. **1ª coleta residencial da história**: SOLEON (CALIL 40 + VEGAS 40 + TORRES3 3), VLANCE (29), GESTAO (188, cluster 100% Cloudflare) e RJ (5 novos — mata o alerta "RJLEILOES parado 9d" do monitor) — tudo do IP de casa do dono (WSL/Ubuntu no Windows), custo zero.
2. **Bugs corrigidos no caminho** (só apareceram no 1º uso real): (a) guard do `main()` de GESTAO/RJ abortava sem token Bright Data ANTES de checar `*_HEADLESS=1` (o `bd()` já sabia usar Chromium); (b) `fetch-residencial.mjs` engolia o erro do launch — agora loga a causa + `scripts/teste-chromium.mjs` diagnostica com 1 comando; (c) WSL precisava de `libnspr4 libnss3 libasound2t64` (instaladas na máquina do dono).
3. **Desenho da rotina (decisão do dono)**: NADA de desligar crons pagos — eles viraram rede de segurança: `scripts/coleta-recente.mjs` + freio nos workflows SOLEON/GESTAO/RJ (schedule pula se `coleta_cliente.ultima_em` < 7 dias; dispatch manual ignora; VLANCE já tinha `--pular-se-fresco`). Marco entre coletas de casa: **72h** (`coleta_cliente.intervalo_horas`, era 84). Windows dispara "ao ligar + a cada 6h ligado" via Agendador de Tarefas (comandos passados ao dono) — o portão no banco decide se é a hora; flexível a qualquer horário.
4. Gates ativos e concluídos nas 4 fontes (ultima_em 30/07 ~18:2x-18:5x UTC). Chave service_role apareceu num print do chat (risco baixo, conversa privada) — se o dono quiser, rotacionar depois com atualização casada Vercel+CI.

**E5. NOITE 30/07 — FUNIL PÚBLICO (sem conta) no Cliente 360 + ofensivas em curso:**
1. **Links de venda invisíveis — causa-raiz corrigida**: `/api/track` DESCARTAVA visitante
   anônimo ("só usuários logados") e o `tracker.js` retinha a fila sem sessão → quem clicava
   nos links `/p/curso|/p/ebook|/planos` e não cadastrava sumia sem rastro (dono: "mandei
   links e ninguém cadastrou"). Agora: tracker envia SEM sessão com `anon_id` persistente
   (localStorage, costura pré-cadastro→usuário); `/api/track` aceita anônimo APENAS em rotas
   públicas (regex), tipos restritos (pageview/click/submit/api_erro/api_falha_rede), lote ≤12,
   role='anonimo'; coluna `eventos_atividade.anon_id` + índice parcial (migração
   `eventos_atividade_funil_publico.sql`, APLICADA); RPC `admin_360_estatisticas` ganhou a chave
   aditiva `funil_publico` (visitantes/pageviews/erros 7d, por rota, últimos 20); card novo
   "Funil público (sem conta)" no Cliente360. Falhas de LOGIN/CADASTRO/recuperação/OAuth/reenvio
   agora deixam rastro (`registrarEvento('api_erro', login_falha|cadastro_falha|…)` — fecha o
   gap E1.6). Auditoria de segurança pós-mudança: 0/0. Retenção 30d inalterada.
2. **Runner residencial JÁ monitorado** (verificado): seção B2 do `monitor-fontes-cron` alerta
   "coleta grátis parada" a 1,5× o intervalo do gate (72h → alarma ~4,5d, antes do fallback BD
   de 7d); PECINI entrou automático ao ganhar linha em `coleta_cliente`.
3. **Ofensivas em curso**: Round 34 (BIASI ?pagina=0 · PESTANA 385→117 · SODRE campos)
   capturado em `debug_fetch` (fonte ofv34-%) e em análise; Round 35 disparado (homes dos 16
   leiloeiros 0-acervo do backlog TRT-15, fonte ofv35-%). Pareceres vazios: 2 restantes
   (Carapicuíba, Praia Grande — pré-fix), cron 6/6h fecha nas janelas 00h/06h UTC.

**E6. NOITE 30/07 — ROUND 35 EM PRODUÇÃO: 2 leiloeiros novos no ar (TOTAL + SATO), 1 armado (CREPALDI):**
1. **TOTALLEILOES ✅ VIVO** — via SUPERBID por loja (storeId 16091) no `scraper-puppeteer.mjs`
   (`scraperSuperbidNet {stores}`): **8 imóveis**, qualidade 100% (uf/valor/link/foto). O resto
   das 65 ofertas da loja é veículo (filtro client-side no mapeamento — a offer-query da loja
   NÃO aceita filtro de productType). **Lição cara (1º teste voltou 0 em silêncio):** o modo
   loja EXIGE espelhar a URL do site white-label — `portalId=[2,15]` + `requestOrigin=store`.
   `fonte_saude` marca "degradado total 8<10" — é acervo real pequeno, não regressão.
2. **CREPALDI 🟡 ARMADO** — mesma config (storeId 16139), loja HOJE sem ofertas abertas
   (recon do Round 35 já previa "0 hoje, deixa armado"). `fonte_saude` vai acusar "falhou
   total 0" até o Crepaldi publicar — esperado; quando publicar, entra sozinho.
3. **SATO ✅ VIVO** — `scripts/scraper-sato.mjs` + workflow `scraper-sato.yml` (dispatch, CI
   grátis — API pública aceita datacenter, SEM Bright Data). Dry-run validou as 3 pendências:
   paginação real = 9 págs/119 leilões (bem menos que os ~300 estimados), rota `/leilao/{id}`
   válida, egress OK. Triagem do run: 30 imóveis lote-único prontos · 50 não-imóvel · 38
   multi-lote (aguardam recon do endpoint de detalhe p/ extrair lotes individuais) · 1 terminal.
   Run live (dryrun=0) disparado na sequência — conferir `select count(*) from imoveis_leilao
   where fonte='SATO' and ativo;` (~30) e o card no app.
4. **PENDENTES do Round 35** (ordem do plano, tarefa #11): recon do detalhe multi-lote do SATO
   + decidir cron do `scraper-sato.yml` (hoje dispatch-only) · tenant SUPORTE `gustavoreis`
   (cuidado com eventos EXTERNOS Comprei/PGFN) · cluster PostgREST `picelli`+`shiokawa` (1
   scraper genérico, centenas de lotes no picelli) · e-confianca via origem e-leiloes.com.br.

**E7. NOITE 30/07 — FLUXO DA ARREMATAÇÃO organizado (spec do dono) + 4 bugs de produção:**
Regras do dono implementadas: (1) Pro assina → relatórios → assessoria a qualquer momento
(exige Pro); ao virar assessorado MANTÉM benefícios do Pro (cotas já eram idênticas — auditado);
mensalidade do Pro CONTINUA indefinidamente durante a assessoria; (2) assessoria é INDIVIDUAL
(1 arrematação/contrato) — sinalizou "Arrematei" → libera contratar a próxima (antes de vender/
tomar posse); Club não contrata avulsa (ilimitada inclusa).
1. **Guarda anti-flip de role (bug crítico)**: pagamento NUNCA rebaixa o role. `roleAposPagamento()`
   em `api/_webhook-core.js` (escada explorador<top2<assessorado<clube; papéis de equipe intocáveis)
   aplicada em `ativarPlanoDireto` + `processarConfirmado` + espelho em `mp.js ativarRoleInline` +
   `reconciliar-assinaturas-cron` (que ainda: NÃO rebaixa assessorado quando o preapproval 12×
   termina — assessoria encerra pela POSSE, não pelo gateway). Antes: a renovação mensal do Pro
   gravava role='top2' e o assessorado perdia o acesso ao Caso/jurídico no meio do contrato.
2. **Atribuição manual sem efeitos colaterais** (`atribuir-arremate.js`): NÃO promove mais para
   assessorado nem seta plano_vencimento — cria caso+âncora+ledger e PRONTO; role/cotas do usuário
   ficam como estão (explorador mantém 3/0, Pro mantém 10/10/3). Acesso ao acompanhamento = vínculo
   ao caso (RLS + "Meus acompanhamentos"). Admin.jsx não força mais role local.
3. **Pós-posse volta ao PLANO BASE** (`marcar-posse.js`): último caso encerrado → se há recorrência
   do Pro ativa (espelho `mp_assinaturas` OU Asaas subscriptions ACTIVE ~49,90/99,90 MONTHLY ou
   ~449,90 YEARLY) volta a `top2`; só cai a explorador sem recorrência nenhuma. Outros casos em
   aberto seguem mantendo assessorado (lógica que já existia).
4. **1 assessoria por vez** — novo `api/assessoria-status.js` (podeContratar/motivo): última
   `contratos_link` de assessoria viva sem arremate sinalizado depois (arrematados.created_at OU
   casos.arrematado_em > contrato.criado_em) → bloqueia; Checkout ganhou a tela "assessoria em
   andamento" (e "inclusa no Club"); Planos: card assessoria p/ assessorado virou
   **"Contratar nova arrematação →"** (era botão morto "Seu plano atual") e p/ Club
   "Incluído no seu plano" (era "Fazer downgrade" — errado).
5. **Preço do plano → mensalidade SEGUINTE (fim do grandfather de preço, regra nova)**: RPC
   `aplicar_precos_agendados` agora devolve de/para (migração `aplicar_precos_agendados_retorna_
   mudancas.sql`, APLICADA) e o cron `aplicar-precos-agendados-cron` propaga aos gateways: Asaas
   PUT value (updatePendingPayments=false) casando ciclo+valor antigo EXATO; MP PUT auto_recurring
   casando external_reference+valor antigo. Assessoria (12× fechado) fora; legado 99,90 NÃO é
   tocado (só muda quem estava no preço que o admin alterou). ⚠️ Fluxo do admin: usar o PREÇO
   AGENDADO (Cobrança passo 8) — mudança direta na coluna não dispara propagação.
6. **Bugs de produção corrigidos no caminho**: (a) `HomeCliente` "Meus acompanhamentos" NUNCA
   renderizava (coluna `criado_em` inexistente em casos → 42703 silencioso; é `created_at`) —
   exatamente a tela do arremate atribuído; (b) `api/arrematacoes.js equipeDoCaso` mesma coluna →
   arrematação nascia sem analista/advogado e o rateio de honorários saía sem equipe; (c)
   `IndiceConsulta PODE_GERAR` sem as variantes `_anual` (pagantes anuais não viam o botão de
   gerar Índice); (d) `garantia-cancelar` lia `planos_config.valor` (inexistente; é `preco`) —
   valor_ref do reembolso sempre null.
7. **Pendentes/decisões em aberto**: repo tem 2 definições conflitantes de `limite_ia` (banco está
   na correta 3/10/3 — conferido ao vivo; consolidar arquivos) e de `registrar_preco_contratado`
   (v2 write-only, ignora assessorado/_anual); `Analise.jsx` "Arrematei" sem o gate visual dos 3
   relatórios (mitigado: só aparece dentro do Parecer Final, que exige laudo); enforcement do
   "1 por vez" é no cliente (gate de UI + status do servidor) — o pagamento inline em si não é
   bloqueado server-side (aceitável: contrato registra a operação; endurecer depois se preciso).

**E8. NOITE 30/07 — teste do dono no modo suporte: 4 achados corrigidos:**
1. **Cota 15/15/5 indevida (Matheus Barros + Rafael)**: NÃO era orientação — efeito colateral em
   cadeia: atribuição manual promovia a 'assessorado' (comportamento antigo, removido no E7) e a
   migração do grandfather (28/07) marcou `plano_legado=true` em TODO role pagante daquele dia,
   incluindo os dois (0 aceites, nunca pagaram, 1 caso cada). CORRIGIDO no banco: ambos voltaram a
   explorador sem legado (casos/relatórios preservados; query com guardas — só afetou quem nunca
   teve aceite/pagamento). Neuma e Alessandra (pagantes reais) mantêm o grandfather.
2. **Modo suporte com identidade do CLIENTE**: Header (nome/avatar/etiqueta de plano do menu) e
   saudação da Home agora usam o usuário visualizado — o banner laranja é quem sinaliza a equipe.
   O "Ver como" já entrava pela Home (/) respeitando o plano do cliente.
3. **Recarga de crédito FECHADA (passo 7 do motor que faltava)**: a Análise mandava "Comprar
   créditos" → /creditos, que não tinha compra; `creditar_credito` existia sem chamador. Agora:
   botão "Adicionar créditos" no card de saldo (presets 50/100/250/500 + valor livre ≥R$20) →
   `PagamentoServico` (PIX/cartão) → novo `api/creditos-recarga.js` confirma o pagamento NO MP
   (approved + dono por metadata.user_id OU CPF do pagador + dedup por referencia mp_{id}) e
   credita o valor REAL recebido via RPC. Suporte não vê o botão (não paga pelo cliente).
   ⚠️ herda a limitação PRÉ-EXISTENTE do PIX estático: `mp-verificar-pix` exige metadata.user_id
   p/ confirmar, e transferência PIX direta não carrega metadata — o caminho cartão funciona
   ponta a ponta; o PIX estático pode não autoconfirmar (mesma limitação da assessoria; a
   recarga tem fallback: CPF do pagador no `creditos-recarga`). Revisar o PIX estático num round.
4. **Meu Portfólio → /arrematados** (a tela real "Meus Arrematados"; /painel é a descartada) +
   empty state novo: "Você ainda não fez nenhuma arrematação" com a mensagem de acolhimento
   (BidPro auxilia a encontrar a oportunidade certa) + CTA "Buscar oportunidades" e "Já
   arrematei — registrar". NOTA: o card "Agendar com o time" ainda aponta p/ /painel — decidir
   destino (Caso? Análises?) com o dono.

**E9. NOITE 30→31/07 — AUDITORIA + BUG BOUNTY COMPLETOS (4 agentes) + cobertura do 360:**

**Cliente 360 — capturou o incidente do gerar-analise?** SIM. Os 500 viraram `api_erro`
com rota, endpoint (`alvo`), status e HORA (23 eventos; gerar-analise 500 só do admin —
0 clientes afetados; enriquecer-lote 500 tocou 2 clientes). MELHORIA aplicada
(`AnalisesContext.jsx`): os 3 iniciadores agora emitem `api_erro` com o `imovelId` no
detalhe nos 3 ramos (erro_corpo / resposta_vazia / falha_ou_500) — antes o 500-sem-corpo
era pego só na camada de transporte (sem o imóvel). PENDENTE (baixa): o rebaixamento
`gerando`→`erro` por stale ainda não emite evento.

**SEGURANÇA (crítico corrigido no ato):**
1. 🔴 **VAZAMENTO DE PII — `saldo_usuarios` (view SECURITY DEFINER) legível por `anon`**:
   expunha nome + **chave PIX** + saldo de TODOS os usuários, sem filtro por dono, ignorando
   RLS. Qualquer um (sem login) baixava `GET /rest/v1/saldo_usuarios`. Só o backend usa a
   view. CORRIGIDO: `security_invoker=on` + revoke anon/authenticated (migração aplicada).
2. 🔴 **`creditos-recarga.js` (feature nova) — duplicação de valor**: creditava QUALQUER
   pagamento aprovado do usuário (assessoria R$4.800, mensalidade…) como recarga — pagava o
   serviço E ganhava o valor em saldo. CORRIGIDO: exige `metadata.proposito='recarga'` (posto
   no mp-checkout), removido o fallback por CPF; recarga forçada a CARTÃO (`soCartao`), PIX
   estático não carrega o marcador.
3. 🟠 **`creditar_credito` — idempotência TOCTOU**: SELECT-then-INSERT sem trava → corrida
   creditava N×. CORRIGIDO: índice único parcial em `credito_lancamentos.referencia` +
   ON CONFLICT na RPC (migração aplicada).
4. **Auditor cego a isto**: `auditoria_seguranca()` não cobria views definer com PII — foi
   por isso que #1 passou 0/0. ADICIONADO o check `view_definer_pii` (migração aplicada);
   auditoria segue 0/0 (agora de verdade). Advisor do Supabase: 1 ERROR (era o saldo_usuarios,
   resolvido) + 67 WARN em sua maioria intencionais (funções definer com grant deliberado);
   backlog defensivo de baixa prioridade: 8 funções com search_path mutável, `sdr_leads` INSERT
   público (form de lead — verificar), 2 buckets públicos com listing amplo.
5. 🟡 **SSRF cego** em `_edital-extrato`/`enriquecer-lote` (redirect:follow revalida só a URL
   inicial). Gated por URL vir do banco; anota como defesa-em-profundidade (usar redirect:manual
   + revalidar hop). NÃO corrigido — follow-up.

**LÓGICA DO FLUXO DE ARREMATAÇÃO (bugs que causavam perda de acesso pago — corrigidos):**
- **BUG 1** `mp.js ativarRoleInline`: não replicava a recuperação de inadimplência e resetava
  a âncora dos 7 dias → assessorado suspenso que atualizava o cartão virava top2 permanente.
  CORRIGIDO (escadaSobe + candidato de recuperação + plano_pago_em só na 1ª vez).
- **BUG 2** `_webhook-core processarConfirmado`: pagamento de serviço limpava `inadimplente_desde`
  sem restaurar role → `role_anterior` órfão → recuperação futura falhava. CORRIGIDO (só limpa a
  flag com plano mapeado).
- **BUG 5** `marcar-posse`: Pro ANUAL é pagamento avulso (sem recorrência) → pós-posse derrubava
  a explorador quem tinha Pro anual pago. CORRIGIDO (âncora plano_ciclo='anual' + plano_pago_em
  <13m). Follow-up: o path de ativação do Pro anual via MP avulso deveria setar plano_ciclo='anual'.
- **BUG 6** `marcar-posse`: contava caso de mera análise como "assessoria em andamento" → mantinha
  assessorado para sempre. CORRIGIDO (filtro arrematado_em not null). + `MANTEM_PLANO` ganhou 'suporte'.
- **BUG 7** `garantia-cancelar`: não cancelava o `contratos_link` → o gate "1 assessoria por vez"
  travava a recontratação para sempre. CORRIGIDO (cancela contratos vivos no reembolso).
- **BUG 8** `assessoria-status`: contrato emitido pela EQUIPE tem criado_por=staff → gate não via a
  assessoria e liberava 2ª em duplicidade. CORRIGIDO (casa criado_por OU assinante_email + fallback
  por caso arrematado sem posse).

**2ª rodada (31/07) — pré-existentes CORRIGIDOS:**
- **BUG 4** ✅ colisão de `mp_id`: era usado como customer id (buscarCliente) E como preapproval
  id (ativarRoleInline) — os dois writers brigavam e o cancelamento fazia PUT /preapproval/{customer}
  → 404, recorrência seguia cobrando. CORRIGIDO: coluna dedicada `perfis.mp_preapproval_id`
  (migração aplicada); ativarRoleInline grava lá (mp_id fica só para customer id); garantia-cancelar
  cancela pela BUSCA ESCOPADA (external_reference userId) + candidatos do perfil (cobre legados).
- **BUG 9** ✅ `reconciliar-assinaturas-cron` só olhava o MP → rebaixava em loop diário quem
  re-assinou no Asaas ou tem Pro anual. CORRIGIDO: antes de suspender, checa `proAnualVigente()`
  (âncora plano_ciclo='anual') e `temAssinaturaAsaasAtiva()` (subscription ACTIVE do Asaas).
- **Regressão (borda)** ✅ processarConfirmado: pagamento de serviço SEM customer id montava PATCH
  vazio — agora remove chaves undefined e pula o update se vazio.

**AINDA PENDENTE (dormant/estrutural — NÃO corrigido, exige desenho):**
- **BUG 3** pagamento em SPLIT (`mp.js criarPreferencia` com `split`): cada parte cai em
  processarConfirmado e mapearPlano(valorParcial)=null → paga e não ativa. **DORMANT: nenhum front
  passa `split` hoje.** NÃO half-fixar (ativar na 1ª parcela = dar plano por pagamento parcial é
  pior). Correção correta antes de habilitar split: LEDGER que soma as partes por userId|planoKey e
  só ativa quando o total é atingido (usar metadata.splitIndex/splitTotal, já gravados).
- **Gate de assessoria só na UI**: mp.js/asaas.js não repetem a regra "1 por vez" ao criar a
  cobrança (fail-open de rede aceitável). Planos.jsx: CTA "Contratar nova arrematação" não consulta
  /api/assessoria-status (leva ao beco — direção segura). Endurecer quando priorizar.
- **SSRF cego** em _edital-extrato/enriquecer-lote (redirect:follow revalida só a URL inicial) —
  gated por URL vir do banco; usar redirect:manual + revalidar cada hop.

**E10. 31/07 — sugestões pendentes IMPLEMENTADAS + fundação do ciclo mensal/anual:**
1. ✅ **Gate de assessoria no SERVIDOR** (era só na tela): regra "1 assessoria por arrematação"
   extraída para `api/_assessoria.js` (`podeContratarAssessoria`), fonte ÚNICA usada por
   `assessoria-status.js` (agora um wrapper fino) E pelos endpoints de pagamento. `mp.js` bloqueia
   (409 `assessoria_bloqueada`) `criar_preferencia`/`criar_assinatura`/`_transparente` quando
   `plano` começa com `assessorado` e o gate reprova. `asaas.js criar_assinatura` idem (409, com
   fail-open de infra). Fonte única nos dois gateways + na tela.
2. ✅ **SSRF fechado nos leitores de documento**: `fetchExternoSeguro()` em `_allowed-hosts.js`
   segue redirects com `redirect:'manual'` revalidando CADA hop com `hostExternoSeguro` (antes o
   `redirect:'follow'` seguia um 302 externo→169.254.169.254/10.x/localhost sem checar). Ligado em
   `_edital-extrato.js` e `enriquecer-lote.js` (2 fetchers). `baixar-doc.js`/`fetch-url.js` usam a
   allowlist ESTRITA + auth (risco baixo) — hardening opcional futuro.
3. ✅ **Fundação do CICLO (mensal/anual)**: `mapearPlano` agora devolve `ciclo` ('mensal'|'anual';
   449,90→anual) e `processarConfirmado` grava `plano_ciclo` + `plano_vencimento`(+12m no anual).
   Isso **destrava a proteção anti-rebaixamento do anual** que eu já havia escrito (proAnualVigente
   em reconciliar-cron + marcar-posse) e que estava ÓRFÃ (o valor 'anual' nunca era gravado).

**⚠️ MENSAL↔ANUAL — build maior PENDENTE (dinheiro-crítico, staged p/ sessão focada):** hoje o
anual (`top2_anual`) é **pagamento único avulso que NÃO renova** (confirmado; `PENDENCIAS_PAGAMENTOS.md`).
As 3 regras do dono (mensal→anual contrata 12m; anual→mensal vira mensalidade ao fim; anual sem
mudança renova 12m) exigem reescrever a criação de cobrança nos DOIS gateways — NÃO fazer no meio de
outras mudanças de pagamento. Plano preciso (pontos do recon):
- **Anual recorrente**: transformar `top2_anual` em preapproval MP `frequency:12,frequency_type:'months'`
  (hoje travado em months=1: `mp.js:294,341`; config `recorrente:false` em `:145`) + subscription Asaas
  `cycle:'YEARLY'` (asaas.js só constrói `_vista`, nunca `_anual` — `:55-62`,`:196`). Com preapproval
  recorrente, a **renovação (regra c) passa a ser nativa** do gateway.
- **mensal→anual (regra a)**: `Checkout.jsx:586` `ehMudanca` precisa considerar `modalidade` (hoje
  compara só role×planoKey base → troca de ciclo nunca vira mudança); `mudarPlano` (`:712`) manda
  `planoKey` base, tem de mandar `planoApiKey` (`top2_anual`); ramo que CANCELA a recorrência mensal
  (`cancelarAssinaturasAnteriores`) e cria a anual.
- **anual→mensal ao fim dos 12m (regra b)**: precisa de MUDANÇA AGENDADA (não existe). Nova coluna
  `perfis.ciclo_agendado` ('mensal'|null) + cron (estender `reconciliar-assinaturas-cron`) que, ao passar
  `plano_vencimento` de um `plano_ciclo='anual'` com `ciclo_agendado='mensal'`, cancela a anual e cria a
  mensal recorrente. A âncora `plano_vencimento`/`plano_ciclo` já passa a ser gravada (fundação acima).
- **Higiene**: unificar a cópia contraditória no Checkout (`:987` "renova a cada 12 meses" ×
  `:1300/:1339` "não há renovação automática") conforme a decisão final.

**E11. 31/07 (ultracode/Fable 5) — PLANO ANUAL RECORRENTE + troca de ciclo mensal↔anual (3 regras):**
Guiado por design workflow (5 agentes: viabilidade MP/Asaas + fluxos + crítica adversarial +
síntese) na ORDEM SEGURA. Commits `40cf355` (backend) · `b1a7420` (front) · `e921095` (P0.2).
- **Regra (a) mensal→anual**: o toggle agora dispara troca REAL — `Checkout.jsx` detecta
  `ehTrocaCiclo` (sem tocar `ehMudanca`, que compara base); cancela a recorrência mensal e cria
  a anual recorrente, cobrando já (via gerarLink → criar_assinatura).
- **Regra (b) anual→mensal**: novo `api/agendar-ciclo.js` (server-autoritativo, anti-IDOR) marca
  `perfis.ciclo_agendado='mensal'` e cancela a auto-renovação anual nos 2 gateways; acesso segue
  até `plano_vencimento` (guarda `anual_vigente` em suspenderPlanoDireto). Materializa no
  vencimento (loop no reconciliar-cron; a mensal é consent-based — reautorização por e-mail).
- **Regra (c) anual renova**: NATIVA — anual virou preapproval MP `frequency:12/months` + Asaas
  subscription `cycle:YEARLY`; o gateway cobra sozinho e o webhook reancora `plano_vencimento`.
- **Arquitetura**: role sempre BASE `top2`; o CICLO mora só em `plano_ciclo` (D5). `plano_vencimento`
  é a âncora (reancorada só com COBRANÇA REAL — P1.2). Migração aplicada (ciclo_agendado + trigger
  + índice + preco_anual); auditoria 0/0.
- **Buracos do crítico adversarial fechados ANTES da troca existir**: P0.1 (mp-webhook não rebaixa
  se há OUTRO mandato authorized — troca com ordem de webhook invertida); P0.4 (reconciliar UPGRADE
  pula quem tem reembolsos_garantia); P0.2 (fallback MP→Asaas não cria 2º mandato — reset do ref
  re-cancela o meio-criado); P1.1 (proAnualVigente/temAssinaturaProAtiva por plano_vencimento, não
  plano_pago_em — quebrava no ano 2); P2.2 (processarVencido derruba âncora no reembolso; posse não
  re-concede se inadimplente); guarda nova `anual_vigente` em suspenderPlanoDireto (cancelar mandato
  anual no meio do ano pago NÃO rebaixa).
- **VALIDAR EM SANDBOX antes de anunciar (R-1..R-10 do spec)**: (R-6) confirmar que MP preapproval
  `12/months` no REDIRECT cobra a 1ª parcela AO autorizar (regra a) — se a conta recusar, fallback
  `frequency:365,frequency_type:'days'`; (R-2) troca mensal→anual com evento `cancelled` chegando
  DEPOIS do `authorized` → cliente segue top2; (R-3) fallback MP→Asaas não deixa 2 mandatos; (R-7)
  agendar-ciclo mantém acesso até o vencimento e materializa/avisa. Estado atual: 3 assinantes top2
  todos MENSAIS (sem anuais legados — migração não é preocupação).
- **REVIEW ADVERSARIAL (workflow, 4 agentes) — 3 bloqueadores fechados** (commit `c4b0bda`): mesma
  causa-raiz (`catch→0/[]` confundia "gateway falhou" com "nada existe"). **B1** cobrança dupla
  mensal→anual: backstop no mp-webhook cancela outros preapprovals authorized do userId ao ativar.
  **B2** recobrança anual indevida no anual→mensal: agendar-ciclo agora CONFIRMA o cancelamento
  (409/502 se não confirmar; não agenda). **B3** perda de acesso: loop ANUAL VENCIDO virou FAIL-SAFE
  (erro de gateway → PULA o rebaixamento). **M1/M2**: garantia grava valor_ref por plano_ciclo +
  limpa a âncora anual no reembolso.
- **REGRA (b) COMPLETA** (commit `3f216a3`): e-mail de reautorização anual→mensal perto do vencimento
  (`renovacao-avisos-cron` + RPC `agendados_ciclo_para_aviso`, aplicada) — o gateway exige novo
  consentimento do cartão; sem clicar, o acesso pausa no fim do período anual. Aviso de renovação
  do anual recorrente (regra c) já é coberto pelo mesmo cron.
- **PENDENTE (documentado, não-crítico)**: grandfather dos anuais AVULSO legados (D4) — não há
  nenhum hoje (0 anuais na base). Quando existirem, estender a RPC de aviso para incluí-los.

**E12. 31/07 — LJUD "Leilão não encontrado" no botão "Acessar leiloeiro" (fix de raiz):** commit
`79d1f05`. **Diagnóstico:** o portal `leiloesjudiciais.com.br` é um AGREGADOR de centenas de
leiloeiros; o mapper ativo (`mapLoteLJUD_pp`) gravava `url_lote = /lote/{lote_id}` do agregador —
SPA frágil que responde "Leilão não encontrado" p/ muitos lotes (a rota interna não é o `lote_id`
cru, ou o lote foi re-listado com outro id). Os documentos (anexos S3) vinham CERTOS porque são
lidos direto da API, independentes daquela página — daí o sintoma do dono (lote futuro, edital/
matrícula corretos, mas "não encontrado"). O recon por Node-fetch (recon-ljud-url.yml) veio vazio
(API bloqueia o fingerprint TLS do Node) → artefato do recon, NÃO evidência; a causa foi lida no
código vivo. **Fix:** `url_lote` passa a apontar p/ o SITE DO LEILOEIRO real (`nm_url_leiloeiro`,
que já vem na API e o mapper descartava), com fallback ao agregador só quando o portal não informa
o domínio. Vale p/ os DOIS sub-motivos (bug de rota OU id envelhecido). `url_lote` é reescrito pelo
scraper todo dia e o doc-scan (`enriquecer-lote` só grava `link_edital` vazio) NUNCA o sobrescreve
→ domínio preservado, sem migração. Foto backfill (og:image) mantido: reconstrói a URL do lote no
agregador a partir do `fonte_id` (`ljud_{id}`). Scrape LJUD-only disparado (`leiloeiros-puppeteer.yml`
fontes=LJUD) p/ corrigir os `url_lote` das linhas ativas hoje, sem esperar o cron das 10h UTC.

**E13. 31/07 — LINK ÚNICO GUIADO da assessoria (Pro + assessoria) + trava ABSOLUTA no servidor:**
commit `638b15c` (deploy `dpl_33CyBPSykuzUEPDiKu8bxnMuRWP4` READY). Contexto: o dono vende
assessoria (R$ 6.000 parcelado / R$ 4.800 à vista) para quem já arrematou; a assessoria é
EXCLUSIVA do Investidor Pro (R$ 49,90/mês). Antes, um Explorador no `?plano=assessorado` batia
num beco 🔒 que jogava ele pra fora do fluxo. **Fix:** o mesmo link (`?plano=assessorado`) virou
uma jornada só — tela TRANSPARENTE com a regra + as DUAS cobranças com valores, botão leva ao
Pro com marcador de retorno (`?plano=top2&apos=assessorado`); ao ATIVAR o Pro, volta DIRETO pra
assessoria. Reaproveita os checkouts já testados (assinatura transparente + PagamentoServico),
ordem sempre Pro→assessoria (ninguém fica com assessoria sem Pro). Gate `assessoria-status`
re-consulta quando o `role` muda (dep nova) → libera sem recarregar. Parcelas 1-3× sem juros /
4-12× com juros já eram o `calcParcelaMaisJuros`. **Trava ABSOLUTA (antes só na tela):**
`auto-contrato` agora exige Investidor Pro (`podeContratarAssessoria`) para gerar o contrato de
ASSESSORADO — staff (atribuição manual) passa, `clube` não entra; FAIL-CLOSED. Fecha o furo do
POST direto. **PIX é semi-manual hoje** (`mp-verificar-pix` exige `metadata.user_id`, que o PIX
estático não carrega) → recomendado CARTÃO; **PIX-anuidade do Pro é o fast-follow** (variante
nova de pagamento único que concede 12 meses sem recorrência — validar no sandbox antes). **Rafael**
(explorador, `6b35b390…`) ia contratar 31/07 pelo link; acompanhar ativação (role→top2 + contrato
assessorado). **PENDENTE (ideia do dono):** identificação por CPF na tela + popup do bundle (funciona
pré-login, reutilizável) — construir com rate-limit + retorno mínimo (privacidade: não vazar quem é
cliente); dono ainda vai definir se o campo de CPF fica na tela da Assessoria ou do Investidor Pro.
**Rafael ainda NÃO contratou** (segue explorador às ~14h UTC; watch re-armado).

**E14. 31/07 — IDENTIFICAÇÃO POR CPF no link de VENDA da assessoria (dono confirmou o fluxo):**
commit `2dd56c8` (deploy `dpl_E9ftxohFM8dejZf1EDzd6oJFcs3P` READY). O dono esclareceu: é o link de
COMPARTILHAMENTO/VENDA do assessorado (parceiro/sistema compartilha `?plano=assessorado&ref=CODE`),
por onde um convidado NÃO-assinante contrata. Para visitante NÃO-logado, o link começa pedindo o
CPF (`IdentificacaoCpfAssessoria` em Checkout.jsx). Reusa `api/verificar-cpf` (rate-limit 6/min por
IP + hash determinístico + NUNCA devolve nome/dados) consultando `{plano,top2}`: `temConta=false`→novo
· `temAcesso`→já é Pro · senão→explorador. 3 caminhos transparentes (novo=cria conta+Pro+assessoria;
explorador=entra e assina o Pro junto; Pro=entra e contrata direto), levando `?apos=assessorado` +
`?ref`. Logado segue na tela de bundle (papel já identifica). Isolado ao ramo assessorado+não-logado.
**Privacidade aceita:** leak inerente (saber se um CPF é cliente) contido pelo rate-limit; retorno
mínimo, sem PII. **FAST-FOLLOW aberto:** PIX-anuidade do Pro (pagamento único = 12 meses sem
recorrência; PIX hoje é semi-manual) — validar no sandbox antes; recomendar CARTÃO enquanto isso.

**E15. 31/07 — fix do "10" solto no card dos planos:** commit `f17fcef`. `data/cursos.js` tinha
`honorarios: 10` (número cru) em `assessorado` e `clube`; o card renderiza `{plano.honorarios}` num
box destacado → aparecia só "10" acima dos benefícios (visto no teste do dono). Corrigido p/ texto
("+10% de honorários sobre o valor arrematado") + render DEFENSIVO em Checkout e Promo (`typeof
=== 'string'`) p/ número solto nunca mais vazar. (`planosConfig` não sobrescreve `honorarios` — fonte
é o estático; DB só tem `honorarios_exito_pct` à parte.)

**E16. 31/07 — PIX AUTOMÁTICO ligado (dono reverteu a decisão do estático):** o dono primeiro optou por
manter o PIX estático/manual, depois pediu p/ ligar o automático (aceita a taxa MP ~0,99% no recebido).
Feito em 2 partes, ambas em produção:
- **Parte 1 (commit `210fe53`) — assessoria + serviços:** `PagamentoPIX` deixou de gerar QR estático da
  chave e passou a criar PIX DINÂMICO via `mp-checkout` (pagamento real com `metadata.user_id` + QR do
  MP); `mp-verificar-pix` confirma por `paymentId`. Confirma sozinho em segundos, sem passo manual. Vale
  p/ assessoria (R$4.800 à vista) e todo serviço via PagamentoServico. Cliente paga o cheio; a taxa fica
  com a plataforma.
- **Parte 2 (commit `23786fc`) — Investidor Pro por PIX (anuidade R$449,90 à vista, 12m sem recorrência):**
  Cartão = mensalidade recorrente; PIX = anuidade. No Checkout, botão "Pagar 1 ano à vista no PIX" no Pro
  anual → PagamentoServico `soPix` (proposito='plano_anual') → ao confirmar chama `/api/ativar-pro-anual`
  (NOVO) → segue o fluxo guiado (volta pra assessoria). **SEGURANÇA (pagamento único que libera plano =
  onde bug vira Pro grátis):** a ativação NUNCA confia no cliente — confere no MP APROVADO + dono
  (metadata.user_id) + proposito='plano_anual' + VALOR = preço anual do SERVIDOR (planos_config).
  Idempotente por paymentId. `mp-checkout` mantém `metadata.tipo='servico'` (webhook genérico NÃO eleva
  plano). **BACKSTOP no `mp-webhook`** p/ proposito='plano_anual' (resiliente a fechar o navegador) com as
  MESMAS guardas + MESMA chave de idempotência (`pix_plano_anual`) → nunca ativa em dobro. Sem mandato → o
  loop ANUAL VENCIDO do reconciliar rebaixa no fim dos 12m.

**ESTADO AO ENCERRAR (tarde 31/07):** tudo em produção e READY. O link de venda da assessoria
(`https://bidprobrasil.com.br/#/checkout?plano=assessorado`) está no ar com identificação por CPF +
bundle Pro+assessoria + PIX automático (assessoria e Pro-anuidade) + cartão + trava absoluta no
servidor. O dono vai mandar o link pro **Rafael** (explorador `6b35b390…`) contratar. Watch do Rafael
armado (send_later, fire ~15:23 UTC) — avisa quando ele ativar (role→top2 + contrato assessorado),
conferindo se foi PIX ou cartão. Nenhum assinante anual/Pro novo travado; auditoria de segurança 0/0.

**PRÓXIMA SESSÃO (noite 31/07):** (1) confirmar contratação do Rafael quando ele fizer (role→top2 +
contrato assessorado); (2) SANITY do PIX real (assessoria + Pro-anuidade) na 1ª cobrança de verdade —
conferir ativação no banco + o pagamento no MP; (3) retomar o item #11 (leiloeiros Round 35).

**E. BIASI (piso 130, mediana 260, último 96) — recon PENDENTE de dado fresco:** queda contínua desde 16/07 (369→173→96). O ambiente remoto não alcança o site (proxy bloqueia) — validar com o run do cluster disparado hoje: `select total,status from fonte_saude where fonte='BIASI' order by executado_em desc limit 3;`. Se seguir ≤100 com status ok em runs consecutivos, pode ser acervo real encolhendo (pós-leilão); se oscilar, rodar a ofensiva (recon estrutura viva × premissas: `?pagina` na listagem agregada + fallback home) via Actions (`debug-leiloeiros.yml`).

---

## ✅ Sessão 19 (29/07: MARKETING ponta a ponta — pixel/CAPI/Google + funil CAC/ROAS + 1ª campanha no ar)
> MESMA branch. `npm run build` OK. Commits `b07c39e..6b2dc65`. **Plano do dia 30/07 no fim desta seção.**

**A. META PIXEL no ar (Reimob `683455009174779`).** Decisão: reaproveitar o pixel "Reimob Imobiliária" (Meta não deixa criar 3º pixel; excluir destrói histórico/públicos; o "Pixel Tarcisio 533681443970197" é da imersão Lance de Ouro — NÃO usar). `VITE_META_PIXEL_ID` no Vercel (Prod+Preview) + redeploy; **validado em produção** (fbq 2.0 + ID embutido nos 24 bundles). O público Lance de Ouro entra depois como Público Personalizado/Lookalike (segmentação), não pelo pixel.

**B. Eventos de conversão que NUNCA disparavam — corrigidos.** `trackPlanContratado` (Purchase) e `trackImovelVisualizado` (ViewContent) estavam definidos em `gtag.js` mas sem NENHUMA chamada no app → Meta/Google não mediam a VENDA. Agora: **Purchase** dispara 1× no `useEffect(pago)` do Checkout (todos os fluxos convergem em `setPago(true)`; `pagoPendente` não conta) com `event_id` determinístico `pur_<userId>_<planoBase>_<YYYYMMDD>`; **ViewContent** no gate deduplicado do `registrar_imovel_visto` (ImovelDetalhe). Search/Lead ficaram FORA de propósito (busca é debounced; alerta sem ponto único).

**C. Meta CAPI server-side + dedup — VALIDADO AO VIVO.** `api/_meta-capi.js` (dormente até `META_CAPI_TOKEN`, já setado no Vercel): Purchase do SERVIDOR nos 2 pontos de confirmação do `_webhook-core.js` (`processarConfirmado` + `ativarPlanoDireto` — Asaas E MP, inicial e recorrente), `external_id`/`em` em SHA-256, MESMO `event_id` do navegador → Meta une (1 conversão, não 2); adblock/iOS não perdem venda. Diagnóstico admin `api/meta-capi-test.js` (?test_event_code=) → testado com `TEST97129`: **HTTP 200 ok:true**. Token foi gerado em Configurações do pixel → "Configurar SEM a Dataset Quality API" (o caminho com Quality API só oferecia o pixel errado).

**D. GOOGLE ADS — conversões eram FANTASMAS; agora reais + Enhanced Conversions.** Descoberta: os rótulos antigos no código (`7658576769/7658576772`) apontavam para ações que NÃO existem → conversões disparavam sem contar. A tag `AW-16850175262` PERTENCE à conta ativa **475-979-5747** (renomeada "Bidpro Brasil"; e-mail reimob; contas gmail canceladas = ignorar; nº da conta ≠ nº da tag — não confundir de novo). Criadas ações reais: **"Compra de plano — BidPro"** rótulo `08veCOz06dgcEJ6K5eI-` (valor dinâmico, contagem Todas) e **"Cadastro — BidPro"** rótulo `uwEKCO_06dgcEJ6K5eI-` (Uma); ação antiga "Cadastro concluído" → Secundária. `gtag.js` atualizado (+`transaction_id` no purchase p/ dedup). **Enhanced Conversions LIGADO** (conta: Conversões otimizadas ✓ Tag do Google; código: `setUserDataGoogle` manda e-mail/nome/endereço hasheados no cadastro e na compra). Card do Admin reflete os rótulos reais.

**E. PAINEL Admin→Marketing = centro de comando (decisão do dono: criar campanha NOS PAINÉIS, medir/decidir NO BIDPRO — API de gestão só com escala).** (1) **"Captação por origem"**: RPC `admin_funil_captacao(p_inicio,p_fim)` (SECURITY DEFINER, guard admin) — funil por canal first-touch (`perfis.mkt_gclid→Google Ads / mkt_fbclid→Meta Ads / utm / indicado_por→Indicação / Orgânico`): cadastros → engajados (imovel_visto) → contratantes PAGOS (aceites_plano) → receita + últimas contratações; entra no CSV. (2) **Investimento**: tabela `marketing_gastos` (RLS admin) + form de lançamento manual → **CAC/assinante e ROAS por canal** (verde/vermelho). (3) **Diagnóstico automático** (regras s/ IA): gasto sem cadastro · cliques sem cadastro (landing) · ROAS<1 (podar termos) · ROAS≥1,5 (escalar ~20%) · ≥30 cadastros (migrar lance p/ Maximizar conversões) · engajamento<30% (gargalo onboarding) · lembrete de lançamento semanal. (4) **FASE 2 — coleta AUTOMÁTICA**: tabela `marketing_metricas_dia` (PK data+canal+campanha, upsert autocorretivo) + `api/ads-metrics-ingest.js` (POST do Google Ads Script; header `x-ads-secret` = env `ADS_INGEST_SECRET`, 31 chars, setada+redeploy) + `api/meta-insights-cron.js` (cron 08:10 UTC registrado; **dormente até META_ADS_TOKEN/META_AD_ACCOUNT_ID**); painel: gasto AUTO tem prioridade s/ manual (nunca soma), selo "auto", colunas Cliques/CPC méd.

**F. 1ª CAMPANHA GOOGLE NO AR — "Pesquisa — Leilão de Imóveis (BR)", R$ 25/dia.** Config anti-desperdício: SÓ Rede de Pesquisa (Display/parceiros OFF), Brasil "Presença", Português, **Maximizar cliques teto CPC R$ 3,00** (migrar p/ conversões com ~30 cadastros), 9 palavras frase/exata (leilão de imóveis, caixa etc.), 1 anúncio (10 títulos+4 descrições), URL com utm, **IA Max/personalização/expansão OFF**, **Aplicação automática de recomendações DESLIGADA na conta** (0 de 21 tipos). Publicada 29/07 ~21h; status: em análise/aprendizado (~1 sem — NÃO mexer). Armadilhas do wizard anotadas: resumo com cache velho (país/IA Max), anúncio se perde ao abandonar rascunho, "+4,4% aplicar tudo" = recusar. **Google Ads Script "BidPro — métricas diárias"** instalado, autorizado, executado (log: "Sem dados" = benigno, campanha sem tráfego ainda) e **agendado diário 07:00–08:00**. ⚠️ Handshake do secret ainda NÃO provado ponta a ponta (só valida no 1º envio com dados).

**G. Cliente 360 — logs de auditoria com DATA+HORA (diretriz do dono).** O dono definiu: o Cliente 360 deve registrar **tudo o que é clicado por QUALQUER usuário** (erro, falha, bug E sucesso), sempre com **data e hora** para auditoria. Feito nesta sessão: as listas que mostravam só a DATA (falhas de relatório 24h, atividade recente, buscas, imóveis vistos, relatórios do cliente, contratos) passaram para **data+hora** (`dataHoraBR`). O clickstream ("Navegação e cliques": tela/clique/falha API/sem resultado, via `instalarTracker` no boot) já cobria todo usuário logado com hora. **PENDENTE (próxima sessão): auditoria de COBERTURA do tracker** — varrer botão a botão (pré-login incluso, onde só há GA4/Meta hoje) confirmando que toda ação relevante gera evento com carimbo; atenção a ações que hoje não passam pelo tracker (downloads/prints, cliques em modais, ações de admin/equipe) e à retenção (30d navegação / 90d atividade — confirmar com o dono se auditoria exige mais).

**📋 PLANO 30/07 (combinado com o dono):**
1. **Métricas Google (após 8h):** `select * from marketing_metricas_dia order by data desc limit 15;` → com linhas = ciclo 100% validado (avisar: selo "auto" no painel). Vazio → pedir log do script: "Sem dados"=anúncio ainda parado (benigno) · `401`=senha script≠Vercel · `503`=faltou redeploy. Conferir se o anúncio saiu de "Em análise".
2. **CONCLUIR META (sem campanha — deixar pronto):** developers.facebook.com → Criar app tipo **Empresa** ("BidPro Integração", vincular ao Business) → Business Settings → **Usuários do sistema** → criar + atribuir conta de anúncios `act_1114056112873901` (leitura) → **Gerar token** `ads_read`+`read_insights` (sem expiração) → Vercel: `META_ADS_TOKEN` (não colar no chat) + `META_AD_ACCOUNT_ID=act_1114056112873901` → redeploy → cron `meta-insights-cron` deve responder `{ok:true,gravadas:0}` (sem campanha).
3. **Auditoria de cobertura do tracker** (item G acima) — botão a botão, todos os papéis.
4. Rotina: segunda-feira olhar **termos de pesquisa** (negativas) — gasto agora entra sozinho.
5. Fila futura: campanha **Meta Advantage+** (criativos + Lookalike da lista Lance de Ouro) · revisão dia ~30 da campanha Google (CAC real, escala, lance por conversão).

---

## ✅ Sessão 18 (29/07): precisão do endereço no relatório + frescor do acervo + proximidades
> MESMA branch. `auditoria_seguranca()` = **0/0**.

**A. RELATÓRIO usava endereço GENÉRICO (impacta a precisão) — `api/gerar-analise.js`.** O scraper (MEGA) deixou LIXO em `endereco` ("praça Valor inicial R$, 166") e o BAIRRO real ("Vila Nossa Senhora de Fátima") ficou só no TÍTULO → a busca recebia só "cidade". Agora, no servidor (antes da busca), montamos o endereço rico: descarta `endereco` com lixo (valor inicial/R$/lance), extrai o BAIRRO do título ("Tipo m² - BAIRRO - Cidade - UF") quando a coluna `bairro` está vazia, e compõe rua+bairro+cidade/UF + nome do condomínio. Zero custo de IA. (Rua exata do edital/matrícula fica como melhoria futura — mais cara.)

**B. FREQUÊNCIA do scraper: grátis 2x/sem → DIÁRIO.** `scraper.yml` (CEF, ~7 min) e `leiloeiros-puppeteer.yml` (cluster MEGA/ZUK/SUPERBID/LJUD/SOLD/SODRE/FRAZAO/BIASI/BB/GRUPOLANCE/VENDASGOV, ~80 min, 0 Bright Data) passaram para `0 9/10 * * *`. Custo = só minutos de GitHub Actions (cluster ~2.400 min/mês no diário — se a franquia apertar, baixar p/ dia-sim-dia-não). Fontes PAGAS (SOLEON/GESTAO/RJ/PECINI, 1x/sem via Bright Data) NÃO mexidas — caminho é ativar o runner residencial (`docs/RUNNER_RESIDENCIAL.md`, pendência do dono) para zerar o BD e liberar frequência.

**C. SWEEP de vencidos dos LEILOEIROS (novo) — RPC `desativar_imoveis_leiloeiro_stale` + `api/limpar-imoveis-stale-cron.js`.** Antes só a CEF era limpa → leilões de leiloeiro vencidos ficavam no ar. A RPC desativa o que NÃO veio no ÚLTIMO scrape da própria fonte (respeita cadência diária x semanal). GUARDAS: ignora CEF/internos; só fontes com scrape recente (≤10d) e concluído (>2h); **pula fonte com remoção > 40%** (scrape degradado — proteção anti-BIASI). service_role-only. Roda no cron diário existente (`0 5 * * *`). Dry-run inicial: desativaria ~34 (CALIL 20, SODRE 13, RJ 1) e pulou PECINI 88%/VEGAS 48%/VENDASGOV 50%.

**D. PROXIMIDADES mais confiáveis (não usa IA, custo 0) — `api/_proximidades.js` + `enriquecer-proximidades.js`.** Os 5 espelhos do Overpass passaram a ser tentados EM PARALELO (`Promise.any` — o mais rápido vence; antes era sequência de até ~45s que estourava o abort de 35s do cliente). O cron de pré-carga subiu de 12 → 40 imóveis/execução (cada um agora resolve em ~3-5s). Confirmado: proximidades = OpenStreetMap/Overpass grátis, sem IA. Triangulação do relatório (`ancorarImovel`) = cascata grátis (ViaCEP/IBGE/Nominatim), sem Google, melhora bairro→rua e grava de volta.

---

## ✅ Sessão 17 (29/07): KYC no suporte + CSP do documento + fluxo de assinatura + privacidade dos assinantes
> MESMA branch. `npm run build` OK.

**A. KYC do parceiro aparecia no MODO SUPORTE (`src/components/KycParceiroModal.jsx`).** O admin em suporte via a conta de um cliente e o popup "Verifique sua identidade / Você entrou no Programa de Parceiros" surgia — mas era o flag do PRÓPRIO admin (aderiu 24/07, sem identidade validada), pois o bypass usava `effectiveRole` (que no suporte vira o papel do cliente). Corrigido: usa o papel REAL (`role`) + **não aparece com `impersonate`** (suporte). Confirmado no banco que o cliente (Matheus) tem `parceiro_aceite_em=null` (nunca aderiu).

**B. Documento não renderizava (CSP) — `vercel.json`.** O `frame-src` só permitia daily.co/mercadopago — **não o Supabase**. O documento (PDF) é um `<iframe>` para o Storage → bloqueado em TODO lugar (assinatura do signatário, modal admin, leitura). Corrigido: `frame-src 'self' blob: https://*.daily.co https://*.mercadopago.com https://*.supabase.co`. (Imagens funcionavam por `img-src https:`.) Upload de contrato passou a gravar `contentType` explícito.

**C. Fluxo de assinatura refinado (`src/pages/ContratoLink.jsx`, `api/assinar-contrato.js`).** (1) botão "Próximo" da etapa de dados **sempre clicável** e DIZ o que falta (campo vazio ou CPF/CNPJ/e-mail inválido) — fim do "botão cinza mudo"; (2) **validação de dígito** de CPF/CNPJ + e-mail (`validarCpf/validarCnpj/validarEmail` em `utils/cnpjCep.js`); (3) **guarda de tamanho** do payload (assinatura+fotos base64 > 3,7 MB → mensagem clara em vez de "tente novamente" do limite do Edge); (4) **rastreio anônimo do funil** — `ContratoLink` manda eventos leves `aberto`/`etapa` para `assinar-contrato` (branch `evento`), que registra `contrato_link_aberto`/`contrato_link_etapa` + os ERROS (`contrato_assinatura_erro`) na linha do tempo de quem criou o contrato (Cliente 360) — antes só o sucesso era rastreado; agora dá para ver onde o signatário para.

**D. PRIVACIDADE dos assinantes (LGPD / exposição no segmento de leilões) — `ContratoLink.jsx`, `ContratoPDF.jsx`, `utils/cnpjCep.js`.** (i) **Endereço deixou de ser obrigatório** e NÃO vai para o documento — a presença é autenticada por **localização aproximada (geo) + IP + dispositivo + carimbo de tempo** (Lei 14.063/2020 + MP 2.200-2/2001), sem expor o endereço residencial. (ii) No **Relatório de Assinaturas** (ContratoPDF), CPF/CNPJ, e-mail e telefone saem **mascarados** (`mascararDoc/Email/Tel`); o **registro completo fica na plataforma** (RLS), disponível às partes e à Justiça — consta na nota legal do próprio documento. ⚠️ **Confirmar com o JURÍDICO** se o nível de mascaramento atende à prática do escritório (não é aconselhamento jurídico).

**E. Endereço errado no topo do arremate (dado):** o imóvel atribuído manualmente ao Matheus (fonte `atribuido_manual`, id `8ddec600…`) tinha `titulo`="RUA MARCELLA BOIRON CARDOSO, 141, ALAGOINHAS/BA" (endereço de pessoa, provável do comprovante da Ana Paula), enquanto os campos estruturados + o boleto "Imovel_Fsa" apontam **Feira de Santana**. Corrigido `titulo` no imóvel e no arremate para "Rua H, lote 45, quadra 04, Loteamento Residencial Parque da Cidade — Feira de Santana/BA". Causa: `atribuir-arremate.js` grava o `titulo` do que a equipe digita na atribuição (conferir no formulário).

---

## ✅ Sessão 16 (29/07): certidões podadas + admin contratos + rascunho de cursos/ebooks + filtros lapidados
> MESMA branch. `npm run build` OK; `auditoria_seguranca()` = **0 crítico / 0 atenção** (nenhum objeto novo de banco nesta sessão).

**A. DOCUMENTAL/JURÍDICO — precisa de estágios? NÃO (verificado).** Diferente do mercadológico (várias buscas web abertas → pause_turn → timeout), o documental já tem deadlines escalonados (165s coleta / 275s fallbacks / 285s hard) e a chamada de IA pesada é uma EXTRAÇÃO de PDFs (visão/OCR) que precisa dos docs juntos — não é o mesmo padrão de risco. O **laudo (3º relatório)** é 1 chamada leve consolidando texto (maxDuration 180s, sem web/PDF) — também NÃO precisa de estágios.
**B. CERTIDÕES — podadas as que custam/exigem captcha (`api/gerar-documental.js`).** Regra do dono: certidão que precisa PAGAR (Bright Data) ou que o sistema NÃO traz sozinho sai da lista e da apresentação. REMOVIDAS das consultas automáticas + do checklist: **CNDT (trabalhista), CNIB (indisponibilidade), CENPROT (protesto)** — todas dependiam de portal pago + captcha e ficavam "pendente/diligência" para sempre. MANTIDAS (grátis, o sistema traz sozinho): **DJEN/Comunica CNJ** + **certidões fiscais (Receita/PGFN/FGTS)**. A indisponibilidade/penhora RELEVANTE continua vindo da leitura da MATRÍCULA pela IA (grátis). Front (checklist e PDF) é data-driven → some sozinho; `certidoesDocumentos` agora sempre vazio (seção some).

**C. ADMIN CONTRATOS — uma linha por contrato + tela de gestão (`src/pages/Admin.jsx`, `ContratoPDF.jsx`).** (1) A tabela agora AGRUPA por `contrato_grupo_id` → **1 linha por contrato** (multi-parte não repete), com status agregado "X/N assinaram". (2) "Ver" abre painel completo: **roster de signatários** (get_partes_contrato, equipe autorizada) com status/data/testemunha, **copiar link por parte** (pendentes), **Alterar dados** de um signatário PENDENTE (nome/CPF/e-mail; assinado fica travado p/ não quebrar a integridade), **Visualizar com assinaturas** (gerarContratoPDF com roster COMPLETO — cada parte com seus pontos de autenticação) e **Excluir documento** (grupo inteiro). `gerarContratoPDF` ganhou suporte a roster `_full` (dados por parte) mantendo compat com a visão do signatário (`p.eu` + contrato.*). Geração de contrato segue restrita a admin/equipe (3 camadas — inalterado; nenhum usuário comum cria documento). **Ajustes pós-feedback:** (i) documento ENVIADO (não IA: `arquivo_url` presente ou `gerado_por_ia===false`) NÃO mostra "Nogueira Empreendimentos" como contratante — na tabela vira "— (coleta de assinaturas)" e no modal um aviso "a plataforma apenas coleta as assinaturas"; (ii) o modal agora EMBUTE o documento (iframe pdf / img) + botão "Abrir em nova aba" (a signed URL do bucket `documentos` vale ~1 ano; o link dentro do PDF de impressão não abria — por isso a visualização foi para o modal); (iii) "Copiar link" por parte pendente ficou robusto (helper `copiarTexto` com fallback execCommand; token resolvido por id OU e-mail).

**D. CURSOS/EBOOKS — rascunho x publicado (`src/pages/Admin.jsx`, `EbookPage.jsx`, `ProdutoPublico.jsx`).** Bug: cadastro incompleto ia PUBLICADO direto (só `ativo default true`, sem validação). Agora: ao salvar incompleto, grava como **RASCUNHO (`ativo=false`)** — não vai para loja/área de membros; fica só para o admin concluir. Completude: **curso** = título + descrição + link de vídeo em ≥1 aula; **ebook** = título + descrição + capa + arquivo (PDF). `toggleAtivo` BLOQUEIA publicar incompleto (checa no banco). Fechadas as brechas de acesso direto por URL a rascunho: `EbookPage`/`ProdutoPublico` agora exigem `ativo=true`.

**E. FILTROS lapidados (`api/gerar-analise.js`, `api/_temporada.js`, `src/pages/Busca.jsx`).** Revenda: mantém **30%**. Locação: piso de yield subiu de 6% a.a. para **12% a.a. (= 1% ao mês)** no classificador do relatório (a Busca não tem coluna de yield). Temporada: deixou de ser "só litoral" — a lista curada `_temporada.js` (espelhada em Busca.jsx) ganhou **termas/águas, serra/inverno, históricas e parques/natureza** (cidade_norm validado no acervo), E o relatório passou a classificar temporada TAMBÉM pelo sinal turístico que a IA lê da região (`perfilRegiao.turismoSazonal` no `promptContexto`, com o TIPO) — pega destinos sazonais fora da lista.

---

## ✅ Sessão 15 (29/07): busca em ESTÁGIOS + barra de evolução + 2ª praça + confirmação dos filtros
> MESMA branch `claude/assessor-handoff-system-check-sswll2`. `npm run build` OK; `auditoria_seguranca()` = **0 crítico / 0 atenção**.

**1. MERCADOLÓGICO — busca em 2 ESTÁGIOS com timeouts INDEPENDENTES (`api/gerar-analise.js`).** Implementa o que estava "em validação": a hipótese do dono ("várias coisas ao mesmo tempo estouram o tempo e o relatório vem incompleto/inconsistente") estava CORRETA. A busca era UMA chamada de IA (`promptMercado`, até 7 buscas web pedindo 12 tópicos no mesmo turno) → muitas buscas → `pause_turn` repetido → em praça sem base própria, estourava os 300s. **Agora são DUAS chamadas com orçamento e nº de buscas PRÓPRIOS:**
>  • **Etapa A — COMPARÁVEIS (essencial):** `promptComparaveis` — níveis 1/2 de venda+locação + consolidado (valor) + fontes locais. Leva o grosso das buscas (6 fresh / 2 cache) e o maior tempo. É a etapa que NÃO pode falhar; se falhar (abort/timeout) vira transitório (`__instavel`) → Índice BidPro/self-heal assumem (como antes).
>  • **Etapa B — CONTEXTO (best-effort):** `promptContexto` — FipeZAP, zoneamento, perfil da região, segurança pública, outras tipologias, outros bairros. Timeout e buscas curtos (3 fresh / 1 cache), `pause_turn` cap 4. **Só roda se a A NÃO falhou E se sobrou orçamento.** Se estourar/falhar, o relatório entrega assim mesmo com os comparáveis da Etapa A — **nunca mais esvazia por causa do contexto.**
>  Helper genérico `buscarEtapa({prompt, sistema, msBudget, webUses, pauseCap, minReserva})` substituiu o antigo `buscarMercado`. `promptMercado` (mega-prompt) foi MANTIDO exportado (ainda usado pelo A/B `api/ab-mercadologica.js`). Diagnóstico persistido: `mercado.__diag` (Etapa A) + `mercado.__diagContexto` (Etapa B) + `__diagParecer` (parecer) — tudo no `result`, diagnosticável pelo banco.

**2. BARRA DE EVOLUÇÃO (pedido do dono: "a cada resposta vai preenchendo/sinalizando concluída").** Nova coluna `analises_mercado.progresso` (jsonb, migração `analises_mercado_progresso`). O backend grava o progresso das etapas via helper `marcarProgresso(imovelId, ownerId, etapas)` (PATCH best-effort na linha 'gerando', chave user_id+imovel_id) a cada transição: `comparaveis → contexto → parecer`, cada uma com status (`gerando/concluido/pulado/erro`) e a **CONTAGEM ISOLADA** (n de amostras/itens daquela etapa). Front: `AnalisesContext.rowToEntry` mapeia `progresso`; `Analise.jsx` renderiza a barra DENTRO do card mercadológico enquanto gera (trilha preenchendo + 3 linhas de etapa com ✓/spinner/— e o contador). Reaproveitamento (cache) marca A/B como concluídas na hora.

**3. 2ª PRAÇA — captura + projeção na praça MAIS DESCONTADA.** Diagnóstico (workflow): só a CAIXA/CEF preenchia `valor_minimo_2`/`data_leilao_2`; os leilões JUDICIAIS (Mega/genérico) colapsavam tudo em `valor_minimo`=min / `valor_avaliacao`=max + 1 data. Entregue nesta sessão:
>  • **Relatório (`gerar-analise.js`)** — lê `valor_minimo_2`/`data_leilao_2` e escolhe a PRAÇA DE REFERÊNCIA = MENOR lance entre as praças com data ainda FUTURA (fallback: menor lance disponível → `valor_minimo`). Usa esse lance no `descontoImovel` e na `classificarIntencao`, e expõe `mercado.pracaReferencia` (`{valor,data,qual}`) no result. **Robusto a qual coluna guarda a 1ª/2ª** (fontes divergem): decide pelo VALOR, não pela posição. SEGURO (só leitura no relatório).
>  • **Mega (`scripts/scraper-puppeteer.mjs`)** — captura ADITIVA da 2ª praça: coleta os blocos `.card-instance` emparelhando valor↔data por praça (`c.pracas`) e grava a OUTRA praça em `valor_minimo_2`/`data_leilao_2`. **NÃO mexe em `valor_avaliacao`/`valor_minimo`/`data_leilao`** (min/max/próxima) → zero impacto em desconto/filtros do catálogo. AUTO-GATED: se a estrutura `.card-instance` não existir, `pracas`=[] e cai no fluxo antigo (zero regressão). O upsert do scraper é blacklist (só remove campos internos), então as colunas reais persistem.
>  • **Detalhe (`ImovelDetalhe.jsx`)** — passou a ORDENAR as duas praças por valor (1ª = maior; 2ª = menor/mais descontada), pareando cada valor com a sua data, para o rótulo ficar sempre correto seja qual for a fonte (CEF ou judicial).
>  ⚠️ **PENDENTE (precisa de recon ao VIVO — ritual do dono):** os DEMAIS scrapers (genérico `scraper-core.mjs`, RJ, Soleon, Pecini, Gestão) ainda colapsam as praças. Cada um extrai o valor à sua maneira → replicar a captura aditiva de `valor_minimo_2`/`data_leilao_2` exige conferir a estrutura VIVA de cada site antes (não editar às cegas — regra anti-regressão BIASI). A Calculadora (`Calculadora.jsx`) segue 100% manual (não pré-preenche da praça).

**4. CONFIRMAÇÃO DAS 3 REGRAS DE FILTRO (Revenda/Locação/Temporada) — pedido "me confirme p/ lapidação".** Mapeado (workflow) — existem DUAS réguas (filtro da Busca × classificador do relatório):
>  • **REVENDA** — Busca: `tipo IN ('apartamento','casa','comercial','imovel') AND desconto_percentual >= 30` (`Busca.jsx` L196). Relatório: baseTipo residencial|comercial AND desconto(avaliação×lance) >= 30% (`gerar-analise.js` classificarIntencao). → **MESMA régua** (nuance: fonte do desconto difere — coluna vs. recálculo).
>  • **LOCAÇÃO** — Busca: `tipo IN ('apartamento','casa','imovel')` SEM yield (a tabela não tem coluna de yield/aluguel). Relatório: residencial AND `yieldBruto >= 6%`. → **RÉGUAS DIFERENTES** (Busca é mais permissiva).
>  • **TEMPORADA** — Busca: residencial AND `cidade_norm IN` (lista ~60 cidades litorâneas), MAS no modo RAIO ignora a cidade. Relatório: residencial AND `ehCidadeTemporada` (mesma lista, em `api/_temporada.js`). → **MESMA régua fora do raio.**
>  **2 refinamentos possíveis (AGUARDAM o dono — não mexi na régua p/ não mudar a busca sem validar):** (a) a lista de cidades de temporada está DUPLICADA (`Busca.jsx` × `api/_temporada.js`) → risco de drift, unificar numa fonte só; (b) decidir se "Locação" na Busca deve exigir yield (só dá pra fazer materializando um yield/aluguel estimado como coluna em `imoveis_leilao`).

## ✅ COMEÇAR AQUI (28/07 — sessão 14: causa-raiz do "relatório sem dados" + rastreio no 360 + 4 correções de produto)
> Continuação da sessão 13, MESMA branch `claude/assessor-handoff-system-check-sswll2`, promovida a `main` por fast-forward. Deploys desta sessão: `0cc5bd1` (calculadora + proximidades), `02bc4e6` (parecer + contrato + Explorador + agendar), e o commit de rastreio do parecer no 360 (topo do log). `auditoria_seguranca()` = **0 crítico / 0 atenção** ao final.

**🎯 PRINCÍPIO REFORÇADO PELO DONO NESTA SESSÃO (regra permanente): erro que é CONSEQUÊNCIA de funcionalidade da plataforma TEM de ser rastreado no Cliente 360.** "Rastrear cada clique e se está funcionando bem; as ORIGENS das fontes de informação e funcionalidades; e as ENTREGAS." O erro do parecer vazio **não foi rastreado e deveria ter sido** — ficava como `relatorio_mercado_ok`. Ao construir/alterar QUALQUER funcionalidade, garantir que sucesso E falha (especialmente ENTREGA incompleta) virem evento no 360. Ver "LACUNAS AINDA ABERTAS" da sessão 13 (pré-login, KYC/LGPD/upload, webhooks, adesão de parceiro, audit_logs no 360) — segue como passe dedicado prioritário.

**1. RELATÓRIO — causa-raiz do "erro"/"sem dados" ACHADA e resolvida (`api/gerar-analise.js`).** Diagnóstico pelo banco (`analises_mercado`): os relatórios ficavam `status='concluida'` **com mercado cheio** (ex.: MORADA/Resende: 9 vendas, R$ 787k), mas com **`parecer` VAZIO**. A busca web funcionava — o que falhava era a **REDAÇÃO do parecer** (chamada de IA separada): erro transitório (429/overloaded/timeout, `retries:0`) **engolido num `catch {}` vazio** → "erro de API silenciado" → relatório concluído SEM parecer, lido como incompleto/"Erro ao gerar". O self-heal do cron re-tentava contra o MESMO bug e QUEIMAVA as 2 tentativas sem nunca preencher (por isso "persistia"). **Correção:** o parecer agora RE-TENTA até 2× enquanto há orçamento; o motivo de falha fica em `result.mercado.__diagParecer` (`{tinhaInputs, restanteInicio, tentativas, erro, len}`) — diagnóstico pelo banco, sem log Vercel. **Correlação que confirmou:** todo relatório vazio tinha o parecer sem retry; o mercado sempre presente.
**1b. RASTREIO NO 360 (a lacuna que o dono apontou):** a entrega incompleta agora emite evento próprio **`relatorio_parecer_vazio`** em `atividade_log` (com o `__diagParecer` no meta) em vez de `relatorio_mercado_ok`. Assim a falha de ENTREGA aparece no Cliente 360 para diagnóstico. (`relatorio_mercado_vazio` e `relatorio_mercado_erro` já existiam.)
**1c. BALANÇO qualidade × economia (novo pedido do dono):** `MAX_VAZIO` do cron 6→4 (alinha ao teto de 24h; menos re-busca web em praça rasa) e `LOTE_PARECER=8` (a regeração do parecer REUSA a pesquisa recente — não repaga web search — então limpa o backlog num run). Os **5 relatórios travados** (MORADA/Resende, Recreio/Lauro, Direitos/Praia Grande, Marcella/Alagoinhas, Vila Santa/Carapicuíba) foram **reenfileirados** (`regen_tentativas=0`) para self-heal com o código novo.

**2. CONTRATO — autofill de endereço (`ContratoLink.jsx`).** O campo "Endereço completo (com número)" da tela do SIGNATÁRIO (não é o CriarContrato — lá não há campo de endereço) era `<input>` puro. Agora usa o MESMO `EnderecoAutocomplete` (Google Places via proxy) do Índice. Novo prop `onType` no componente mantém o texto digitado à mão valendo mesmo sem escolher sugestão (endereço é obrigatório) — retrocompatível (Índice inalterado).

**3. CONTRATOS — ver assinantes (`Contratos.jsx`).** Botão "Assinantes" por card abre modal dedicado com as PARTES e o status de cada uma (assinou/pendente + data + testemunha), com "X de Y assinaram". Multi-parte = várias linhas em `contratos_link` com mesmo `contrato_grupo_id`; a RLS deixa o cliente ver só a própria linha → nova RPC **`get_partes_contrato(p_grupo_id)`** SECURITY DEFINER (só campos seguros: nome de `dados_signatario`/`assinante_email`, status, testemunha; NUNCA CPF/KYC de terceiros). ⚠️ **Segurança:** o Supabase concede EXECUTE direto a `anon` em toda função nova do schema public (ALTER DEFAULT PRIVILEGES) — o `revoke from public` NÃO tira isso; foi preciso `revoke execute ... from anon` explícito (o auditor pegou). Migração `get_partes_contrato.sql` já com o revoke.

**4. PLANO EXPLORADOR (`Planos.jsx`, `cursos.js`, migração + `Analise.jsx`).** Texto → "3 relatórios mercadológicos e viabilidade financeira de amostra" (sem "/mês"). Passou a ser **AMOSTRA VITALÍCIA** (não reseta por mês): coluna `perfis.amostra_mercado_usadas` + `consumir_analise_por` ramifica por papel (explorador usa a amostra; demais, cota mensal); `estornar_analise_por` entende `tipo='amostra'`. Default 0 = perdoa histórico (todo explorador atual recomeça com 3). Ao esgotar → **comprar crédito** (`gerar-analise` já retorna 402 e o front leva a `/creditos`). Documental/Jurídica seguem exigindo upgrade (já era enforce em `gerar-documental.js`). Front: `carregarCota` lê `amostra_mercado_usadas` p/ explorador; contador "Relatórios de amostra: X/3"; bloqueio → "Comprar créditos". Migração `explorador_amostra_vitalicia.sql`.

**5. AGENDAR ANALISTA — gate p/ 3 relatórios (`Analise.jsx` + `api/agendar-reuniao.js`).** Liberava no 2º relatório (`ambosRelatorios` = mercado+documental). Agora exige os TRÊS (inclui Laudo). Front: nova var `relatoriosConcluidos` (NÃO reusei `ambosRelatorios`, que libera a GERAÇÃO do laudo). Backend: `agendar-reuniao` conta os 3 tipos concluídos do imóvel na 1ª reunião (403 se faltar) — o gate do front era burlável por POST direto.

**6. CONTRATO ASSINADO — modo LEITURA em vez de dead-end (`ContratoLink.jsx`).** Antes, reabrir um link já assinado dava "Link indisponível" (beco sem saída), e a tela "Contrato assinado!" não mostrava a situação das partes. Agora: (a) link já assinado → **modo leitura** (não é mais erro): mostra o LAYOUT do documento + o roster das partes (quem assinou / quem falta + data + testemunha) + "Baixar documento" (comprovante em texto). (b) A tela de sucesso ganhou o botão "Ver contrato e quem já assinou". Como o signatário pode ser ANÔNIMO (só o token), criei a RPC token-gated **`get_partes_por_token(p_token)`** (SECURITY DEFINER, anon, na allowlist do auditor; e-mail de terceiro MASCARADO, nunca CPF/KYC). Migração `get_partes_por_token.sql` (inclui a atualização do `auditoria_seguranca()` p/ a allowlist). `auditoria_seguranca()` = **0 crítico / 0 atenção**.

**7. CONTRATO — visualizar com validade jurídica + entrega por e-mail (deploy `main` @ topo do log).** Pedidos do dono nesta rodada:
- **Fim do botão "Comprovante" na lista (`Contratos.jsx`):** removido. O "Visualizar" leva ao documento em modo leitura, que agora traz **AO FINAL** o bloco "Assinaturas e validade jurídica" — o que a MP 2.200-2/2001 (ICP-Brasil) e a Lei 14.063/2020 pedem: identificação dos signatários (nome; e, do próprio, CPF/CNPJ e IP de origem), data/hora de cada assinatura, situação da testemunha e o **código de verificação (hash SHA-256)** que garante a integridade. Reordenei a tela: banner de situação → documento → bloco de assinaturas ao final.
- **DOCUMENTO PDF de verdade (não mais .txt) — `src/components/ContratoPDF.jsx` (NOVO).** O dono apontou: o "comprovante" saía como bloco de notas (.txt) e as informações de validade têm de estar DENTRO do documento. Agora "Baixar documento assinado" gera um PDF (via `imprimirHtml` → "Salvar como PDF", mesmo mecanismo dos relatórios) com o CONTRATO + um **"Manifesto de Assinaturas"** ao final (padrão das plataformas de assinatura eletrônica): por signatário — nome, status, data/hora (horário de Brasília); do próprio, CPF/CNPJ, e-mail, IP, método e a **imagem da assinatura**; + a base legal (MP 2.200-2/2001 e Lei 14.063/2020) e o **hash SHA-256** de integridade. Funciona RETROATIVO (lê o contrato + roster existentes) — vale para as assinaturas já feitas. Reconcilia com o exemplo do drive na próxima sessão (ver caveat abaixo).
- **⚠️ CAVEAT — exemplo do drive não pôde ser aberto:** o dono pediu p/ modelar pelo "documento de assessoria do Rafael (assinado)" no Google Drive. O conector do Drive nesta sessão retornou **"requires approval"** (mesma restrição do get_runtime_logs da Vercel) → NÃO consegui ler o exemplo. Modelei pelo PADRÃO JURÍDICO consolidado (MP/Lei + manifesto estilo Clicksign/D4Sign/Autentique). **Próxima sessão:** com o Drive autorizado, abrir o doc do Rafael (`search_files`/`read_file_content`) e ajustar layout/campos do `ContratoPDF.jsx` p/ bater com o modelo dele.
- **Limitação conhecida (refinamento):** o PDF é gerado no CLIENTE pelo token → traz dados COMPLETOS só do próprio signatário (das demais partes: nome + data, sem CPF/IP/assinatura, por privacidade). Um manifesto 100% completo (todos os signatários com todos os campos) exige um gerador SERVER-SIDE (service key) — anotar p/ quando quiser o PDF anexado no e-mail (hoje o e-mail manda o LINK do documento assinado).
- **Assinar por LINK sem conta — JÁ funcionava (confirmado):** `api/assinar-contrato.js` é edge + service key, sem exigir auth; o signatário assina só com o token. Nada a mudar.
- **Entrega do documento assinado por e-mail (NOVO):** quando TODAS as partes assinam (`completo`), `assinar-contrato.js` agora e-maila CADA parte com o link do documento assinado (`#/c/<token>` → modo leitura). Vale p/ grupo (várias partes) e parte única. Antes só o CRIADOR era notificado do "totalmente assinado".

**8. CONTRATO — DOCUMENTO PDF + atribuição à arrematação + anexos no suporte (deploy `main` @ topo do log).**
- **PDF de verdade (`src/components/ContratoPDF.jsx`):** "Baixar documento assinado" gera um PDF (via `imprimirHtml` → Salvar como PDF) com o CONTRATO + um "Manifesto de Assinaturas" ao final (nome/status/data-hora por parte; do próprio, CPF/CNPJ/e-mail/IP/método + imagem da assinatura; base legal MP 2.200-2/2001 e Lei 14.063/2020; hash SHA-256). Substitui o .txt. Retroativo.
  - **Modelado no ZapSign REAL (o dono enviou o PDF do Rafael — assinado via ZapSign by Truora).** Estrutura extraída do arquivo (última página = "Relatório de Assinaturas"): `Status: Assinado` · `Documento:` (nome) · `Número:` (uuid do doc) · `Data da criação` · `Hash do documento original (SHA256)` · `Assinaturas X de Y` · `Datas e horários em UTC-0300 (America/Sao_Paulo)` · `INTEGRIDADE CERTIFICADA - ICP-BRASIL` + "Assinaturas eletrônicas e físicas têm igual validade legal, conforme MP 2.200-2/2001 e Lei 14.063/2020" · por signatário: `Assinado via …` + NOME + `Data e hora da assinatura` + `Token` + imagem da `Assinatura` + `Pontos de autenticação` (Telefone, E-mail, Nível de segurança "validado por código único", Localização aproximada lat/lng, IP, Dispositivo/user-agent). Rodapé repetido em toda página: "`ZapSign <num>`. Documento assinado eletronicamente, conforme MP 2.200-2/2001 e Lei 14.063/2020" + marcador `-- N of M --`.
  - **`ContratoPDF.jsx` reescrito nesse molde:** "Relatório de Assinaturas" com Status/Documento/Número(=contrato_grupo_id)/Data da criação/Hash SHA-256/Assinaturas X de Y/fuso UTC-03:00/selo INTEGRIDADE CERTIFICADA; por signatário — "Assinado via BidPro Brasil", nome, data/hora, Token, imagem da assinatura e "Pontos de autenticação" (e-mail, CPF/CNPJ, IP, nível de segurança); rodapé fixo por página com o nº do documento + base legal + URL de autenticidade `#/c/{token}`.
  - **PARIDADE ZapSign FECHADA (todos os pontos de autenticação):** migração `contratos_link_pontos_autenticacao` (colunas `assinante_user_agent text`, `assinante_geo jsonb`, `dados_complementados_em timestamptz`). `assinar-contrato.js` grava **dispositivo** (user-agent do SERVIDOR, mais confiável) + **localização aproximada** (do body, via `navigator.geolocation` com consentimento, best-effort). **Telefone** já vinha em `dados_signatario.telefone`; **IP** já em `assinante_ip`. `ContratoLink.jsx` captura o geo no ato de assinar (não bloqueia se negar). `ContratoPDF.jsx` renderiza os "Pontos de autenticação" completos (Telefone, E-mail, CPF/CNPJ, Nível de segurança, Localização aproximada, IP, Dispositivo) — igual ao ZapSign.
  - **Assinaturas ANTIGAS (sem dispositivo/geo) — resolvido por COMPLEMENTO (decisão do dono: "reassinar OU complementar, o que for mais fácil" → complementar):** endpoint novo `api/complementar-assinatura.js` (edge, service key, token-gated, idempotente) e um botão **"Completar dados de autenticação"** na tela de leitura do contrato (`ContratoLink`) que aparece quando a assinatura não tem dispositivo/geo. O próprio signatário captura agora (device via header, geo via consentimento) SEM re-assinar — não altera assinatura/hash/carimbo originais; grava `dados_complementados_em` e o PDF rotula "(dispositivo/localização complementados em …)". O único contrato assinado atual (PortoSeguro) já mostra esse botão ao ser aberto pelo signatário.
  - **Refinamento residual (opcional, NÃO bloqueia):** no PDF, dados COMPLETOS dos DEMAIS signatários (CPF/IP/dispositivo de terceiros) exigiriam um gerador SERVER-SIDE (o cliente só enxerga o próprio por token) — hoje mostramos nome + data/hora dos demais e todos os campos do próprio. Suficiente para validade; server-side seria só para um único PDF com o bloco completo de todas as partes.
  - **Refinamento (opcional):** PDF é gerado no CLIENTE (por token) → dados completos só do próprio signatário. Manifesto 100% completo (todos com CPF/IP/assinatura) exige gerador SERVER-SIDE — necessário se um dia quiser o PDF ANEXADO no e-mail (hoje o e-mail manda o LINK do doc assinado).
- **(4) FEITO — Atribuir contrato a uma ARREMATAÇÃO.** Migração `contratos_link_atribuir_arremate` (colunas `arremate_imovel_id text` + `arremate_user_id uuid` + índice). `gerar-contrato.js` grava o vínculo (recebe `arremateImovelId`/`arremateUserId`); `CriarContrato.jsx` repassa do `_preState` (fluxo "vindo da arrematação"). Na tela do arremate (`Arrematados.jsx` → aba Documentos) há a seção **"Contratos vinculados"**: lista os contratos daquela arrematação com status (assinado/aguardando) + link "Ver documento" (`#/c/token`) — o doc assinado aparece ali **mesmo depois de assinado** (join VIVO por `arremate_imovel_id`+`arremate_user_id`, sem duplicar em `imovel_anexos`). Staff (inclusive em suporte) pode **"Vincular um contrato existente"** (inclui já assinados) via um select → update escopado (RLS `is_equipe`). Decisão de design: NÃO inserimos em `imovel_anexos` (evita o mismatch `arrematados.imovel_id` TEXT × `imovel_anexos.imovel_id` UUID e a criação de âncora dentro do fluxo de assinatura) — o join vivo é mais simples e sempre reflete o estado real. "Ninguém/usuário" = comportamento de link/signatário já existente.
- **(5) FEITO — Anexos complementares no MODO SUPORTE.** O backend (`api/upload-anexo.js`) já autorizava staff; o bloqueio era só de UI (`Arrematados.jsx` `soLeitura` escondia o upload no modo suporte). Agora `permitirAnexo = !impersonate || ehStaff` libera o upload de docs (auto/carta de arrematação, escritura, matrícula…) para o DONO e para quem está no SUPORTE do usuário (staff), com aviso "🛟 modo suporte — anexando em nome do assinante". Excluir anexo segue só para o dono (`!soLeitura`). `auditoria_seguranca()` = **0 crítico / 0 atenção**.

---

## ✅ COMEÇAR AQUI (28/07 — sessão 13: CHECAGEM COMPLETA DO SISTEMA / assessor handoff)
> Ritual de 6 itens rodado ponta a ponta + várias correções aplicadas. `auditoria_seguranca()` = **0 crítico / 0 atenção** (antes e depois). **PROMOVIDO A PRODUÇÃO** nesta sessão: os fixes foram desenvolvidos na branch `claude/assessor-handoff-system-check-sswll2` e promovidos a `main` por fast-forward (origin/main é ancestral) — último deploy prod **READY @ `8c68689`**. Backfill de DADOS aplicado direto em produção via MCP (idempotente, salvo como migração).

**SAÚDE:** 30.885 imóveis ativos · 99,3% frescos (<24h) · fila geocode 35 · 0 relatórios presos (1 erro transitório 24h) · 7 anomalias abertas · deploys Vercel **todos READY** (prod @ `2f8b777`). ⚠️ Fontes atrasadas: **GESTAOLEILOES** (últ. 23/07) e **RJLEILOES** (últ. 21/07) — coletadas pelo **RUNNER RESIDENCIAL** do dono (grátis); conferir se o cron de casa (`~/.bidpro-runner.env`) rodou. docs_fila 781 (dreno 30/30min, normal).

**CORRIGIDO nesta sessão:**
1. **CEF "Botão Edital abre a Matrícula" (1.843 lotes) — DADOS corrigidos.** O `link_edital` de lotes CEF extrajudicial/licitação apontava para o PDF da MATRÍCULA (`/editais/matricula/…`) → o botão "Edital" abria a matrícula. O guard no scraper JÁ existe (`b19df3c`, 26/07) e corrige coletas novas; o resíduo legado (só se auto-corrige no próximo re-scrape COMPLETO de CEF, ~2x/sem — enquanto isso a captura de matrícula bumpa `atualizado_em` sem re-rodar o mapeador) foi limpo por backfill idempotente (`supabase/migrations/cef_edital_matricula_mislabel_backfill.sql`): `link_edital ← url_lote` (página de detalhe = o que o scraper corrigido produz). QA invariante `edital_eq_matricula` **1803→2** (OK; restam 2 LEILOTECH benignos: URL do lote tem "matricula" no slug).
2. **Garantia de 7 dias (CDC art. 49) negada a quem paga via Asaas OU plano ANUAL — CÓDIGO corrigido.** `plano_pago_em` (âncora do reembolso) só era gravada em `ativarPlanoDireto` (MP recorrente); o caminho `processarConfirmado` (webhook Asaas + avulso anual MP) NUNCA setava → `garantia-cancelar.js:98` calculava `dentro7=null` e NEGAVA o reembolso legalmente devido (com mensagem falsa "sem reembolso"). Fix em `api/_webhook-core.js`: ancora `plano_pago_em` na 1ª ativação paga (mesmo critério do `ativarPlanoDireto`; `buscarCliente` passou a trazer a coluna). Forward-looking — NÃO backfillei os **4 pagantes atuais sem âncora** (setar `now()` abriria janela indevida p/ pagamento ANTIGO; se algum pedir reembolso de pagamento recente, tratar manualmente).
4. **Programa de Parceiros para EQUIPE e LEILOEIRO + COMPARTILHAR plano (pedido do dono).**
   (a) **Componente único `src/components/ConviteParceiro.jsx`** (fonte única do TERMO_PARCEIRO v6, antes só em HomeCliente): card "Programa de Parceiros" que convida a virar parceiro (termo → `aceitar_parceria` → `/minha-rede`) ou, se já for, leva ao link de venda. Plugado em **Atendimento** (equipe) e **LeiloeiroPortal** (leiloeiro) — antes esses papéis nunca viam o convite (só HomeCliente). HomeCliente agora importa o termo do componente (sem duplicar).
   (b) **Compartilhar plano (Planos.jsx):** botão "Compartilhar este plano" por card (Explorador/Investidor Pro/Assessoria/Clube), **visível só a parceiros** (`parceiro_aceite_em`), gera o link de venda `#/planos?ref=<codigo>&plano=<key>` via Web Share nativo (celular/PWA) com fallback copiar. Landing rola até o card do plano (`?plano=`).
   (c) **BUG corrigido de atribuição:** Planos NÃO capturava `?ref=` → o link de venda para /planos perdia a indicação ao ir ao checkout/cadastro (parceiro não recebia crédito). Agora Planos grava `tsn_ref_codigo` no mount (mesmo mecanismo de Checkout/ProdutoPublico; consumido por `vincular_upline` no signup).
   (d) **Tela de planos VOLTOU após o login (pedido do dono) + CTA contextual.** O link "Planos" no topo estava OCULTO para logado (`Header.jsx` — a gestão migrara p/ Perfil › Assinatura) → Assessoria/Leilão Club "sumiam" para quem já tinha conta. Reabri o link no menu logado. Em `Planos.jsx`, cada card agora rotula pela escada de planos (`RANK` explorador<top2<assessorado<clube): plano ATUAL = "Seu plano atual" (desabilitado); ABAIXO do atual = "Fazer downgrade" (→ Meu Perfil › Assinatura, sem refazer cobrança); ACIMA = "Contratar/Assinar". Ex.: Investidor Pro vê Explorador "Fazer downgrade", IP "Seu plano atual", Assessoria/Club "Contratar". "Fazer downgrade" leva a `/perfil?aba=assinatura`. No Perfil (Zona LGPD), para PAGANTE o botão vermelho virou **"Cancelar assinatura paga"** (abre o cancelamento → vira Explorador; a exclusão total LGPD fica acessível depois, já como Explorador — mantém o fluxo 2-passos existente); Explorador segue com "Excluir minha conta". O "Planos" no menu logado já está no ar (`1f83069`) — se não aparece, é bundle do PWA em cache (fechar/reabrir o app).
3. **PWA iOS — botões atrás da barra de status (safe-area) — CÓDIGO corrigido.** Reportado pelo dono: no app instalado, o topo das telas ficava SOB o relógio/bateria do iPhone (botão "Voltar ao app" do Admin inclicável). Causa: `index.html` usa `viewport-fit=cover` + status bar `black-translucent` (conteúdo começa no y=0, sob a status bar); o `Header` compartilhado já tratava com `env(safe-area-inset-top)`, mas as telas FORA do MainLayout tinham chrome próprio sem isso. Corrigido em: `Admin.jsx` (S.header), `AdminFinanceiro.jsx` (header), `LeiloeiroPortal.jsx` (container), `ProdutoPublico.jsx` (header), `components/LeitorEbook.jsx` (barra do leitor fullscreen) e `components/Header.jsx` (movi o inset p/ o `<header>` externo → os banners de modo-suporte/simulação de role também descem da status bar). Padrão: `paddingTop: calc(<pad> + env(safe-area-inset-top, 0px))` (inset=0 fora de iPhone com notch). PdfReader (controles em `sticky bottom`) e as telas centralizadas (Login/Checkout/Convite/…) já estavam OK. Login renderiza certo; o aviso de 2FA do Google em app instalado é esperado.
5. **Relatório mercadológico em cidade GRANDE sem base própria não sai mais em TELA DE ERRO (`main` @ `8c68689`, deploy READY).** Incidente reproduzido: **Belo Horizonte** (28/07 06:04) e, por diagnóstico, **Rio de Janeiro capital** (demo do dono hoje) têm **índice próprio ZERO** (cidade E estado sem amostra em `indice_amostra`) → sem cushion. Nessas praças a busca web AMPLA (7 usos) estourava o tempo (`__falhou`); a **2ª tentativa de 3 buscas TAMBÉM** estourava → `__instavel` sem valor e sem índice → `throw tempo_limite` (gerar-analise.js) → status `'erro'` ("A pesquisa demorou mais que o tempo limite"); o self-heal re-tentava 2× e também falhava (BH ficou `regen_tentativas=2`). **Correção por CAUSA na 2ª tentativa** (`api/gerar-analise.js` ~L1019): quando a 1ª **TRAVOU** (`__falhou`), a 2ª agora vai **RÁPIDA (1 busca web)** — uma única busca quase sempre CONCLUI, devolve um R$/m² de referência e entrega uma estimativa **apurada preliminar** (e **semeia o Índice** p/ os próximos relatórios da praça, quebrando o ovo-galinha do cushion). Se a 1ª veio VAZIA mas concluiu (praça fina), mantém a 2ª média (≤3 buscas). A busca AMPLA/apurada continua sendo a **1ª** tentativa — caso feliz inalterado; só o caminho de timeout deixa de virar erro. Report de BH resetado (`regen_tentativas=0`) p/ o self-heal reprocessar com o código novo. **Praia Grande (demo de hoje) já era SEGURA** (130 amostras venda + 26 locação no índice). **Recomendação p/ demo:** gerar o relatório do Rio **~30–60 min antes** da reunião — a 1ª geração já cai no fallback rápido, fica em cache (instantâneo na hora) e semeia o índice; qualquer surpresa aparece com antecedência.

**OBSERVABILIDADE / LOGS + CLIENTE 360 (pedido do dono: "tudo o que qualquer usuário faz tem de aparecer nos logs p/ caçar erro/falha/quebra; conferir via Cliente 360"). Auditoria multi-agente + evidência de produção:**
- **Panorama (6 sinks, NÃO há logger único):** `atividade_log` (linha do tempo do 360, via RPC `registrar_atividade`/lê por `atividade_usuario`) · `eventos_atividade` (clickstream: pageview/click/api_erro/api_vazio, via `tracker.js`→`/api/track`) · `erros_cliente` (crashes JS: ErrorBoundary + window.onerror/unhandledrejection, mesmo pré-login) · `audit_logs` (ações sensíveis: pagamento/contrato/CPF) · `uso_integracoes` (custo IA) · `uso_servico` (login — write-only/morto). Evidência prod (30d): atividade_log só tinha eventos de RELATÓRIO (mercado/documental/laudo/arremate); eventos_atividade 343 clicks + 222 pageviews + 1 api_erro; **erros_cliente = 0 abertos** (todos resolvidos; recentes eram chunk-stale pós-deploy, auto-recuperados — pipeline de crash ÍNTEGRO).
- **CORRIGIDO nesta sessão (deploy `main` @ `b4ebc6d`):**
  1. **G1 (maior impacto) — clickstream ficava INVISÍVEL no Cliente 360.** O tracker coletava e a RPC `atividade_navegacao` existia e o painel "Navegação e cliques" já renderizava, mas `api/admin-usuario-360.js` NUNCA preenchia `data.navegacao` → painel sempre vazio. Passa a anexar (200 últimos). Agora o 360 mostra tela-a-tela + cliques + falhas/relatórios-vazios de cliente/parceiro/equipe.
  2. **`api_vazio` era descartado** — `apiCall.js` enviava, mas caía fora da allowlist `TIPOS` do `/api/track` e sumia (era justo o "relatório sem estimativa"). Incluído.
  3. **`revenda` sem escritor** — `sinalizar-revenda.js` não logava (o 360 tinha o rótulo, ninguém escrevia). Adicionado `registrar_atividade('revenda')`.
  4. **`saque` (financeiro) invisível** — adicionado log best-effort em todos os caminhos de sucesso (equipe, parceiro validado, auto-QSA, validação manual) em `api/saque.js`.
- **LACUNAS AINDA ABERTAS (documentadas p/ passe dedicado — tocam arquivos sensíveis, deixar p/ janela com teste, NÃO na véspera de demo):**
  - **Pré-login não logado:** signup/reset/verify e **FALHA de login** são client-side `supabase.auth.*` (`Login.jsx:146/247/264/311`); só o login com SUCESSO vai ao sink morto `uso_servico` (`AuthContext.jsx:183`). Ação: postar desfecho (ok+falha) a um endpoint logado, ou auth-hook do Supabase → `atividade_log`.
  - **Ações sensíveis sem log:** KYC/selfie (`verificar-identidade-kyc.js`, `validar-selfie.js`), LGPD-excluir (`lgpd-excluir.js`), upload (`upload-anexo.js`), checkout grátis (`criar-conta-checkout.js`, `assinar-com-cadastro.js`). Ação: `auditLog` (sensível) + `registrar_atividade` (timeline).
  - **Webhooks engolem desfecho:** `mp-webhook.js`/`asaas-webhook.js` sem `auditLog` (falha de reconciliação só no Vercel log). Ação: `auditLog('webhook_*', sucesso, detalhes)` no processado e no catch.
  - **Adesão de parceiro / equipe / comissões:** `aceitar_parceria` é RPC client-side (`ConviteParceiro.jsx:90`) → sem timeline; ação: trigger de banco ou passar por endpoint logado.
  - **`audit_logs` não aparece no Cliente 360** (ações de admin/pagamento ficam fora da tela de validação do dono). Ação: surfaçar `audit_logs` na resposta do `admin_usuario_360`.
  - **`logAtividade` duplicado** em gerar-analise/documental/laudo + inline no arremate → criar `api/_atividade.js` único (dívida técnica, não urgente).

**CONTRATOS — bug de envio + testemunha por link + notificações (28/07, deploy `main` @ `861393c`):**
- **BUG que travava TODO envio de contrato ("Erro ao salvar contrato"):** `gerar-contrato.js` inseria `requer_assinatura:true` em `contratos_link`, mas essa **coluna NÃO existe** → PostgREST rejeitava o insert. Removido. A MESMA coluna-fantasma gateava o form de assinatura interna em `Contratos.jsx` (nunca aparecia) → corrigido p/ gatear só por status.
- **Testemunha por LINK (pedido do dono):** cada parte agora recebe um link (`#/t/<testemunha_token>`) para encaminhar à SUA testemunha, que abre, vê o contrato + de quem é testemunha, preenche nome/CPF e assina — sem estar junto da parte (antes a testemunha assinava na MESMA tela). Migração `contratos_testemunha_por_link.sql` (coluna `testemunha_token` + RPC pública `get_contrato_testemunha` que devolve só campos não-sensíveis, nunca KYC/CPF da parte); endpoint novo `api/assinar-testemunha.js` (edge, IP+carimbo+hash); `TestemunhaLink.jsx` + rota `/t/:token`; a parte assina sozinha (`ContratoLink.jsx`) e vê o link da testemunha na tela final. Contrato completo = parte (`status='assinado'`) **e** testemunha (`testemunha_em`).
- **Notificação a cada assinatura:** ao assinar (parte ou testemunha), o CRIADOR recebe e-mail ("X/Y assinaram" / "totalmente assinado" / "testemunha assinou") + entra na linha do tempo do Cliente 360 (`contrato_assinado_parcial/_completo`, `testemunha_assinou`).
- **Copiar link de cada parte:** a tela de conclusão do CriarContrato já mostra (e agora com feedback "✓ Copiado!") o link de CADA parte + o link da testemunha de cada parte; e-mail continua indo a cada parte. Documento assinado fica disponível em Contratos (Baixar comprovante).
- **Segurança:** `get_contrato_testemunha` entrou na allowlist do auditor; `auditoria_seguranca()` = **0 crítico / 0 atenção**.

**ABERTO — priorizado p/ o dono (varredura multi-agente de bugs + advisors; NÃO corrigido, precisa decisão/migração dedicada):**
- **[SEGURANÇA/MÉDIA] Criação de conta + enumeração — CORRIGIDO (branch, aguarda promoção).** (a) `api/verificar-cpf.js`: o insert do rate-limit era fire-and-forget no Edge → limiter inoperante → enumeração de CPF/e-mail. Agora AGUARDA o insert (registra antes de contar; cross-instância via DB, sem depender de Upstash); teto 6/min/IP passa a valer. (b) `Calculadora.jsx` `submeterLead` passou a checar `res.ok` (antes roteava errado em 429/5xx). (c) **Squatting** (conta criada sem prova de posse do e-mail): decisão do dono = **manter acesso instantâneo + e-mail de aviso, PARA TODOS os cadastros**. Implementado de forma UNIVERSAL: novo endpoint `api/boas-vindas.js` + coluna `perfis.boas_vindas_em` (idempotente, marca antes de enviar) disparado pelo `AuthContext` no **1º SIGNED_IN** — cobre TODOS os caminhos (checkout grátis, checkout pago, cadastro normal, Google, convites) enviando 1× por conta. Helper `enviarBoasVindas` em `_email.js` (fonte única; removido o envio inline do criar-conta-checkout). E-mail traz caminho de reclamação ("Esqueci minha senha" → link só chega no e-mail do dono real). Best-effort, não bloqueia login/cadastro. Criação em massa segue limitada por IP (`_rate-limit.js`, 5/min; global exige Upstash — pendência do dono). (`pg_net`/`http` não instalados → trigger de banco não é opção sem infra do painel.)
- **[ACESSO/ALTA-latente] Vídeos de curso vazam.** `src/pages/Curso.jsx:68` e `Membros.jsx:97` fazem `select('*')` em `aulas_admin` (expõe `video_url`/materiais a QUALQUER logado; gate é client-side). Latente HOJE (`cursos_admin` vazio). ANTES de lançar curso: RPC de entitlement espelhando `obter_arquivo_ebook` + revogar colunas de `authenticated`.
- **[BAIXA] Robustez.** `api/daily-webhook.js:56` insere transcrição sem idempotência (dup + custo Gemini na reentrega); `.json()` sem `.ok` (fail-safe, mas mascara indisponibilidade como "revisão"): `verificar-identidade-kyc.js:131`, `validar-anexos-arremate.js:104`, `enviarRostoKYC` (`Perfil.jsx:579` → falso "selfie recebida"); double-click sem ref-guard síncrono em saque (`Comissoes.jsx`/`MinhaRede.jsx`) e no cadastro grátis do Checkout.
- **[ESCALA — rumo a 10k] Advisors — PARCIALMENTE FEITO em produção (via MCP, verificado):**
  - ✅ **`auth_rls_initplan` — RESOLVIDO (170 políticas).** `rls_initplan_wrap_auth.sql`: DO block atômico que envolve `auth.uid/role/jwt/email()` em `(select ...)` (avalia 1×/query em vez de por linha). SEMANTICAMENTE IDÊNTICO (não muda acesso). Verificado: `realmente_sem_wrap=0`, `com_wrap=170`, `auditoria_seguranca()=0/0`. Nenhuma política usa `current_setting` (não precisou tratar).
  - ✅ **Índices — RESOLVIDO.** `escala_indices_fk_e_duplicado.sql`: dropou o índice DUPLICADO `atividade_log_user_idx`; criou índices das FKs `cota_concessoes.concedido_por` e `perfis.rank_key`.
  - ⏳ **`multiple_permissive_policies` (483 lints) — DEFERIDO (fazer com revisão).** Consolidar políticas permissivas sobrepostas (mesma tabela×ação×papel) exige MERGE de lógica (união de USING com OR) por tabela — risco de sobre-restringir (quebra acesso) ou sobre-permitir (expõe dado). NÃO é aditivo/idêntico como o initplan. Prioridade: tabelas quentes `imoveis_leilao`/`perfis`/`imoveis`/`chamados`. Precisa de passe dedicado + re-auditoria 0/0 (idealmente com teste de RLS por papel). NÃO há branch de banco disponível aqui (list_branches falhou) — então rodar em janela de baixo tráfego.
  - ⏳ **Auth em conexões ABSOLUTAS (10) — NÃO-ACIONÁVEL AGORA (verificado).** Não é limite de role (todos `rolconnlimit=-1`) nem a tela de Connection Pooler (Supavisor 15/200, que já escala com compute) — é config INTERNA do GoTrue, sem toggle direto no painel atual. `max_connections=60` (Micro). Resolve NA PRÁTICA ao subir o compute (Settings → Compute and Disk) perto da escala real; forçar antes = Management API/suporte Supabase. INFO, sem urgência a 16 usuários. Não mexer no Connection Pooler.

## PARCEIROS / RANKS — DIAGNÓSTICO 28/07 (pedido do dono; foundation ainda não divulgada)
> Config verificada: `comissao_regras` nível 1 = **assinatura 25% · produto (e-books/cursos) 25% · venda_direta (Assessoria/Leilão Club) 10%** (níveis 2-6 em cascata; 7+ = 0). `rank_config`: pool 0% (off), carência queda 2 meses, indicação 25%. **Confere com o pedido do dono (#4).**
> - **#1 (indicação só via link):** OK. `vincular_upline` só grava `indicado_por` a partir de um ref REAL (id ou `codigo_indicacao`), nunca sobrescreve e barra auto-indicação; roda no cadastro a partir do `tsn_ref_codigo` (do link). Atribuição à EMPRESA (venda sem link) e atribuição manual do admin são casos à parte (não dão crédito indevido a parceiro).
> - **#5 (repasse mediante pagamento):** OK. `distribuir_comissao_rede` roda por PAGAMENTO recebido — recorrência = mês a mês (só `subscription_authorized_payment`+`processed`); avulso/parcelado recebido de uma vez = distribui uma vez sobre o valor recebido. É a regra do dono.
> - **#3 (percentuais confusos):** copy da tela `MinhaRede.jsx` reescrita p/ mapear produto→%, com a regra de repasse.
> - **BUG do nível não promover (o print 2/1 mas "próxima conquista"):** (a) `recalcular_ranks` **NUNCA roda** (sem cron/rotina) → `perfis.rank_key` fica NULL; a tela só calcula o "próximo" on-the-fly. (b) A conta testada é **admin** (dono/empresa) e `rank_do_parceiro` retorna NULL para não-pagante (`eh_pagante`) → **admin nunca ganha rank** (por design; rank é p/ parceiro pagante). (c) Rodei `recalcular_ranks()` agora: 5 pagantes, **0 com rank** (nenhum pagante tem indicado pagante — só o nó empresa tem, e ele é admin). Pioneiro (r1) = **1 indicado pagante** (hardcoded em `rank_do_parceiro`; a coluna `min_diretos_pagantes` está 0/ não calibrada). **#2 (timing + data anunciada): RESOLVIDO.** (a) O fechamento MENSAL **já era agendado** por `/api/ranks-recalc-cron` (`0 6 1 * *`) — a nota antiga "sem cron" estava desatualizada. (b) Decisão do dono: **mensal (dia 1)** + o nó EMPRESA passa a ranquear (toda venda sem indicante vai pra empresa/dono → ele valida tudo pela conta). Migração `ranks_empresa_elegivel.sql`: `rank_do_parceiro`/`recalcular_ranks` agora incluem `rank_config.empresa_uid` além dos pagantes. Rodei o recálculo → a conta do dono virou **Pioneiro (r1)** (2 indicados pagantes); auditoria 0/0. (c) `MinhaRede.jsx` anuncia **"nível confirmado no fechamento mensal (dia 1) — próxima conferência: DD/MM"**. **CALIBRAÇÃO CONFERIDA (28/07) — bate EXATO com o Clube Conselheiro (§12.8.1), NADA a mudar:** a graduação por duplicação já está fiel — Pioneiro=1 indicado pagante · Fundador=2 Pioneiros · Mestre=2 Fundadores · Mentor=2 Mestres · Embaixador=3 Mentores · Guardião=5 Embaixadores (+0,5%∞) · Patrono=2 Guardiões (+1,0%) · Lenda=3 Patronos (+1,5%). A cascata de bônus de equipe (`comissao_regras` níveis 2-6 = **4/3/2/2/1**) também confere com o Conselheiro. A coluna `min_diretos_pagantes` é MORTA (o motor usa `req_pernas`/`req_sub_ordem`). Única divergência **intencional do dono**: venda_direta (Assessoria/Leilão Club) a **10%** — o dono confirmou 10% nesta sessão (o Conselheiro usa 25%). UI "só o próximo nível acima do atual" já funciona (filtro atual/proximo no `MinhaRede`).

**CAPTURA — BIASI regressão (MONITORADA, recon roda 01/08).** BIASI oscila (histórico 370/368/369 → 173/26/144/153/**96** desde ~17/07 = flakiness do scraper, NÃO encolhimento real do acervo). O site é bot-walled (403) deste sandbox → o recon da estrutura VIVA não roda aqui; a Rotina mensal **"Bug bounty dos leiloeiros"** (01/08, ambiente com Bright Data) faz o recon e distingue código×acervo. Hipótese de causa: Estratégia 1 (`?pagina`) em `scripts/scraper-puppeteer.mjs` `scraperBiasi` (~L2089) quebra cedo quando um `?pagina` renderiza vazio por lentidão/anti-bot (`if (!lotes.length) break`). Fix defensivo sugerido (estritamente mais seguro): `page.waitForSelector('a.leilao-lote[data-id]')` + retry-on-empty ANTES do `break` — nunca reduz a contagem. Monitor já alerta o dono (piso aprendido 130 · hardcoded 120).

## SESSÃO 12 (28/07 — índice FIEL + captura arrojada + anti-"relatório vazio" + observabilidade)
> Deploy `main` @ `1ad33cd` (production). **~10 deploys incrementais** no dia (cherry-pick sobre a main, todos READY, build vite OK em cada um). **9 migrações** via MCP (aditivas/retrocompatíveis). `auditoria_seguranca()` = **0 crítico / 0 atenção**. **ONR (cartório digital) PAUSADO pelo dono** — os 2 commits (`dc5ba54`,`76d3933`) ficam SÓ na branch de dev `claude/system-routine-checks-1fyoif`, FORA de produção (o deploy é cherry-pick que os exclui).

**Gatilho:** relatório de BH saiu VAZIO na frente de um cliente + preços do índice discrepantes. Auditoria multi-agente (3 agentes) + correções:

1. **Índice FIEL (raiz da discrepância)** `indice_padrao_bandas_e_sanidade.sql`: a agregação fazia MÉDIA PONDERADA sobre padrões MISTURADOS (Alphaville R$18k × popular R$2,5k → R$6.921 que não servia a ninguém). Agora `indice_regiao_ponderado`/`indice_bairros_cidade` **aparam outlier [p10..p90]** + devolvem **BANDAS de padrão** (popular=p25/médio=p50/alto=p75); `indice_plausivel(tipo,natureza,valor)` barra implausível **por tipo** na ingestão e na leitura (R$260/m² de apto não entra). Verificado Barueri/apto: pop R$5.190 · méd R$7.042 · alto R$9.167.
2. **ANTI-"relatório vazio" (causa-raiz = CÓDIGO MORTO)** `4f283c2`: `buscaInstavel`/`erroApiBusca` em `gerar-analise` eram declarados e **nunca usados** → timeout de busca sem almofada de índice salvava `concluida`+branco (cliente via vazio; self-heal de timeout não pegava). Agora timeout sem cobertura do índice lança `tempo_limite` → 504 "tente novamente" + estorno + self-heal + Cliente 360 registra ERRO. **FECHA o item D da sessão 11 (Goiânia timeout).**
3. **Busca ARROJADA + anti-timeout:** `indice-mercado` e `gerar-analise` sobem teto de amostras/tokens; **2ª tentativa ESTREITA** (≤3 buscas) p/ cidade grande concluir em vez de 502/vazio. Núcleo do gerador extraído p/ `api/_indice-core.js` (reuso sem divergir).
4. **REFORÇO proativo do índice — DESLIGADO por padrão (decisão de custo do dono, ~US$300/mês):** `api/indice-reforco-cron.js` (cron `35 */4`, gate `isCronAuthorized`) semeia cidades magras que importam (`indice_reforco_proximas`, backlog ~204). **Ligar com env `INDICE_REFORCO=1`.** A base segue alimentada ORGANICAMENTE a cada relatório.
5. **Cascata 250m → 1km → cidade → ESTADO:** novo `indice_estado_ponderado(uf,tipo)` (referência ampla quando a cidade não tem base) plugado no card e no fallback do relatório. + `indice_composicao(...)` responde "quantas amostras em cada nível" (localidade/bairro/cidade/estado) triado por tipologia e padrão — painel "Composição" no `IndiceConsulta.jsx`.
6. **TRIANGULAÇÃO do imóvel-alvo no relatório** (FECHA o "PENDENTE fast-follow" do item C da sessão 11): `ancorarImovel()` re-geocodifica o alvo pelo ENDEREÇO+CEP(Correios)+IBGE — cascata GRÁTIS de `_geo.js`, sem Google — quando a coord é imprecisa (~27% dos ativos são bairro/cidade/nula); persiste a coord melhor (conserta índice + próximos relatórios). Âncora do raio de 250m.
7. **CAPTURA AMPLA por bairro** `a4ce186`: toda busca de relatório passa a extrair o MÁXIMO de anúncios do mesmo tipo em QUALQUER bairro da cidade (balde `outrosBairros`, cada um marcado com seu bairro) — compõe bairro→cidade→estado a cada relatório. Cada amostra vai à base com o SEU bairro (não o do alvo). Régua **por tipo** nas escritas/leituras (terreno R$150/m² deixa de ser cortado pelo piso plano 200 — **FECHA o "revisar piso valor_m2>=200" da sessão 11**).
8. **FONTES LOCAIS por praça (revalidação ORGÂNICA)** `1ad33cd` `fonte_local_cidade_registro.sql`: o relatório descobre imobiliárias locais, memoriza (`fonte_local_cidade`) e reusa as vistas nos últimos 120d (injeta no prompt → economiza busca de descoberta). Empresas que fecham envelhecem sozinhas (só as frescas são injetadas) — **sem cron de manutenção**. RPCs `fontes_locais_frescas`/`registrar_fontes_locais` (dedup por domínio).
9. **Cliente 360 — falhas VISÍVEIS:** a falha de hoje estava no `atividade_log` (causa "This operation was aborted", BH 3×/Goiânia 2×) mas o 360 não mostrava. Agora: tile + painel **"Relatórios que falharam (24h)"** (causa·cidade); `admin_360_estatisticas` devolve `relatorios_falha_24h/7d`+`falhas_recentes`; `admin_usuario_360` devolve `com_erro`/`vazias` por tipo (RelatorioCard mostra); `admin_busca_usuarios` marca ⚠ também por falha de relatório; "Atividade recente" renderiza o diagnóstico do `meta` (Causa·Fonte·Comparáveis·Cidade·Imóvel); `apiCall` registra o "200-mas-vazio" (`api_vazio`).

**PENDENTE (próxima sessão):**
- **Agente de saúde de dados (3º da auditoria) não retornou** — rodar a varredura de relatórios presos/erro + anomalias de índice e corrigir o que aparecer.
- **Densidade hiperlocal:** a âncora de 250m está resolvida, falta VOLUME dentro do raio. Caminho decidido: NÃO scraper de portal fixo (fraco no interior) — é o **registro de fontes locais** (já no ar) + a captura ampla compondo ao longo dos relatórios. Reavaliar se precisa de fetch dirigido (Bright Data) só nos sites locais pesados (JS) já descobertos.
- **Regenerar relatórios** para constituir o índice denso: só faz sentido com o motor arrojado já em prod (está) — o `regenerar-relatorios-cron` já re-emite os vazios/erro; para densificar em massa, ligar `INDICE_REFORCO=1` ou aguardar a composição orgânica.

## SESSÃO 10 (27/07 — bugs varredura, MLM recorrente, índice anti-poluição/reuso/todos-os-tipos, créditos, coleta grátis)
> Deploy `main` @ `6e5063a` (production). Muitos deploys incrementais no dia (todos verificados READY). Build (vite) OK em cada um. **6 migrações** via MCP (todas aditivas/retrocompatíveis) + operações de dados pontuais. `auditoria_seguranca()` = **0 crítico / 0 atenção** após as migrações.

**ENTREGUE EM PRODUÇÃO (nesta sessão):**
1. **Varredura de bugs (abertura)** `09510f6`: anti-interposição no saque (cliente não valida a própria PJ; trigger `proteger_campos_sensiveis_perfil` reverte pj_validada em self-update — `perfis_trigger_protege_pj_validacao.sql`); PagamentoServico lia Response como JSON (risco de cobrança dupla) → `res.ok`+`.json()`; crons de dinheiro fail-CLOSED (cancelar-nao-pagos, saldo-abandono só avança aviso se e-mail enviou); webhook refund + idempotência.
2. **Motor de comissão — BUG SILENCIOSO de pagamento** `e0b2535` (`comissoes_dedup_multi_nivel_fix.sql`): índice único era `(gateway_payment_id, origem)` e origem é constante por pagamento → o 2º lançamento (nível 2+/bônus infinito) violava a unicidade, a RPC abortava sem handler e **NENHUMA comissão era paga**. Regrain p/ `(gateway_payment_id, beneficiario_id, tipo)` + idempotência em saldo_lancamentos. Dormente hoje (ranks r1), quebraria na 1ª promoção.
3. **Comissão recorrente MP (E2)** `4c090ee`: `ativarPlanoDireto(cobranca)` distribui comissão de rede SÓ com pagamento recebido (`subscription_authorized_payment`+`ap.status=processed`); autorização sem pagamento/reconciliação → não comissiona. Regra do dono: **repasse MEDIANTE PAGAMENTO, sempre**. + trilha de carreira no "Seu Nível" (`meu_nivel_trilha_carreira.sql`) + plural pt-BR + chip incremental.
4. **Índice anti-poluição** `5d2928d`: mercadológico passou a aplicar a BANDA CENTRAL p25–p75 (paridade com o Índice) — Barueri set-dez/2025 R$3.990→R$8.888; `_indice-composicao.js` usa valor central da região quando o período tem <2 no padrão + flag `fora_padrao`. **Gate de origem do documental** (geração NOVA exige mercadológico concluído; isenta cron/onBehalf).
5. **Reuso por QUADRIMESTRE** `b061c4a` (`gerar-analise.js`): reaproveitamento regional LIGADO por padrão (desliga só `MERCADO_CACHE=0`); frescor por `data_ref` (quadrimestre do anúncio) — região com ≥8 amostras no quadrimestre atual reusa (busca 5→2); dado antigo → busca completa refaz e atualiza o índice p/ todos. Regra do dono: "todo dado aproveitado, evita desperdício".
6. **Colheita do índice robusta** `22f8961`: `gravarAmostrasIndice` não depende mais do lote no `imoveis_leilao` (fallback de região pelo snapshot do relatório) — evita busca paga virar lixo. **Backfill** de 5 mercadológicos órfãos (143 vendas + 53 locações reais que não tinham sido colhidas). Gap = 0.
7. **Auto-cura de PARECER VAZIO** `d37f2fd` + **estorno de cota** `19df59d`: `regenerar-relatorios-cron` regenera mercado concluído-com-parecer-em-branco (bug do erro de API silenciado) SEM cobrar, e **devolve 1 cota** ao assinante (`analises_mercado.cota_estornada`, idempotente; estornar é no-op p/ quem não foi cobrado). Alessandra restituída manualmente (6→5).
8. **Modo suporte concede consultas (#20)** + **tela Meus Créditos (#21)** `a392bf4` (`cotas_concessao_suporte_e_resumo.sql`): coluna `bonus_indice` + `consumir_indice_por` usa; tabela `cota_concessoes` (RLS self/admin); RPC `admin_conceder_cota` (gated admin/analista) + botão "🎁 Conceder consultas" no Admin; RPC `minhas_cotas` + página **`/creditos`** (3 cotas/bônus/saldo/extrato) + atalhos Home/Header.
9. **Índice "Todos os tipos"** `1db962f`+`19df59d`: 1 busca ampla cobre os 4 tipos (economia), apresenta por tipo. **Bug corrigido:** matching de tipo estrito derrubava amostras (rótulos variantes) + JSON truncava → `canonTipo` tolerante + `max_tokens` 8000 no todos.
10. **Caixa venda-online documental** `6e5063a`: não trava mais pedindo "edital" (que não existe na venda online) quando a matrícula foi lida — as regras online padronizadas satisfazem o gate p/ CEF.

**➕ SESSÃO 11 (28/07 — pedidos do dono):**
1. **Trilha de carreira só mostra o nível ATUAL + o PRÓXIMO** (`MinhaRede.jsx`): filtra `nivel.trilha` por estado `atual`/`proximo`; níveis conquistados e futuros ficam ocultos (o parceiro descobre à medida que gradua). Sem mudança de dados/RPC.
2. **VLANCE residencial-first + economia** — ver item A abaixo (atualizado).
3. **Índice mapa por bairro + triangulação da posição (condomínio/CEP/endereço) + geo_nivel** — ver item C abaixo. Migrações `indice_bairros_cidade.sql`, `indice_amostras_endereco_para_triangular.sql`, `indice_amostras_condominio_e_geonivel.sql` aplicadas; `auditoria_seguranca()` seguiu **0/0**.
4. **SEGURANÇA — token de auth vazava no log de atividade (`d6c96ca`):** a Alessandra logou hoje e o pageview gravou o `access_token` JWT como `rota` em `eventos_atividade` (fluxo implícito do Supabase + HashRouter → URL pós-login `#access_token=...&refresh_token=...`; o tracker capturava o hash cru antes do Supabase limpar). Corrigido em `tracker.js` (`rotaAtual()` → `/(auth-redirect)`) + `api/track.js` (guarda server-side `redigir`) + **redação das 6 linhas já gravadas** (2 usuários, todas de hoje; tokens Supabase expiram ~1h → já expirados). `auditoria_seguranca` do banco não cobre isso (é log de app) — cai no item 4/6 do ritual.
5. **Alessandra "erro no acesso":** um **HTTP 504 pontual** em `/api/proximidades-imovel` (timeout Overpass/OSM) às 12:50, 1x em 14 dias; a página não quebrou. Transitório.
6. **Radar de Editais (CNJ) — panorama:** ver bloco "RADAR — DIAGNÓSTICO 28/07" abaixo.

**📡 RADAR — DIAGNÓSTICO 28/07 (verificação, sem mudança de código):**
- **O que é:** monitor admin read-only (`Admin.jsx` `RadarEditaisTab` → RPC `admin_radar_editais`) que puxa **editais de leilão de imóvel do DJEN/CNJ** (`comunicaapi.pje.jus.br`, público, via Bright Data pq o WAF dá 403 em datacenter) 2 em 2… na verdade **4/4h** (`radar-editais-cron`, janela deslizante 3d), filtra ruído (`ehEditalReal` + IA Gemini/Haiku `nao_edital`), faz parse (leiloeiro/avaliação/lance/praça/matrícula/URL/cidade) e grava em `editais_leilao`. Cobertura: **TJSP+TRT-15/SP** (hardcoded SP; abrir p/ BR = só env `RADAR_TRIBUNAIS`). Termos: `RADAR_TERMOS`.
- **Cadeia de valor hoje:** cron chama `editais_enriquecer_acervo()` que cruza `editais_leilao`×`imoveis_leilao` **por número de processo** (match forte) e por `lance_minimo` (fraco) e preenche avaliação/área/endereço faltantes. O badge **"integrar" é só status, NÃO é botão** (a ação de onboard-leiloeiro foi planejada e nunca construída — `docs/RADAR_EDITAIS_CNJ.md:33`).
- **Números reais (30d):** 75 editais = **40 processados** (só 4 c/ URL de plataforma, 37 c/ matrícula) + **18 erro_parse** (têm processo+matrícula mas 0 avaliação/leiloeiro parseado) + **17 nao_edital** (IA rejeitou, mas AINDA contam nos KPIs — infla ~23%). **0 já no acervo, 0 leiloeiro integrado, 0 cruzam por processo** → o enriquecimento está **INERTE** hoje (nenhum edital SP casa com o acervo).
- **Diagnóstico:** a captura funciona; a **cadeia de valor não fecha** — os editais são de leiloeiros/processos que não estão no acervo, então nada é enriquecido e o "a integrar" (75) fica parado sem ação. É informativo e **subutilizado**.
- **Oportunidades (ordem de valor):** (1) fechar o loop **"a integrar" → onboarding de leiloeiro** (botão vivo → fila em `leiloeiro_conhecimento` + dispara a ofensiva de captura); (2) **virar FONTE**: p/ editais com `leilao_plataforma_url`+dados, inserir direto em `imoveis_leilao` (imóvel novo) mesmo sem scraper do leiloeiro; (3) **cruzar por MATRÍCULA** (37/75 têm), não só processo, e **alertar** quando um edital toca um imóvel já no acervo (nova praça/data) ou uma oportunidade quente; (4) reduzir os **18 erro_parse** (IA fallback dedicado — têm matrícula/processo, dá pra extrair); (5) **excluir `nao_edital` dos KPIs**; (6) expandir cobertura p/ outros tribunais/UFs por env.

**⚠️ ABERTO — COMEÇAR POR AQUI (decisões do dono já tomadas):**
- **A) VLANCE — RESOLVIDO; agora RESIDENCIAL-FIRST, Bright Data só fallback (28/07).** Estava 100% zerado: API Vlance dá 403 em datacenter e a via client-side (`coletaCliente.js`) falha por CORS/anti-bot **mesmo do IP residencial do staff** (o `fetch` do NAVEGADOR é barrado independente do IP → `coleta_cliente.ultima_em` nulo). `scraper_vlance.py` roteia get-leiloes (GET) e get-lotes (POST `body=page=N`) — **1º DIRETO (residencial, grátis); só cai na Bright Data Web Unlocker se o direto for bloqueado** (o corpo POST no /request é campo **`body`**, não `data`). Flags: `VLANCE_FORCE_BD=1` (pula o direto — a CI usa, é datacenter), `VLANCE_NO_BD=1` (100% residencial — o runner usa). **VERIFICADO:** 28 imóveis VLANCE reais (Araraquara/Barueri/Birigui/Campo Mourão…). **ECONOMIA (residencial):** `runner-residencial.sh` agora coleta VLANCE (`VLANCE_NO_BD=1`) junto de SOLEON/GESTAO/RJ do IP de casa (grátis) — basta o dono agendar o cron em `~/.bidpro-runner.env` (ver `docs/RUNNER_RESIDENCIAL.md`). O workflow CI `scraper-vlance.yml` virou **rede de segurança**: `--pular-se-fresco 48` → se o residencial já atualizou o VLANCE nas últimas 48h, a CI PULA e **não gasta Bright Data**; só coleta (via BD) quando o residencial não rodou. As 4 fontes grátis seguem `coleta_cliente.ativo=false`, monitoradas por FRESCOR (`FONTES_SEM_SAUDE`). **Por que não pelo login (navegador):** CORS/Cloudflare barram o `fetch` do navegador mesmo residencial — por isso a via residencial confiável é o RUNNER (processo), não a aba.
- **B) ASSISTENTE DO PARCEIRO (onboarding passo a passo) — pedido do dono:** ao solicitar ser parceiro: (1) completar dados que faltam → (2) aceitar termos → (3) selfie → (4) CNH, **um de cada vez**. STATUS: **NÃO construído.** Hoje as peças existem soltas (aceite em `HomeCliente.jsx` via `aceitar_parceria` v6-2026-07; KYC selfie+documento/CNH em `Perfil.jsx` seção Parceria — pede selfie do rosto + documento com CNH). Antonio JÁ consegue entrar hoje pelo fluxo atual. NEXT: montar o wizard sequencial.
- **C) Índice — MAPA DA CIDADE POR REGIÃO (28/07, pedido do dono "pega uma cidade, traz tudo, classifica por região; onde falta usa a média"):** o consultor já cascateava 250m→1km→média-da-cidade (`indice_regiao_ponderado` nível 1/2/3, ≥5 amostras). O que faltava era **coleta**: toda amostra de uma geração ficava colada no MESMO ponto/bairro da consulta → busca de cidade virava 1 média só. Agora `indice-mercado.js` pede o **BAIRRO de CADA amostra** e, sem rua/bairro, usa prompt "MAPEIE A CIDADE" (espalha por vários bairros); `montarAmostras` grava o bairro por amostra. Nova RPC `indice_bairros_cidade(cidade,uf,tipo)` (service-only, ≥3 amostras/bairro) + `regioes[]` no retorno de `indice-mercado`/`indice-consulta` + bloco "Mapa da cidade por bairro" no `IndiceConsulta.jsx`. **VERIFICADO** com dado real: Carapicuíba/SP → Centro R$7.026/m², Pousada dos Bandeirantes R$7.362, V. Sta Terezinha R$7.039. Bairro fino cai na média (nível 3).
  - **TRIANGULAÇÃO da posição a 250m (28/07):** o motor de geocodificação JÁ existia (`api/_geo.js` `geocodificarCascata` = IBGE valida/centróide + Correios/ViaCEP normaliza + BrasilAPI/Nominatim dão a coordenada; usado no acervo `imoveis_leilao` via `/api/geocodificar` de hora em hora, rotas grátis). O que faltava era rodar as AMOSTRAS por ele. Agora `indice-mercado.js` captura `endereco`(logradouro+nº) e `cep` por amostra; `indice_amostras` ganhou colunas `cep/endereco/geocod_em` + `ingerir_amostras_indice` grava (migração `indice_amostras_endereco_para_triangular.sql`, aplicada, auditoria 0/0). Novo cron **`indice-geocodificar-cron`** (`50 */4 * * *`) pega amostras sem lat/lng que têm CEP/endereço/condomínio e roda a cascata **SÓ nas rotas grátis** (`permitirPago:false`) → **custo ~US$0** → preenche lat/lng por imóvel, e a resolução por 250m (`indice_regiao_ponderado`) passa a valer de verdade. Amostra só-bairro não entra (o "mesmo bairro" já é nível 1 sem coordenada).
  - **TRIAGEM do sinal + precisão (28/07):** anúncio dá ora o CONDOMÍNIO, ora rua s/ número, ora endereço completo. `geocodificarCascata` (`_geo.js`) agora aceita `condominio` e o trata como âncora precisa — entra na frente da string do Google + ganha passo próprio de POI no Nominatim (grátis) ANTES do logradouro (prédio nomeado > rua s/nº). Cada amostra guarda `condominio`, `endereco`, `cep` e o **`geo_nivel`** que a triangulação alcançou (endereco/rua/bairro/cidade = posição EFETIVA vs APROXIMADA) — migração `indice_amostras_condominio_e_geonivel.sql` (aplicada, auditoria 0/0). **Bônus no ACERVO:** o `imoveis_leilao.nomecondominio` (que existia e era IGNORADO) agora entra na geocodificação em lote (`geocodificar.js`) e on-demand (`geocodificar-imovel.js`) → pinos mais precisos nos leilões também. **PENDENTE (fast-follow):** espelhar no mercadológico (`gerar-analise.js` grava em `indice_amostra` SINGULAR com bairro/geo_grid/lat/lng todos do imóvel-ALVO; comparáveis são vizinhos do alvo já geocodificado, então o ganho lá é menor — mas dá p/ pedir bairro/cep por comparável e triangular igual). NEXT (cidade pequena Minaçu/GO): retry-on-empty p/ o índice + revisar piso `valor_m2>=200` (terreno tem R$/m² baixo).
- **D) Mercado — timeout de busca em cidade nova:** Goiânia deu `"This operation was aborted"` (busca completa de 5 usos estourou o tempo) → mercadoVazio; o self-heal reprocessa e não cobra. NEXT: tunar orçamento/tentativas se recorrer.


> Deploy `main` @ `0bf3002` (production **READY**, verified). Build (vite) OK · **9 migrações** via MCP (aditivas/retrocompatíveis) · env `ABANDONO_ATIVO=true` + `RESEND_WEBHOOK_SECRET` setadas pelo dono + redeploy. Toda a sessão foi pedida pelo dono a partir da validação do preview do saque PJ.

1. **Recibo do repasse (não-bloqueante).** Ao PAGAR um saque, o admin anexa o **comprovante do Mercado Pago** (bucket `documentos`) + **descrição breve**; o parceiro vê "Recibo: … · ver comprovante" no extrato (`/comissoes`). Colunas `saldo_lancamentos.comprovante_url/comprovante_desc/pago_em/pago_por` (`recibo_repasse.sql`); `api/saque.js` (pagar/pagar_todos); Admin `PrestacaoContasTab` (upload + campo); `Comissoes.jsx`. **NF fiscal (a PJ do parceiro emite) ficou p/ depois** — decisão do dono (viu exigir nota como trava). Empresa pagadora: **Nogueira Empreendimentos LTDA, CNPJ 02.311.492/0001-61**.

2. **Revalidação PJ — aprova UMA vez → saca à vontade + reconferência mensal.** Removida a validação manual a cada 2º saque. Cron **`pj-revalidacao-cron`** (mensal) reconfere QSA + situação do CNPJ (fail-OPEN: API fora → não mexe; só marca "regressão de sócio" quem validou COM match; CNPJ irregular vale p/ todos). Divergência → **BLOQUEIA o saque, NÃO reserva** (o crédito acumula e **não expira**; gate na RPC `solicitar_saque_ledger`) + **popup volta no Perfil**. Colunas `pj_revalidacao_pendente/_motivo`, `pj_revalidado_em` (`pj_revalidacao_periodica.sql`); RPC `marcar_revalidacao_pj`; `validar-pj-socio.js` reprocessa quando pendente (não diz "já validada").

3. **Financeiro — REAL recebido × PROJEÇÃO.** Plumbing (as tabelas estavam INERTES): `mp-webhook.js` popula `mp_assinaturas` (estado) + `mp_pagamentos` (cobrança recorrente=mensalidade / avulso=venda, por `operation_type`; coluna `origem` em `mp_pagamentos_origem.sql`); backfill de assinaturas no `reconciliar-assinaturas-cron` (horário, custo 0) + novo **`backfill-mp-pagamentos-cron`** (semanal, teto 50 pág). Tela **"📊 Síntese"** (aba padrão de `AdminFinanceiro.jsx` → `SinteseFinanceira`) via RPC `financeiro_resumo` (`financeiro_resumo.sql`) + endpoint `api/financeiro-resumo.js` (só admin): realizado (entradas = mensalidades + vendas · saídas · resultado · a pagar · comissões acumuladas) separado da projeção (MRR se todos efetivarem) + gráfico mensal. **O "R$50" NÃO era mock** (todo valor é live; `saldo_a_pagar_total` real = R$74,96). ⚠️ enche conforme webhook/backfill rodam (só valem em produção).

4. **Abandono de saldo (90 dias) — LIGADO.** Atrelado à **DIVERGÊNCIA** (revalidação pendente = precisa atualizar CNPJ). Cron diário **`saldo-abandono-cron`**: **3 avisos** (1º imediato + 2 aos ~30/~60 dias, cobrando atualização e lembrando a cláusula) → **caducidade aos 90 dias** (o valor fica p/ a empresa). **REVERSÍVEL** (`reverter_saldo_abandono` lança `caducidade_abandono` que zera o saldo; admin pode estornar). Atualizar dados/revalidar/sacar **interrompe**. Colunas `abandono_inicio_em/_avisos/_avisado_em/_em`, `pj_dados_atualizados_em` (`saldo_abandono.sql` + `abandono_cadencia_avisos.sql`). **Termos Seção 8.1** "Crédito condicionado e caducidade por inatividade" (`src/pages/Termos.jsx`). **Base legal:** `docs/BASE_LEGAL_ABANDONO_SALDO.md` — **90 dias NÃO se sustenta por prescrição** (é de anos, CC 206); só por **cláusula de caducidade + crédito condicionado** (CC 121-130), com aviso prévio. **Avisos rodam sempre; a REVERSÃO é gated por `ABANDONO_ATIVO` (LIGADO pelo dono).** ⚠️ **PENDENTE DONO: revisão jurídica da cláusula 8.1** (recomendada — embora já ligada, só age após divergência + 3 avisos + 90 dias).

5. **Cliente 360 — rastreamento de atividade + confirmação de leitura de e-mail.** (a) **Clickstream:** `eventos_atividade` (pageview/click/api_erro; `eventos_atividade.sql` + RPC `atividade_navegacao`, service-only), ingest `api/track.js` (só logados, user_id do token, teto), `src/utils/tracker.js` (wire em `main.jsx`; navegação SPA + cliques em elementos interativos; `apiCall.js` loga HTTP≠ok), retenção 30d (`limpar-eventos-cron`). Card **"Navegação e cliques"** no `Cliente360.jsx`. Vale p/ cliente/parceiro/equipe. (b) **Leitura de e-mail:** colunas `emails_log.entregue_em/aberto_em/clicado_em` (`emails_log_leitura.sql`), `api/resend-webhook.js` (auth `?k=RESEND_WEBHOOK_SECRET`) recebe delivered/opened/clicked → selo **"✓ lido/entregue"**; e-mails de abandono vinculados ao usuário (`meta`). RPC `admin_usuario_360` atualizada (bloco `navegacao` + campos de leitura). ⚠️ open tracking é best-effort (cliente que bloqueia imagem não dispara "lido"); clique é confiável.

6. **Config do DONO já feita nesta sessão:** env Vercel `ABANDONO_ATIVO=true` + `RESEND_WEBHOOK_SECRET=<definido no painel>` (Production) + redeploy; **Resend:** webhook `https://bidprobrasil.com.br/api/resend-webhook?k=…` **Enabled** (5 eventos) + **open/click tracking ON** + **"Enable Receiving" DESLIGADO** (o único MX "Failed" era o inbound de RECEBER via Resend — não usamos; **DNS do Registro.br não precisou de nada**, envio/SPF/DKIM já Verified). Conta de teste `teste@teste.com.br` **reativada** (estava `ativo=false` por toggle do admin; agora ativo, role top2).

7. **Crons novos em `vercel.json` (só rodam em produção):** `pj-revalidacao-cron` (mensal, dia 1 05h) · `backfill-mp-pagamentos-cron` (dom 03h) · `saldo-abandono-cron` (diário 06:30) · `limpar-eventos-cron` (diário 04h).

**PENDÊNCIAS DO DONO (sessão 9):** (a) **revisão jurídica da cláusula de caducidade** (Termos 8.1) — recomendada mesmo com `ABANDONO_ATIVO` já ligado; (b) opcional: pedir p/ acelerar o backfill do financeiro se quiser o histórico de pagamentos imediatamente (senão enche no domingo + tempo real).

## Sessão 8e (26/07 — leitor de ebook (pdf.js) + acesso grátis por plano valendo)
> Deploy `main` @ `c1c501d`. Build (vite) OK · migração via MCP · `auditoria_seguranca()` = **0/0**.

1. **BUG "Este conteúdo está bloqueado" ao clicar em Ler (área de membros) — CORRIGIDO.** Causa-raiz: a URL assinada do Storage vinha com `scope=download` (Content-Disposition: attachment) e era embutida num `<iframe sandbox>` **sem `allow-downloads`** → o navegador bloqueia; e Chrome/Safari **mobile/PWA não renderizam PDF em iframe** de qualquer forma. Solução: novo `src/components/PdfReader.jsx` (pdf.js) desenha o PDF em `<canvas>` — **busca os bytes via fetch/CORS** (disposição é irrelevante p/ fetch), então funciona em desktop **e** mobile/PWA, sem re-assinar. `EbookPage.jsx` usa o PdfReader p/ PDF assinado do Storage (mantém iframe só p/ Google Drive `/preview`). Fallback "abrir em nova aba / baixar" em erro. Admin já tinha acesso (o gate liberava) — o problema era 100% de RENDER. pdf.js entra code-split (`pdf-*.js`, ~97KB gz, só ao ler).
2. **"Quem tem acesso grátis" (planos_gratis) agora VALE p/ ebooks.** O seletor de chips no cadastro (Admin `PlanosGratisSelector`) já existia p/ ebook e curso, mas o `obter_arquivo_ebook` **ignorava** `planos_gratis` → marcar "Explorador (grátis)" num ebook pago não liberava nada. Corrigido: RPC (`supabase/migrations/ebook_entitlement_planos_gratis.sql`) + gate do `EbookPage` passam a honrar `planos_gratis` (inclui Explorador e mapeia "Investidor Pro anual"→top2). Ebook de teste (`619871ee`, R$14,90) tem `planos_gratis=[]` → hoje só pagos/compra/equipe leem (admin lê). Para liberar p/ um plano, marcar o chip no cadastro.
3. **Cursos — controle existe, ENFORCEMENT pendente (não forcei, sem dado p/ testar):** `cursos_admin` está **VAZIO (0 cursos)** e o `Curso.jsx` lê só o `CURSOS` **estático** (id string), não o `cursos_admin` (uuid) → um curso criado no admin nem abre no player hoje (bug pré-existente do split estático×DB). Wire de `planos_gratis` p/ curso exige reconciliar isso (fazer o `Curso.jsx` carregar `cursos_admin`+`aulas_admin`). **Próximo passo quando o dono criar o 1º curso real:** plugar o player no DB + honrar `planos_gratis` em `podeAssistir`. Deixei intacto p/ não quebrar o estático sem poder validar.

### Sessão 8e — parte 2 (sem beco de acesso + anúncio por e-mail)
4. **Sem "acesso restrito" de beco — bloqueado vai p/ AQUISIÇÃO.** `EbookPage` (não logado/sem acesso) agora manda o usuário à **página do produto** (`/#/p/ebook/:id`) mostrando preço + opções, em vez de "acesso restrito → ver planos". **Bug de rota corrigido:** `/p/ebook/:id` era sombreado pelo `/p/:tipo/:id` (ProdutoLanding, que NÃO trata ebook → "Produto não encontrado") — adicionei rota estática no router de topo (App.jsx) → agora renderiza o `ProdutoPublico`. `ProdutoPublico`: usuário **já logado** sem acesso agora vai ao checkout (`/checkout?plano=top2` — "Assinar e desbloquear"), não mais p/ `/login`.
   - ⚠️ **PENDENTE (decisão do dono, mexe em pagamento):** a **compra AVULSA por item** (pagar só aquele ebook/curso, ex.: R$14,90) NÃO está conectada ao gateway — existe só o scaffold `api/registrar-compra-produto.js` (cria `compras_produtos` **pendente**; ativação só viria de webhook de pagamento, que não trata produto). Hoje o caminho de pagamento que FUNCIONA é **assinar o plano** (inclui o acervo). Para vender por item de verdade: checkout aceitar `?ebook=/?curso=` + cobrança única MP/Asaas + webhook→`ativo`. (Perguntei o modelo; o dono interrompeu — segui com "assinatura desbloqueia", que já roda.)
### Sessão 8e — parte 10 (SAQUE do parceiro: validação de PJ/sócio ponta a ponta) ✅ construído
> Continuação do GAP tributário (parte 9 item 21). O dono definiu o fluxo: KYC (selfie+doc) no
> onboarding + IA/consulta valida sócio + 1º saque automático, 2º+ manual via atendimento; termos
> transferem a responsabilidade ao parceiro. Custo: **QSA por dado aberto da Receita = grátis**
> (mais barato que IA ler o contrato); selfie reusa o que já existe (Claude Vision, centavos).
22. **Verificação de sócio (anti-interposição) via QSA GRÁTIS.** `api/_pj-socio.js` cruza o CPF do
    parceiro com o **quadro societário** do CNPJ (BrasilAPI/minhareceita — dado aberto, grátis; QSA
    mascara o CPF nos 6 dígitos do meio → casamos por esses 6 + nome; **fail-closed**: dúvida →
    manual). `api/validar-pj-socio.js` valida e marca `pj_validada_em` (via='auto_qsa'). Lógica de
    match testada com mock (match, nome divergente, CPF ausente). ⚠️ o sandbox de dev **não** alcança
    a Receita (proxy 403) — **smoke test em produção**: 1 parceiro real com CNPJ do qual é sócio.
23. **Saque do parceiro — 1º auto / 2º+ manual.** `api/saque.js` POST (parceiro-cliente): exige
    **KYC** (`identidade_validada`, via `/api/validar-selfie` já existente) + **PJ cadastrada**; 1º
    saque libera pela automação (CPF no QSA) e, do 2º em diante, **sempre** validação MANUAL —
    reserva `aguardando_pj` (não pagável) e abre **chamado `saque_pj`** p/ analista+dono. RPCs:
    `solicitar_saque_pj_pendente`, `aprovar_saque_pj`, `reprovar_saque_pj`, `registrar_pj_validacao_auto`
    (migração `saque_pj_validacao_socio_qsa.sql`; colunas `pj_validada_via/por/socio_qsa`). PATCH ganhou
    `aprovar_pj`/`reprovar_pj` (admin **ou** analista). **Validado no banco:** reserva→aprovar→pagável;
    reprovar→devolve saldo. `auditoria=0/0`.
24. **Frontend.** Perfil.jsx (parceiro): card "Empresa (PJ) e verificação" — KYC (selfie+doc), campos
    CNPJ/razão/PIX-PJ (salváveis: não são campos protegidos), **anexo do contrato social** (bucket
    `documentos`→`usuario_docs` tipo `pj_contrato_social`), botão "Verificar automaticamente (Receita)",
    e status validada/pendente. Admin → Financeiro → Prestação de contas: fila **"Validação de saque —
    empresa (PJ)"** com dados da PJ + ver documentos + **Aprovar/Reprovar**. Termos do parceiro **v6**.
    **FALTA (follow-up, não bloqueia):** (a) botão Aprovar/Reprovar também dentro do **Atendimento**
    (analista) — hoje a fila de ação fica na Prestação de contas (dono); o chamado abre p/ o analista ver;
    (b) **selfie no CHECKOUT de alto ticket** (só liguei no saque do parceiro); (c) **anexo da NF** no
    pedido de saque (hoje o contrato social cobre a prova de sócio; NF fica p/ o contador definir CNAE);
    (d) API paga de QSA/biometria (opcional, se quiser tempo-real/oficial). **SMOKE TEST em produção do
    match QSA (dono/parceiro real).**
25. **Validação REAL da Receita + KYC com opção de foto (26/07, pedido do dono).** (a) **Diagnóstico
    admin** no `validar-pj-socio.js`: admin pode POSTar `{cnpj,cpf,nome}` e ver o resultado REAL da consulta
    ao QSA **sem gravar** — UI em Admin → Prestação de contas ("Testar consulta à Receita"). Serve para validar
    a integração com dados reais em produção (o sandbox de dev é bloqueado por política de egress — não é bug de
    código). (b) **Matcher endurecido** (`_pj-socio.js`): só casa sócio cujo `cnpj_cpf_do_socio` é CPF mascarado
    (`***DDDDDD**`, 6 dígitos) — ignora sócio PJ. (c) **KYC (formato final)**: foto **só do rosto** + **documento** por **foto frente+verso**
    (ex.: CNH física) **OU** **arquivo** (ex.: CNH digital PDF). A selfie do rosto **conclui** o KYC no
    servidor só quando o documento já foi enviado (`validar-selfie` tipo='rosto' checa `usuario_docs`).
    Arquivados em `usuario_docs` (`kyc_selfie`/`kyc_documento`/`kyc_documento_frente`/`_verso`) e visíveis
    na fila de validação do admin. **Fluxo: código no
    branch/preview p/ o dono validar ANTES de promover a main.**

### Sessão 8e — parte 9 (pool 2% OFF + empresa como patrocinadora + termo PJ conferido) ✅ validado
16. **Rateio de 2% do POOL DESLIGADO — FEITO** (pedido do dono). O repasse já é gradual sobre TODA a rede via
    **bônus infinito** (diferencial das faixas de liderança, parte 8) — o pool fechado virou redundante. `update
    rank_config set pool_pct=0`; texto do painel `MinhaRede.jsx` deixou de citar "+ pool" (agora "…sobre TODA a sua
    rede."). `distribuir_pool_rank` fica no banco mas não distribui nada (pct=0). Migração
    `mlm_pool_off_empresa_sponsor.sql`.
17. **Vendas SEM indicante = vendas da EMPRESA (o dono) — FEITO.** Nova coluna `rank_config.empresa_uid` (setada p/
    o uid do dono). No `distribuir_comissao_rede`, o nó empresa é **sempre elegível** (`if v_cur = v_empresa or
    (eh_pagante…)`) — recebe o repasse mesmo sendo admin/não-assinante, e o SALDO **fica retido** (saque exige PJ).
    Alinhados os **2 Investidor Pro sem upline** (Neuma + Alessandra) sob o dono (`indicado_por = empresa_uid`).
    **Validação:** rodei `distribuir_comissao_rede` p/ as duas (R$49,90 cada) → **saldo da empresa/dono = R$24,96**
    (2 × 25% de R$49,90), creditado e retido. Fluxo de comissionamento confirmado ponta a ponta.
18. **Termo de aceite do parceiro — RECEBER exige PJ: CONFERIDO e corrigido.** O dono disse "já tínhamos ajustado
    isso nos termos"; ao verificar, o §5 ainda pedia **CPF+PIX** (pessoa física). Corrigi o `TERMO_PARCEIRO`
    (`HomeCliente.jsx`) p/ **B2B/PJ**: §2 "(nome, CPF, telefone). Para RECEBER, é necessário cadastrar uma empresa
    (pessoa jurídica) — ver item 5."; §5 reescrito (pagamento à **conta de uma EMPRESA (pessoa jurídica), mediante
    nota fiscal**; cadastra **CNPJ, razão social e chave PIX**; pode **abrir um MEI**; sem PJ o saldo apurado fica
    **retido**); §6 "pagos à sua empresa contra nota fiscal". Versão `v4-2026-07` → **`v5-2026-07`** (re-aceite).
    `npm run build` OK · `auditoria_seguranca()=0/0`.
19. **Auto-atribuição à empresa de TODA venda futura sem indicante — FEITO.** Em vez de alinhar à mão, o
    `distribuir_comissao_rede` agora, ANTES de subir a árvore, roteia o comprador sob a empresa quando `indicado_por
    is null` (idempotente; nunca sobrescreve upline existente; nunca auto-atribui a empresa a si mesma). Como está no
    **motor**, cobre todos os gateways (MP/Asaas) + reconciliação de uma vez. Validado: rodei a função p/ um perfil
    sem upline → ficou `indicado_por = empresa` e a empresa recebeu 25% (nível 1); dado de teste **limpo** depois.
    `auditoria=0/0`. Migração atualizada (`mlm_pool_off_empresa_sponsor.sql`).
20. **SAQUE — fluxo verificado (o dono solicitou R$24,96).** `solicitar_saque_ledger` validou cadastro (o dono é
    `admin`/equipe → PIX **pessoal**, não PJ; PJ vale p/ parceiro-cliente pagante), travou por advisory lock,
    conferiu saldo e inseriu o lançamento `saque` −24,96 status `solicitado`. Estado: `saldo_disponivel` 24,96 → **0**,
    `saque_pendente` **24,96**. Hoje é **domingo** → pagamento sai só **sexta (31/07, 12h Bahia)** — o admin libera em
    Prestação de contas (`pagar`/`pagar_todos`), ou **recusa** p/ devolver ao saldo da empresa. Fluxo íntegro
    ponta a ponta.
21. **⚠️ GAP tributário achado + buraco fechado — GATE PJ no saque (anti-interposição).** O dono apontou: o saque de
    parceiro deveria exigir **cadastrar a PJ + carregar documentos + verificar se o parceiro é sócio** (plano §12.9).
    O que existia: `solicitar_saque_ledger` só conferia os **3 campos de texto** (cnpj/razao_social/pj_chave_pix)
    PREENCHIDOS — **sem** checar `pj_validada_em` (coluna existia, sem uso), **sem** upload de documento, **sem**
    verificação de sócio, **sem** NF. **Não havia dano realizado** (nenhum parceiro externo tem saldo sacável hoje:
    só 2 lançamentos de comissão, ambos p/ a empresa/dono; o saque do dono foi via PIX pessoal, sem tocar no gate PJ).
    **Fix imediato (feito):** a RPC agora **bloqueia** o saque do parceiro-cliente enquanto `pj_validada_em IS NULL`
    (mensagem `pj_pendente`), e `api/saque.js` GET reflete (`pj_pendente`/`saque_habilitado`). Validado: parceiro com
    os 3 campos mas sem validação → bloqueado (nada gravado). Migração `saque_gate_pj_validada.sql`.
    **FALTA construir (fluxo completo — depende de decisão do dono, ver §12.9):** (a) **cadastro da PJ + upload** de
    cartão CNPJ/contrato social + **anexo da NF** no pedido de saque; (b) **verificação de sócio** (CPF no quadro
    societário) — manual (equipe confere) ou **automática** via API (ReceitaWS/Serpro, custo); (c) tela do **admin p/
    validar a PJ** (setar `pj_validada_em`); (d) painel de **teto MEI**. Contador/advogado definem NF/CNAE e provisão.

### Sessão 8e — parte 8 (PAYOUT ligado: bônus infinito + CHECK + cron do recálculo) ⚠️ paga de verdade
15. **Payout do MLM LIGADO** (`payout_bonus_infinito_e_check_comissoes.sql`, `api/ranks-recalc-cron.js`, `_webhook-core`).
    (a) **CHECK da `comissoes` corrigido** (aceita `rede_nN`/`infinito`/`venda_direta`) — era o landmine que fazia o
    motor falhar em silêncio; validado com insert de teste. (b) **Bônus infinito** no `distribuir_comissao_rede`:
    Guardião 0,5% / Patrono 1,0% / Lenda 1,5% — diferencial (total ≤ % do topo) sobre TODA a rede, sem trava de
    profundidade; `estornarComissao` reverte rede **+ infinito** no chargeback. (c) **Cron mensal**
    `ranks-recalc-cron` (`0 6 1 * *`) roda o `recalcular_ranks`. `auditoria=0/0`.
    **⚠️ Agora o repasse de rede é LIVE:** cada assinatura com upline elegível credita comissão (via
    `processarConfirmado`). Sem cadeias de indicação hoje → 0 impacto imediato; **o dono valida** com 1 assinatura
    indicada. A avaliar (não bloqueia): rateio do **pool 2%** (`distribuir_pool_rank`) e venda-direta 20/25% fixo.

### Sessão 8e — parte 7 (RANKS: graduação por duplicação "Guardiões" — modelo Conselheiro)
14. **Subir de nível agora exige GRADUAÇÕES abaixo (não mais só pagantes) — FEITO.** O dono apontou que contar
    pagantes estava errado; virou **duplicação recursiva** (Clube Conselheiro): cada nível pede **N indicados
    DIRETOS que ELES MESMOS subiram** ao nível anterior. Nomes (dono): **Pioneiro→Fundador→Mestre→Mentor→
    Embaixador→Guardião→Patrono→Lenda** (topo evita "diamante"). Regras: Fundador=2 Pioneiros · Mestre=2 Fundadores ·
    Mentor=2 Mestres · Embaixador=3 Mentores · Guardião=5 Embaixadores · Patrono=2 Guardiões · Lenda=3 Patronos.
    `comissao_ranks`+`req_pernas/req_sub_ordem/bonus_infinito_pct`; `rank_do_parceiro` lê filhos diretos;
    `recalcular_ranks` = **fixpoint bottom-up** + carência 2m; `meu_nivel` mostra progresso por graduação.
    `MinhaRede.jsx` atualizado (barra de graduação + selo de liderança/bônus infinito). Migração
    `ranks_guardioes_graduacao.sql`, algoritmo validado com árvore sintética, `auditoria=0/0`, recalculado 1×.
    **FALTA (payout, NÃO-live):** (a) **cron mensal** do `recalcular_ranks` (hoje estático entre execuções);
    (b) `distribuir_comissao_rede` pagar o **bônus infinito** das faixas de liderança; (c) corrigir o **CHECK da
    `comissoes`** (landmine 8e) antes de ligar o payout de rede. Ver `PLANO_COMISSIONAMENTO_MLM.md` §12.8.1.

### Sessão 8e — parte 6 (tela de indicações: fim do "pisca" do link + painel de nível)
12. **Bug do link "pisca" (grande→pequeno) — CORRIGIDO.** `MinhaRede.jsx`: o link nascia com o `uid` (longo) e trocava pro `codigo_indicacao` (curto) ao carregar. Agora **gera o código antes de exibir** (RPC `gerar_codigo_indicacao` se faltar) e só mostra o link quando `codigoPronto` (placeholder "Gerando seu link…" enquanto isso). Sem troca visível.
13. **Painel "Seu nível" enriquecido + visível p/ admin.** Antes era `!isAdmin` (o dono não via). Agora mostra sempre e traz: nível atual + **% por indicação** (assinatura, flat `rank_config`), **linha da LOJA** (vendas de ebook/curso pagam o `comissao_pct` do produto), **próximo nível** (nome + "o que falta": indicados pagantes/rede) e **o que desbloqueia** (profundidade da rede — `max_nivel`: hoje X → Y níveis). RPC `meu_nivel()` passou a devolver `proximo.max_nivel` (`supabase/migrations/meu_nivel_proximo_max_nivel.sql`, auditoria 0/0). Ranks: Pioneiro→Fundador→Mestre→Mentor→Embaixador→Lenda.

### Sessão 8e — parte 5 (aula travada → Comprar de verdade + material de apoio por aula)
10. **Modal de "aula travada" agora leva ao Comprar real (não mais "simulação"/planos fake).** `Curso.jsx`: o modal `showUpgrade` tinha planos inventados (R$97/R$297) + "integração Asaas em breve". Trocado por: **"Comprar este curso — R$X"** → `/#/p/curso/:id` (checkout MP/Asaas já no ar; só cursos do banco pagos) + **"Ver planos"** → `/planos`.
11. **Material de apoio POR AULA (opcional) — FEITO.** Coluna `aulas_admin.materiais jsonb` (`supabase/migrations/aulas_material_apoio.sql`). No **Admin** (editor de aula) um `MateriaisEditor`: adiciona por **link** (nome+url) ou **upload** (novo kind `material` no `UploadMidia` → bucket `documentos`, aceita PDF/Excel/Word/PPT/CSV/TXT, URL assinada 10 anos); lista com remover. No **player** (`Curso.jsx`): se a aula tem `materiais`, aparece um **botão por material** (ícone por tipo, abre/baixa); **sem material = sem seção** (fim do placeholder fixo "Slides/Planilha/Checklist"). `auditoria_seguranca()=0/0`.

### Sessão 8e — parte 4 (player do curso ligado ao BANCO + curso na loja)
9. **Player de curso agora abre cursos do BANCO — FEITO.** `Curso.jsx` era só ESTÁTICO (slug); agora é **dual-mode**: se o id casa com `CURSOS` (slug legado) usa o estático; senão **carrega de `cursos_admin`+`aulas_admin`** (uuid) e monta módulos/aulas (vídeo via `videoEmbed` já existente). Assim os cursos criados no admin **abrem** (antes davam "não encontrado"). `podeAssistir` passou a honrar **`planos_gratis`** (grátis por classe de assinante) + compra avulsa (`compras_produtos` curso ativo) + aula `gratis`. Rota `/p/curso/:id` → `ProdutoPublico` (top-level, igual eBook) → botão **Comprar** (MP/Asaas) funciona p/ curso. Botão **"Compartilhar para vender"** no curso (só cursos do banco, pagos). **eBook player** = `PdfReader` (pdf.js, já feito na parte 1). `cursos_admin` ainda vazio → validar criando 1 curso; o estático segue intacto (sem regressão).

### Sessão 8e — parte 3 (loja: fundação da compra avulsa + parceiro vende + comissão)
> Pedido do dono: parceiros compartilham e VENDEM ebooks/cursos individualmente (sem dar acesso à plataforma); checkout deve servir produtos+assinaturas+serviços; cadastro define grátis por classe. Mapeei o stack de pagamento com 3 agentes (checkout, webhooks, comissão/afiliado).
6. **Botão "Compartilhar para vender" no eBook (Área de Membros) — FEITO.** `EbookPage` gera/reaproveita o `codigo_indicacao` do parceiro (RPC `gerar_codigo_indicacao`) e copia `/#/p/ebook/:id?ref=CÓDIGO`. (Só eBook por enquanto — `Curso.jsx` usa CURSOS **estático**, id ≠ `cursos_admin`; curso entra quando o player for ligado ao DB.)
7. **Fundação de banco da COMPRA AVULSA — FEITO** (`supabase/migrations/avulso_produtos_fundacao.sql`, aplicada, `auditoria_seguranca()=0/0`): `compras_produtos` ganhou status `pendente/estornado` (o CHECK só tinha ativo/cancelado → o scaffold `registrar-compra-produto` NUNCA rodou; 0 linhas) + colunas `gateway/gateway_payment_id/ref_codigo/comissao_pct/pago_em` (não havia chave p/ casar pagamento×compra). 3 RPCs **service-role only**: `comprar_produto_iniciar` (valida ativo+pago, barra quem já tem acesso por papel/planos_gratis/compra, grava parceiro+%, cria 'pendente'), `confirmar_compra_produto` (webhook: ativa idempotente + credita comissão do parceiro), `estornar_compra_produto` (chargeback).
   - ⚠️ **LANDMINE achado (registrar, não é do meu escopo agora):** `public.comissoes` tem CHECK `tipo IN ('afiliado','honorario')` e `origem IN ('produto','assinatura','arrematacao')`, MAS o motor `distribuir_comissao_rede` insere `tipo='rede_nN'`/`origem='venda_direta'` → **violaria o check**. `comissoes`+`saldo_lancamentos` estão **VAZIAS** (nunca creditou de fato). Por isso a comissão de PRODUTO aqui NÃO usa esse motor: credita o **referenciador direto** o `comissao_pct` do produto com valores válidos no check (`tipo='afiliado'`,`origem='produto'`; ledger `saldo_lancamentos` status 'disponivel' → conta no `saldo_usuarios`). Quando for mexer no MLM de assinatura, corrigir o check/‑motor.
8. **Checkout AVULSO (Asaas hospedado) — FEITO e no ar.** (a) `api/asaas.js` ganhou a ação `criar_cobranca_avulsa` (já estava listada em userActions, faltava implementar): chama `comprar_produto_iniciar` (service key, p_user_id do `getAuthUserNode`), cria/reusa customer e gera **cobrança única** (`billingType:'UNDEFINED'`) com **`externalReference = compras_produtos.id`** → devolve `invoiceUrl`. (b) `api/asaas-webhook.js`: em `PAYMENT_CONFIRMED/RECEIVED`, se `externalReference` é uuid → `confirmar_compra_produto` (**fluxo 100% separado do plano — nunca eleva role**); no chargeback → `estornar_compra_produto`. Idempotência dupla (eventoJaProcessado + guarda de status na RPC). (c) `ProdutoPublico`: logado sem acesso + pago → botão **"Comprar por R$X"** → abre o `invoiceUrl` + **poll** de `compras_produtos` (libera a tela sozinho ao confirmar). Comprador ganha só o PRODUTO (a compra ativa já libera em `obter_arquivo_ebook`), **sem assinatura**. Assinar o plano segue como opção secundária.
   - **MP avulso — FEITO também.** `api/mp.js` ação `criar_preferencia_produto` (Checkout Pro hospedado, `external_reference=compra_id`, metadata tipo='produto'); `api/mp-webhook.js` roteia `approved`/`charged_back` c/ external_reference uuid → `confirmar/estornar_compra_produto`. `ProdutoPublico.comprar()` tenta **MP primeiro, Asaas fallback** (mesma preferência do checkout de assinatura).
   - 🧪 **VALIDAR (dono):** teste em **sandbox** primeiro — `ASAAS_ENV=sandbox` na Vercel — ou baixe um ebook para R$1 e compre com OUTRA conta (não-assinante): (1) abre o Asaas; (2) após pagar, a página do produto libera "Ler eBook"; (3) `select status,gateway_payment_id,pago_em from compras_produtos order by criado_em desc limit 1;` = ativo; (4) se veio com `?ref=CÓDIGO` de um parceiro, confere `select * from saldo_lancamentos where origem_tipo='produto' order by criado_em desc limit 1;` (comissão creditada). Pré-req: `ASAAS_WEBHOOK_TOKEN` e o webhook do Asaas apontando p/ `/api/asaas-webhook` (já usados nas assinaturas). Customer sem CPF: se o Asaas recusar criar, o comprador informa o CPF na própria página hospedada — validar.

5. **Anúncio de produto por e-mail (do cadastro) — FEITO.** Botão **📣 Anunciar** nas linhas de ebook/curso ativos (Admin) → `api/anunciar-produto.js` (Node, **só admin**): monta e-mail de apresentação (capa+título+resumo+preço) com botão → página do produto (`/#/p/<tipo>/<id>`), e envia à base de **CLIENTES** (explorador/top2/top2_anual/assessorado/clube — **nunca equipe/admin**), respeitando o **opt-out** dos alertas (`alertas_email.ativo=false`) + descadastro one-click (`assinarUnsub`). Reusa `_email.js` (Resend + `emails_log` tipo `anuncio_produto`). Confirma + mostra contagem enviados/destinatários. *Escala: hoje envia num disparo (base pequena); se crescer muito, encadear como o `enviar-alertas-cron`.*

## ✅ COMEÇAR AQUI (26/07 — sessão 8d: perfil de bairro + segurança pública no mercadológico + leiloeiros vinco/Vlance)
> Deploy `main`. Build (vite) OK · `node --check` OK. Duas ideias do dono p/ auxiliar o 250m + continuar os leiloeiros.

1. **Perfil da região + segurança pública no mercadológico (`gerar-analise.js` + `Analise.jsx`) — DEPLOYADO.** A MESMA busca web do mercadológico passa a devolver: (a) **perfilRegiao** = tier de valorização (mais/menos valorizada na cidade) + atratividades + fragilidades + motivos (explica o R$/m² da microrregião, contexto do 250m); (b) **segurancaPublica** = FACTUAL, só de fontes OFICIAIS (SSP/ISP/Atlas da Violência) citando fonte+período, NUNCA "bairro perigoso"; sem dado marca `encontrado:false` + recomenda diligência (mesma regra anti-alucinação do zoneamento). Persistem no `result.mercado` (gravado inteiro). Ambas renderizadas na tela após a Valorização. *Follow-up: levar as 2 ao PDF do mercadológico (hoje só na tela).*
2. **Leiloeiros — vinco (cluster GESTAOLEILOES):** adicionado ao `DOMINIOS` default + `fetchHome(dom)` apex→www (`scraper-gestao.mjs`). ⚠️ **NÃO validado ainda: o teto Bright Data da semana está em 450/450** (`brightdata_uso` semana 2026-07-20 = 450 — ESGOTADO; os recons desta sessão contribuíram). O `bd()` recusa antes de buscar → "home não veio" em ~0,37s (fast-fail de cota, NÃO bug). **Zera na virada da semana ISO (seg 27/07).** Validar então: DEBUG run (debug=1 dominios=vinco) → se a home vier + enumerar idLeilao, run dryrun=0. O cron semanal do cluster (qui 12 UTC) já pega vinco sozinho. Se mesmo com cota ainda falhar, aí sim investigar render-mode.
3. **Leiloeiros — Vlance (verdeamarelo/sudeste/capitalvalor/destak):** recon-deep mostrou o listing `/leilao/index/imoveis` **JS-rendered (SPA)** — HTML cru só tem shell + "ative seu javascript", ZERO lotes/R$/área. **Não dá pra raspar o HTML:** o scraper precisa da **API JSON** que `/v3/js/vlance/lotes/paginacaoLotes.js` chama (achar o endpoint) OU render de browser (Bright Data). É um build dedicado (próximo passo: recon do paginacaoLotes.js p/ o endpoint de dados).
4. **Bright Data nesta sessão:** ~11 requests (recon-1=8, recon-deep=2, vinco≈1) — folgado no teto 450/sem.

## ✅ COMEÇAR AQUI (26/07 — sessão 8c: Índice — raio 250m na base real + gráfico no PDF + relação na tela + recon leiloeiros)
> Deploy `main`. Build (vite) OK · `node --check` OK · migração via MCP. Pedidos do dono após ver o PDF de Barueri.

1. **Raio 250m no Índice (base REAL) — fundação (escolha do dono: "raio 250m primeiro").** Descoberta: a composição usa `indice_amostra` (real), que só tinha `bairro_norm`+`geo_grid(~1km)` e **sem lat/lng** → o raio de 250m (que existe na `indice_regiao_ponderado`) rodava só na tabela `indice_amostras` (plural, sintética). **Feito:** (a) migração `indice_amostra_latlng_para_raio_250m.sql` (colunas `lat`/`lng` + índice parcial); (b) `gerar-analise.js` grava a **coordenada do imóvel-alvo** em cada amostra (comparáveis são vizinhos por construção); (c) `indice-consulta.js` faz **recorte por raio**: com coordenada na consulta, prioriza ≤250 m (rua) → ≤1 km (grid) → cidade, 1º nível com ≥6 vendas; amostras sem lat/lng (legado) só contam na cidade → **sem regressão**. `reg.nivel/nivel_label` refletem o nível. **O 250m real entra conforme novas amostras acumulam coordenada** (legado fica em bairro/cidade). A banda central (8b) segue como rede de segurança do nível cidade.
2. **Gráfico sumia no PDF (bug):** as barras usam cor de fundo e o navegador **não imprime fundo** sem `print-color-adjust:exact` → `IndicePDF.jsx` ganhou a regra (body + universal) + cor sólida de fallback nas barras. Agora o gráfico de valorização sai no arquivo gerado.
3. **Relação das amostras na TELA:** existia só no PDF; `IndiceConsulta.jsx` passou a renderizar a tabela de rastreabilidade (descrição · R$/m² · portal · data) também na tela.
4. **Recon leiloeiros (8 req Bright Data, corrigiu premissas do backlog):** **vinco** = cluster **GESTAOLEILOES** (`leilao.php?idLeilao=N`, não FRAZÃO) → estender `scraper-gestao.mjs` (mais barato); **verdeamarelo/sudeste/capitalvalor** = **Vlance /v3/** (`/leilao/index/imoveis`+API) + **destak** (Vlance) → 1 scraper cobre 4 (também no LJUD, checar); **alfaleiloes** = independente S3+axios (API provável), só imóveis ⭐; **cunha/sanches** = independentes+Cloudflare (dedicados). **Próximo:** vinco (gestao) + Vlance. Atualizar `docs/LEILOEIROS_TRT15_BACKLOG.md` com essas correções.
5. **PENDENTE (busca ampla — dono deprioriza p/ depois do 250m):** a cada análise, colher o MÁXIMO de anúncios da cidade e filtrar p/ a área pedida, semeando o Índice inteiro (acelera o mapa de 250m). Amplia a colheita/cache das sessões 10/12.

## ✅ COMEÇAR AQUI (26/07 — sessão 8b: composição por período do Índice oscilando (bimodalidade de padrão))
> Deploy `main`. Build (vite) OK · `node --check` OK. Dono apontou (print Barueri/SP apto): a **composição por período** despencava em set–dez/2025 (R$ 3.878) entre vizinhos ~R$ 8.700; suspeita de poluição/mistura de tipos.

- **Diagnóstico (dados do banco):** NÃO é mistura de tipo nem leilão. É **bimodalidade de PADRÃO** — Barueri mistura apto popular (~R$2.6k–4k/m², 45–58m²) e médio/alto (~R$8.9k–18k/m²), ~5× de spread no MESMO balde. A mediana de cada janela de 4 meses "virava" conforme o período pegou baratos ou luxo (set–dez/2025 = 9 populares × 5 altos → 3.878; mai–ago/2025 e mai–ago/2026 = maioria alto → ~7–8,7k). Poluição menor: linhas sintéticas **"FipeZAP (média cidade)"** contadas como anúncio.
- **Fix (aprovado pelo dono — "banda central + tira sintéticas"):**
  - `api/_indice-composicao.js`: `composicaoTemporal` ganhou 4º param `banda` (p25–p75). A **mediana** de cada período (e o valor) passa a olhar só o **padrão CENTRAL**; o **quantitativo (n) mantém TODOS** os anúncios. Fallback: se um período não tem nada na banda, usa a mediana de todos (nunca null). Backward-compatible (chamador sem banda = comportamento antigo → mercadológico intacto).
  - `api/indice-consulta.js`: filtro `FONTE_SINTETICA` (fipezap/média cidade/índice/estimado) removido da composição, da curva por ano e das bandas de padrão; `bandaCentral` = p25–p75 dos R$/m² de venda REAIS; passado à composição.
  - **Validado nos dados reais + teste do helper:** set–dez/2025 **3.878 → 8.888** (alinhado aos vizinhos), n preservado, sintéticas fora. Série deixa de "virar".
- **Follow-up (não feito, baixa prioridade):** ligar a MESMA banda no mercadológico (`gerar-analise.js lerComposicaoRegiao`) — hoje passa 3 args (sem banda), então segue como antes; herda o fix quando quiser.

## ✅ COMEÇAR AQUI (26/07 — sessão 8: ritual de saúde + achado de segurança + lixo institucional no documental)
> Branch: `claude/system-health-check-894pgq`. Build (vite) OK · `node --check` OK · migrações via MCP. Sessão = ritual de abertura (saúde + relação imóveis/docs + Cliente 360), com 2 correções na raiz.

**🩺 Diagnóstico (íntegro no essencial):** acervo **31.938 ativos**; último `atualizado_em` **23/07 13:20** e `ativos_24h=0` — **NORMAL** (coleta roda seg/qui; checagem foi domingo 26/07 → próxima seg 27/07). Último run de cada fonte **`ok`** (23/07), só **VENDASGOV `degradado`=2** (gap login-gated conhecido). Bug-bounty dos leiloeiros: **vazio** (nenhuma fonte abaixo do piso aprendido). Geocode: **473** ativos sem lat/long (1,5%, aguardando o cron de geocode). `qa`/monitor sem regressão.

**🔒 Segurança — 1 ATENÇÃO encontrada e CORRIGIDA (voltou a 0/0):** `auditoria_seguranca()` apontou `rpc_definer_anon` na função **`meu_nivel()`** (RPC de painel do Programa de Parceiros criada na sessão 7, 26/07) — ficou com `EXECUTE` para **anon** fora da allowlist. É função autenticada (usa `auth.uid()`, retorna `sem_sessao` sem login). **Fix:** `revoke execute … from anon, public; grant … to authenticated` (migração `rpc_meu_nivel_revogar_anon.sql`, mesmo padrão da sessão 9). `auditoria_seguranca()` = **0 crítico / 0 atenção** confirmado.

**📄 Relação de imóveis × documentos (Cliente 360):** eventos dos últimos 7 dias — `relatorio_mercado_ok`=10, `relatorio_documental_ok`=7, `relatorio_documental_faltam_docs`=8. As 8 ocorrências de "faltam docs" são **todas do próprio dono** (admin, testes) — mescla de casos por design (leiloeiro não publica matrícula → pede anexo) e transitórios ("baixando automaticamente"). **Fila de docs:** 2.528 pendentes / 136 erro, **nada preso** (mais antigo 25/07, `>3d`=0) → drenando normal. Cobertura de doc no bucket coerente com o handoff (CEF por design ~0; SBID/SUPORTE `esperado`; GESTAOLEILOES sem PDF avulso).

**🐛 BUG de captura CORRIGIDO — lixo institucional no documental (raiz + limpeza):** investigando as ocorrências do Cliente 360, achei que o **SUPERBID** publica no rodapé/config global o **"Relatório de Transparência e Igualdade Salarial"** (Lei 14.611/2023); o `enriquecerDocumentosLote` (via `vasculharDocumentos` de `api/_doc-scan.js`) harvestava esse `.pdf` corporativo e gravava como anexo (`tipo='outro'`) em **452 lotes** → o laudo documental listava "já lemos … Relatório de Transparência …" mesmo faltando a matrícula real. **Fix na raiz (`api/_doc-scan.js`):** novo `RE_DOC_INSTITUCIONAL` em `ehDocumento()` — denylist CIRÚRGICO (igualdade salarial, transparência+igualdade/salarial, quem somos, trabalhe conosco, código de conduta/ética, governança corporativa, relações com investidores) que **não** toca em edital/matrícula/laudo/proposta/regras do lote. Cobre TODOS os leiloeiros (o `vasculharDocumentos` é compartilhado) + a leitura on-demand. **Limpeza:** removidas as **452** linhas (migração `anexos_remover_institucional_superbid.sql`, idempotente). *(O denylist do DOWNLOAD já existia em `captura-documentos.mjs` — por isso quase todas eram link-only; só 2 chegaram ao bucket, órfãs triviais.)*

## ✅ COMEÇAR AQUI (26/07 — sessão 7: Programa de Parceiros "BidPro Brasil" + contratos + LGPD)
> Branch: `claude/bidprobrasil-handoff-storage-qzm1mc`. Tudo **deployado na `main` (produção, bidprobrasil.com.br)**, build (vite) OK, `node --check` OK, migrações via MCP, segurança 0/0. Spec detalhada em `docs/PLANO_COMISSIONAMENTO_MLM.md §12`. **Base VAZIA hoje** (0 uplines, 1 parceiro, 0 comissões) → toda mudança de dinheiro é **inerte/segura** até existir rede. Commits `43738ca`…`d0fb67a`.

**⚠️ TRAVA JURÍDICA (não implementar como "final" sem parecer):** o envelope PJ/B2B (abaixo) e os percentuais foram alinhados ao **Clube Conselheiro** (originais lidos no Drive) mas **precisam de contador + advogado tributarista** antes de dinheiro real fluir. Pendência: redigir um **brief de 1 página** para eles (rota PJ/MEI B2B, teto MEI, provisão do saldo). Números são **config** (1 UPDATE), fáceis de ajustar.

1. **Modelo de comissão (alinhado ao Clube Conselheiro).** Migrações `bidpro_modelo_comissao_ranks_pj` + `rede_contato_nivel1_e_indicacao_por_produto`.
   - **Comissão de Indicação (venda direta, N1):** **25%** em Investidor Pro/produtos em conta; **10%** em alto ticket (Assessoria/Leilão Club) — roteado por plano no `_webhook-core.js` (`p_tipo='venda_direta'` p/ assessorado/clube; senão `'assinatura'`). `rank_config.comissao_indicacao_pct=25`.
   - **Bônus de Equipe (multinível, N2–N6):** 4/3/2/2/1%. `comissao_regras`: assinatura/produto = 25/4/3/2/2/1; venda_direta = 10/4/3/2/2/1.
   - **Ranks:** renomeados **Pioneiro·Fundador·Mestre·Mentor·Embaixador·Lenda**, `max_nivel` 1–6 (rank governa PROFUNDIDADE), piso r1 = ≥1 direto pagante. `distribuir_comissao_rede` ganhou **DEPTH-GATE** (upline só recebe o nível que seu rank destrava). RPC `meu_nivel()` (auth.uid, painel).
2. **Envelope jurídico — parceiro PJ (B2B).** Migração `saque_parceiro_via_pj_b2b`. Para SACAR, o parceiro-cliente cadastra **PJ** (`perfis.cnpj/razao_social/pj_chave_pix/pj_validada_em`) — acaba a variação PF/PJ/INSS; SCP foi **descartada** (frágil). `solicitar_saque_ledger` role-aware (parceiro→PJ; equipe→PIX pessoal, inalterado). Admin vê o PIX da empresa no pagamento. **Entrada sem fricção, saque com gate** — o saldo visível é o incentivo p/ regularizar.
3. **Tela do parceiro (`MinhaRede.jsx` → menu "Indicações").** Boas-vindas (a aba só aparece após o aceite), **tema azul BidPro** (#0D63DB/#084BA6), painel **"Seu Nível"** (comissão de indicação + progresso + trilha), **financeiro** (saldo a receber + gate de PJ "cadastre sua empresa para sacar" + solicitar saque). **Árvore:** indicados **diretos (N1 = venda direta) com CONTATO** (telefone/e-mail); rede abaixo (N2+) só nome+cidade (LGPD) — na RPC `minha_rede`. **Menu (`Header.jsx`):** "Indicações" no menu principal (entre Membros e Calculadora); "Comissões" só p/ equipe.
4. **Removidos:** coluna "Comissão %" (`comissao_pct`) da tela Configurações do admin; plano "Pacote de Cursos"; link de afiliado da Calculadora.
5. **Exclusão de conta — funil de retenção (`Perfil.jsx`).** Pagante → é levado a **cancelar o plano antes** (vira Explorador, grátis). Explorador → **tela de retenção** ("sua conta é gratuita; siga acompanhando oportunidades nas suas regiões") + botão forte "Quero manter" e link discreto com o gatilho "Não tenho interesse em aumentar meu patrimônio…" → confirmação final. **LGPD:** `api/lgpd-excluir` agora anonimiza também PIX/CNPJ/razão/pj_pix.
6. **Contratos Assessoria/Leilão Club + BLOQUEIO.** O checkout (`Checkout.jsx`) já chamava `/api/auto-contrato` p/ assessorado/clube → gera contrato → redireciona p/ `/c/:token` assinar. **`TEMPLATE_ASSESSORADO` reescrito** (base: contrato do cliente **Rafael**, no Drive) com **valores atuais** (R$6.000 parcelado/R$4.800 à vista + 10% êxito mín. R$5.000), papéis corretos (empresa=CONTRATADA). **`TEMPLATE_CLUBE` já existe (rascunho** R$60k/R$48k) — **dono vai elaborar o definitivo**. **Enforcement (NOVO):** `auto-contrato` cria `contratos_pendentes` (30 dias) e `assinar-contrato` o marca 'assinado' → `ContratoObrigatorio` (montado no `App.jsx`) mostra aviso dispensável por 30 dias e **bloqueio de tela cheia** depois.
7. **Termos atualizados:** Termo de Parceiro **v4-2026-07** (`HomeCliente.jsx`, cláusula 8: contato do N1 + corresponsabilidade), Privacidade seção 4, Termos de Uso **seção 8** (Programa de Parceiros + PJ + LGPD).

8. **Card "Programa de Parceiros" do dashboard (`HomeCliente.jsx`) — vira CONVITE (26/07):** o card agora é **só um convite** (`mostraConviteParceiro = info.indica && role!=admin && !aceite`): aparece antes do aceite p/ **convidar + liberar a aba Indicações**; **some após o aceite** (o parceiro passa a usar o menu **Indicações**/`MinhaRede`) e **nunca aparece p/ admin**. Sem o card, o `home-grid` vira **coluna única** (harmônico, sem gap lateral). O **aviso âmbar** "mantenha a assinatura em dia" saiu daqui e mora em Indicações (só p/ não-pagante, some ao assinar). Recolorido p/ azul BidPro; CTAs de PIX que iam p/ `/comissoes` (agora só equipe) foram removidos/roteados p/ `/minha-rede`.

9. **Onboarding do parceiro + painel "Seu Nível" (26/07):** ao **aceitar** ser parceiro (`HomeCliente.aceitarParceria`), redireciona para **`/minha-rede`** (conhecer a tela). O painel **"Seu Nível"** (`MinhaRede.jsx`) foi redesenhado: **hero com gradiente azul** (nome do nível + selo da **comissão por indicação %**) e o **progresso pro próximo nível em BARRAS** (indicados pagantes + rede, `atual/alvo · faltam N`, via helper `Progresso`) — mostra claramente quanto ganha por indicação e o que falta para subir. Trilha Pioneiro→Lenda embaixo.

**Pendências do DONO:** (a) validar modelo/números com **contador+advogado** (brief a redigir); (b) **Leilão Club:** elaborar contrato definitivo (upgrade do `TEMPLATE_CLUBE`, mesmo padrão do assessorado); (c) confirmar se quer bloqueio de contrato **imediato** (hoje: 30 dias de carência, casa com a cláusula); (d) **pool 2% / go-live** (agendar `recalcular_ranks`+`distribuir_pool_rank` mensais — ainda sem cron); (e) trocar o **pool** por um **Bônus Infinito estilo Diamante** no topo (Lenda), se quiser espelhar 100% o Conselheiro.

## ✅ COMEÇAR AQUI (25/07 — sessão 5: correções de rumo do dono sobre a sessão 4)
> Branch: `claude/bidprobrasil-handoff-storage-qzm1mc`. Build (vite) OK · `node --check` OK. Três ajustes pedidos após a sessão 4.

1. **Relatório do ÍNDICE — nova peça COMERCIAL (marketing) na tela do Índice.** O 1º relatório (mercadológico) já APRENDE com o Índice (semeia+lê+injeta — confirmado). Novo: botão **"Gerar relatório do Índice (PDF)"** em `src/pages/IndiceConsulta.jsx` → `src/components/IndicePDF.jsx` (novo). Gera, client-side (mesmo padrão `imprimirHtml`+`cabecalhoBidPro`), uma peça **com identidade BidPro completa** para o endereço/bairro/cidade consultado: venda e locação R$/m², rentabilidade bruta, curva de valorização por ano, metodologia e marca. Uso comercial p/ advogados/peritos/corretores. Sem endpoint novo (usa o `res` já buscado de `/api/indice-consulta`).

2. **Legitimidade do leilão — SEPARADA por modalidade (`api/gerar-documental.js`).** Antes o antifraude aplicava CNJ a tudo. Agora: **JUDICIAL** → valida o processo no CNJ (dígito verificador + DataJud); **EXTRAJUDICIAL** (Lei 9.514, sem processo) → orienta conferir o lote no **site OFICIAL do leiloeiro** (`url_lote`/`link_edital`, agora no SELECT). **Ambos** → o parecer recomenda reunião com analista + encaminhamento ao jurídico (reforçado no prompt e no `result.antifraude.recomendacao`; o rodapé do PDF já dizia). `ehJudicial` reusa a var da linha ~611.

3. **Certidões — a do PORTAL (não da plataforma), ao FINAL do relatório; CNIB/CENPROT viram diligência do ADVOGADO.** O dono não quer página fabricada pela BidPro; quer a **certidão como o portal devolveu**, visualizável, ao fim do documental/jurídico. `salvarComprovante` guarda o **retorno fiel do portal** sanitizado (remove `<script>`/`<base>`/`<link>`/`<iframe>` → não re-hidrata ao vivo, fim da "tela de digitação"). Nova seção **"Certidões das consultas (documentos do portal)"** ao FINAL do `DocumentalPDF.jsx` (`result.certidoesDocumentos`). **DECISÃO do dono (sessão 5b):** como **CNIB e CENPROT** são SPA+captcha e a certidão oficial **não sai de forma confiável** pela plataforma, foram **RETIRADOS** da captura (sem `comprovanteHtml` em `api/_laudo-fontes.js`) e **recomendados como diligência do ADVOGADO** — injetados em `certidoesRecomendadas` ("Certidões a gerar antes do lance") + mensagem de diligência reforçada. **Só o CNDT** (server-rendered, sai de fato) permanece como certidão capturada do portal.

## ✅ COMEÇAR AQUI (25/07 — sessão 6: relatórios "sumindo", docs "faltando", CEF 2ª praça, Cliente 360)
> Branch: `claude/bidprobrasil-handoff-storage-qzm1mc`. Build (vite) OK · `node --check` OK · migrações via MCP · segurança **0/0**. Bugs reportados pelo dono (com prints), investigados com 2 agentes + queries no banco do próprio dono (admin).

**Diagnóstico (banco):** o dono tem 35 documentais, 27 com parecer real e **8 com "faltando"** — todos com `regen_motivo='matricula_nao_lida'` e **sem parecer** → confirma o **loop de regeração que sobrescreve o relatório bom** por "faltam documentos". 2 casos ATIVOS/futuros com docs no bucket (MEGA Itaboraí = matrícula no bucket com nome-lixo "Edital…"; GRUPOLANCE Rio Claro = leitura do bucket voltou 0).

1. **Relatórios "sumiam" — RAIZ + fix (`api/gerar-documental.js`).** A regeração (a) zerava `result` no início e (b) o gate "0 docs lidos" sobrescrevia o parecer bom por `semDocs` (precisaDocumentos), sem nada impedir o downgrade. Gatilho: `vicioRegen` marca `regen_motivo` até em relatório bom (CNJ transitório/modalidade indefinida) → `regenerar-relatorios-cron` re-roda → leitura CEF falha transitória (teto Bright Data/403/URL assinada expirada) → apaga. **Fix (PRESERVAÇÃO):** carrega o `resultadoAnterior`; se já havia parecer BOM (>200 chars, sem precisaDocumentos), a regeração que lê 0 docs **preserva o parecer**, limpa `regen_motivo` (para o loop) e loga anomalia `documental_regen_leitura_zero`; o upsert de `gerando` não zera mais o result. Vale para todos os 3 relatórios do fluxo.
2. **"Faltam documentos" com docs no bucket (MEGA).** A matrícula estava no bucket (`tipo='matricula'`) mas com nome "Edital…" → em código antigo o gate a dava como faltando. O #261 já prefere o `tipo` do banco; com o Fix A + regeração no código atual, resolve. Os 6 casos passados/inativos são de leilão já ocorrido (baixa prioridade).
3. **CEF 2ª praça — capturada e exibida.** O CSV só traz o valor da 1ª praça (≈ avaliação) e a data mais próxima; a 2ª praça (a oportunidade real, ex.: 550k→330k, 40% off) só existe na página de detalhe e era descartada. **Migração** `cef_segunda_praca.sql` (colunas `valor_minimo_2`/`data_leilao_2`, aplicada via MCP); **`scripts/enriquecer-datas-cef.mjs`** ganhou `extrairPracasCEF()` e captura valor+data das DUAS praças na mesma visita (+ revisita quem falta `valor_minimo_2`); **`ImovelDetalhe.jsx`** mostra o tile "Lance mínimo (2ª praça)" com % abaixo da avaliação + a 2ª data. *desconto_percentual/BidScore seguem na 1ª praça (não mexi no ranking — decisão do dono se quer refletir a 2ª).*
4. **Cliente 360 — documental/laudo agora instrumentados.** Só `relatorio_mercado_ok` era logado → falhas de documental/laudo ficavam invisíveis no Cliente 360. Adicionei `logAtividade` em `gerar-documental` (ok/faltam_docs/erro) e `gerar-laudo-viabilidade` (ok/erro).
5. **Retenção — guarda de leilão futuro no ramo sem_data (`retencao_analises_guard_semdata.sql`, aplicada).** O ramo que apaga análises com `data_leilao=null` > 60d não tinha a guarda de "imóvel ativo com leilão futuro" (o documental grava data_leilao=null com frequência) → podia apagar relatório de leilão futuro. Adicionada a mesma guarda dos outros ramos.

> ✅ **DEPLOYADO + CONFIRMADO EM PRODUÇÃO (25/07):** merge na `main` (`0f369f6`) → deploy Vercel READY. Regeração forçada (workflow `testar-analise-amostras.yml`, admin) + enricher CEF (`enriquecer-datas-cef.yml`). **Resultados:** MEGA Itaboraí → parecer 12.584 chars, `faltando=[]`; GRUPOLANCE Rio Claro → parecer 13.838 chars, `faltando=[]` (os 2 ativos que davam "faltam documentos" com doc no bucket, resolvidos); **2ª praça capturada em 93 imóveis CEF** (ex.: ALPHAVIEW Barueri 550k→**330k**, 07/08, 40% off — exatamente o print do dono); Cliente 360 logando `relatorio_documental_ok`. Os inativos/leilão-passado seguem "faltam documentos" (correto). Enricher CEF cobre o resto do acervo nas próximas rodadas (hora em hora).

## ✅ COMEÇAR AQUI (25/07 — sessão 7: relatório do Índice com gráfico + rastreabilidade)
> Branch/main: deploy. Pedido do dono (com print do PDF): (1) o **gráfico** de valorização não aparecia; (2) mostrar a **relação dos imóveis da amostra** com **descrição, portal e data de inclusão** (rastreabilidade).

- **Gráfico sumia (raiz):** a RPC `indice_valorizacao_anual` exige muitas amostras/ano e sumia em região com histórico curto (ex.: Feira de Santana Casa: 2024=3 amostras, 2025=75 → série curta). **Fix:** `api/indice-consulta.js` agora retorna `amostras_ano` (mediana R$/m² de venda por ano, derivada das próprias amostras, aparece com ≥2 amostras/ano) e o `IndicePDF.jsx` desenha um **gráfico de BARRAS** (como na tela) a partir dela, com % período/ano.
- **Rastreabilidade:** `indice-consulta` também retorna `amostras` (20 comparáveis recentes do segmento/cidade: `especie,valor_m2,valor_total,area_m2,data_ref,fonte,criado_em`). O `IndicePDF` ganhou a seção **"Relação dos imóveis da amostra"** — tabela com **descrição** (venda/locação · área · R$), **R$/m²**, **portal** (o `fonte`, ex.: OLX/ZAP/VivaReal/LeilaoImovel-CEF) e **data** (mês/ano do anúncio + "capt." = quando entrou na base). Leitura interna via service key (RLS não bloqueia).

## ✅ COMEÇAR AQUI (25/07 — sessão 8: leilão contaminando o índice + padrão do imóvel)
> Deploy `main`. Dois defeitos apontados pelo dono no Índice/mercadológico (exemplo: condomínio Laguneville, ALTO PADRÃO, recebeu comparáveis POPULARES + um de leilão).

1. **Leilão contaminando o índice (raiz + fix).** Os 2 seeders (`gerar-analise` e `indice-mercado`) JÁ mandam o LLM descartar leilão no prompt, mas ele deixou passar 4 comparáveis "LeilaoImovel / CEF" e "ChavesNaMao / CEF" (R$ 605–1.375/m² vs mercado ~2.600) que **derrubam o R$/m²**. **Fix determinístico (não confia só no prompt):** (a) removidos os 4 do banco; (b) guarda por FONTE (`FONTE_LEILAO`) em `gravarAmostrasIndice` (gerar-analise) e `montarAmostras` (indice-mercado) — não grava comparável cuja fonte indique leilão/Caixa/arremate/venda-direta; (c) defesa em leitura no `indice-consulta` (lista + gráfico já excluem leilão).
2. **Padrão do imóvel (popular × alto padrão).** O mercadológico já usa **Nível 1 = mesmo condomínio** (padrão certo quando há anúncios internos) + ajuste por "padrão construtivo", mas não CLASSIFICAVA o tier nem rejeitava comparável de padrão diferente. **Fix (`promptMercado`):** nova REGRA obrigatória — identifica o **padrão** (popular/médio/médio-alto/alto/luxo) pelo condomínio/endereço/área e usa SÓ comparáveis do MESMO padrão (descarta R$/m² muito distante do tier; em alto padrão com poucos anúncios internos, prefere mesmo-padrão na cidade a "próximo porém inferior"). Novo campo `consolidado.padraoImovel` + citado no comentário.
3. **PENDENTE (proposta ao dono):** o ÍNDICE regional ainda é média por cidade/segmento (mistura padrões) — estruturalmente ele não sabe o padrão de um endereço sozinho (quem identifica é o mercadológico). Enhancement proposto: **bandas de padrão** no índice (percentis popular/médio/alto de R$/m²) para não julgar um alto padrão pela mediana da cidade. Precisa do ok do dono (mudança de design).

## ✅ COMEÇAR AQUI (25/07 — sessão 9: índice coerente por região + bandas de padrão)
> Deploy `main`. Pedido do dono: bandas de padrão + confirmar que o índice/relatório agrega a composição de preços da REGIÃO solicitada.

- **Descoberta (coerência):** havia DUAS tabelas — `indice_amostra` (singular, fonte REAL, dos relatórios) e `indice_amostras` (plural, geo, fonte sintética, do indice-mercado). A RPC `indice_regiao_ponderado` lia a PLURAL; a lista/gráfico/limpeza que fiz eram na SINGULAR → **valor e composição vinham de fontes diferentes** (ex.: Feira de Santana Casa: valor exibido 3.190 via fallback, mas as amostras mostradas medianas 2.638). Divergência = o oposto de rastreável.
- **Fix (`indice-consulta.js`):** o índice passa a calcular **valor + lista + gráfico + bandas da MESMA base** (`indice_amostra`, fonte real), escopada à região (cidade+uf+tipo), sem leilão. Valor = **mediana** das amostras de venda (robusta a outliers de padrão). Fallback (ponderado com geo → acervo) só quando a região não tem amostras de mercado. Agora o número reflete exatamente os comparáveis mostrados.
- **Bandas de PADRÃO** (`regiao.bandas` = percentis p25/p50/p75 de R$/m² de venda): popular · médio · alto. Feira de Santana Casa: **popular R$ 2.472 · médio R$ 2.638 · alto R$ 4.749** — um imóvel ALTO PADRÃO (ex.: Laguneville) deve olhar a faixa "alto" (~R$ 4.749), ~2× a mediana. Exibidas na tela do Índice (`IndiceConsulta.jsx`) e no PDF (`IndicePDF.jsx`).
- **Laguneville:** NÃO é imóvel do acervo (foi uma consulta ao Índice) → não há mercadológico dele p/ regenerar. O ÍNDICE dele agora reflete o alto padrão. Para um MERCADOLÓGICO alto-padrão do endereço, roda-se a análise manual (já padrão-aware).

## ✅ COMEÇAR AQUI (25/07 — sessão 10: reaproveitamento por região no mercadológico — cache do Índice)
> Deploy `main` (`f2e0d0c`). Pedido do dono: o mercadológico/índice deve calcular um valor REAL de mercado pela **média dos anúncios por tipo, excluindo leilão**, para confrontar a avaliação (oportunidade ou não). E — sem re-buscar imóveis na web toda vez (custo alto) — **métricas de reaproveitamento por região** (volume por bairro/localidade). O dono aprovou ("gostei. faça e coloque em produção").

**(a) Amostras com LOCALIDADE (`gravarAmostrasIndice` em `api/gerar-analise.js`).** Cada amostra gravada em `indice_amostra` agora leva `bairro_norm` (mesma normalização do banco) e `geo_grid` (~1 km, `'lat.dd,lng.dd'`) — antes iam **vazios**. É o pré-requisito para reaproveitar por bairro/grid (sem isso, só dava para escopar por cidade). Não muda comportamento visível; só enriquece a base própria.

**(b) Cache de comparáveis por região — gate por env (`amostrasRegiaoCache` + `else` da busca).** Quando a microrregião **já tem** amostra DENSA (≥ 8, `MERCADO_CACHE_MIN`) e RECENTE (≤ 120 dias, `MERCADO_CACHE_DIAS`) de **VENDA sem leilão** na base própria, o gerador **injeta esses comparáveis REAIS como âncora** no `promptMercado` e **reduz a busca web de 5 → 2 usos** (a IA segue montando o mercado, só completa lacunas: padrão/anúncio ativo). Escopo do **mais fino ao mais amplo**: `bairro_norm → geo_grid → cidade`, parando no 1º nível com densidade suficiente. Assim uma região "aquecida" (muitos relatórios já feitos) **não paga a pesquisa cara toda vez** — a economia é ~60% da etapa de web search nos hits.
- **FLAG OFF por padrão (`MERCADO_CACHE`):** em produção **nada muda** até o dono setar `MERCADO_CACHE=1` na Vercel (Production+Preview). O `console.log('[mercado-cache]', …)` grava **hit/miss + nível + nº de comparáveis + maxWeb** por relatório → dá para **medir a economia real** nos logs antes de deixar ligado em definitivo. Thresholds ajustáveis por env (`MERCADO_CACHE_MIN`, `MERCADO_CACHE_DIAS`).
- **Sem risco de leilão/padrão errado:** a leitura filtra fonte de leilão (`ehFonteLeilao`) e usa só o MESMO tipo/segmento; a mediana injetada respeita o recorte da região. Rural fica fora (régua de hectare). Build (vite) OK · `node --check` OK.
- **Confronto avaliação × mercado (parte conceitual do pedido):** já existente e reforçado — o mercadológico exclui leilão do comparativo (`FONTE_LEILAO` na sessão 8) e estima o valor pela média/mediana de anúncios do mesmo tipo; o Índice serve de norteamento de R$/m² por região. Este cache só barateia a obtenção desses comparáveis reutilizando o que já capturamos.
- **Como ligar e medir:** (1) Vercel → Env `MERCADO_CACHE=1`; (2) gerar alguns mercadológicos em cidades já bastante analisadas (ex.: Feira de Santana); (3) `Vercel logs` filtrando `[mercado-cache]` → ver `hit:true` e `maxWeb:2`; (4) comparar consumo/tempo com a semana anterior. Reverter = apagar a env (volta a 5 buscas sempre).
- **STATUS (dono):** `MERCADO_CACHE=1` e `MERCADO_CACHE_MIN=8` já setados na Vercel; `MERCADO_CACHE_DIAS` deixado no padrão (120 = 4 meses) — o dono quis planejar (virou a sessão 11).

## ✅ COMEÇAR AQUI (25/07 — sessão 11: composição TEMPORAL do valor — períodos de 4 meses + projeção p/ hoje)
> Deploy `main`. Build (vite) OK · `node --check` OK. Pedido do dono: o valor (Índice e mercadológico) deve separar os anúncios por período (4 meses), mostrar o quantitativo, usar o valor REAL quando há amostra recente e — quando só há anúncios antigos — **projetar para hoje** e **avisar** quem gerou o relatório. Decisão do dono: **projeção pela curva do próprio Índice BidPro** + **implementar agora**.

- **Helper compartilhado `api/_indice-composicao.js` (puro, roda no Edge e no Node):** `composicaoTemporal(vendaSamples, amostrasAno, nowMs)` → buckets de 4 meses (mediana R$/m² + contagem), `total_anuncios`, `n_recentes`. Valor: se há ≥ 4 amostras na janela de 4 meses → **mediana das recentes** (`projetado=false`); senão **projeta cada anúncio p/ hoje** por `(1+taxa)^anos` (taxa = CAGR da mediana/ano da região, clampada [-10%,+30%]) e tira a mediana (`projetado=true`, `sem_amostras_recentes=true`, `base_periodos` = faixa de anos). Sem curva confiável (≤ 1 ano) → mediana geral sem projeção, ainda sinalizado. `avisoFrescor(comp)` gera a mensagem honesta ao usuário. Testado com 3 cenários (recente / só-antigo-projetado / sem-curva).
- **Índice (`api/indice-consulta.js`):** o valor de venda passa a ser a composição temporal (recente OU projetado); retorna `regiao.{projetado,sem_amostras_recentes,total_anuncios,n_recentes,taxa_aa,base_periodos,periodos}` + `aviso` no topo. Aviso só quando o valor veio da composição (não no fallback ponderado/acervo).
- **Front do Índice:** `IndiceConsulta.jsx` mostra banner ⏳ de frescor, selo **PROJETADO** no card VENDA, contagem "X anúncio(s) · Y recente(s)" e a **composição por período** (últimos 6 buckets). `IndicePDF.jsx` idem (banner + selo + seção "Composição por período" + metodologia atualizada citando a projeção).
- **Mercadológico (`api/gerar-analise.js`):** `lerComposicaoRegiao(imDb, segIdx)` lê a base própria (indice_amostra, venda, sem leilão) DEPOIS de gravar as amostras deste relatório e anexa `mercado.indiceComposicao` + `mercado.avisoFrescor`. `Analise.jsx` renderiza o banner de frescor + selo PROJETADO + composição por período abaixo do bloco "Índice BidPro". Assim o relatório confronta a avaliação com o valor de mercado por período e avisa quando não há anúncio recente.
- **Coerência com pedidos anteriores:** leilão continua excluído (`ehFonteLeilao`); mesma normalização de bairro/grid da sessão 10. A janela de 4 meses reaproveita o conceito do `MERCADO_CACHE_DIAS=120`.

## ✅ COMEÇAR AQUI (25/07 — sessão 12: máximo de referências por tipo + colheita de OUTRAS tipologias)
> Deploy `main`. Build (vite) OK · `node --check` OK · migração via MCP. Pedido do dono: mesmo com o mínimo de 8 (cache), o mercadológico deve trazer o MÁXIMO de referências por tipo; e como "a IA pode trazer tudo e filtrar", aproveitar a MESMA busca para semear as OUTRAS tipologias da região. Decisão do dono: colher **todas as 3 outras** tipologias + **implementar agora**.

- **Máximo por tipo (`promptMercado`):** reforço "traga TODAS as amostras coerentes do tipo-alvo (não corte a lista), só depois filtre padrão/leilão"; `max_tokens` 8.000 → **11.000** p/ caber mais amostras + o novo bloco.
- **Colheita oportunista (`outrasTipologias`):** a IA retorna, num bloco separado, os comparáveis de **VENDA que já viu** de apto/casa/terreno/comercial (menos o tipo-alvo), até ~12 por tipo, SEM buscas dedicadas, sem leilão. `gravarOutrasTipologias()` grava no Índice desses segmentos no **nível CIDADE** (`bairro_norm`/`geo_grid` VAZIOS de propósito — o quarteirão do alvo não vale p/ uma casa do outro lado da cidade), `origem='relatorio_regiao'`, teto 15/segmento, dedup pelo índice único. Só em busca FRESCA (`!reaproveitado`); o bloco é apagado do `result` persistido (fica enxuto). **NUNCA entra no valor do relatório atual** — só na base do Índice. Log `[outras-tipologias]` mede o ganho.
- **Regra preservada:** o VALOR do imóvel-alvo continua saindo só do MESMO tipo/padrão (sessões 8–9). A colheita é byproduct que decanta na base — acelera o cruzamento do mínimo de 8 (mais cache hits) e a composição temporal dos outros segmentos.
- **Migração `indice_amostra_origem_relatorio_regiao.sql` (aplicada):** estende o CHECK de `origem` p/ incluir `relatorio_regiao` (auditável via `select origem,count(*) from indice_amostra group by origem`). Dedup index NÃO inclui `tipo` (inclui cidade/uf/especie/valor/fonte/data) — colisão entre tipos é improvável e só descarta duplicata exata.

## ✅ COMEÇAR AQUI (25/07 — sessão 13: aviso de login Google em PWA/navegador embutido)
> Deploy `main`. Build (vite) OK. O dono não conseguia logar com Google no celular ("Algo deu errado" no 2FA do Google, print de `accounts.google.com` dentro de navegador embutido). Causa: o Google BLOQUEIA a verificação em duas etapas em navegadores embutidos (Instagram/FB/etc.) e, em PWA standalone/iOS, o OAuth abre num navegador sobreposto e o retorno perde a sessão (storage isolado) — não é bug do BidPro (o `signInWithOAuth` está correto).

- **`src/pages/Login.jsx`:** detecção client-only `ambienteFragilGoogle` (`display-mode: standalone` OU `navigator.standalone` OU UA de app embutido: FBAN/FBAV/Instagram/Line/Twitter/LinkedInApp/Snapchat/Pinterest/MicroMessenger/WhatsApp/GSA). Quando true, mostra um aviso ⚠️ acima do botão do Google (nos modos login E cadastro): "o Google pode falhar no 2FA — prefira e-mail e senha, ou abra www.bidprobrasil.com.br no Safari/Chrome". O e-mail/senha já era o caminho visualmente primário (fica acima do divisor). Sem mudança no fluxo OAuth em si.
- **Workaround imediato p/ o dono:** entrar por e-mail/senha (funciona 100% dentro do PWA) ou abrir no Safari/Chrome de verdade. No iPhone, PWA standalone real só instala pelo Safari (não pelo Chrome).

## ✅ COMEÇAR AQUI (25/07 — sessão 14: capas e arquivos da Área de Membros no Storage)
> Deploy `main`. Build (vite) OK · migração via MCP. O dono: a capa do e-book vinha em branco; pediu capa (PNG/JPG) e arquivo do e-book **armazenados no banco** (Storage), para capas de ebooks/cursos/aulas sempre disponíveis; vídeos por YouTube ou Bunny.

- **Raiz da capa em branco:** `capa_url` guardava um **link do Google Drive** e o `driveImage()` tentava servir como imagem, mas o Drive **bloqueia hotlink** → `<img>` vazio.
- **Migração `membros_capas_bucket_e_curso_capa.sql` (aplicada):** bucket **público** `membros-capas` (capas: leitura pública, upload só admin via policies em storage.objects) + coluna `capa_url` em `cursos_admin` (ebooks_admin já tinha).
- **Admin (`src/pages/Admin.jsx`):** componente `UploadMidia` — capa (imagem) → `membros-capas` público (retorna publicUrl); PDF do e-book → `documentos` privado + **URL assinada ~10 anos** (só quem tem direito recebe via a RPC `obter_arquivo_ebook` que já existe). Editor de e-book ganhou upload de **capa** + **PDF** (com preview e fallback de URL manual); editor de **curso** ganhou upload de **capa** (preview; sem capa usa o emoji). Placeholder do vídeo da aula agora cita **Bunny Stream**.
- **Vídeo já OK:** `Curso.jsx > videoEmbed()` já suporta **YouTube, Bunny Stream, Vimeo, Panda** (embed externo) — nada a fazer, só confirmado.
- **Aulas:** a "capa" da aula é a própria miniatura do vídeo (YouTube/Bunny) → não precisa de imagem separada (decisão registrada).
- **Leitor (`EbookPage.jsx`):** `isPdf` passou a casar `.pdf` seguido de `?`/`#`/fim (a URL ASSINADA termina em `?token=...`) — senão o leitor não reconheceria o PDF do Storage.
- **Ação do dono:** as capas ATUAIS (links do Drive) continuam em branco até **reenviar a imagem** pelo Admin (Membros → editar e-book/curso → “Enviar imagem (PNG/JPG)”). O mesmo para trocar o PDF pelo upload.

## ✅ COMEÇAR AQUI (25/07 — sessão 15: painel de Assinaturas mostrava tudo 0)
> Deploy `main`. Build (vite) OK. O dono: Financeiro › Assinaturas mostrava 0 assinantes/0 pagantes e todos os status zerados, mesmo havendo usuários grátis E pagos.

- **Raiz (erro de API silenciado):** `AbaAssinaturas` (`src/pages/AdminFinanceiro.jsx`) fazia `perfis.select('… email …')`, mas `perfis` **NÃO tem coluna `email`** (fica em auth.users) → PostgREST 400 → `data=null` → 0 em tudo. O `.then` não checava `error`.
- **2º bug:** o `select` não trazia `role` e `statusAssinante` classificava "pago" por `p.plano` — mas `plano` é **sempre 'gratuito'** (default legado); o tier real está no `role` (top2/assessorado/clube + anuais). Então todos cairiam em "grátis".
- **3º bug:** o filtro `.in('role', ['explorador','top2','assessorado','clube'])` **excluía os anuais** (top2_anual etc.).
- **Fix:** removido `email` do select; adicionado `role`; filtro passou a `ROLES_ASSINANTE` (explorador + 6 tiers pagos mensais/anuais); `.then` agora checa `error` (console.error); `statusAssinante` classifica pago por `role` (ou plano); lista mostra o tier por `role` (`TIER_LABEL`) em vez do enganoso `plano='gratuito'`; nome de exibição sem o `email` inexistente.
- **Dados reais (17 perfis):** 12 explorador (grátis) · 2 assessorado + 2 top2 (pagos, não inadimplentes → em dia) · 1 admin (interno, fora da lista). **Esperado no painel:** 16 assinantes · 4 pagantes · 12 grátis · 4 em dia.
- **Obs.:** Pausado/Teste seguem 0 até plugar o status da assinatura no Asaas/MP (ainda sem campo próprio). A coluna `perfis.plano` está órfã (sempre 'gratuito') — candidata a limpeza/uso futuro.

## ✅ COMEÇAR AQUI (25/07 — sessão 16: parceiro grátis indica, mas só saca sendo pagante)
> Deploy `main`. Build (vite) OK. Regra do dono: quem aceita ser parceiro pode indicar; se for Explorador (grátis) pode virar parceiro, mas deve ser SINALIZADO que precisa ser pagante para ter direito a RECEBER; e o aceite deve orientar completar o cadastro (PIX etc.).

- **Trava de negócio (`api/saque.js`):** `podeReceber(role)` = tier pago (top2/assessorado/clube + anuais) OU equipe (admin/analista/advogado/consultor/afiliado/leiloeiro). GET retorna `precisa_assinatura` e `saque_habilitado` passa a exigir `!precisa_assinatura`; POST bloqueia com 403 e mensagem clara se não pode receber. Explorador/grátis indica e acumula, mas não saca até assinar.
- **`Comissoes.jsx`:** lê `precisa_assinatura`; quando true, aviso roxo "Você pode indicar, mas para RECEBER precisa de assinatura ativa" + botão "Ver planos e assinar" + saque desabilitado. O gate de cadastro (`faltando`: nome/CPF/telefone/chave PIX) continua.
- **`HomeCliente.jsx` (box Programa de Parceiros):** já-parceiro NÃO pagante vê aviso ⚠️ "para RECEBER precisa de assinatura ativa" + botões **Assinar** e **Configurar meu PIX**; pagante vê atalho "Configurar meu PIX para receber". (O texto do convite já dizia que grátis pode indicar mas precisa de assinatura para receber.)
- **Dúvida do dono — "Pausado / período de teste":** *Pausado* = assinatura temporariamente suspensa no gateway (cobrança em espera, não cancelada); *período de teste (trial)* = janela grátis inicial antes da 1ª cobrança. Hoje BidPro **não** expõe esses estados (sem campo próprio) → ficam 0. Se não usarmos trial, dá para **esconder** o card Pausado até plugar o status do Asaas/MP (a decidir com o dono).

## ✅ COMEÇAR AQUI (25/07 — sessão 17: comissão de rede exige assinatura EM DIA na data da cobrança)
> Migração via MCP (banco). Regra do dono: a comissão só é DEVIDA ao upline que está com a assinatura EM DIA **na data em que o indicado (e a rede abaixo) é cobrado** — não basta ser pagante/vender; tem que estar preparado antes, em dia na data da cobrança.

- **Onde nascia a comissão:** webhook de pagamento (`api/_webhook-core.js`) → RPC `distribuir_comissao_rede` (sobe a árvore `indicado_por`, N níveis de `comissao_regras`).
- **Antes:** exigia só `eh_pagante(role)` + `parceiro_aceite_em`. Um `top2` **inadimplente** ainda receberia.
- **Correção (`comissao_rede_elegivel_em_dia_na_cobranca.sql`, aplicada):** a elegibilidade por nível agora exige, ALÉM de pagante+aceite, **assinatura EM DIA na data (current_date = data da cobrança)**: `ativo` (não cancelado) + `inadimplente_desde IS NULL` + `plano_vencimento` nulo ou futuro. Quem **não** está em dia é **PULADO** — a comissão sobe para o próximo upline elegível (compressão dinâmica mantida). Vale para todos os níveis (a rede abaixo). Idempotência por pagamento+nível preservada.
- **Interação com o saque (sessão 16):** agora há duas travas — **acúmulo** (só credita quem está em dia na cobrança) e **saque** (só saca quem é pagante/equipe). Efeito: quem não mantém a assinatura em dia não acumula nem saca. **Ponto p/ o dono decidir:** um parceiro que ACUMULOU estando em dia e depois cair (churn) — hoje o saque fica travado até reassinar. Se preferir que ele mantenha o saldo já ganho, eu relaxo a trava de saque (a de acúmulo continua). *(Obs.: conta cortesia — role pago sem vencimento/sem inadimplência — é tratada como "em dia"; para excluir cortesias precisaríamos de um flag "pago via gateway".)*

## ✅ COMEÇAR AQUI (25/07 — sessão 18: saque liberado do acumulado + chargeback sinaliza o cliente)
> Deploy `main` (front) · webhook já ativo (backend). Decisões do dono: (a) como a elegibilidade da comissão é decidida na ORIGEM (só credita no mês em dia), o saque do que já foi acumulado deve ser liberado; (b) em caso de CHARGEBACK da cobrança paga, a comissão é descontada no pagamento seguinte e o relatório deve sinalizar QUEM foi o cliente e que houve chargeback.

- **Saque destravado (`api/saque.js`):** removido o bloqueio no POST por assinatura; `saque_habilitado` volta a depender só do cadastro (nome/CPF/telefone/PIX). O flag virou `nao_ganha_novas` (INFORMATIVO). O saldo só contém o que foi ganho em meses "em dia" (garantido na origem, sessão 17), então é do parceiro por direito.
- **Front (`Comissoes.jsx`, `HomeCliente.jsx`):** aviso reescrito — "Você pode indicar e SACAR o que já acumulou; para GANHAR novas comissões, a assinatura precisa estar em dia na data da cobrança dos seus indicados". Botão de saque não é mais desabilitado por assinatura.
- **Chargeback (`api/_webhook-core.js` `estornarComissao`):** já revertia todos os níveis com lançamento NEGATIVO (fica negativo se já sacado → **abate no pagamento seguinte**) e cancelava as `comissoes`. Agora **sinaliza o cliente**: busca `comissoes.cliente_id → perfis.nome` e grava a descrição do estorno como "Estorno de comissão — CHARGEBACK do cliente {nome} (gateway); descontado do saldo/pagamento seguinte", e a `comissoes.referencia` como "Cancelada por chargeback do cliente {nome}". Param `motivo` ('chargeback'|'reembolso'); chamada em `processarChargeback` passa 'chargeback'. Idempotência mantida.
- **Regra final consolidada:** vínculo do indicado é permanente; comissão é DEVIDA por cobrança se o upline está em dia naquela data (senão sobe p/ o próximo elegível); o acumulado é sempre sacável; chargeback estorna e desconta no seguinte, identificando o cliente no relatório.

## ✅ COMEÇAR AQUI (25/07 — sessão 19: tela "Minha Rede" do parceiro (LGPD) + aposenta Consultor)
> Deploy `main` · migração via MCP. Pedido do dono: aba de Parceiro no menu (após o aceite) com o link + nº de indicados + a ÁRVORE da rede (quem virou parceiro e a rede abaixo), SEM telefone/e-mail/contato (LGPD); admin também vê. E aposentar o Consultor (o MLM o substitui).

- **RPC `minha_rede(p_root)` (SECURITY DEFINER, LGPD-safe):** devolve SÓ a sub-árvore do chamador (recursiva por `indicado_por`, até 10 níveis) com **apenas** id, parent_id, nível, **nome**, **cidade/UF**, `parceiro` (bool) e nº de indicados. **Nenhum dado de contato sai do banco.** Não-admin fica travado na própria raiz; admin passa `p_root` para ver a de qualquer parceiro. Helper `cidade_uf_publica(endereco)` extrai só "Cidade - UF" (descarta rua/número/CEP) — testado. EXECUTE só p/ authenticated.
- **Página `src/pages/MinhaRede.jsx`:** cabeçalho/apresentação, link de indicação (mesmo formato da home) + copiar, números (diretos · rede total · viraram parceiros), árvore expandível por nível (nome + cidade + selo PARCEIRO), busca admin para ver a rede de outro. Aviso LGPD explícito. Rota `/minha-rede` (autenticado).
- **Menu (`Header.jsx`):** item "Minha Rede" + "Comissões" no menu do usuário (desktop e mobile) **só quando `parceiro_aceite_em` está setado** (ou admin) — busca o aceite uma vez.
- **`/comissoes` liberado:** antes era `roles=['admin','consultor','analista','advogado']` (parceiro pagante comum NÃO via as próprias comissões/PIX). Agora é autenticado (a página/‌API são escopadas ao user.id) — necessário para o MLM.
- **Consultor APOSENTADO:** rota `/consultor` → **redireciona para `/minha-rede`**; botão "🤝 Comercial" removido do menu (desktop+mobile). `/afiliado` segue ativo (papel distinto). **Pendente (seguro, à parte):** parar de EMITIR novos convites de consultor no Admin e decidir a migração de quem já é `role='consultor'` (não mexi no role p/ não quebrar RLS/comissões existentes).

## ✅ COMEÇAR AQUI (25/07 — sessão 20: aposentadoria completa do Consultor)
> Deploy `main` · migração via MCP. Fecha a aposentadoria do papel Consultor pedida na sessão 19: (a) parar de conceder e (b) migrar quem já tem — feito com cuidado e reversível.

- **Diagnóstico:** `is_equipe()` = analista/advogado/admin (consultor NÃO está). Consultor desbloqueia acesso de STAFF (ler análises/casos/leads/etc.) por várias policies — retirá-lo é justamente tirar esse acesso. **Contagem real: 0 consultores** (role/vendedor_tipo/convites todos 0) → migração é no-op hoje.
- **(a) Parar de conceder:** `ROLES_DISPONIVEIS` (Admin) perdeu 'consultor' (dropdown de papel não oferece mais); botão "habilitar venda" força **afiliado** (sem opção consultor); `api/ativar-vendedor.js` coage qualquer convite (mesmo legado tipo='consultor') para **afiliado**.
- **(b) Migração idempotente (`aposentar_consultor_migra_parceiro.sql`, aplicada):** `role='consultor'` → `explorador` PRESERVANDO link/rede (indicado_por, codigo_indicacao) e saldo/comissões; grandfather do `parceiro_aceite_em` (mantém acesso à Minha Rede/Comissões); `vendedor_tipo consultor→afiliado`; desativa convites de consultor pendentes. Afetou **0 linhas** agora; blinda qualquer legado.
- **Reversível:** como não havia consultores, nada mudou de fato; se um dia precisar reativar o papel, é só re-adicionar 'consultor' aos pontos acima. Policies/labels que citam 'consultor' foram MANTIDAS (não quebram nada; só não há mais quem tenha o papel).

## ✅ COMEÇAR AQUI (25/07 — sessão 21: revisão LGPD dos termos frente à estrutura (MLM/rede/chargeback))
> Deploy `main`. O dono pediu para revisar os termos/LGPD (site + aceite de pagamento + aceite de parceiro) frente à estrutura atual, para proteger a empresa.

- **Lacunas encontradas:** (1) Política de Privacidade não citava o Programa de Parceiros nem que um parceiro **vê nome+cidade da rede** (compartilhamento entre usuários), a **chave PIX**, comissões e o **dossiê de chargeback (IP/dispositivo)**. (2) Termo de Parceiro cláusula 8 dizia "você não trata dados de terceiros" — desatualizada (agora visualiza a rede); cláusula 4 não refletia "em dia **na data da cobrança**".
- **`Privacidade.jsx`:** seção 1 agora inclui chave PIX + vínculo de indicação; parágrafo novo sobre **metadados anti-fraude/chargeback** (IP/dispositivo, legítimo interesse — Art. 7º IX e Art. 10); **nova seção 4 "Programa de Parceiros e rede de indicações"** (base legal, **minimização**: parceiro vê só nome+cidade, nunca contato; **corresponsabilidade** do parceiro — Art. 42+; admin vê p/ gestão); retenção agora cita documentos de leilão arquivados. Seções renumeradas.
- **Termo de Parceiro (`TERMO_PARCEIRO`, `HomeCliente.jsx`):** cláusula 4 reescrita (comissão devida só se em dia **na data da cobrança**; perde o mês fora de dia, recupera nos meses em dia; vínculo permanece; chargeback desconta no seguinte); cláusula 8 reescrita (vê só nome+cidade da rede, **corresponsável**, proibido usar p/ outra finalidade; metadados anti-fraude). **Versão v2→v3-2026-07.**
- **Aceite no pagamento (Checkout):** é checkbox com links para Termos + Privacidade — como os documentos foram atualizados, o aceite já referencia a versão nova (sem mudança estrutural).
- **Venda avulsa APOSENTADA (decisão do dono):** o mecanismo de "vendedor" (afiliado / % sobre vendas do link, separado do MLM) foi encerrado — todos ganham só pelo Programa de Parceiros (pagante em dia + link). Estado real: 0 operacionais, 0 vendedores (`vendedor_tipo` nulo p/ todos), e a comissão de rede já exige `eh_pagante`. Mudanças: (a) removidos os botões "Habilitar venda"/"Comissão" do Admin; (b) 'afiliado' saiu de `ROLES_DISPONIVEIS`; (c) rotas `/afiliado` e `/consultor` → redirecionam p/ `/minha-rede`; (d) `api/ativar-vendedor.js` retorna 410 (programa encerrado). A lógica antiga de comissão de venda (comissao_afiliado_pct) ficou inerte (0 vendedores) — não removida p/ não quebrar cálculos legados.
- **Analista — a DEFINIR (dono):** se participa de comissões (só colaborador sem comissão · recebe sendo pagante como os demais · recebe como exceção sem pagar). Não mexi no papel analista.

## 📋 PRÓXIMOS PASSOS / PENDÊNCIAS (revisão 25/07 — para resolver com o dono)

**A) Posso tocar (alguns precisam de go-ahead por custo/CI):**
1. **Mais leiloeiros (backlog TRT-15).** Construir scraper novo exige recon VIVO na CI (dev bloqueado) e **consome Bright Data (teto 450/sem)**. Ordem de melhor retorno: (1) SUPORTE tenant enum (cunha/vinco), (2) cluster **Vlance /v3/** (verdeamarelo+sudeste+capitalvalor+sanches), (3) alfaleiloes/destak. → **precisa go-ahead** (custo).
2. **Validar arquivamento de docs (sessão 3).** A fila (~2 mil) escoa a 40/30min; conferir no próximo ciclo pelas queries do bloco "sessão 3" (contagem de `imovel_anexos` das 11 fontes ↑ e `documentos_fila` pendente ↓).
3. **Regenerar 1 caso JUDICIAL + 1 EXTRAJUDICIAL** para conferir o antifraude por modalidade e a certidão CNDT ao final (posso forçar quando o dono quiser).
4. **Índice sob demanda p/ ADMIN quando a região não está mapeada** (evolução antiga pedida): disparar a pesquisa e estabelecer o valor na hora. → posso implementar.
5. **(Descartado, salvo pedido)** captura pós-captcha de CNIB/CENPROT via render Bright Data — decidido virar diligência do advogado.

**B) Depende do DONO (painel/assinatura — ver `docs/PENDENCIAS_DONO.md`):**
1. **Asaas** — reativar webhook (grátis, rápido). Depois eu reconcilio.
2. **Upstash Redis** — rate-limit global (grátis). Depois eu confirmo pelos logs.
3. **PECINI** — rodar 1 vez a captura de docs na CI (grátis) → eu confirmo cobertura.
4. **R2 (backup DR)** — criar bucket + 4 env vars + colar a cláusula LGPD na Política.
5. **Ranks / plano de carreira** — nomear os ranks, validar percentuais + % do pool, e **agendar os crons mensais** (`recalcular_ranks` + `distribuir_pool_rank`).
6. **Quando crescer o pago** — Resend (plano), Supabase (compute + read replica). *(Leaked-password já ligado.)*
7. **Preço agendado 01/10** (49,90→89,90 / anual 899) — já configurado; só monitorar o gatilho.
8. **Ligar o cache de mercado (opcional, economia)** — setar `MERCADO_CACHE=1` na Vercel (Production+Preview) para ativar o reaproveitamento por região (sessão 10). Fica OFF até o dono decidir; depois eu leio os logs `[mercado-cache]` e reporto a economia. Reverter = apagar a env.

## ✅ COMEÇAR AQUI (25/07 — sessão 4: Índice→viabilidade, antifraude documental, certidões, +leiloeiros)
> Branch: `claude/bidprobrasil-handoff-storage-qzm1mc`. Build (vite) OK · `node --check` OK nos `api/`. Segurança **0/0**. 4 pedidos do dono; investigados com 3 agentes em paralelo + queries.

1. **Índice BidPro agora ALIMENTA o laudo de VIABILIDADE (#3, `api/gerar-laudo-viabilidade.js`).** O relatório mercadológico (`gerar-analise.js`) já semeava+lia+injetava o Índice no prompt, mas o **laudo de viabilidade standalone** só recebia FipeZAP — o Índice e a curva de valorização (base própria) **nunca chegavam** ao 3º documento. Corrigido: `resumoMercado()` passa `mercado.indiceBidPro` (venda/locação R$/m², nível) + `mercado.valorizacao` (curva por ano + %a.a.); nova REGRA no `promptDefesa` manda o agente **cruzar Índice × FipeZAP** e ancorar na referência mais conservadora, usando a valorização como tendência. Assim o aprendizado da plataforma flui para os DOIS relatórios.

2. **ANTIFRAUDE no documental — valida LEILOEIRO e EXISTÊNCIA DO PROCESSO (#4, `api/gerar-documental.js`).** Golpe de leilão (site clonado, processo forjado) não tinha nenhuma trava. Agora: (a) **procedência** — cruza `row.fonte` com `leiloeiro_conhecimento`; fonte não reconhecida vira RISCO "alerta" + item de checklist "Procedência do lote". (b) **processo** — `cnjValido()` valida o **dígito verificador CNJ** (mód-97, Res. 65/2008) e cruza com o DataJud (`cnj.total`): DV inválido → risco; nº válido mas **não localizado no DataJud** → risco "confirmar no tribunal". Objeto `result.antifraude` persistido + dica no prompt da IA + riscos entram na contagem de pontos de atenção. (Zero falso-positivo: o alerta de DV só dispara em nº de 20 dígitos malformado.) Bônus: corrigido `im.fonte`→`row.fonte` na anomalia `cnj_vazio` (logava undefined).

3. **BUG das certidões corrigido — "abria tela de digitação, não a certidão" (#4, raiz).** Causa: o comprovante salvo era o **HTML CRU do portal** (SPA/JSF com captcha — CNIB/CENPROT/CNDT) e o front (`verComprovante` em `Analise.jsx`) injetava `<base href>` no **domínio VIVO do órgão** → o portal re-hidratava ao vivo e mostrava a **tela de busca/digitação**. Correção em 2 pontas: (a) `salvarComprovante` (gerar-documental) agora gera um **comprovante PRÓPRIO da BidPro** — página estática, **sem script e sem `<base>`**, com o RESULTADO da consulta (situação + data) + retrato em texto do retorno do portal (transparência) + link rotulado "emitir a certidão OFICIAL no portal" (honesto, não se passa pela certidão); (b) `verComprovante` deixou de injetar o `<base>` vivo e passou a renderizar INERTE (remove `<script>`/`<base>`), defesa contra comprovantes legados. Os portais só emitem o PDF oficial após captcha+form — por isso o certo é o comprovante próprio, não fingir ter a certidão.

4. **+Leiloeiros — auditoria + plano (#1, `docs/LEILOEIROS_TRT15_BACKLOG.md` §25/07).** Backlog de 58 domínios: a maioria já FLUI (LJUD=39 leiloeiros, LEILOTECH=13, SUPORTE/GESTAOLEILOES/SOLEON/SBID9). Os **0-acervo** exigem scraper dedicado com recon VIVO — **egress do dev bloqueado (HTTP 000)**, roda só na CI (`recon-deep.yml`) e **consome Bright Data (teto 450/sem)** → precisa go-ahead do dono. Próximo lever: (1) SUPORTE tenant enum (cunha/vinco, o mais barato); (2) cluster **Vlance /v3/** (1 scraper = verdeamarelo+sudeste+capitalvalor+sanches); (3) alfaleiloes/destak.

5. **Armazenamento pago — CONFIRMADO (#2).** A lógica do dono está certa e JÁ implementada: como pagamos Bright Data para raspar as fontes pagas, guardar o doc evita re-pagar na geração do relatório. Todas as fontes pagas/mistas têm `arquivar_docs=true`. Na prática **não há duplo custo**: RJ/SOLEON/PECINI publicam o PDF num CDN próprio que aceita fetch DIRETO grátis (por isso RJ=12/12, PECINI=23/36 já guardados) — o Bright Data pago é gasto só 1× (na listagem). **GESTAOLEILOES=0 guardados é genuíno**: o site não publica PDF avulso (só página do evento + número da matrícula, que o scraper já extrai p/ o cartório).

## ✅ COMEÇAR AQUI (25/07 — sessão 3: armazenamento de docs para TODOS os leiloeiros)
> Branch: `claude/bidprobrasil-handoff-storage-qzm1mc`. Migração aplicada via MCP; código na branch. Segurança **0/0** no início.

**Pedido do dono:** "ampliar o armazenamento que configuramos no último handoff dos documentos para todos os leiloeiros que temos, inclusive os próximos que conectarmos." Responde a pergunta que o #263 (arquivamento proativo) deixou em aberto ("confirmar se quer arquivar mais fontes gratuitas") — a resposta é **todas**.

**Feito (`supabase/migrations/arquivar_docs_todos_leiloeiros.sql`):**
1. **Default de `leiloeiro_conhecimento.arquivar_docs` → `true`.** Todo leiloeiro **futuro** (auto-registrado pelo `registrarConhecimento`, que faz upsert sem nunca tocar nessa coluna) **nasce arquivando**. Fecha o "inclusive os próximos que conectarmos" sem precisar lembrar de ligar na mão.
2. **Flag ligada para TODAS as fontes atuais** (`update ... where custo is not null` → 24 fontes). Só a pseudo-fonte interna **`SUPORTE`** (custo null, não é leiloeiro) ficou de fora. As gratuitas estáveis que eram **link-only** (MEGA/PESTANA/GRUPOLANCE/ZUK/BIASI/FRAZAO/WEBLEILOES/VIP/LEILOTECH/LEILOFY/SODRE) agora arquivam.
3. **Comentário do cron `enfileirar-documentos.yml`** atualizado (não é mais "fontes instáveis"; agora "todos os leiloeiros").

**Impacto medido antes de aplicar:** **~1.979** imóveis ativos novos a arquivar (têm link mas sem cópia no bucket). **Custo de captura = R$ 0** — todas são `gratis`/sem anti-bot → resolvem no CAMINHO 1 (fetch direto) do `captura-documentos.mjs`; Bright Data (pago) só dispara quando o navegador é BLOQUEADO, o que não ocorre nessas fontes. **Storage:** era 2.754 arquivos / **5,29 GB** (~2 MB/arquivo) → projeção **~11 GB**, folgado nos **100 GB** do Pro.

**Guardas que continuam corretas mesmo com a flag em todos** (no `enfileirar_docs_arquivar()`): **CEF** fica de fora (pipeline próprio — matrícula = URL estática, edital = coletivo por leilão); **`docs_status='esperado'`** (SUPERBID/SBID9/SBID21/SOLD/VENDASGOV — a fonte não publica o doc no lote) é pulado. Se qualquer 'esperado' passar a publicar, a flag JÁ ligada faz o arquivamento entrar sozinho.

**Fila semeada:** `enfileirar_docs_arquivar()` chamado 2× → **~2.074** imóveis na `documentos_fila`. O `captura-documentos.yml` (a cada 30 min, 40/run) drena em ~1 dia; o `enfileirar-documentos.yml` (diário 10 UTC, 1000/run) mantém em dia daqui pra frente. **Validar no próximo ciclo:** `select count(*) from imovel_anexos a join imoveis_leilao il on il.id=a.imovel_id where a.storage_path is not null and il.fonte in ('MEGA','PESTANA','GRUPOLANCE','ZUK','BIASI','FRAZAO','WEBLEILOES','VIP','LEILOTECH','LEILOFY','SODRE');` deve subir; e `select count(*) from documentos_fila where status='pendente';` deve cair.

## ✅ COMEÇAR AQUI (25/07 — sessão 2: qualidade de dados que o cliente vê)
> PR #261 em `main`. 4 problemas relatados pelo dono, investigados com 3 agentes em paralelo + queries; todos corrigidos na raiz.

1. **Foto errada (CRÍTICO) — GESTAOLEILOES / "Lance no Leilão".** O scraper (`scripts/scraper-gestao.mjs`) fatia os cards pela **coluna de texto**; a imagem de cada lote fica na coluna que precede o texto do PRÓXIMO lote → "1ª foto da fatia" = foto do lote seguinte. **100% das 107 fotos** apontavam para outro imóvel. Fix: `parseCard` casa a foto do **próprio idLote** (`<idLote>_NN.jpg`) no HTML inteiro; sem match → sem foto. `foto.js` (fotoCandidatos) tem trava de credibilidade (descarta prefixo ≠ idLote). Backfill determinístico dos 107 aplicado (migration `gestaoleiloes_foto_idlote_backfill.sql`). **REGRA (fotos/docs/anexos):** vincular mídia ao id ESTÁVEL do lote e validar na escrita; preferir ausente a trocada. **Caso à parte:** foto "portão do empreendimento" do CEF é fiel à fonte (não é troca).
2. **Leitura de docs nos relatórios.** `gerar-documental` lia a cópia do bucket pelo tipo INFERIDO do rótulo → furava o cache e caía na URL vencida. Agora prefere o **tipo do anexo (do banco)** → lê direto do bucket. **Log persistente** `doc_guardado_nao_lido` (via `registrar_anomalia_relatorio`, sobrevive à regeração que sobrescreve o `result`) quando tínhamos o doc mas a leitura voltou 0. Regra p/ leitor NOVO de `imovel_anexos`: nunca confiar no `url`; assinar pelo `storage_path`.
3. **Pontos próximos não carregavam.** UI sem estado (só sucesso renderizava) + loader silencioso + back-end 200-com-null em falha + cron marcava `proximidades_em` em falha → ~9,9 mil imóveis PRESOS. Fix: estados loading/empty/error + "tentar novamente" (ImovelDetalhe); `proximidades-imovel` responde 502 retryable; `_proximidades` com 3 espelhos Overpass; cron com `proximidades_tentativas` (retry<5) + re-enfileirados os presos (migration `proximidades_tentativas_retry.sql`). Fila drena por `enriquecer-proximidades` (LOTE=12; subir `PROXIMIDADES_LOTE` se quiser acelerar).
4. **Localização errada no mapa (geocode).** Nominatim devolvia o CENTRO da cidade p/ endereço sujo; era rotulado 'endereco' só porque o input tinha número → pino a km. Fix na origem `_geo.js` (`nivelReal`: resultado ~250m do centróide IBGE → 'cidade'). Backfill: assinatura de centróide (≥3 RUAS distintas na MESMA coord exata) rebaixada a 'cidade' (~2.025, migration `geocode_centroide_rebaixar_nivel.sql`). `MapaImoveis` HONRA o nível: pino aproximado esmaecido + aviso. Melhoria futura: re-geocodificar os rebaixados via Google (location_type ROOFTOP) p/ recuperar precisão.
5. **Arquivamento PROATIVO de docs p/ fontes instáveis (pedido do dono: "temos memória, vamos usá-la").** Fontes que "sempre têm quebra/falha" precisam ter o PDF no bucket ANTES do link morrer; as confiáveis ficam link-only. Flag `leiloeiro_conhecimento.arquivar_docs` (TUNÁVEL: `update ... set arquivar_docs` p/ ligar/desligar por fonte), ligada p/ custo pago/misto + qualidade<0.95 (GESTAOLEILOES/PECINI/RJLEILOES/CALIL/TORRES3/VEGAS/LJUD). RPC `enfileirar_docs_arquivar()` enfileira na `documentos_fila` imóveis dessas fontes com LINK mas SEM cópia no bucket; o `captura-documentos.mjs` (a cada 15min) drena e guarda o PDF (CAMINHO 1 = fetch direto, grátis; Bright Data só se bloquear, com teto). Rodando no cron `enfileirar-documentos.yml` (10 UTC). Seed inicial: **1.141 imóveis** enfileirados. Migration `arquivar_docs_fontes_instaveis.sql`; auditoria segurança 0/0. **CEF de fora (proposital):** matrícula é URL ESTÁTICA derivável (confiável, não quebra); edital é COLETIVO por leilão (mistura página/PDF, ~metade mislabel) → **FOLLOW-UP dedicado** (capturar o edital coletivo por leilão via pipeline CEF, dedup por leilão). Confirmar se quer arquivar mais fontes gratuitas (LEILOTECH/LEILOFY/PESTANA/GRUPOLANCE/SUPERBID) — hoje ficaram link-only por serem estáveis.

## ✅ COMEÇAR AQUI (25/07 — Cobrança passos 7–8, preservação de docs, disponibilidade de docs)
> Branch: `claude/handoff-startup-routine-eki4th` (PRs #257–#259 mergeados em `main`). Build (vite) OK.

**Entregas em produção nesta sessão:**
- **Passo 7 — bug de RECEITA corrigido (#258).** `processarConfirmado` (`api/_webhook-core.js`) gravava `perfis.plano = 'top2'/'clube'/'assessorado'`, que **viola o check `perfis_plano_check` (gratuito|analista|gestor)** → o UPDATE lançava e **o cliente PAGO não era ativado** (caminho **Asaas/fallback** e reconciliação valor→plano; MP via `ativarPlanoDireto` já estava certo). O TIER mora em `role`; removida a gravação de `plano`. Auth dos 2 webhooks revalidada (assinatura/token timing-safe, fail-closed, re-fetch autoritativo, idempotência por INSERT-trap) — íntegra.
- **Passo 8 — gatilho de preço (#257).** 49,90→89,90 mensal e 449,90→**899,00** anual ("pague 10, leve 12") agendados p/ **01/10/2026** via `planos_config.preco_agendado*` + RPC `aplicar_precos_agendados()` + cron diário. Banner de contagem regressiva em `Planos.jsx`.
- **Preservação de docs entre rodadas (#258).** Scrapers zeravam links de doc já capturados quando a rodada do dia não os trazia → o nº de docs "flutuava". `scraper-puppeteer` (+`link_edital`) e `scraper-caixa` (não preservava NADA) passam a **preservar** links existentes (aditivo). Matrícula CEF é URL determinística (nunca some); edital era o que oscilava.
- **Disponibilidade de docs — "armazenamos mas não fica disponível" (#259).** DUAS coisas: (1) **cobertura da fonte (esperado):** ~96% do acervo guarda só o LINK de origem, não o arquivo — CEF matrícula 100% (derivável) mas edital 36%; alguns leiloeiros sem matrícula. (2) **BUG:** quando NÓS guardamos o arquivo, o `imovel_anexos.url` era **signed URL de 1h (`expiresIn:3600`) que EXPIRA** → todo leitor que abria esse url direto dava 404 (2.842 arquivos, todos com url que expira; 476 imóveis com matrícula no bucket sem link). **Correção (raiz, todas as telas):** `src/utils/docUrl.js` `assinarAnexos()` re-assina EM LOTE via **`api/doc-url.js`** (single+lote; **RLS = autorização**, lê com o JWT do usuário, service key só p/ assinar) — usado em ImovelDetalhe/Caso/Analise. **Back-end (economia):** `gerar-documental` agora assina sob demanda pelo `storage_path` (`urlDocumento` de `_storage.js`) em vez de servir o url vencido e cair no **re-download da fonte** (o `processar-analise` já fazia certo). Padrão a seguir p/ qualquer leitor novo de `imovel_anexos`: **nunca confiar no `url` gravado; assinar pelo `storage_path`.**

## ⏭️ COMEÇAR AQUI (23/07 — ROTINA DE INÍCIO: diagnóstico verde + bug bounty multi-agente do código)
> Branch: `claude/handoff-startup-routine-eki4th`. Build (vite) OK. Segurança **0/0**. Sessão = ritual de abertura (CLAUDE.md itens 1–6), sem pedido de feature nova.

**🩺 Diagnóstico de início (tudo íntegro):** acervo **32.931 ativos**, geocode **0 pendentes** (100%); a coleta roda **seg/qui 9–10h UTC** — como a checagem foi numa **quinta pré-9h**, `ativos_24h=0` é NORMAL (última coleta seg 20/07 `ok` em todas as fontes; a de hoje ainda ia rodar). ⚠️ *Nota de cobertura:* o bug-bounty dos leiloeiros compara o ÚLTIMO run com o piso — **não detecta parada TOTAL** da coleta (o último `fonte_saude` fica saudável); quem cobre isso é o `ativos_24h` do item Saúde. `auditoria_seguranca()`=**0/0**; `qa_invariantes()` todos ok; deploy prod (`ba99236`) **READY**; **relatório mercadológico OK às 06:04 UTC** → recarga de crédito Anthropic (causa-raiz do "vazio") confirmada resolvida. VENDASGOV `degradado`=2 (gap login-gated conhecido).

**🐛 Bug bounty do CÓDIGO (4 agentes em paralelo: pré-login · telas logadas · api/ · crons&e-mails). 13 bugs de COMPORTAMENTO confirmados e CORRIGIDOS na raiz:**
1. **[HIGH] Auto-sequência dos 3 relatórios quebrada — `src/pages/Analise.jsx:997`.** A etapa 0 chamava `analisarMercadoClick()` (fluxo **inline** legado, que NÃO persiste nem seta `relMercadoGerado`) em vez de `gerarRelMercado()` (fluxo **servidor** `/api/gerar-analise`). Efeito: ao atribuir um arremate ("gerar os 3 automaticamente"), só rodava uma pesquisa efêmera na tela do admin → `relMercadoGerado` nunca virava true → documental e laudo **nunca** geravam e **nada** persistia p/ o cliente. Trocado p/ `gerarRelMercado()`. Regressão de refactor (o #174 dizia funcionar).
2. **[HIGH] Retenção apagava docs SEM aviso — `api/retencao-avisos-cron.js:153`.** `enviarEmail()` NUNCA lança (retorna `{ok:false}`); o cron fazia `emailOk=true` incondicional → `email_enviado=true` mesmo com Resend fora/sem chave/destinatário inválido → `anexos_expirados_avisados` tornava o doc elegível → `limpar-documentos-cron` apagava sem o usuário ser avisado (quebra o "notificar ANTES"). Agora confia no retorno (`emailOk=!!r?.ok`).
3. **[MED] Cadastro com e-mail JÁ cadastrado → falso "Cadastro realizado!" — `src/pages/Login.jsx`.** `signUp` só extraía `{error}`; com confirm-email ON, um e-mail existente volta sem erro e com `identities:[]` (anti-enumeração) → usuário esperava um e-mail que nunca chega. Detecta `identities.length===0` e trata como duplicata.
4. **[MED] Erro de API silenciado nas checagens de duplicidade — `Login.jsx` `checarEmail`/`checarCPF`.** `res.json()` sem `res.ok`: sob 429/5xx o aviso de duplicado sumia e o botão destravava. Agora `if(!res.ok) return` / só confia no corpo OK.
5. **[MED] Export LGPD "Baixar meus dados" saía SEMPRE vazio (`{}`) — `src/pages/Perfil.jsx`.** `JSON.stringify(apiCall(...))` serializava o objeto `Response`. Agora checa `.ok` e lê `res.json()`.
6. **[MED] "Excluir minha conta" reportava sucesso mesmo falhando no servidor — `Perfil.jsx`.** `fetch` não lança em 4xx/5xx; deslogava e mandava p/ home sem a conta ter sido apagada. Checa `res.ok` antes do `signOut()`.
7. **[MED] Upload de PDF grande falhava em silêncio — `Analise.jsx` `handleFileUpload`.** `btoa(String.fromCharCode(...new Uint8Array(buf)))` FORA do try → `RangeError` (estouro de pilha) em edital de vários MB, sem loader nem erro. Convertido em BLOCOS (0x8000) dentro do try.
8. **[MED] Relatório jurídico afirmava "sem sanções CEIS/CNEP" falsamente — `api/processar-analise.js:209`.** RPC `consultar_sancoes` lida sem `.ok` (PostgREST devolve JSON de erro, não lança) → `sancoes=[]` e a seção NÃO era marcada faltante. Agora `if(!r.ok) secoesFaltando.push('sancoes')`.
9. **[MED] KYC selfie falhava-fechado em silêncio durante incidente do Claude — `api/validar-selfie.js`.** `claudeRes.json()` sem `.ok` → rejeição genérica em HTTP 200, indistinguível de reprovação real. Agora retorna **503** "temporariamente indisponível".
10. **[MED] Aviso de renovação podia sumir antes da cobrança — `api/renovacao-avisos-cron.js`.** A trava de idempotência era gravada ANTES do envio; e-mail falho (não lança) → próximo run via 409 e pulava → cliente cobrado sem o aviso. Agora, em falha, SOLTA a trava p/ re-tentar.
11. **[LOW] Customer Asaas duplicado em erro transitório — `api/asaas.js`.** Busca de customer sem `.ok` → `data` vazio → criava novo. Agora `if(!searchRes.ok) throw`.
12. **[LOW] Cron de financiamento derrubava o run inteiro — `api/financiamento-alertas-cron.js`.** Leitura REST sem `.ok` → objeto não-iterável no `for`. Agora aborta limpo (502).
13. **[LOW] `×` em Minhas Análises apagava os 3 relatórios (local+banco) sem confirmar — `src/pages/MinhasAnalises.jsx`.** Adicionado `window.confirm`.

**✅ Verificado no banco (não é bug):** `retencao_candidatos_aviso()` **VIVA** já exclui `admin/analista` (r1 e r2) — o conserto do #192 está em produção. Era só **drift** (o arquivo de migração não tinha) → codificado em `supabase/migrations/retencao_candidatos_aviso_exclui_internos.sql` p/ um rebuild não regredir. Pagamentos/webhooks (Asaas/MP) auditados **sólidos**: HMAC/token timing-safe, re-fetch autoritativo, idempotência via INSERT-trap (23505). Os 3 geradores de relatório já checam `.ok` e **estornam cota** em vazio/erro.

### 🏗️ Leiloeiros do backlog — RETOMADA (23/07, continuação da sessão)
Sequência "siga o follow up e retome os leiloeiros". Publicado em produção:
- **#203** — follow-ups da auditoria de cards da Busca (RPC `buscar_por_raio_v2` com campos ricos; anti-bleeding do `valor_minimo` no scraper).
- **#204** — `recon-deep` (ferramenta de recon profundo listing+detalhe).
- **#205/#206/#207** — **2 scrapers de CLUSTER novos** (recon-first: home→plataforma→estrutura viva via Bright Data):
  - **SOLEON** (`scripts/scraper-soleon.mjs`) → **calil, vegas, 3torres** (mesma base do RJ Leilões, parser reusado). Detalhe `/item/{id}/detalhes`, listagem `/lotes/imovel?tipo=imovel&page=N`. **LIVE OK: 45 imóveis, 100% completos** (cidade+foto+valor+matrícula+edital). Fix de `cidade` (rótulo `Cidade: X/UF` primeiro). ⚠️ Os 3 caem no **Bright Data** (bloqueiam datacenter mesmo sem CF aparente) → sub-cota `soleon`=150/sem.
  - **Gestão de Leilões PHP** (`scripts/scraper-gestao.mjs`) → **extrajust, lancetotal, lancenoleilao, granado** (back-office ÚNICO compartilhado). Decodifica **latin1**; `leilao.php?idLeilao=N` = evento multi-lote inline; filtra `CATEGORIA` (só imóvel); dedup global por idLote; leiloeiro do `<title>`. **LIVE OK: 123 imóveis** (Granado Leilões + Lance No Leilão; nomes já limpos). ⚠️ 1ª gravação expôs **desconto negativo** em lotes CAIXA (Inicial 1º leilão > avaliação + rótulo "2ª Praça" faltando) → **corrigido (#208)**: usa o `VALOR DE VENDA 2º LEILÃO` canônico da descrição + trava contra desconto negativo; **re-gravado**. Conferir: `select count(*) from imoveis_leilao where fonte='GESTAOLEILOES' and desconto_percentual<0;` (esperado 0).
- **`api/_brightdata.js`**: sub-cotas `soleon`=150 e `gestao`=150 (teto global 450/sem no banco = trava dura).

**Bright Data (você pediu p/ sinalizar):** semana 20/07 usava **283/450** no início; após recon+debug+SOLEON live ~**347/450**. Cada evento do cluster PHP rende MUITOS imóveis por 1 request (granado idLeilao=98 tem 588 lotes) → barato por imóvel.

**Próximas alavancas (recon já feito, ver `docs/LEILOEIROS_TRT15_BACKLOG.md`):**
1. **Vlance /v3/** (verdeamarelo, sudeste, capitalvalor) — `/leilao/index/imoveis`, tem API; conferir se não já entram via LJUD.
2. **WordPress/Nuxt** (e-confianca; possível backend comum com osvaldo/sanches/hisa — mesmo `/leilao/N`) — SPA Vue, precisa achar o endpoint de dados.
3. **Acumular SOLEON**: calil (282) e vegas (31) só carregaram 20 cada (teto/run) — o cron semanal (seg 10:30 UTC) acumula; ou subir `max_lotes`.
4. **SUPERBID** (zaccarino, crepaldi) — rede já raspada; verificar cobertura.

**PENDÊNCIAS / follow-ups (baixo risco, não feitos):**
- **`.json()` sem `.ok` fail-safe (consistência):** `admin-chat.js:12` (sbGet, admin-only), `ab-mercadologica.js:54`, `verificar-identidade-kyc.js:131`, `validar-anexos-arremate.js:104`, `inbound-juridico.js:122`, `chat-suporte.js:81` — todos hoje caem em default SEGURO (revisar/indeterminado/escalar/null); guard de `.ok` só p/ clareza.
- **Reset de senha (HashRouter + implicit flow):** `RedefinirSenha.jsx` pode dar "link inválido" em alguns casos — **precisa TESTE em runtime** (não dá p/ provar só no código); se reproduzir, migrar p/ `flowType:'pkce'`.
- **`verificar-cpf.js` rate-limit:** insert fire-and-forget sem `await` + bucket e-mail/CPF compartilhado (anti-enumeração levemente mais frouxa) → migrar p/ `_rate-limit.js` (INCR atômico).
- **`financiamento-alertas-cron` parcelas:** só o sinal tem flag `notificado`; parcelas dedupam só por "hoje" → re-run duplica / falha no dia não re-tenta. Precisa coluna/tabela de dedup por parcela.
- **Segurança ofensiva (item 4 do ritual):** entraram rotas desde 15/07 (autocomplete, indice-consulta, sinalizar-arremate/revenda, retenção, atividade_log, backup-r2). O auditor determinístico cobre banco (0/0) e o agente de api/ varreu auth/RLS/IDOR/webhook sem achado de segurança; a Rotina mensal roda a ofensiva completa. Sem red flag nova.

---

## ⏭️ COMEÇAR AQUI (23/07 — relatórios "vazios", Índice por segmento, autocomplete, Cliente 360)
> Branch: `claude/bidprobrasil-handoff-diagnostics-akwysq`. Tudo levado à produção via PRs **#189–#196** (squash no `main`). Build (vite) OK em todos. Segurança **0/0**.
> **Infra:** Supabase **Pro** ativo (transferido p/ org BidPro Brasil, sa-east-1); compute **MICRO** (ok p/ agora). Backup diário 7d ativo.

**🔴 CAUSA-RAIZ do dia (o "relatório vazio/erros persistem" que arrastava várias sessões): a conta da API Anthropic ESTAVA SEM CRÉDITOS.** Toda chamada ao Claude voltava `HTTP 400 "credit balance too low"`. Como mercado/documental/laudo/parecer usam o Claude, TODOS falhavam — em ~3-4s (o 400 volta na hora). **Só apareceu depois que consertei o erro silenciado** (abaixo). **Dono recarregou os créditos (23/07)** → relatórios voltam. *Se voltar a acontecer: `console.anthropic.com → Billing`, ligar Auto-reload. O log de atividade (Cliente 360) e os logs da Vercel agora mostram a causa na hora.*

**Consertos levados à produção:**
1. **Erro de API SILENCIADO (causa-raiz do "vazio") — `anthropic()` em gerar-analise/documental/laudo (#190, #191).** As 3 funções faziam `r.json()` **sem checar `r.ok`** → um 400/401/404 virava `{}` → 0 amostras → "concluído mas vazio". Agora **logam status+corpo e PROPAGAM a falha** (nunca mais "vazio silencioso"). Varredura da MESMA classe em todo `api/` (179 arqs): auth/pagamentos já checavam `.ok`; só `admin-chat.js` (baixo risco) fica anotado.
2. **Fallback pelo Índice BidPro (ideia do dono) (#190).** Sem comparáveis ATIVOS na região (busca vazia/instável) mas COM base própria → a estimativa usa o Índice, **explícito no relatório/parecer**. Se nem o Índice cobrir (atípico) → "não encontramos comparativos", **não cobra cota**, self-heal 48h.
3. **Auto-retry do mercadológico vazio (#189).** `regenerar-relatorios-cron` re-tenta relatório concluído-vazio por até 48h, sem cobrar cota (espelha o documental). Front avisa que está re-tentando.
4. **Índice por SEGMENTO (#194).** apartamento/casa/terreno/comercial (rural fora, é R$/ha). `public.indice_segmento(tipo)` + backfill das 891 amostras (410 apto/251 casa/**148 terreno**/65 comercial — os 148+65 estavam como 'residencial' **contaminando** a média). gerar-analise roteia semeadura/leitura/amostras/valorização/fallback pelo segmento, com a ÁREA certa (terreno = m² de terreno). Consulta ganhou seletor **Tipo**. ⚠️ `cidade_indicadores` foi **reconstruído limpo** (caiu de ~2330 p/ ~25 agregados: os 2330 vinham do direct-seed polido; a cobertura por região **se refaz conforme os relatórios rodam**, já no segmento certo — o fallback é secundário agora que o mercado ao vivo voltou).
5. **Autocomplete de endereço estilo Google Places (#193, #196).** Proxy `api/endereco-autocomplete.js` (Edge, logado, rate-limit) esconde a `GOOGLE_MAPS_API_KEY` (a mesma do geocoding) + sessiontoken. Componente reusável `EnderecoAutocomplete.jsx` (Índice já usa; serve p/ checkout/cobrança e cadastro). Índice virou **autocomplete-first** (cidade/UF/bairro somem → chip; fallback manual). **Dono habilitou a Places API (23/07).** Placeholders genéricos (não o endereço do dono).
6. **Log de atividade no Cliente 360 (#195).** `atividade_log` (RLS, TTL **90 dias** limpo pelo `limpar-analises-cron`) + RPCs `registrar_atividade`/`atividade_usuario`/`atividade_log_limpar`. gerar-analise loga ok/vazio/erro **com o motivo** (ex.: "sem créditos") + arremate. Aparece em Cliente360. É a ferramenta de diagnóstico que teria mostrado o "sem créditos" sem gerar relatório.
7. **Retenção: exclui admin/analista (#192).** O cron nudava o próprio dono (3 imóveis de teste). `retencao_candidatos_aviso()` agora ignora contas internas; os 3 avisos do dono foram cancelados. (Os "3 e-mails" NÃO eram duplicados — eram 3 imóveis distintos.)
8. **Botão "Arrematei" com gate (#192).** Em Minhas Análises só aparece com os **3 relatórios** prontos (antes aparecia em qualquer análise).
9. **Gestão de plano no Perfil (#196).** Membros perdeu "Cancelar/Gerenciar plano" (fica só "Fazer upgrade" p/ Explorador). Perfil: bloco destacado **"cancele o plano e continue como Explorador"** (usa `garantia-cancelar`); exclusão de conta (LGPD, direito legal) vira opção **secundária**.
10. **PWA popup uma vez só (#196).** Auto-oferta no máx. 1× (flag `bidpro_pwa_ofertado`); depois só pelo item fixo do menu. Resolve "aparece toda visita" (inclusive iOS).
11. **Backup externo R2 (DR) — `api/backup-r2-cron.js` (#189), DORMENTE.** Espelha só o IRRECUPERÁVEL (33 arquivos / **11 MB**: uploads manuais/KYC/contrato — os 14 GB `_auto` são re-capturáveis) + snapshot JSON das tabelas de negócio. SigV4 à mão. **Ativar:** criar bucket Cloudflare R2 + env `R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET`. **LGPD (dono escolheu Opção A):** R2 fica fora do Brasil → **cláusula de transferência internacional a adicionar na Política de Privacidade** (texto entregue ao dono no chat).
12. **Segurança:** tabela de backup `_bkp_aval_suspeita_20260721` estava pública sem RLS → **travada** (RLS + revoke). **Dono ligou "Leaked password protection"** (Auth → Attack Protection). `auditoria_seguranca()` = 0/0.
13. **Bug-bounty do CÓDIGO virou ROTINA de abertura** (CLAUDE.md item 6): varredura multi-agente de cada botão/função (pré-login→backend) ao ler o HANDOFF, com padrões-alvo (erro de API silenciado, ação sem gate, cron/e-mail sem excluir internos, cota em fluxo que falhou).

**PENDÊNCIAS / follow-ups (23/07):**
- **Dono:** ativar o **R2** (criar bucket + 4 env vars → me avisar p/ eu conferir a 1ª rodada) e colar a **cláusula LGPD** na Política de Privacidade. Confirmar que os relatórios saem agora (recarga de crédito) — de preferência testar 1 terreno + 1 apto p/ ver o Índice por segmento.
- **Índice:** cobertura de `cidade_indicadores` por segmento se refaz com o uso; monitorar. Loop Índice↔relatório reafirmado (relatório LÊ o índice como referência de preço E SEMEIA/aprimora o índice ao gerar — ambos os lados já ligados).
- **Índice — evoluções pedidas ainda não feitas:** geração sob demanda p/ ADMIN quando a região não está mapeada (dispara pesquisa e estabelece o valor); raio ~250m (precisa guardar pontos lat/lng por amostra).
- **`admin-chat.js`** (leitura Supabase admin-only) é o único `.json()` sem `.ok` restante — baixo risco, anotado.

## ⏭️ COMEÇAR AQUI (22/07 — diagnóstico de saúde + erros nos relatórios emitidos)
> Branch: `claude/bidprobrasil-handoff-diagnostics-akwysq`. Segurança **0/0** o tempo todo. Build (vite) OK.
> **Pedido do dono:** conferir os diagnósticos do dashboard (saúde + funcionalidades) e os **relatórios emitidos** ("há erros a resolver").

**Diagnóstico de início (tudo íntegro):** segurança `0 crítico / 0 atenção`; bug bounty dos leiloeiros **vazio** (nenhuma fonte abaixo do piso aprendido); geocode **100%** (0 de 32.931 ativos sem lat/lng); fontes todas `ok` (só VENDASGOV `degradado`=2, gap conhecido login-gated); `qa_invariantes()` **todos ok**; deploy de produção **READY**.

**Erros encontrados e RESOLVIDOS (atacados na raiz):**
1. **Falso-positivo `cnj_vazio` em TODO relatório extrajudicial (raiz: regex `/judicial/` casa "extraJUDICIAL") — `api/gerar-documental.js`.** O gatilho da anomalia era `/judicial/i.test(modalidade) || !!procNum || execNome≥6`. Como "extrajudicial" contém "judicial", os **9.579 imóveis extrajudiciais** disparavam anomalia sempre que o CNJ (que por definição não existe em extrajudicial) voltava vazio; e ter só o NOME do executado sem achar processo é **título limpo**, não falha. Reescrito para o sinal REAL de integração: só sinaliza quando havia um **nº de processo concreto (≥15 díg.)** e mesmo assim o CNJ voltou vazio (nº malformado / token / fonte fora do ar).
2. **Mesma família de regex corrigida em 3 lugares** (guard `&& !/extra/i`): `gerar-documental.js` read-cap (`ehJudicial` fazia extrajudicial ler peças a mais → custo IA), `api/atribuir-arremate.js` (arremate extrajudicial digitado pela equipe era gravado como `judicial`), `api/scraper-leiloeiros.js` (MEGA — classificava modalidade do `ctx`). Sem alteração retroativa em dados (não dá p/ saber quais dos 182 MEGA `judicial` vieram de ctx com "extrajudicial" sem re-scrape; o fix previne daqui pra frente).
3. **Crash de cliente na `/analise` — `Cannot destructure property 'logUso' of 'undefined'` (`src/contexts/AuthContext.jsx`).** O `import('../utils/logUso').then(({ logUso }) => …)` não era guardado: em **chunk stale pós-deploy** o módulo vinha `undefined` e o destructure quebrava (o `try/catch` não pega a rejeição do `import()`). Trocado por `import(...).then(m => m?.logUso?.(…)).catch(()=>{})`.
4. **Timeout do `snapshot_metricas_fontes` no `monitor-fontes-cron`** (alimenta `fonte_metricas_hist`, base do APRENDIZADO do bug bounty). Ele chama `fonte_cobertura()` (~5,8s, `jsonb_path_exists` por linha em 32k+ imóveis) + `fonte_qualidade()` (~1,3s); sob a carga de escrita da coleta (15h UTC) passava do `statement_timeout` (~8s) e era cancelado, abrindo buraco no histórico. **Migração** `snapshot_metricas_fontes_timeout_resiliente.sql`: teto de tempo próprio de 60s (aplicada via MCP; validado: 21 linhas gravadas, sem timeout).
5. **2 anomalias `cnj_vazio` obsoletas resolvidas no banco** (id 12 extrajudicial LEILOFY — falso-positivo; id 13 judicial de teste `atribuido_manual` sem nº — ambas não voltam a disparar sob a lógica corrigida).
6. **AVISO "RLS de escrita do usuário" (`_bkp_gl_anexos_fantasma`) — `auditoria_uso()`.** As tabelas de BACKUP (`_bkp*`, rede de segurança da limpeza do GRUPOLANCE) têm RLS sem política (estado seguro) mas caíam no auditor por terem `criado_por` + INSERT p/ authenticated. **Migração** `auditoria_uso_ignora_tabelas_backup.sql`: o auditor passa a ignorar `_bkp*` por padrão (cobre backups futuros, sem hardcode). Validado: `auditoria_uso()` → `total 0`.
7. **🧠 Loop de APRENDIZADO quebrado → relatório "concluído mas defeituoso" não aparecia no health-check (pedido do dono: "gerei relatórios com falhas e o health-check não apontou") — `api/gerar-analise.js` + `api/health-check.js` + `vercel.json`.** Três rupturas, confirmadas no código+banco: (a) **sinal 100% ruído (chave camelCase×snake_case):** `aprenderNaEmissao` lia `imovel.valor_avaliacao` (snake) mas a tela envia `valorAvaliacao` (camel) → `Number()`=NaN → `avaliacao_ausente:true` em TODA emissão (as 13 de 21/07, inclusive imóveis com valor). Corrigido: passa os valores VALIDADOS (`avalDb`/`vminImovel`) à função. (b) **health-check cego a falha de conteúdo:** a seção "falhas de geração" só via `status='erro'`; relatório sem avaliação/parecer/mercado CONCLUI (`status='concluida'`) e passava batido. Nova seção 3f lê `agente_aprendizado` (24h) e sinaliza mercado-vazio/sem-parecer (escala a erro se fração alta) + avaliação/mínimo ausentes (nota). (c) **timing:** rodava só 06:00 UTC (antes das gerações do dia) → 2ª rodada 22:00 UTC (~19h BRT). Commit `d62fa59`, build OK. *(As ~31 linhas antigas de `agente_aprendizado` ficaram poluídas pelo bug — saem da janela de 24h sozinhas.)* **Follow-up opcional (não feito):** ligar o mercadológico ao loop de vício/`regen_motivo` (documental/laudo já têm) p/ auto-regerar defeituosos.

> **Nota de cobertura:** o e-mail que o dono recebeu vem do cron `health-check` (mais amplo que o ritual do CLAUDE.md). Dos 4 itens: anomalias e erros de runtime foram detectados+corrigidos aqui; a RLS foi vista nos advisors e agora corrigida; **o ERRO de Storage (abaixo) NÃO havia sido levantado no diagnóstico de início** — lacuna registrada.

**PENDÊNCIAS / follow-ups:**
- **🐛 CAUSA-RAIZ do Storage inchado: o `limpar-documentos-cron` NUNCA drenava.** Investigando a retenção (pedido do dono), achei que **só ~364 de ~7.716 anexos** tiveram o arquivo limpo na história e **4.018 já-elegíveis pela regra atual** seguiam armazenados. Motivo: a RPC `anexos_expirados` leva **~6,3s/lote** e batia no teto de **8s** que o PostgREST aplica (authenticator=8s; service_role null herda) → o cron recebia timeout, quebrava no 1º lote e apagava 0, todo dia. **Migração** `anexos_expirados_timeout_resiliente.sql`: teto próprio de 60s (aplicada via MCP). Agora o cron consegue drenar o backlog (próximo run 02h UTC, ou disparo manual). **Isso, não a regra de retenção, era o real motivo do bucket crescer.**
- **📋 Regra de retenção ATUAL (confirmada na RPC `anexos_expirados`):** apaga o arquivo quando `arrematado=false` **e** o imóvel NÃO tem nenhum relatório (mercado/documental/laudo) **e** — se o imóvel existe — está `ativo=false` **e** (sem reunião realizada **ou** data do leilão > 30 dias); anexos órfãos (imóvel já saiu) apagam após 5 dias. Mantém: arrematado (permanente), com-relatório, imóvel ativo, e janela de 30 dias pós-reunião p/ arremate.
- **Pedido do dono (past-auction + sem relatório → apagar 24h após a última praça, mesmo ativo):** medido — liberaria só **~58 anexos agora** (a maioria dos imóveis com praça vencida já vira `ativo=false` e **já é elegível**). Só há UM campo de data (`data_leilao`, sem 1ª/2ª praça separadas) → "última praça" = esse campo. Implementável (remover a exigência de `ativo=false` p/ imóvel com `data_leilao` vencida +24h, preservando as travas de relatório/arremate/reunião), **aguardando OK do dono** por ser mudança de política destrutiva.
- **🔴 Storage ACIMA do teto (ERRO do health-check) — decisão do DONO.** `infra_uso_storage`: **16,0 GB** (documentos 14,25 GB + fotos 2,95 GB) vs **teto 8 GB do free tier = ~200%** e CRESCENDO (e-mail mostrava 186%). "Risco de bloqueio/pausa." Não é bug de código: ou **upgrade p/ Supabase Pro** (teto sobe) ou **limpeza do bucket `documentos`** (o `limpar-documentos-cron` já loopa com retenção arrematado/data-futura/venda-direta/com-relatório, mas não vence o crescimento). **NÃO deletei documentos por conta própria** (destrutivo + retenção). **Decisão do dono: vai assinar o Supabase Pro (22/07).** ⚠️ **Passo obrigatório junto do upgrade:** o teto do health-check é a env `STORAGE_LIMITE_GB` (default 8 em `api/health-check.js`); **setar `STORAGE_LIMITE_GB=100` no Vercel** (Production+Preview+Development) após assinar, senão o check segue comparando com 8GB e continua mandando o e-mail de ERRO mesmo no Pro.
- **⚙️ Escala — `fonte_cobertura()` custa 5,8s** (agregação com `jsonb_path_exists` por linha em 32k ativos). NÃO reescrita nesta sessão (mudaria números de vários painéis; risco). Candidata a otimização (coluna/flag materializada dos tipos de anexo) antes de crescer o acervo. O timeout imediato já está blindado (item 4).
- **`avaliacao_ausente` (GRUPOLANCE, 1 anomalia aberta)** segue como gap legítimo — avaliação só no PDF do edital, aguarda leitura PAGA (Bright Data / OK de custo do dono). Não é falso-positivo.
- Advisors do Supabase: só INFO pré-existentes (RLS habilitado sem política em tabelas de backup `_bkp_gl_*`/`ab_mercadologica` — estado seguro). `auditoria_seguranca()`=0/0 é a referência do projeto.

**🗺️ ROADMAP aprovado pelo dono (fazer em etapas — "irmos fazendo"):**
- **✅ RETENÇÃO — parte de STORAGE resolvida (commit `f07c76b`, migração `anexos_expirados_regras_retencao_dono.sql`).** RPC reescrita: mantém permanente arrematado + imóvel com os **3 relatórios completos**; **Regra 3** apaga 24h após a última praça (`data_leilao` vencida) OU quando a fonte tira do acervo, mesmo ativo; **Regra 4** venda-direta pelo scraper; órfão 5 dias. Roda ~0,8s; **~4.093 anexos** p/ o cron drenar. Doc apagado é **re-capturável** (o cron só zera `storage_path`). **✅ Etapa 2 (regras 1 e 2) já CONSTRUÍDA — ver bullet abaixo** (notify-first, em dry-run até `RETENCAO_AVISOS_ATIVO=1`).
- **✅ PWA — Etapa 1 pronta (commit `f07c76b`).** Feita **sem `vite-plugin-pwa`** (cache RUNTIME no próprio `public/sw.js`, p/ NÃO conflitar com o SW de push): `public/manifest.webmanifest` + meta tags no `index.html` (`viewport-fit=cover`, apple) + navegação network-first com fallback offline ao shell + assets stale-while-revalidate + `/api`/Supabase/cross-origin passam direto + skipWaiting/limpeza por versão. Componente `src/components/PwaInstall.jsx` (banner "Instalar" Android/desktop + instrução iOS) montado no `App.jsx`. **Falta Etapa 2** (offline gracioso + fluxo de update testado), **Etapa 3** (testes iOS 16.4+; instalar destrava o push no iPhone) e paralela **code-splitting** do bundle de 2 MB. **Dúvida do dono respondida:** é UM só código/deploy — atualiza site e PWA juntos, sem app store; dados ao vivo; casca via SW na próxima abertura.
- **LEITURA de IA nos documentos — DONO DECIDIU DEIXAR COMO ESTÁ** (o índice segue se formando pelos relatórios). Era só estimativa: ~US$150–250 (Haiku) numa passada dos 7.439 docs. Não fazer por ora.
- **🔐 DR / segurança de dados (avaliado a pedido do dono):** protegido = código (git) + schema (migrações). Fragilidades: **(1)** DB sem backup no free tier → o **upgrade Pro** (hoje) dá backup diário/7 dias. **(2)** PITR é add-on pago (~US$100/mês) — sem ele, RPO até 24h. **(3)🔴 Storage (14GB `documentos`) NÃO entra no backup do DB** — mitigação: maioria é re-capturável da fonte; **IRRECUPERÁVEL = anexos manuais da equipe** (auto de arrematação/comprovantes) → merecem cópia externa (S3/Backblaze). **(4)** segredos só no Vercel. **Recomendado:** concluir Pro → avaliar PITR → replicar só os anexos manuais irrecuperáveis → runbook curto no repo (itens 3 e 4 a montar quando o dono pedir).
- **✅ BACKLOG TRT-15 — recon dos 7 prioritários feito** (`docs/LEILOEIROS_TRT15_BACKLOG.md`): as 2 dúvidas **confirmadas** (`brunoleiloes`=**LJUD**, `albertomacedo`=**SUPERBID** — nada a construir, Grau 1). Grau 2 (plataforma onboarda vários): **centraljudicial** e **hastapublica** (param `id_leiloeiro` = multi-tenant comprovado) são as que mais valem, + **leilaobrasil**, **e-leiloeiro** (tentativo). Grau 3: **judhastas**. ⚠️ egress deste ambiente bloqueia os sites (403) → **recon HTTP vivo** (multi-tenancy + JSON/API) precisa de ambiente com saída liberada e pode rebaixar Grau 2→1. **✅ Recon dos 34 restantes FEITO (22/07, tabela completa no backlog doc):** Grau 1 = **5** (planalto/verdeamarelo=LJUD, zaccarino=Superbid, cunha/vinco=SUPORTE que já raspamos) · **5 alavancas de plataforma** (SUPORTE tenants é a mais barata; cluster "Gestão de Leilões" SP cobre 4; Vlance; NYX; Sumaré) · Grau 3 = 29, priorizar alfaleiloes/gustavoreis/3torres/destak. Fechar leads exige recon de CDN com egress liberado.
- **✅ 3º RELATÓRIO (Conclusão) — resumo em tópicos (commit `49657e0`, `api/gerar-laudo-viabilidade.js`).** Pedido do dono: trazer EM TÓPICOS o mais crítico (positivo e negativo) cruzando o mercadológico/financeiro + documental/jurídico, nem ultra-resumido nem extenso. `pontosFortes`/`pontosDeAtencao` do laudo agora são 3–5 tópicos substantivos (1–2 frases de leigo, com número/fato + origem). A tela (`Analise.jsx` ~L1906-1909) já renderiza esses blocos. Parecer detalhado intacto.
- **✅ RETENÇÃO Etapa 2 — CONSTRUÍDA (commit `f6255b8`, migração `retencao_etapa2_sinalizacao_avisos.sql`).** Botão **"Arrematei este imóvel"** em Minhas Análises (por item) e na Análise (Relatório de Conclusão) → `api/sinalizar-arremate.js` cria linha em `arrematados`, marca `imovel_anexos.arrematado=true` (mantém docs) e cancela avisos pendentes. Tabela `doc_retencao_aviso` (RLS on, só service_role) + RPCs `retencao_candidatos_aviso()` (Regra 1 arrematado+inadimplente→30d; Regra 2 3-relatórios sem arremate→15d) e `anexos_expirados_avisados()` (só devolve docs **já avisados** `email_enviado=true` + carência vencida, revalidando o estado atual — **trava notify-first**; revoke execute de public/anon/auth). `api/retencao-avisos-cron.js` envia e-mail+push ANTES; cron 01h no `vercel.json`; `limpar-documentos-cron` drena os avisados. **🔒 ROLLOUT: LIGADO (dono autorizou 22/07, commit `1e8c9e5`) — ativo por padrão; `RETENCAO_AVISOS_ATIVO=0` pausa (volta ao dry-run).** Piso de 7d de carência entre aviso e deleção. 1 os candidatos são 3 imóveis do próprio dono (Regra 2) → os 1os avisos vão para o e-mail dele. Segurança 0/0.
- **⏳ ÍNDICE BIDPRO — revisão de planejamento (dono).** Hoje (`cidade_indicadores` + `semear_indice_relatorio`/`indice_bidpro_regiao`): semeado pelos relatórios (venda R$/m² + aluguel R$/m²) + bootstrap do acervo; níveis **bairro / grid ~1km (0,01°) / cidade**; venda+aluguel já existem (só residencial). Pedido do dono: **aba de consulta** (buscar rua/bairro/cidade → m² venda+locação) + triar **raio ~250m**. Complexidade: **aba lendo cidade/bairro = baixa-média (~1-2d)** (reusa `indice_bidpro_regiao` + geocode); **raio 250m = média-alta (~2-4d + backfill)** — precisa guardar PONTOS (lat/lng das amostras) + RPC de distância (`indice_raio`), pois o grid atual é ~1km. Recomendado: aba (cidade/bairro) já, raio 250m como evolução. Cobertura só onde já houve relatório (enche com o uso).
- **✅ PWA no menu + CTAs da Landing — FEITO (commit `f6255b8`).** `PwaInstall.jsx` ganhou gatilho manual (evento `tsn:pwa-install`, abre a instalação mesmo se o banner foi dispensado; passo a passo adaptado Safari/iOS × menu do navegador). `Header.jsx`: item **"Instalar app"** no dropdown do usuário (desktop) + menu mobile (só quando não-standalone). `Landing.jsx` (pré-login): seção com 2 cards — **Índice BidPro** ("Consulte o preço do m² na sua região", deixando **CLARO venda E locação**) + **App BidPro** (dispara a instalação). A **aba interna "Índice BidPro"** fica para quando a tela de consulta existir (planejamento abaixo) — não criei link morto.
- **✅ APRENDIZADO/ÍNDICE — loop de precisão (regras do dono) FEITO (commits `decb537` e anteriores).** Distinção do dono aplicada: **arremate NÃO entra no Índice** (operação extraordinária; o prompt já descartava leilão das amostras). **Valor do arremate agora OBRIGATÓRIO** ao sinalizar (registro + calibra teto de lance, `sinalizar-arremate`). Nova base **`indice_amostra`** (amostras de mercado DATADAS, venda/locação, origem relatorio/revenda; RLS só service_role) — `gerar-analise` grava as amostras a cada emissão; **backfill de 891 amostras** (2022–2026). RPC **`indice_valorizacao_anual`** → **valorização por ano (venda R$/m²)** embutida no relatório + **mini-gráfico** de barras (Analise.jsx) e linha no PDF + citada no parecer. **Revenda** (`sinalizar-revenda` + UI em Arrematados): valor real de venda vira **amostra do Índice** (com data) + **gabarito** (`arrematados.revenda_valor/data/m²`). Segurança 0/0. **✅ Itens 3 e 4 FEITOS (commit `8b8656d`, migração `indice_recencia_calibracao.sql` + cron `indice-aprendizado-cron`):** (3) **recência** — `indice_consolidar_amostras()` reconstrói o índice-cidade pela mediana das amostras dos últimos 18 meses (dado velho não domina mais); o read `indice_bidpro_regiao` passa a preferir a linha mais FRESCA e **aplica o `fator_calibracao`**. (4) **calibração** — `indice_calibrar()` move o `fator_calibracao` (0,7–1,3, suavizado) comparando a REVENDA real com o índice; hoje **0 regiões** (sem revenda ainda) → no-op seguro que passa a agir com o uso. (+) **supervisor Gemini** (`aprendizado_sugestoes`, dormant sem `GEMINI_API_KEY`): grava sugestões de ajuste p/ o dono revisar (nunca auto-aplica). Cron diário 03:20. Segurança 0/0.
- **✅ (22/07 tarde) DJEN + Admin + Índice-consulta + code-splitting FEITOS.** (1) **Radar de Editais**: extração do leiloeiro/cidade robusta (`nomeLeiloeiroValido`/`cidadeValida` rejeitam fragmentos de frase tipo "para os encargos de avaliação e leilão"; recuperam nomes reais, ex. "Zuleika Matsumura Akimoto"); 36 editais re-enfileirados p/ re-extração limpa. Confirmado: os imóveis dos editais **NÃO estão no acervo** (0/25 processos) — são leilões judiciais (funil à parte). (2) **Admin › Qualidade**: card das **sugestões do supervisor Gemini** (`aprendizado_sugestoes`, RPCs admin-gated) + marcar aplicada. Gemini **já ligado** (chave no Vercel; 1ª rodada 03:20). (3) **Índice — aba `/indice`**: consulta GRÁTIS (qualquer logado) do m² venda+locação por cidade/bairro + valorização (RPCs expostas via `api/indice-consulta`); item "Índice BidPro" no menu. **Fase 2:** geração paga p/ região não mapeada + autocomplete ViaCEP + raio 250m. (4) **Code-splitting** (React.lazy): bundle inicial 535→104 KB gzip (−84%). Segurança 0/0.
- **📊 ÍNDICE BidPro — estimativa de investimento do "relatório de localidade p/ usuários pagos" (pedido do dono).** Base hoje: **2.323 linhas** de índice, **359 cidades** (355 cidade / 886 bairro / 1.082 grid), **só 47 linhas com aluguel** (locação é o gap) vs **3.041 cidades no acervo** → ~12% coberto. Custo por relatório de localidade (venda+locação de um bairro/cidade): **marginal ~R$0,50–2,50** (IA Sonnet ~R$0,30–0,70 sintetizando comparáveis + coleta: **~R$0 se via scraper próprio** / R$0,50–2 se via API de dados paga). **One-time (engenharia):** gerador + seed do índice (reusa `semear_indice_relatorio`) **~2–3 dias**; aba de consulta cidade/bairro **~1–2 dias**; raio 250m (pontos lat/lng + RPC de distância) **~2–4 dias** — evolução. Cada relatório pago **enche o índice** (venda+aluguel) → paga o custo e acelera a maturidade por cidade. Recomendado: começar cidade/bairro por dados próprios; raio 250m depois.

---

## ⏭️ (21/07 — sessão 3) — CREDIBILIDADE dos relatórios + telas admin + relatórios/contratos/certidões
> Tudo em `main` (PRs **#172–#187** mesclados). Segurança **0/0**. Branch: `claude/session-1hpqy6`.
> **Motivação:** o dono gerou relatórios ao vivo para clientes e viu **metragem/avaliação erradas**, **desconto absurdo** e **endereço trocado** (Alagoinhas × Feira de Santana) — "essas coisas não podem ocorrer". Atacado na RAIZ.

**Entregue:**
1. **Bug "valor grudado" (bleeding) na RAIZ — `scripts/scraper-puppeteer.mjs`:** o scraper (LEILOFY) estampava a MESMA avaliação/área em vários lotes (seletor global vazando). Guard central **`bledSet()`** no `salvarImoveis` (mesma avaliação/área com centavos em ≥3 lotes de ≥2 cidades → null) + trava de desconto 88% + `url_lote` fallback. Removido o `Math.max` global de avaliação no `mapLoteLeilofy`. **Limpeza no banco: 0 bleeding; descontos ≥88% de 199 → 1** (o único restante é CEF **real** de 87,7% em São Gonçalo/RJ — não é erro).
2. **Trava de credibilidade no motor de relatório — `api/gerar-analise.js`:** avaliação que implica **desconto ≥88%** (aval > 8,3× o mínimo) é MIS-READ/bleed → rejeitada (`avalDb=0`) + `registrarAnomalia('avaliacao_implausivel')`. Candidatos de valor ordenados preferindo o DOCUMENTO.
3. **Ler/classificar TODOS os documentos ANTES de preencher (bug Alagoinhas × Feira):** ao atribuir arremate manual **não se digita endereço** — a IA lia o 1º casamento (do comprovante de endereço). Agora o sistema **lê e classifica CADA anexo por tipo** e tira cada campo do doc autoritativo (matrícula→endereço/área; laudo/edital→avaliação; edital→lance/processo; **NUNCA** comprovante p/ campo de imóvel). Novo **`consolidarDocsImovel()`** (`src/utils/claude.js`, merge por prioridade + `_proveniencia`); `getInstrucaoExtracao` devolve `tipoDocumento`+`descreveImovel`. `src/pages/Admin.jsx`: atribuição consolida antes de preencher.
4. **Automação dos 3 relatórios em SEQUÊNCIA (#174):** ao atribuir, gera mercadológico → documental → laudo automaticamente lendo os anexos (`autoGerar:true` + máquina de estados `autoSeqRef` no `Analise.jsx`).
5. **Regerar-com-IMPACTO (#172):** quando o documental acha dado que CORRIGE o mercadológico (cidade/metragem/avaliação/endereço), NÃO regera em silêncio — grava `analises_mercado.correcoes_sugeridas` (migração `correcoes_sugeridas_relatorio.sql`) + `result.correcoesMercado`; a tela oferece **"Corrigir e regerar" / "Manter"** mostrando o impacto do erro. `api/gerar-documental.js` ganhou `municipioImovel`/`ufImovel` + correção de cidade/estado pela matrícula + captura do nº de processo.
6. **Cruzar edital + leiloeiro + DJEN pela chave do PROCESSO (CNJ), de graça (#173):** `editais_enriquecer_acervo()` reescrita (migração `editais_cruzar_por_processo.sql`): match FORTE por nº de processo (≥18 díg.) preenche avaliação/área/endereço/cidade faltantes; mantém o match por `lance == mínimo` como reforço; trava de desconto 88%.
7. **Radar resiliente (#175):** re-tentativa com backoff (1,5s→3s, ×2) quando o DJEN dá **403/429/5xx transitório** mesmo via Bright Data. Termos jurídicos ampliados via `RADAR_TERMOS` (edital de leilão, leilão judicial/eletrônico, hasta pública, alienação judicial, alvará de venda). IA drena `erro_parse` via `ia_extraido=false` (10 pendentes → 1 run).

**Estado p/ DEMO (validado no banco):** acervo limpo (0 bleeding) · **ZUK 447 imóveis prontos** (avaliação+área+matrícula) · CEF 28k. Recomendação: demonstrar com ZUK/CEF; ao atribuir arremate ao vivo, só anexar docs + valor e deixar o sistema ler/gerar.

**🔧 Revisão das TELAS do admin (pedido do dono — "há o que melhorar ali ainda") — FEITA (PRs #176–#179):**
Auditoria completa das abas (`Admin.jsx`) → 15 achados priorizados; resolvidos:
1. **Ganhos seguros (#176):** remove lista morta `TABS` (nav usa `GRUPOS_ADMIN` como fonte única); rótulo `📣 Marketing`; tira guard `role==='admin'` redundante; `confirm` antes de remover disponibilidade do analista; `insert().select()` sem refetch; painel de Custos mostra aviso quando a fonte cai (antes sumia); paraleliza contagens de fotos; `title` nos textos truncados.
2. **Código morto (#177):** remove `SdrTab` (~669 linhas, nunca renderizado) + aba `Tour` órfã (~148) → **-817 linhas**.
3. **Agregação via RPC + dedup de KPI (#178):** nova RPC `admin_dashboard_contadores(inicio,fim)` (admin-gated) agrega contagens/MRR/acervo no servidor — Dashboard **para de puxar `perfis` inteiro pro cliente** (escala p/ 10k+); "imóveis ativos" passa a sair da MESMA fonte do `/api/scraper-status` (acervo_stats) — validado 32.931==32.931.
4. **Fidelidade Infra & Custos (#179):** "custo mensal" inclui o **custo REAL de IA/integrações** (via `/api/uso-integracoes`) no lugar do fixo R$3; **câmbio real** (usd_brl ~5,4) no storage em vez do chumbado 6.0; detalhamento por componente.
Segurança **0/0** após a RPC nova.

**🩹 Atendimento pós-demo — relatórios, contratos, certidões, telas (PRs #181–#187):**
1. **MarketingTab demografia via RPC (#181):** a seção "Perfis demográficos" vinha VAZIA (query usava colunas inexistentes `cidade`/`estado`; a UF real é `endereco_uf`). Nova RPC `admin_marketing_demografia()` agrega no servidor (role/UF/coorte/ativos).
2. **DIVERGÊNCIA de imóvel ≠ risco jurídico (#182):** quando os docs descrevem outro imóvel (matrícula de Feira × cadastro de Alagoinhas), a IA marcava **`bloqueante`** → derrubava a nota jurídica (2.9), disparava REPROVADO + banner vermelho. Agora o motor **reclassifica**: tira de `riscos` (não pontua, não reprova) e manda p/ `result.divergenciasImovel`; a tela mostra banner ÂMBAR "Divergência de documentação — não é risco jurídico" + o caminho "Corrigir e regerar". Riscos REAIS (penhora de terceiro, ação anulatória) intactos. **Só vale p/ relatório NOVO** — o antigo precisa regerar.
3. **Etapas manuais fantasma + caixa "Imóvel de outro leiloeiro" (#182, #187):** apareciam mesmo com relatório já gerado (gate dependia só de `modoManual`, que volta a true ao recarregar). Agora escondidos quando `relDocumentalGerado`.
4. **Documentos abriam com erro / comprovante em código (#183, #185):** anexos do Storage usavam signed URL que EXPIRA → re-assina no clique via `/api/anexo-url`. Comprovante de certidão reabre num Blob forçando `text/html` (renderiza, não mostra código).
5. **Contratos — valores do `planos_config` (#184):** helper `descricaoContratoPlano()` monta a descrição dos planos pagos a partir do config (fonte única) — mudou preço/termo no painel, o contrato acompanha. Pré-preenchimento revisado por humano.
6. **Cabeçalho padronizado nos 3 PDFs (#186):** novo `src/components/pdfCabecalho.js` — marca BidPro, imóvel+matrícula, executado, processo, "Solicitado por [nome]—[nível]" + data. `AuthContext` passou a expor `nome`. Comprovantes de certidão vão no PDF documental.
7. **"Fontes e comprovantes das informações" (#187):** a "Evolução das consultas" foi reenquadrada (tela + PDF) p/ mostrar a ORIGEM dos dados (docs lidos + consultas públicas + comprovante de cada uma).

**PENDÊNCIAS:**
- **🖊️ Contratos — termos a CONCLUIR (dono):** os valores de multa/rescisão no `planos_config` precisam do termo jurídico correto — **Assessoria** texto dizia multa 10% mas config=0; **Leilão Club** texto dizia "integral" mas config=30%. O dono ainda vai DEFINIR isso (o contrato pode mudar com o tempo: situação, participações, legislação). Deixado como **a concluir** — ajustar no painel Config→planos e o texto acompanha.
- **📄 Layout do CORPO dos relatórios (de-densificar):** o cabeçalho já foi padronizado (#186); falta reorganizar o **corpo** (hoje "corrido, parecendo contrato") em cards/seções escaneáveis, como no mercadológico da tela. Follow-up desejado pelo dono.
- **🧾 Certidões — auto-geração mais COMPLETA:** hoje só a CNDT (e CNIB/CENPROT quando o órgão responde) gera comprovante automático; fiscais/DJEN voltam como dado. Ampliar a cobertura automática + prévia/visualização das certidões. Follow-up.
- **~3,6 mil imóveis SEM avaliação** aguardam leitura **PAGA** do PDF do edital (Bright Data) — **aguarda OK de custo do dono**.
- **Monitorar o 1º run do Radar pós-#175** (confirmar que a re-tentativa pega editais que caíam no 403) — o dono ainda não pediu p/ armar.

**➡️ Como regerar o imóvel dos ASSESSORADOS (orientação ao dono):** para um imóvel com relatório ANTIGO (gerado antes do #182) que ainda mostra o banner vermelho de divergência: **regere o DOCUMENTAL primeiro** (ele relê os docs com a nova lógica → o banner vira a divergência âmbar, a nota jurídica sobe, some o REPROVADO) e, se aparecer o card **"Corrigir e regerar"**, use-o para o mercadológico com a cidade certa; por fim regere o **laudo**. Em imóvel NOVO (atribuído depois do #182) já sai correto pela sequência automática.

---

## ⏭️ (21/07 — sessão 2) — tipologia na raiz + BIASI + BUG BOUNTY auto-aprendido
> Tudo em `main` (PR **#153** mesclado). Segurança **0/0** o tempo todo. Branch: `claude/session-1hpqy6`.

**Entregue:**
1. **Tipologia na RAIZ (pedidos 1 e 3 do dono):** helper **`reforcarTipo()`** central no `salvarImoveis` (deriva o tipo da categoria da `url_lote` — autoritativa no Grupo Lance — e do título; só *upgrade* do balde `imovel`, nunca sobrescreve). `normalizarTipo` inline alinhado ao canônico (`'area'` cru saiu). **Backfill: 106 lotes reclassificados** → terrenos saem da intenção **Locação** (bug de Bertioga resolvido) SEM tocar no filtro/3 caminhos.
2. **Diagnóstico de qualidade (pedido 2):** RPC `fonte_qualidade()` + **Seção C2** no monitor (tipologia fraca / edital=matrícula / matrícula=página), 0 falso-positivo.
3. **BIASI — regressão 369→26 resolvida e VALIDADA** (run real: **26→144, status ok**). Causa: reescrita de 17/07 ignorava `total` + dedup GLOBAL entre leilões. Novo scraper 2 camadas (listagem agregada `?pagina=N` + fallback home→leilão com dedup por leilão), *safe-by-construction*.
4. **🆕 BUG BOUNTY DOS LEILOEIROS — monitor AUTO-APRENDIDO** (migração `bug_bounty_leiloeiros_aprendizado.sql`): o monitor **aprende o piso de acervo de cada leiloeiro do próprio histórico** (`fonte_baseline_aprendida()` = mín. dos runs saudáveis × 0,65) e alerta na Seção **C3** — **auto-calibra os atuais e ONBOARDA os futuros, sem hardcode** (fim do "recalibrar piso na mão"). Compara com o TOTAL do último scrape (imune à varredura anti-estrangeiro). Snapshot diário em `fonte_metricas_hist` (base do aprendizado). Ritual de início (CLAUDE.md item 2) + **Rotina mensal "Bug bounty dos leiloeiros"** (`trig_01P7HVmW4SMUrUEsaiZ5tH9V`, recon ofensivo web×código) fecham o ciclo. **Revisado adversarialmente:** o piso usa a MEDIANA (não o mín., que afundaria junto com o run em regressão e nunca dispararia) × 0,5 + gate de volume (mediana ≥ 20, senão fonte minúscula falsava). Validado: **0 falso-positivo** hoje e uma queda BIASI→26 dispararia (26 < piso 130).

**PENDÊNCIAS / AGUARDANDO O DONO:**
- **🆕 Backlog de leiloeiros TRT-15 → `docs/LEILOEIROS_TRT15_BACKLOG.md`** (integrar aos poucos até zerar; +imóveis). Insight de economia: ~18 dos 58 **já entram** via portal que já raspamos (LJUD/LEILOTECH/SUPORTE/SUPERBID) — não são 58 scrapers novos. Estratégia: confirmar cobertura no portal → detectar plataforma white-label (onboarda vários) → scraper dedicado só p/ o que sobrar. **Radar de Editais (CNJ) → `docs/RADAR_EDITAIS_CNJ.md`:** viável e GRÁTIS via API pública DJEN/Comunica (texto integral dos editais TJSP/TRT15) + DataJud (cross-check). Plano: cron 2×/dia, parse leiloeiro/imóvel (regex+IA), tabela `editais_leilao`, e aba admin **"📜 Radar de Editais"** (edital novo × leiloeiro integrado/não · % já no acervo · botão "add ao backlog"). **Aguardando OK do dono p/ construir** (passo 0: validar o endpoint 1× em produção — o proxy deste ambiente bloqueia `*.pje.jus.br`).
- **✅ Rodada 2 (4 itens, fácil→difícil, TODOS resolvidos):**
  - **(A) Auditoria:** auto-reload em falha de chunk pós-deploy (`reportarErro.js`) + erro órfão `q.rpc().catch` marcado resolvido.
  - **(B) GRUPOLANCE limpo** (151 imóveis + 372 anexos fantasma, REVERSÍVEL via backup `_bkp_gl_*` + arquivos no Storage) + **telas**: aba "📡 Operação de Coleta" (mapa ROTULO_TAB, chave intacta) + Geocodificação enxugada (fim da lista, "on-demand"). *(Dedup de KPIs com o Dashboard = polimento seguinte.)*
  - **(C) Zero-resultado era ARTEFATO DE LOG:** `busca_historico` gravava `resultados_count` do estado React stale (0 na 1ª busca da sessão) → o "49%" estava inflado. Corrigido (usa o count real). Cobertura real é BOA (Salvador 373, Feira 122…); gaps estreitos (Santana de Parnaíba 7, Arujá 2). **Follow-ups:** buscas em MODO RAIO não são logadas (demanda subestimada); scrapers dos gaps reais ficam no backlog (precisa CI/recon).
  - **(D) Radar de Editais (CNJ/DJEN) CONSTRUÍDO:** tabelas `editais_leilao`/`monitor_runs` + RPC `admin_radar_editais` + cron `radar-editais-cron` (a cada 4h com AUTO-AJUSTE: só trabalha até 1 pull OK/dia; se o DJEN cair, o próximo run tenta de novo — vercel.json) + aba admin **"📜 Radar de Editais"**. ⚠️ **Validar o 1º run em produção** (proxy de dev bloqueia `pje.jus.br`; conferir `monitor_runs.itens_vistos>0`) e refinar o parser (regex→IA) conforme os editais chegam.
- **✅ Rodada 3 (QA de funcionalidades + Radar como fonte, 5 itens, todos feitos):**
  - **(1) QA Camada 1 — invariantes de funcionalidade:** RPC `qa_invariantes()` + `admin_qa_invariantes()` + **Seção C4** no monitor (alerta por e-mail quando um invariante regride) + aba admin **"✅ Qualidade"**. Vigia CORRETUDE por feature (edital=matrícula, avaliação mis-read, sentinela, perfil sem role + gaps: avaliação ausente c/ doc 3.288, sem foto, desconto≥90%). 0 falso-positivo hoje.
  - **(2) Avaliação não puxada (bug do Grupo Lance):** causa = `garantirValores` tentava a página SPA primeiro e o edital-PDF por último sem orçamento. Fix: **tenta o DOCUMENTO (PDF/edital) primeiro** (cobre as 3.288). O imóvel de Santana de Parnaíba foi corrigido no banco (avaliação R$566.423 do próprio leiloeiro) + anomalia resolvida.
  - **(3) Radar → INGESTÃO do edital:** parse enriquecido (área/ocupação/cartório/débitos/endereço/cidade-UF; o DJEN traz o nº da matrícula + descrição, não a certidão) + RPC `editais_enriquecer_acervo()` (preenche avaliação faltante por chave forte: lance == valor mínimo do lote). O edital do DJEN vira fonte p/ leiloeiros que não raspamos.
  - **(4) QA Camada 2 — jornadas sintéticas:** Rotina semanal `QA de funcionalidades BidPro` (`trig_0171WT1PCzKSVXRGSmD6E8HP`) — revisão adversarial dos botões + cruzamento com invariantes/anomalias/erros/Cliente 360, notifica o dono.
  - **(5) Radar todos os estados:** lista de tribunais via env `RADAR_TRIBUNAIS` (default SP; abrir p/ o Brasil = só setar a env). ⚠️ Ainda depende de **validar o 1º run do Radar em produção** (proxy de dev bloqueia `pje.jus.br`).
- **✅ Rodada 4 (economia de crons + Radar VALIDADO em produção, PRs #158–#163):**
  - **(A) Economia de crons (PR #158):** frequências ociosas reduzidas (filas ~0) — geocode `*/10min`→de hora em hora; laudo/documental-retry→`*/6h`; regeocod→semanal; matrícula-CEF/documentos→`*/30min`. **Mesma vazão por run, menos disparos.**
  - **(B) Radar AUTO-AJUSTÁVEL + resiliente (PRs #158, #161):** o cron roda a cada 4h mas **só trabalha até 1 pull OK/dia** (checa `monitor_runs`); se o DJEN cair, o próximo (4h) tenta de novo até conseguir. Crons são estáticos (não mudam de frequência em runtime) — este *self-throttle* é o equivalente de "se ajustar sozinho". Botão manual: workflow **"Disparo FORÇADO — Radar"** (`.github/workflows/radar-forcado.yml`, PR #159) → `POST /api/radar-editais-cron?forcar=1`.
  - **(C) 🔑 DJEN 403 = bloqueio por IP → Bright Data (PRs #160-161):** ao validar o 1º run, o DJEN devolveu **403 para o IP da Vercel** (UA/headers de navegador NÃO bastam — testado). Fix: fallback via **Bright Data Web Unlocker** (IP residencial), `proposito 'radar'`, sub-cota `radar=120/semana` (~centavos; o self-throttle já limita a 1 pull/dia). **Validado: 612 comunicações capturadas.** Se um dia parar mesmo via IP residencial → DJEN passou a exigir credencial oficial do CNJ (pedido do dono via admin regional do TJSP).
  - **(D) Precisão + IA (PRs #162-163):** a busca por texto traz MUITO despacho/intimação que só cita "leilão" (612 → só ~40 leads reais com estrutura+valor). **Filtro duro `ehEditalReal`** na ingestão (só entra leilão-de-imóvel real) + **extração por IA** (`iaGeminiPrimary` = Gemini/Claude-Haiku, barato) só nos leads: leiloeiro/avaliação/imóvel/matrícula/praças do `texto_integral`. Capada 10/run + time-boxed + idempotente (flag `ia_extraido`); roda **mesmo com o pull pulado** → drena a cada 4h. Limpeza dos 572 ruídos já feita (612→40). **Achado:** o DJEN traz POUCO edital formal e MUITA intimação/despacho de leilão com dados reais — a IA extrai de qualquer comunicação de leilão. ⚠️ **Próximo ciclo:** conferir a qualidade da extração IA nos 40 (leiloeiro/avaliação) e ajustar prompt/regex se preciso; considerar aba admin filtrar `status!='nao_edital'`.
- **Storage** 13,5 GB (upgrade Pro pendente) · **PECINI** ok (36, cron gravou) · Bright Data (conferir gasto — agora inclui o `proposito 'radar'`).

---

## ⏭️ (Sessão 1) 21/07 — estado + pendências vivas
> Sessão longa 20–21/07 (madrugada). **Tudo mesclado em `main`** (deploys Vercel READY). Segurança **0/0** o tempo todo.

**Estado do sistema:**
- **Geocode:** 33.313/33.353 ativos geocodificados (100%); Google só **on-demand** (página do imóvel) + **trava MENSAL** `GOOGLE_GEOCODE_MAX_MES` (default 10k = free tier). Cron/lote = 100% grátis. Custo ~US$0 (era ~US$120+/mês). **OK — dono aprovou.**
- **⚠️ Supabase Storage:** ~12,5 GB vs **1 GB do free tier** (bucket `documentos` = 10,5 GB de PDFs). **DONO VAI FAZER UPGRADE p/ Pro NO FIM DO MÊS.** A limpeza `limpar-documentos-cron` agora LOOPA (drena o backlog); retenção = manter arrematado/data-futura/venda-direta-ativo/**com-relatório**. Saúde agora vigia o Storage (`infra_uso_storage`, alerta a 80%).
- **E-mails:** dedup por mudança (health-check + monitor-fontes só avisam quando o conjunto MUDA ou há ERRO). Monitor movido p/ 15h UTC (após a coleta). Fim do e-mail diário repetido.

**Captura de documentos (recon de 2 agentes — reenquadrou o problema):** os editais-PDF dos leiloeiros JÁ estão em `imoveis_leilao.anexos` (~2.100 imóveis) — a métrica media a coluna errada (corrigido). CEF: editais são COLETIVOS (`/editais/EL<NNNN><MMYY><UNID>.PDF`), capturados on-demand pela `cef_matricula_fila`; ~600 lotes tinham matrícula gravada como edital (limpo + guard no scraper). **Bright Data só p/ PECINI/RJ (~48 imóveis).**

**PENDÊNCIAS / PRÓXIMOS PASSOS:**
1. **SUPERBID (validação em curso):** o run de `leiloeiros-puppeteer fontes=SUPERBID` capturou docs p/ **1.168 imóveis** (de ~0), mas a URL é UUID opaco → classificação ajustada (lê o tipo do objeto inteiro do anexo). **Verificação agendada (`send_later` ~00:57 UTC)** confere se `anexos[tipo=edital]` subiu. Se a API não expõe o tipo, os docs seguem capturados/usáveis (IA lê). Reportar ao dono.
2. **Varredura de telas admin (começou):** tela **Scrapers** teve os números corrigidos (servidor; fim do 0% geocode). Próximo: **reposicionar como "Operação de Coleta"** (enxugar duplicação com o Dashboard; encolher a aba Geocodificação — 99,9% feita/on-demand). Seguir tela a tela com o dono.
3. **Roadmap captura (grátis, sem depender dos leiloeiros):** backfill CEF edital em massa com **DEDUPE por edital** (fazer PÓS-upgrade do Storage); SOLD/SBID/VENDASGOV (source/login-gated); replicar a promoção genérica de edital.
4. **Métrica:** `edital` foi REMOVIDO do monitor p/ SUPERBID/SOLD/SBID9/VENDASGOV/PECINI (gap genuíno) — **re-adicionar** quando a captura estabilizar.
5. **Opcionais:** raspar HTML no backfill p/ as **435 fotos CEF** sem URL previsível; ativar **LocationIQ** (`GEOCODER_KEY`) como rede se o Nominatim throttlar (dependemos mais dele agora).

**Merges da sessão (main):** `d2c2daf` (e-mails dedup + timing) · `e20c773` (autozoom + geocode custo + re-check fotos) · `6f5792d` (trava mensal + backfill multi-padrão) · `8d43808` (edital dos anexos na tela + monitor 15h + ZUK 420 + regeocod só cidade/falhou) · `e5ccfa9` (monitor de Storage) · `b4cace8` (limpeza loop + keep-relatório + backfill gracioso) · `d181022` (edital CEF: fim do matrícula-como-edital + captura URL real) · `e6502b4`/`11efc9b` (SUPERBID captura via API) · `be63930` (métrica edital/matrícula REAL + monitor recalibrado) · `57c30b3` (tela Scrapers com números do servidor).

---

## ⏭️ (Anterior) 3 pedidos do dono (20/07) — captura de tipologia, diagnóstico de qualidade, filtro de locação — AINDA PENDENTES
> Investigado e CONFIRMADO nesta sessão; **resolver na próxima**. Ordem sugerida: (3) filtro é rápido → (1) captura → (2) diagnóstico.

**(1) Captura dos leiloeiros mais robusta + aprendizado — o agente deveria captar tipo/foto/edital/matrícula/anexo.**
- **Tipologia (`tipo`) fraca → gera o bug do filtro (item 3).** Muitos lotes ficam no balde genérico `imovel` mesmo dando p/ classificar. Escopo (ativos): ~276 `imovel` genéricos — **LJUD 79 (21 com título "terreno/lote/gleba/área"), ZUK 50, SUPERBID 44 (11), LEILOTECH 38 (10), SBID9 22 (6), GRUPOLANCE 15**, CEF 11…
  - **GRUPOLANCE tem a categoria na URL** (`url_lote` = `/imoveis/<categoria>/…`: `terrenos-e-lotes` 99, `glebas` 3, `vagas-de-garagem`, `imoveis-comerciais/-rurais/-industriais`, `casas`, `apartamentos`) e **o scraper ignora**. **Fix:** derivar `tipo` do segmento de categoria da URL → `normalizarTipo` (`api/_tipo.js`). Mapa: terrenos-e-lotes/glebas→`terreno`, casas→`casa`, apartamentos→`apartamento`, imoveis-comerciais/-industriais/galpoes/predios→`comercial`, imoveis-rurais→`rural`, vagas-de-garagem→`imovel`(ou novo tipo).
  - **Outros leiloeiros:** o título muitas vezes JÁ diz "terreno/lote/gleba/área" mas o `tipo` ficou `imovel` → garantir que o scraper **passe título+categoria por `normalizarTipo`**, e fallback: `tipo` genérico + título casa keyword de terreno → `terreno`.
  - **Glitch de título:** há "**sImóvel**, 12.796,46m²…" (GRUPOLANCE) — artefato de scraping (char extra). Limpar/trim no parser.
- **Foto/Edital/Matrícula/Anexo (contexto desta sessão):** foto de CDN externo agora passa pelo `/api/img-proxy` (display OK) — a captura poderia **backfillar a foto p/ o nosso Storage** (confiável). Edital: `link_edital` = página do lote em ~todos não-CEF; o edital-PDF real está nos **anexos** (a UI já prefere ele). Matrícula GRUPOLANCE: **auto-derivada/fantasma** (ver "PENDÊNCIA" abaixo) — script já endurecido (hash vs edital) p/ NÃO gravar edital-como-matrícula.
- **Arquivos:** `scripts/scraper-puppeteer.mjs` (framework; `normalizarTipo` inline; config por fonte ~L209), `api/_tipo.js` (classificador canônico). **Aprendizado:** documentar o mapa de categorias por leiloeiro (tipo/foto/doc) em `leiloeiro_conhecimento` + `docs/BASELINE_CAPTURA_LEILOEIROS.md` ao evoluir cada parser.

**(2) O DIAGNÓSTICO deveria ter pego isso.** O `monitor-fontes-cron` (`BASELINE_FONTES` + RPC `fonte_cobertura()`) só mede **COBERTURA (campo não-nulo %)**, não **QUALIDADE/CORREÇÃO**:
- matrícula que é **página** (não arquivo) ou que é o **edital** conta como "tem matrícula" → passa; a matrícula **fantasma** do Grupo Lance até **infla** a cobertura (parece 80% quando é falsa).
- **não há métrica de tipologia** (% `imovel` genérico por fonte).
- **Fix:** o RPC **`admin_docs_por_leiloeiro`** (criado nesta sessão) já calcula as confusões (ed=matríc, ed=lote, matríc=lote, matríc-não-arquivo) — **plugar essas métricas + `% imovel genérico` no `fonte_cobertura()`/monitor** e alertar por regressão/limite. Assim o e-mail de saúde pega documento trocado e tipologia fraca, não só campo vazio.

**(3) Filtro de LOCAÇÃO mostrando terrenos/áreas em Bertioga — CONFIRMADO: é erro de filtro/classificação, NÃO têm viabilidade de locação.** Os 7 resultados de Bertioga são `tipo='imovel'` genérico, **608–20.698 m²**, categoria de URL `terrenos-e-lotes` (GRUPOLANCE) — terrenos, sem viabilidade de aluguel residencial.
- **Causa:** `TIPOS_RESIDENCIAL = ['apartamento','casa','imovel']` (`src/pages/Busca.jsx` L72) inclui o balde genérico `imovel` → terrenos não classificados entram na Locação/Temporada.
- **Fix (2 camadas):** (a) **upstream** = classificação do item 1 (melhor); (b) **defesa downstream** = na intenção **locação/temporada**, excluir `imovel` cujo **título** casa `terreno|lote|gleba|área` OU `area_m2` acima de um teto residencial (ex.: > 600–1000 m²). Aplicar nos DOIS caminhos: `aplicarFiltrosImoveis` (L196-198) e `ajustarFiltrosPorIntencao` (L100-109). **Revenda mantém `imovel`** (terreno é flipável). Escopo do vazamento: ~50+ claramente terrenos entre os 276 genéricos.

---

## 🆕 Sessão 20/07/2026 — Correções pós-produção + relatório em 4 blocos + gates de documento
> Branch de dev: **`claude/verify-reports-bidpro-index-mq4lct`** (reiniciada de `origin/main` após o merge do #149). **PR #150 mergeado** (fotos/edital/datas/MRR) e um 2º commit (relatório/gates/auditoria) na branch. Deploys Vercel READY. Banco: RPC nova aplicada via MCP.

**Parte 1 — bugs reportados em produção (PR #150, MERGEADO + deploy READY):**
1. **Fotos não apareciam (Minhas Análises e telas afins).** Duas causas: (a) `api/img-proxy` usava allowlist EXATA de host → 403 em quase todo CDN de leiloeiro (cada um usa um subdomínio) → trocado por `hostExternoSeguro` (anti-SSRF mantido) + só repassa `content-type` de imagem; (b) cada tela reimplementava a regra de foto e divergia (Análises/Arrematados **ignoravam** o self-hosted do CEF e mandavam o não-CEF direto ao proxy, sem fallback). **Novo componente único `src/components/FotoImovel`** com fallback EM CADEIA (self-hosted → hotlink → padrão Caixa → proxy), usado em Minhas Análises, Arrematados, Sugestão de imóvel e painel do Mapa; popup do Leaflet ganhou fallback inline p/ o proxy.
2. **Botão "Edital" abria a Matrícula** (tela do imóvel e da análise): a CEF grava `link_edital = matrícula`. Guard descarta quando `link_edital === matrícula`.
3. **Datas "Gerado em / Expira em" não apareciam** na Análise: caíam em "—" quando o `analiseEntry` do contexto ainda não carregara. Agora usam `mercado.pesquisaEm` (sempre presente no resultado, top-level E aninhado em `result.mercado`) como fallback.
4. **Divergência de MRR no dashboard:** o detalhe por plano rotulava Assessoria (R$6.000/12m) e Leilão Club (R$60.000) como "/mês" e somava o valor CHEIO — o MRR de UM plano (R$6.000) superava o MRR TOTAL do topo (R$599,80). Regra única **`mrrMensalPlano`** (mensal-equivalente) no marcador do topo E no detalhe, com "eq." nos pacotes. Os 4 marcadores do topo foram conferidos no banco (16 usuários, +15 no mês, 0 inadimplentes, 0 reembolsos — fiéis; os antigos valores chumbados 49,90/500/5000 coincidiam com o preço real).

**Parte 2 — relatório mercadológico em 4 blocos + gates de documento + auditoria (branch, 2º commit):**
5. **Relatório mercadológico (tela de Análise) reorganizado em 4 bandas numeradas** (helper `BandaMercado`), mesma informação sem a pilha vertical longa: **1 Resumo** (indicado para + 4 KPIs) · **2 Referências de preço** (FipeZAP + Índice BidPro) · **3 Amostras e comparativos** (Nível 1 e 2 num `<details>` recolhível, fecha o excesso) · **4 Metodologia** (datas + análise de mercado). *(O `RelatorioPDF.jsx` NÃO foi reorganizado — fica como pendência opcional se quiserem espelhar.)*
6. **Documentos não podem se confundir** (motivado por "Edital abria Matrícula" + "matrícula" fantasma do Grupo Lance):
   - Novo gate **`ehDocArquivo`** (PDF ou objeto do nosso Storage) em `ImovelDetalhe` e `Analise`: uma **PÁGINA nunca vira botão de Matrícula/Edital** → vira "Acessar leiloeiro" (honesto).
   - **Edital dos anexos:** quando `link_edital` é a página do lote (padrão de ~todos os não-CEF: auditoria mostrou `link_edital = url_lote` em 100% de SUPERBID/GRUPOLANCE/BIASI/SOLD/VIP…), o botão passa a preferir o **edital-PDF REAL dos anexos** (Storage > anexo do leiloeiro).
   - **Captura de matrícula do Grupo Lance** (`scripts/captura-matricula-grupolance.mjs`): a URL da "matrícula" é DERIVADA da do edital por substituição de string; alguns CDNs devolvem o próprio edital ali. Agora compara o **hash** do PDF derivado com o do edital e **não salva se idênticos**.
7. **Auditoria documental por leiloeiro (admin):** RPC **`admin_docs_por_leiloeiro`** (admin-gated, definer) + painel **"Cobertura documental por leiloeiro"** no Dashboard: imóveis/fotos/matrículas/editais/regras/anexos por fonte + sinalizadores de confusão (edital=matrícula, edital=lote, matrícula=lote, matrícula que não é arquivo).

**⚠️ PENDÊNCIA que depende do DONO (decisão) — "matrículas fantasma" do Grupo Lance:**
- O dono reportou um imóvel GRUPOLANCE (Bertioga, `45668569-…`) que mostra **Matrícula mas não tem** matrícula real. A matrícula é **auto-derivada** (`matricula_grupolance_auto.pdf`, storage-sign PDF de 359 KB) — não deu p/ classificar o conteúdo daqui (o proxy do ambiente bloqueia baixar arquivos de CDN e do próprio Supabase Storage; sem `pdftotext`). Escopo: **146 imóveis** GRUPOLANCE com `link_matricula` auto-derivado (+ 367 linhas em `imovel_anexos`). O padrão `_auto.pdf` também existe em **cef** (legítimo — não mexer) e **zuk** (824 anexos no total).
- **Não removi dados** (não criei essa base + não consigo verificar cada arquivo → guardrail: **surfar, não deletar no chute**). O gate `ehDocArquivo` NÃO esconde a de Bertioga (é um PDF de verdade). **Ação recomendada, reversível** (mantém os arquivos no Storage): `update imoveis_leilao set link_matricula=null where fonte='GRUPOLANCE' and link_matricula ilike '%grupolance_auto.pdf%';` + `delete from imovel_anexos where tipo='matricula' and storage_path ilike '%_grupolance_auto.pdf';` — **só rodar com OK do dono.** Idealmente, um backfill de re-verificação (hash matrícula vs edital) para separar reais de fantasmas.


> Branch de dev: **`claude/verify-reports-bidpro-index-mq4lct`**. Banco aplicado via MCP; código na branch (pronto p/ PR → `main`). Ritual: **segurança íntegra** (`auditoria_seguranca()` = 0 crítico / 0 atenção, conferido no início e no fim).

**Contexto:** o dono gerou 4 relatórios e (a) viu erros e (b) NÃO encontrou o **Índice BidPro** (`cidade_indicadores`, criado no #146) em lugar nenhum — deveria constar no relatório tanto para **venda** quanto para **locação**.

**Diagnóstico:** o índice estava **órfão** — `cidade_indicadores` existia (872 bairro + 355 cidade + 1058 grid, só VENDA do acervo) mas **nunca foi ligado** ao `gerar-analise.js` nem à tela/PDF; e o `aluguel_m2`, que a migração previa "semeado pelos relatórios", estava **100% vazio** (o loop nunca foi implementado). Os 4 relatórios (todos SP litoral): Caraguatatuba ✅, Bertioga 720m² terreno ✅, **Praia Grande SITIO CAIUBURA ❌ (timeout)**, Praia Grande Canto do Forte ✅ (reaproveitado). 3 anomalias `avaliacao_ausente` (Caraguatatuba/LJUD, Bertioga/GRUPOLANCE ×2 — avaliação não exposta na página do leiloeiro; relatórios saíram pelo mercado, sem base de desconto). Cidades litorâneas têm acervo escasso com avaliação válida (< piso 5) → sem índice de cidade — exatamente o caso que a **semeadura por relatório** resolve.

**Entregue hoje — LOOP do Índice BidPro fechado (migração `indice_bidpro_loop_relatorios.sql`):**
1. **RPCs (SECURITY DEFINER, search_path '', só `service_role` — não aparecem no auditor):**
   - `semear_indice_relatorio(...)`: cada relatório mercadológico ALIMENTA a microrregião com **venda R$/m²** (`precoMedioM2`) e **aluguel R$/m²** (`aluguelMedio/área`) REAIS de anúncios. Semeia **só bairro + grid** (níveis específicos, onde o preço do imóvel é válido); o nível **cidade fica ancorado na mediana ampla do acervo** — assim um imóvel premium (ex.: flat de R$10.980/m² em Barueri) **NÃO infla a cidade inteira** (bug de qualidade evitado; validado: Barueri cidade=R$2.718 acervo, grid=R$10.980 relatorio). `relatorio` prevalece sobre `acervo` no mesmo nível; re-semeaduras suavizam por EMA 0.5. Guarda de faixa (venda 200–50k, aluguel 1–1000 R$/m²).
   - `indice_bidpro_regiao(...)`: LÊ o nível mais específico disponível (bairro > grid > cidade), preferindo `relatorio`. Normalização de bairro/grid idêntica ao bootstrap (`_bairro_norm`, grid ~1km). **cidade_norm remove espaços/acentos** (Praia Grande → `praiagrande`).
2. **`api/gerar-analise.js`**: após a pesquisa de mercado, SEMEIA + LÊ o índice e anexa `mercado.indiceBidPro` (só residencial — terreno/rural têm régua própria e contaminariam a base por m² privativo). O `promptParecer` ganhou a referência "Índice BidPro" ao lado do FipeZAP (consta no TEXTO do parecer também).
3. **`src/pages/Analise.jsx`**: card **"Índice BidPro (nossa base)"** após a validação FipeZAP — venda R$/m², **locação R$/m²/mês** e yield do índice, com nível (bairro/microrregião/cidade) e nº de amostras. `src/components/RelatorioPDF.jsx`: mesma linha no PDF.
4. **Backfill único** (via MCP): semeei o índice a partir dos 25 relatórios residenciais concluídos (24 imóveis) → **36 linhas `relatorio` (15 bairro + 21 grid), TODAS com aluguel** (1ª vez que o índice tem locação). As 4 cidades dos relatórios agora resolvem venda+aluguel.
- **Build (vite) OK.** Segurança 0/0 após as RPCs novas.

**Entregue hoje (parte 2) — timeout resolvido na RAIZ + consulta ao edital p/ assertividade:**
5. **TIMEOUT (causa-raiz + self-heal) — `api/gerar-analise.js`.** O killer era o `anthropicFetch` com **`retries:1`**: cada `buscarMercado()` podia rodar **2×200s** e, com o retry por "sem amostras", somar >400s, estourando o deadline (foi o que derrubou o SITIO CAIUBURA). Correção:
   - **Orçamento de tempo GLOBAL** (`restante()`, `HARD_MS=285s`): edital, busca de mercado e parecer usam só o tempo restante — nunca inicia uma chamada que não caiba. Busca agora é **`retries:0`** (1 tentativa) com timeout = restante − reserva do parecer; a 2ª busca só dispara se **couber** (`restante()>150s`). Se a busca FALHAR (abort/timeout), marca **transitório** (`tempo_limite`) em vez de virar erro genérico. Se faltar tempo p/ o parecer, **entrega o mercado SEM o parecer** (melhor que perder tudo). O deadline virou backstop.
   - **Self-heal — `api/regenerar-relatorios-cron.js`**: relatório de mercado em `erro` por *tempo_limite* é **re-tentado 1×** (teto p/ economia) com orçamento fresco, relendo o `inputs` da própria linha. Assim o cliente não fica com erro preso (o SITIO CAIUBURA será regerado sozinho pós-deploy).
6. **Consulta ao EDITAL quando a avaliação/valor está pendente (assertividade) — `garantirValores`.** Antes só raspava a **página do lote** (SPA de LJUD/GRUPOLANCE → regex falha). Agora percorre **edital → matrícula → anexos → página do lote** (fetch DIRETO, grátis): HTML por regex; **PDF por IA focada** (extrai só avaliação + lance mínimo, `max_tokens:300`). Bright Data (pago) fica no documental. Orçado (fração do tempo, sem roubar do mercado) e só dispara quando o valor falta (economia). Corrige no banco (desconto/score) e o que não confirmar segue como anomalia.

**➡️ Follow-ups desta frente (não dependem do dono):**
- **Caminho client legado** (`analisarMercadoClick` → `src/utils/claude.js`) não recebe o índice (é gerado no cliente, não persiste); o fluxo principal (servidor `gerar-analise`) é o que importa e está coberto.
- **fator_calibracao** do índice segue 1.0 (venda do acervo = mediana de avaliação de leilão, abaixo do mercado); os valores de `relatorio` já são de mercado. Calibrar quando houver volume.

**Entregue hoje (parte 3) — Intenção da busca + classificação no relatório + correções:**
7. **Filtro de INTENÇÃO na tela de Leilões (`src/pages/Busca.jsx`)** — Revenda / Locação / Temporada, filtra DE FATO o acervo: revenda = tipos líquidos + desconto ≥ 30%; locação = residencial; temporada = residencial em cidade litorânea/turística. Nos dois caminhos (query direta + modo raio traduzido p/ a RPC). Já grava no `busca_historico` (analytics de demanda por intenção). Contagens: revenda 21.708, locação 29.751, temporada 951.
8. **`api/_temporada.js` (novo)** — lista curada + **motivos de atratividade** dos destinos de temporada do Brasil (validados na web: Florianópolis/Búzios/BC 85–90% ocupação, Ubatuba, Pipa, Porto de Galinhas, etc.). Espelha a lista do Busca.jsx (manter em sync).
9. **Classificação de INTENÇÃO no relatório (`gerar-analise.js`)** — `mercado.classificacaoIntencao` (revenda/locação/temporada, pode ser vários) com o PORQUÊ; injetada no `promptParecer` (nova §SEÇÃO "Adequação por objetivo" + defesa da temporada com a atratividade da cidade). O agente **APRENDE** (corpus `intencao` em `aprenderNaEmissao`). Exibida na `Analise.jsx` (card "Indicado para") e no PDF.
10. **Datas do relatório na tela (`Analise.jsx` + `AnalisesContext`)** — "Gerado em X · Expira em Y" (regra do cron: 15 dias após o leilão, ou 60 dias após a criação, se não arrematado).
11. **Correções de relatório:**
    - **`garantirValores` — sanidade do valor lido do edital:** avaliação lida > 10× o lance (desconto > 90%) é MIS-READ → descarta + anomalia `avaliacao_incoerente`. Bug real: o terreno de Bertioga tinha virado avaliação R$8,7M → **94% de desconto FALSO** no card. **Revertido** no banco; sanity-check impede recorrência.
    - **Timeout v2:** 2 buscas de mercado mais curtas (135s + 110s) em vez de 1 longa (um search que trava aborta e a 2ª conclui); reserva do `garantirValores` reduzida (30s) p/ não roubar tempo. Bertioga (terreno) volta a caber; self-heal como rede.

**➡️ Roadmap (pedidos do dono — próximas frentes):**
- **Comparativo desconto (avaliação × leilão) × Índice BidPro** por metragem/tipo — a feature em si é futura, mas o **GATE de liberação POR CIDADE já está pronto** (migração `indice_maturidade_por_cidade.sql`): `cidade_indice_maduro(cidade_norm,uf,tipo,min_micros)` devolve `maduro=true` quando a cidade tem ≥ **6 microrregiões de índice de RELATÓRIO** (threshold tunável). Quando a feature for construída, ela só CHECA esse gate no momento do relatório → **libera automaticamente por cidade** conforme cada uma vai sendo mapeada. **Lembrete vivo:** card "Cidades maduras (Índice)" no dashboard (via `cidades_indice_maduras()` / `admin_metricas_negocio`). Hoje: **2 maduras** (Carapicuíba/SP, Salvador/BA), 12 em progresso. Ao construir a feature: `const gate = await (cidade_indice_maduro); if (gate.maduro) { …exibe desconto×índice… }`.
- **Dashboard admin — números de cobertura: FEITO (parte 4).** `PainelCoberturaRelatorios` (novo, no `Dashboard`) + RPC `admin_metricas_negocio()` (SECURITY DEFINER, admin-gated): imóveis/cidades/estados com relatório (50/33/10), relatórios por tipo, **amostras de mercado usadas** (1.202), buscas + % zero-resultado, cobertura do Índice BidPro. **Fidelidade:** "Total de usuários" passa a contar TODOS os perfis (antes só 8 roles; anuais/leiloeiro/pacote sumiam) e planos anuais somam ao plano-base no MRR. Aplicado via MCP; segurança 0/0. **Pendente do redesenho maior:** reorganizar em faixas (pulso/saúde/acervo/pessoas/infra) + demais correções de fidelidade (MRR lendo `planos_config`, custos de infra que hoje são estimativa chumbada).
- **Data-quality:** **18 imóveis ativos com desconto ≥ 90% (avaliação > 10× o lance)** — possíveis mis-reads do scraper (pré-existentes). Candidato a um detector no health-check / limpeza.

## 🆕 Sessão 18/07/2026 (tarde) — Bug vivo + edital ZUK + varredura estrangeiros + Cliente 360
> Branch de dev: **`claude/ultimo-handoff-6lxk6j`**. Banco aplicado via MCP; código na branch (pronto p/ PR → `main`). Diagnóstico do ritual: **segurança íntegra** (`auditoria_seguranca()` = 0 crítico / 0 atenção), deploy #142 READY, 33.283 imóveis ativos, geo 0 pendente.

**Contexto:** o dono pediu "faça o que não depende de mim + siga o ritual das validações" e depois "analise a Cliente 360 p/ tirar mais sinais comerciais e de erro". O ritual achou 1 erro de cliente REAL na saúde; corrigido + 2 follow-ups da ZUK + limpeza de dados + varredura anti-estrangeiro + mineração da Cliente 360 (achou 2º bug).

**Entregue hoje:**
1. **BUG VIVO corrigido (`src/pages/ImovelDetalhe.jsx`)** — erro de cliente de hoje `q.rpc(...).catch is not a function` (rota `/imovel/:id`, assinante logado, 3 ocorrências). O builder do `supabase.rpc()` é *thenable* mas **não tem `.catch()`**; no bundle minificado `supabase`→`q`. Fix: `registrar_imovel_visto` passa a usar `.then(()=>{}).catch(()=>{})` (mesmo padrão já usado no `Painel.jsx`, que converte o builder num Promise real). Auditei todo `src/` — **era o único** `.rpc(...).catch` direto; os demais usam `.then().catch()` ou são Promises reais (`supabase.auth`). O erro em `erros_cliente` **auto-limpa** quando parar de ocorrer após o deploy (health-check limpa em 24h). Build OK.
2. **EDITAL PDF da ZUK plugado (`scripts/scraper-puppeteer.mjs`, `enriquecerDatasZuk`)** — follow-up #1 do handoff anterior. Na MESMA visita que já busca a data (custo zero), captura o `<a>` "Edital de venda" → PDF (`documentacaoleilao.portalzuk.com.br`) e "Condições de venda" → PDF de regras, gravando em **`anexos`** (`{nome,url,tipo}`, mesclado por URL no `salvarImoveis`) + `link_regras_venda`. **NÃO toca em `link_edital`** (segue sendo a página do lote da re-visita). Filtro por `.pdf`/host ignora a "Matrícula do Imóvel" (que aponta p/ a própria página). Lógica validada em teste isolado (edital+regras capturados; página do lote ignorada). Assim o relatório documental passa a ler o PDF certo.
3. **Metragem útil/privativa da ZUK — já estava feita (#136, 17/07).** Confirmei: `enriquecerDatasZuk` já prefere "metragem útil" sobre "total" (linhas ~904-911). Follow-up #2 do handoff **encerrado** (era resíduo de doc desatualizada).
4. **Limpeza "só Brasil" + backfill de UF (via MCP, dados):** o ritual achou 17 lotes ativos sem UF (era 6).
   - **6 lotes SBID9 do Paraguai DESATIVADOS** (Caaguazú, Toro Blanco ×3, Paraguarí, Asunción) — regra documentada "só Brasil". **Causa-raiz diagnosticada:** o guard `ehEstrangeiroSemUF` (scraper) funciona quando a cidade está preenchida (testei c/ dataset real: retorna `true` p/ as 4 cidades), mas **falha aberto quando a cidade chega VAZIA no save** — esses entraram com cidade/UF vazias (17/07 11:44, mesmo horário do scrape) e a cidade foi preenchida depois. **Verifiquei que o conjunto ativo está limpo** (nenhum outro estrangeiro nas fontes Superbid/SBID9/21/SOLD).
   - **4 lotes com UF EXPLÍCITA no título backfillados** + geo re-enfileirado (`geocod_nivel='refazer'`): GOIÂNIA/GO, Palmeira/PR, Rio Negrinho/SC, Selbach/RS. (`cidade_norm` é coluna GERADA — recalcula sozinha.)
   - **7 ambíguos deixados p/ o dono** (não adivinho UF — lição do Ibiúna/AP): "Escavadeira Komatsu PC200" (**não é imóvel** — candidato a desativar), "Terreno em Itanhaém" (provável SP, sem sufixo), Tatuquara, Afonso Pena, Sitio Cercado, "PARTE IDEAL 50%", "direitos creditórios APARTAMENTO" (todos LEILOTECH).

5. **VARREDURA anti-estrangeiro implementada (`api/monitor-fontes-cron.js`, Seção D)** — fecha o furo "cidade-vazia-no-save". Com a cidade já preenchida (pós-geocode), aplica a MESMA lógica do guard (`_municipios.js`, normalização idêntica) e **desativa** lotes das fontes Superbid (SUPERBID/SBID9/SBID21/SOLD) com UF vazia cuja cidade não é município BR; reporta no e-mail do monitor. **Teto de 50** (acima disso NÃO desativa, só alerta — protege o acervo contra erro de dataset). Lógica testada isolada (Paraguai pego, BR preservado, homônimo real "Buenos Aires/PE" corretamente mantido). Aditiva (try/catch — nunca derruba o monitor). Roda 1×/dia após o scraper.
6. **Cliente 360 — mineração dos acessos (2 bugs achados + sinais comerciais).** O dono pediu p/ examinar o que cada cliente acessa. Achados:
   - **🐛 `imovel_visto` = 0 linhas (rastreamento 100% quebrado)** — MESMA causa do bug #1: `registrar_imovel_visto` era `.rpc(...).catch(...)`, que **lança ANTES do `.then()` disparar** → a RPC nunca executava e NENHUM acesso foi gravado. O fix do item 1 **restaura o rastreamento inteiro** (a seção "Imóveis que visualizou" da Cliente 360 vive vazia por isso; passa a encher após o deploy). Conferir `imovel_visto` enchendo pós-deploy.
   - **🐛 `desconto_min` nunca era logado (`src/pages/Busca.jsx`)** — o insert de `busca_historico` gravava cidade/estado/tipo/valor/pagamento mas **omitia `desconto_min`** (362 buscas com `filtros.descontoMin>0` tinham a coluna flat nula). A Cliente 360 lê a coluna flat → mostrava "sem desconto" mesmo com o cliente filtrando ≥40%. **Corrigido** (1 linha no insert).
   - **📊 Comercial (994 buscas):** demanda concentrada em **Grande SP** (Santana de Parnaíba, Carapicuíba, Osasco, Barueri, Guarulhos, Praia Grande) + **BA** (Feira de Santana #1, Salvador); tipos casa/apartamento. **49% das buscas (491) dão ZERO resultado.** Lacunas oferta×demanda (candidatas a nova fonte/cobertura): **Santana de Parnaíba** (109 buscas × 8 no estoque), **Barueri** (61×12, 5 clientes), **Arujá** (30×1). Onde HÁ estoque e ainda dá zero (Feira de Santana 117 ativos), o corte é por filtro (ex.: "hipotecado" sem cobertura local, desconto alto) — oportunidade de alerta "avise-me quando aparecer" (`alertas_email` já existe, 15 ativos). **7 de 14 clientes sem perfil de investidor** (nudge de onboarding).

7. **Cliente 360 mostra ERROS DE NAVEGAÇÃO do cliente (novo, pedido do dono).** A ficha já mostrava buscas/vistos/relatórios, mas não as telas de erro/inconsistências que o usuário bateu — sinal que já existia em `erros_cliente` (capturado pelo `log-erro-cliente`) mas não estava ligado ao cliente. Agora:
   - Migração `cliente_360_erros_navegacao.sql`: `admin_usuario_360` retorna `erros` (msg, rota, url, ocorrências, primeira/última, resolvido — não-resolvidos primeiro) e `erros_abertos`; `admin_360_estatisticas` ganha `erros_abertos_total` e `clientes_com_erro`; `admin_busca_usuarios` ganha `tem_erro` por linha. Todas SECURITY DEFINER `search_path ''` (bypassa a leitura só-admin de `erros_cliente`). Aplicada via MCP + no repo.
   - `src/pages/Cliente360.jsx`: card **"Erros de navegação"** na ficha (mensagem, rota, nº vezes, quando, badge aberto/resolvido), tile **"Clientes c/ erro"** nas estatísticas e badge **⚠ erro** na lista (spot de clientes com problema sem abrir a ficha). Validado: a ficha do cliente que bateu o `q.rpc().catch` já mostra o erro; a lista o marca.

### 🔚 Encerramento 18/07 (tarde) — decisões do dono (no computador)
- **Health Check ERRO de 16/07 (3 `valor_sentinela` CRÍTICO): RESOLVIDO** — conferido: `relatorio_anomalias` = **0 abertos / 3 resolvidos** (os 3 SUPERBID Uberaba/Uberlândia/Mairiporã neutralizados na sessão de 16/07). Se recorrer, `registrar_anomalia_relatorio` reabre e o health-check alerta.
- **Lotes ambíguos de UF — decididos:**
  - **DESATIVADOS** (via MCP): "Escavadeira Komatsu" (**equipamento** — regra do dono: equipamento NÃO entra no sistema), "direitos creditórios APARTAMENTO" (**direito creditório não dá direito à matrícula** → não é imóvel/oportunidade; ≠ direito **aquisitivo**, que ENTRA), "PARTE IDEAL 50%" (**parte ideal não é oportunidade válida** — "pegadinha p/ novatos").
  - **Itanhaém → SP/Itanhaém** (imóvel legítimo, único município com o nome) + geo re-enfileirado.
  - **Ficam p/ enriquecer da fonte (NÃO adivinhar UF):** "Sobrado no Sitio Cercado", "TERRENO no Afonso Pena", "TERRENO NO TATUQUARA" (LEILOTECH white-label). Regra do dono: buscar a localização do **leiloeiro** (site/endereço) ou dos **documentos** — precisa de mecanismo (ver follow-ups).
- **Classificação de TIPO (regra do dono):** o tipo (rural/urbano/etc.) deve **espelhar como veio do leiloeiro/documentação** — NÃO forçar pela minha suposição. Ao gerar relatório, **reconciliar com o documento**. Zoneamento/averbação errados são **comuns e podem virar oportunidade** — não "consertar" às cegas.
- **PR #143: MESCLADO** em `main` (deploy de produção). **Asaas/Upstash:** o dono fará depois (mantidos em `PENDENCIAS_DONO.md`). **PECINI:** aguardar o cron de **seg 07-20** e monitorar. **Pagos** (Resend/compute/senha-vazada): no momento certo.

**➡️ FOLLOW-UPS de código pendentes (não dependem do dono):**
- **⚠️ FILTROS DE INGESTÃO NO SCRAPER (prioritário — senão os lotes desativados VOLTAM no próximo scrape LEILOTECH).** Regras do dono a plugar no `salvarImoveis`/mapeadores: (a) **equipamento não entra** (escavadeira, máquina, veículo/…); (b) **parte ideal não entra** (título com "parte ideal"/"% do imóvel"/fração); (c) **direito creditório não entra**, mas **direito aquisitivo entra** (distinguir no título/descrição). Hoje desativei os 3 na mão — sem o filtro, o upsert diário reativa.
- **Enriquecer localização de LEILOTECH** (white-label vmleiloes/spencer/bringel): capturar cidade/UF da página do leiloeiro (Afonso Pena/Sitio Cercado/Tatuquara ficaram sem UF por isso). Sem isso, não dá p/ geocodificar nem filtrar por região.
- **Replicar o padrão anchor-por-texto** (edital PDF) para outras fontes cujo `link_edital` hoje é a URL do lote (o `vasculharDocumentos` genérico já classifica, mas só roda no cap de docs; ZUK ganhou a captura na própria visita de datas).
- **(Comercial, opcional)** priorizar fontes/cobertura para Santana de Parnaíba, Barueri e Arujá (alta demanda, baixo estoque); avaliar alerta automático nas buscas de zero-resultado.

**Pendências do dono (aguardando):** **PECINI** (cron seg 07-20, +conferir gasto Bright Data; hoje 23 ativos, última 14/07 — monitorar segunda). **Asaas** (reativar webhook) e **Upstash Redis** (provisionar) — em `PENDENCIAS_DONO.md`, fará depois. **BIASI** = 173 é o **acervo real** (não regressão). Pagos (Resend/compute/senha-vazada) no momento certo.

## 🆕 Sessão 18/07/2026 — Linha de base da captura + recon edital ZUK (encerramento)
> Branch de dev: **`claude/bidprobrasil-handoff-diagnostics-lqttm2`**. Banco aplicado via MCP; código em PR novo → `main`. Segurança íntegra (`auditoria_seguranca()` = 0 crítico / 0 atenção, conferido nesta sessão).

**Contexto:** vários relatórios de assinantes falharam por **degradação silenciosa** da captura (área/data/avaliação/edital faltando sem o scraper "quebrar"). O dono pediu uma **linha de base por leiloeiro** para o agente responsável ver "o que está funcionando e o que não está".

**Entregue hoje:**
1. **Linha de base da captura — `docs/BASELINE_CAPTURA_LEILOEIROS.md`** (referência única). Define os campos essenciais em 3 níveis — **críticos** (título, cidade/UF, `valor_minimo`, foto, tipo, modalidade), **esperados** (área útil, data, edital, matrícula) e **condicionais por fonte** (avaliação, regras de venda — ausência é NORMAL) — e a **quantidade + cobertura esperada por leiloeiro** (20 fontes), com os **caveats** que evitam "falso conserto".
2. **Ligado ao agente de monitoramento (o "agente responsável"):**
   - `api/monitor-fontes-cron.js` ganhou `BASELINE_FONTES` (piso de acervo + cobertura mínima por campo que a fonte entrega) e a **Seção C**: alerta **acervo abaixo do piso** e **campo que regrediu** (folga ~15pts). Aditivo (se a RPC falhar, não derruba o monitor). Calibrado p/ **0 falso-positivo** no acervo de hoje.
   - Migração `fonte_cobertura_baseline.sql`: RPC `public.fonte_cobertura()` (cobertura por fonte em 1 round-trip; `security invoker`, só `service_role` — **não** aparece no auditor).
   - `leiloeiro_conhecimento.observacao` de **todas as 20 fontes** carrega a meta (piso + campos + gaps) — o agente scraper passa a ter o alvo.
3. **Recon edital ZUK — RODEI (posso rodar sozinho; não depende do dono).** Run `29627025136` (workflow `recon-zuk-edital`, grátis via Puppeteer) concluiu OK. **Padrão descoberto:** na página do lote, o `<a>` com texto **"Edital de venda"** aponta para o **PDF real** em `https://documentacaoleilao.portalzuk.com.br/AAAA/MM/<hash>.pdf`; **"Condições de venda"** → outro PDF (regras); **"Matrícula do Imóvel"** → aponta para a **própria página do lote** (não é PDF → segue no fluxo `captura-matricula-zuk`). Registrado em `leiloeiro_conhecimento.docs_estrategia` da ZUK.

**⚠️ Por que o "edital=100%" era enganoso:** hoje `link_edital` de quase toda fonte guarda a **URL da página do lote** (não o PDF). Foi por isso que "o edital não abriu" num lote ZUK. CEF (~37%) é a exceção — lá é o PDF real.

**➡️ PRÓXIMO PASSO (código, não ação do dono):** plugar a captura do edital ZUK em `enriquecerDatasZuk` (`scripts/scraper-puppeteer.mjs`) — pegar o href do anchor **"Edital de venda"** e gravar o PDF em **`anexos`** (ou campo próprio) **SEM sobrescrever `link_edital`** (que é a URL do lote usada pela própria visita — sobrescrever quebraria a re-visita e viraria retrabalho). Validar com dry-run antes de gravar. Depois, replicar o padrão de anchor-por-texto para as demais fontes cujo edital hoje é URL de lote.

**Reagendamento dos scrapers (confirmado, já em `main` via #137):** grátis (CEF, leiloeiros-puppeteer) **2×/sem** (seg/qui); pagas (PECINI, RJLEILOES) **1×/sem**. Reexecução consecutiva só após correção de falha.

**🔧 Correção (noite) — mercado inflado por área TOTAL x PRIVATIVA.** Um relatório ZUK (Apart./Flats, Av. Aníbal Correia 1.629, Barueri) mostrava "venda estimada" R$1,3M, "desconto vs mercado" 86% e **ROI 353%** — irreal. Causa: `area_m2=121,22` é a **área total/terreno**, não a **privativa** (avaliação R$329k ÷ comps R$10.980/m² ⇒ ~30 m² privativos; é um flat). O relatório fazia `comps × 121 m²`. Regra do dono: **a base do mercado é a área privativa; terreno excedente entra à parte**.
- **`api/gerar-analise.js`**: quando os comparáveis passam de **3× o R$/m² implícito na avaliação** (área provável total), ancora o `valorMercado` na **avaliação** (conservador), anexa `mercado.areaAlerta` e registra anomalia **`mercado_area_incoerente`** (o agente/saúde enxergam). Cobre **qualquer fonte** com avaliação.
- **`src/pages/Analise.jsx`**: detecta a mesma incoerência e, no card de mercado, troca a base `pm²×área` por um **aviso** pedindo a **Área Privativa** do edital (relabela "Desconto vs. avaliação"). Regerando o relatório, ROI/desconto ficam coerentes.
- **FOLLOW-UP (scraper):** capturar a **metragem útil/privativa** da ZUK (recon da seção de características do lote) para não cair no fallback de área total. Registrado no `leiloeiro_conhecimento` da ZUK.

**🧭 Melhor caminho p/ a metragem — fonte autoritativa = MATRÍCULA/EDITAL (implementado).** A metragem confiável está na **matrícula** (área privativa/construída) e no **edital**, não só no site do leiloeiro. O relatório **documental** já lê esses PDFs (`lerDoc`, com Bright Data fallback). Agora ele **extrai a área** (privativa/total/terreno) e **grava a privativa em `imoveis_leilao.area_m2`** (base do mercadológico) + detalhamento em `ficha_juridica`:
- `api/gerar-documental.js`: novos campos `areaPrivativaM2/areaTotalM2/areaTerrenoM2` na extração (matrícula prevalece sobre edital); persiste a privativa em `area_m2` quando plausível/coerente com a avaliação (200–200.000 R$/m²) e materialmente diferente da atual.
- `api/gerar-analise.js`: passa a **preferir a área privativa confirmada** (`ficha_juridica.areaPrivativaM2`) sobre a área do site/cliente; a coerência (âncora na avaliação) só age quando a área NÃO veio da matrícula.
- Fluxo: gerando o **documental**, a `area_m2` é corrigida na fonte → o **mercadológico** passa a estimar por comparáveis com a metragem certa. Sem documental ainda, a guarda de coerência evita o número inflado. **Cobre qualquer leiloeiro** (não só ZUK). O documental também **corrige na divergência** (endereço/geo, data do leilão, área privativa) e sinaliza as demais divergências (edital×matrícula) no parecer.

**🏷️ Avaliação DIRECIONADA POR TIPO de imóvel (novo).** Cada tipo tem base de cálculo própria; o mercadológico agora direciona a avaliação pelo tipo (antes multiplicava R$/m² × área para tudo — errado p/ terreno, fazenda, terreno excedente).
- **`docs/AVALIACAO_POR_TIPO.md`** — referência: itens + base de cálculo por tipo (condomínio, casa de rua, **terreno excedente**, terreno, gleba/áreas, **rural/fazenda por hectare**, comercial, **indústria/galpão**, vaga, atípico).
- **`api/gerar-analise.js`** (`promptMercado`): método explícito por tipo + exige `consolidado.valorEstimadoImovel` (calculado pelo MÉTODO DO TIPO), `unidadeValor`, `areaConsiderada`, `baseCalculo` e `terrenoExcedente`. O servidor **prefere o `valorEstimadoImovel` type-correct** da IA; a guarda de coerência (área total×privativa) só age nas bases por **m² privativo** (residencial/comercial). Helper `baseAvaliacaoPorTipo()` classifica o tipo.
- **`src/pages/Analise.jsx`**: passa `areaTerrenoM2` e mostra o `baseCalculo` (a conta que sustenta o número) no card de mercado.
- **Invalidação de cache type-aware (auto-cura):** uma pesquisa de mercado ANTIGA (anterior à avaliação por tipo) não traz `valorEstimadoImovel`/`baseCalculo`. Para bases por m² (residencial/comercial/industrial) tudo bem (cai no `precoM2×área`); mas para **terreno/rural/vaga** não há esse fallback — então o gerador **ignora o cache antigo e refaz a busca** só nesses tipos (recalcula pelo método certo). Reaproveitamento residencial segue valendo (sem custo extra de busca). Após 1 geração, o cache vira type-aware sozinho.

### 🔚 Encerramento 18/07 (resumo p/ a próxima sessão)
Merges do dia em `main`: **#138** (linha de base + monitor de regressão + recon ZUK), **#139** (área total×privativa não infla o mercado), **#140** (metragem autoritativa da matrícula/edital), **#141** (avaliação direcionada por tipo) + esta invalidação de cache. Segurança íntegra (`auditoria_seguranca()` = 0/0). Docs novos: `BASELINE_CAPTURA_LEILOEIROS.md`, `AVALIACAO_POR_TIPO.md`.
**Pendências do dono:** validar PECINI (cron seg 07-20, +Bright Data), conferir BIASI (~370). **Follow-ups de código:** plugar a captura do EDITAL PDF ZUK (padrão do recon: anchor "Edital de venda"); capturar metragem útil/privativa da ZUK no scraper (hoje corrigida via documental).

**Lembretes do dono (quando estiver no computador):**
- **Recon ZUK: nada a fazer** — já rodou; o pendente é o passo de código acima (posso fazer na próxima sessão).
- **PECINI** (pago): validar a 1ª gravação do cron **seg 07-20** (esperado > 23 ativos) **e conferir o gasto Bright Data**.
- **BIASI**: conferir se o acervo volta a ~370 após o fix de paginação (senão, 173 é o real do site).
- Decisões de fontes pagas (PECINI/RJ) e demais pendências em `docs/PENDENCIAS_DONO.md`.

## 🆕 Sessão 17/07/2026 — Merge do #126 + rede anti-recorrência (saúde/segurança)
> Branch de dev: **`claude/bidprobrasil-handoff-diagnostics-lqttm2`**. Banco aplicado via MCP; código em PR novo → `main`.

- **PR #126 MESCLADO em `main`** (deploy de produção READY) — loop de aprendizado + RLS do fluxo Caso.jsx + detector `auditoria_uso()` agora rodam em produção.
- **Erros de runtime do cliente → SAÚDE (fecha o furo amplo do "caso Alessandra").** Antes o `log-erro-cliente` só ia para os Runtime Logs (efêmero, invisível à saúde). Agora:
  - Nova tabela **`erros_cliente`** (dedup por fingerprint = hash de msg+rota normalizadas; recorrência só incrementa `ocorrencias` — não cresce sem limite). Escrita só por service key via RPC `registrar_erro_cliente` (security definer); leitura só admin; sem grant a authenticated (não é flagrada pelo `auditoria_uso`).
  - `api/log-erro-cliente.js` persiste + resolve `user_id` do assinante (Bearer, best-effort) — liga o erro a quem foi afetado.
  - **Front captura também erros ASSÍNCRONOS** (`window.onerror`/`unhandledrejection`) via `src/utils/reportarErro.js` (dedup/teto/filtro de ruído), além do ErrorBoundary de render.
  - `api/health-check.js`: novo item **"Uso — erros de runtime do cliente"** — sinaliza erros não resolvidos nas últimas 24h (auto-limpa quando param), escala p/ ERRO se amplo ou se atinge usuário logado.
- **Falso-positivo do auditor corrigido.** `auditoria_seguranca()` acusava as triggers anti-escalação (`returns trigger`) como RPC-definer-anon. Adicionada exclusão `p.prorettype <> 'trigger'` — futuro-prova novas triggers protetoras. **Agora `select public.auditoria_seguranca()` = 0 crítico / 0 atenção.**
- Migrações: `erros_cliente_saude.sql`, `auditoria_seguranca_ignora_triggers.sql`.

## 🆕 Sessão 16/07/2026 (tarde) — Diagnóstico de saúde + correções
> Branch de dev desta sessão: **`claude/bidpro-brasil-health-diagnostics-y6cupy`** (mesclada em `main` em 17/07 — PR #126).

### 🔚 Encerramento de hoje (resumo p/ a próxima sessão)
**Estado:** Segurança íntegra (0 crítico / 0 atenção). Saúde: 0 anomalias abertas, 0 gaps de RLS de usuário (`auditoria_uso()` limpo). Tudo abaixo está no **PR #126** (`claude/bidpro-brasil-health-diagnostics-y6cupy` → `main`) e as correções de banco/RLS/detector já valem em produção (aplicadas via MCP).

**Entregue hoje:**
1. **Saúde:** sentinela SUPERBID resolvido · 6 estrangeiros SBID9 desativados + guard de raiz no scraper · UF vazia 19→6 · geo (Ibiúna AP→SP, FRAZAO re-enfileirados).
2. **RLS — auditoria completa do fluxo Caso.jsx:** `casos` (INSERT/UPDATE), `analise_jobs`, `cotas_analise`, `arrematacoes`, `procuracoes`, `analise_juridica` + 2 triggers de proteção (atribuição / honorários). Camada `api/` sem gaps.
3. **Auditoria de saúde proativa:** RPC `auditoria_uso()` no `health-check` pega a classe do bug antes do usuário.
4. **Loop de aprendizado COMPLETO:** os 3 relatórios aprendem na emissão (durável, poison-resistente) · vício → aponta → regenera (cron 6h, teto 3, econômico) → aprende o erro · moderador supervisiona (RPC determinística no cron semanal).
5. **Alessandra:** plano correto (Investidor Pro pago); travava era o RLS, resolvido.

**Pendências (dono / próxima sessão):**
- [ ] **Aprovar o prompt de permissão** para eu vigiar o PR #126 (inscrição em tempo real + check-in horário) — ficou pendente de aprovação no app.
- [ ] **Mesclar o PR #126** em `main` quando quiser (deploy Vercel automático).
- [ ] **Pós-deploy:** o aprender-na-emissão e o cron de regeração só produzem dados após novos relatórios reais — conferir `agente_aprendizado` enchendo e o relatório semanal do moderador.
- [ ] **PECINI** (validação de captura, do handoff anterior) segue pendente.
- [ ] *(Opcional)* plugar o `regen_motivo` também no mercado (deixado fora de propósito — vícios de mercado já se auto-corrigem no `garantirValores`).

**Diagnóstico:** Segurança íntegra (`auditoria_seguranca()` = 0 crítico / 0 atenção). O health-check estava em **ERRO crítico** por 3 anomalias `valor_sentinela` abertas.

**Correções (banco + código):**
- **Health CRÍTICO resolvido:** 3 lotes SUPERBID (Uberaba/Uberlândia/Mairiporã) com `valor_sentinela` — o valor já estava neutralizado (nulo → "sem lance") e o `%` de desconto vem do card SUPERBID (preservado). Marcadas `resolvido=true` em `relatorio_anomalias`. Se o sentinela recorrer, `registrar_anomalia_relatorio` reabre sozinho. **Anomalias abertas: 0.**
- **Regra "só Brasil" (dado + raiz):** desativei **6 lotes SBID9 do Paraguai** (Asunción, Caaguazú, Paraguarí, Toro Blanco ×3) que entravam com UF vazia. **Fix de raiz** em `scripts/scraper-puppeteer.mjs`: novo guard `ehEstrangeiroSemUF` barra, nas fontes da rede Superbid (SUPERBID/SBID9/SBID21/SOLD), lotes com **UF vazia + cidade que não é município IBGE** (mesma normalização de `api/_geo.js`). Testado (12 casos: Paraguai descartado, BR preservado).
- **Backfill de UF (HANDOFF passo #3):** 7 lotes (BIASI/LEILOTECH/PESTANA/WEBLEILOES) tinham a UF **no título** mas coluna vazia → preenchi UF+cidade (SP/SC/GO/PR/RS/AP) e re-enfileirei o geocoder. **UF vazia ativa: 19 → 6.**
- **Geo:** MEGA "Ibiúna" estava com UF **AP** (Ibiúna é **SP**) → corrigido + re-geocode; 3 FRAZAO `geocod_nivel='falhou'` re-enfileirados (`refazer`).

**Residual (sinalizar ao dono):** 6 lotes LEILOTECH (white-label vmleiloes/spencer/bringel) sem cidade parseável — **não adivinhei UF** (foi assim que surgiu o erro Ibiúna/AP). 1 deles é "Escavadeira Komatsu PC200" (equipamento, **não é imóvel**) — candidato a desativar/filtro de tipo.

**Bug de cliente (RLS) — corrigido:** investidora relatou "new row violates row-level security policy for table casos" + "Algo deu errado" ao clicar em **"tenho interesse"** num imóvel. Causa: `casos` só tinha políticas de SELECT (cliente/analista/advogado) + ALL admin; **faltava a política de INSERT do cliente** (provável perda no hardening de RLS de 15/07 — bate com o "tem alguns dias"). O front cria o caso client-side (`src/pages/Caso.jsx` → `insert({ cliente_id: user.id, … })`). Fix: migração `casos_cliente_insert_rls.sql` — `create policy casos_cliente_insert for insert with check (auth.uid() = cliente_id)`. Testado sob RLS (positivo: cria o próprio; negativo: não cria p/ terceiro). **Aplicado no banco.**

**Auditoria RLS completa do fluxo de assessoria (Caso.jsx) — corrigido.** O bug do `casos` era a ponta: TODO o fluxo do Caso.jsx tinha mutações client-side sem política. Migrações aplicadas + no repo:
- `rls_fluxo_caso_analise.sql`: `analise_jobs` (solicitar análise) e `cotas_analise` (contador) — eram erro visível ao cliente.
- `rls_fluxo_caso_assessoria.sql`: `casos UPDATE` (participante), `arrematacoes` (arrematante), `procuracoes` (cliente), `analise_juridica` (analista) + **2 triggers de segurança**: `casos_protege_atribuicao` (cliente não reatribui equipe → não vaza o caso) e `arrematacoes_protege_honorarios` (cliente não marca honorários 'distribuido' → sem calote; servidor/gestor livres). Tudo validado sob RLS+trigger.
- **Camada api/ auditada: SEM gaps** (tudo service key; clients de usuário são só-leitura).

**Auditoria de saúde agora pega essa classe de falha (proativo).** Migração `auditoria_uso_rls_detector.sql`: RPC `auditoria_uso()` acha tabela de dados do usuário com RLS ligada mas SEM política de escrita do dono (o padrão do bug casos), com allowlist das 17 tabelas só-servidor. `api/health-check.js` chama e sinaliza (e-mail ao admin). Roda hoje: **0 gaps**. *(Pendente: captura runtime de erros de cliente — persistir `log-erro-cliente` p/ a saúde ver QUALQUER erro de uso, não só RLS.)*

**Alessandra (investidora):** plano **correto** — `role='top2'` É o "Investidor Pro" (R$49,90, pago 07/07 via MP). `plano='gratuito'` é coluna **legada** (todos os 14 usuários têm; o acesso real é o `role`). O que a travava era só o RLS, já corrigido.

**PR aberto:** #126 (branch `claude/bidpro-brasil-health-diagnostics-y6cupy` → main) com o guard "só Brasil" do scraper + todas as migrações de RLS + detector de saúde.

**Loop de aprendizado (combinado com o dono) — EM ANDAMENTO:**
- ✅ **Aprender na emissão — TODOS os 3 relatórios.** Tabela unificada `agente_aprendizado` (durável, separada de `analises_*` — validado: 0 FK, fora da RPC de limpeza). Módulo compartilhado `api/_aprendizado.js` (`aprenderNaEmissao` + `vicioRegen`). Cada gerador grava, ao concluir, corpus + qualidade/vícios, POISON-RESISTENTE (nunca valor derivado de input do usuário):
  - `gerar-analise.js` (mercado): avaliação/mínimo/desconto + preço m²/aluguel/FipeZAP; `corpusDaRegiao()` realimenta o prompt (fecha o loop, sem IA).
  - `gerar-documental.js`: CNJ consultado, matrícula/edital lidos, nº riscos + vícios (matricula_nao_lida, cnj_nao_consultado, modalidade_indefinida…).
  - `gerar-laudo-viabilidade.js`: usa o próprio `controleQualidade` (recomendaRevisao/contradições/lacunas) como vício.
- ✅ **Apontamento para regerar:** colunas `regen_motivo`/`regen_em`/`regen_tentativas` nos 3 relatórios; documental e laudo já gravam `regen_motivo` na emissão (mercado grava via `vicioRegen` do módulo — falta plugar 1 linha no upsert dele).
- ✅ **Execução da regeração — FEITO.** Bypass de cron (`x-cron-secret`) aditivo em `gerar-analise` e `gerar-laudo` (espelha o documental; caminho do usuário intocado; cron pula getUser/gate/cota). `api/regenerar-relatorios-cron.js` (a cada 6h, registrado no `vercel.json`): pega `regen_motivo != null` com `regen_tentativas < 3`, incrementa a tentativa ANTES de disparar e re-dispara a geração (fire-and-forget). Travas de economia: teto 3, lote 2/tipo, assentamento 2h, corte 72h. Escopo documental+laudo (mercado se auto-corrige no `garantirValores`). Validado: 0 elegíveis agora (seguro).
- ✅ **Moderador supervisiona — FEITO.** RPC `moderador_supervisao_aprendizado()` (determinística, zero IA) escreve insights em `moderador_insights` (agentes parados >14d, regens pendentes, volume 7/30d por agente); `moderador-cron` (semanal) já chama e envia no relatório. Testado.

**LOOP DE APRENDIZADO COMPLETO** (emissão→aprende nos 3 · vício→aponta→regenera→aprende o erro · moderador supervisiona). Tudo no PR #126.

## 🆕 Sessão 15–16/07/2026 — o que mudou (tudo em `main`)
> Branch de dev desta sessão: **`claude/document-inventory-validation-bstmk5`** (mesclada em `main`).

**Documentos dos lotes (cobertura):** BIASI 42%→96,5% (matrícula), CEF corrigido (1.957 editais mal gravados → matrícula direta; matrícula 100%, edital 100% sobre leilão), SODRE 55,6%→95,2% (expirados 15 lotes-zumbi), ZUK com ORDER BY+negative-cache (alcança a cauda). **PECINI PENDENTE (dono):** validar captura de docs com `PECINI_DRYRUN=1` no Actions (ver `docs/PENDENCIAS_DONO.md`).

**Saque / honorários / comissões:**
- Regra do saque: solicitações **avulsas e ilimitadas**; pagamento **só sexta** com **corte 12h** (fuso Bahia). Tela do Perfil e Comissões mostram regras + **próxima liberação**.
- **Cadastro completo obrigatório p/ sacar** (nome, CPF, telefone, PIX) — a tela aponta o que falta; **CPF é digitado 1× e reusado** (cpf-set cifra; Perfil deixa digitar quando vazio). Checagem usa **cpf_hash**.
- **Prestação de contas (admin):** "Pagar todos" (libera elegíveis da sexta) + **analítico venda→repasse** por beneficiário + nome/PIX do solicitante. **Bug corrigido:** id do lançamento é **bigint** (o PATCH validava como UUID — pagar/recusar individual falharia).
- Config em **Configurações** (honorário + comissão por plano) e **override por usuário** (Êxito por membro; **modal do afiliado** — antes era prompt). Anti-duplicidade de crédito no ledger (índice único).

**Cadastro / onboarding:**
- **Cidade obrigatória** no cadastro (filtro por região + alertas). **CPF NÃO** no cadastro grátis — só no pagamento (checkout já exige) e no saque.
- **Popup "Completar cadastro"** pós-login (`CompletarCadastroModal`): pede o que falta **um campo por vez** (cobre login Google/contas antigas). CPF saiu da exigência-base do AuthContext.
- **Role no login corrigido:** o perfil era buscado DENTRO do `onAuthStateChange` (lock) e vinha 'explorador' até dar refresh — agora deferido (setTimeout 0); reconhece o role de primeira.

**Financeiro (integridade — crítico):**
- `api/mp-admin` (transações reais) agora só conta **RECEITA real**: coleta aprovada, operação de venda, **nós como recebedor** (collector_id), líquido ≤ bruto. Antes somava pagamentos que a conta FEZ (ex.: "Anthropic") como receita.

**Scraper / qualidade de dados (regras do dono):**
- **Só imóveis do Brasil:** `salvarImoveis` descarta UF não-BR (desativei 70 lotes estrangeiros PE/PY/AR + 1 lote CEF com estado corrompido/JS).
- **Nunca gravar valor sentinela** (999999999 = falha crítica): anula (fica "sem lance"); desativei os 3 lotes SUPERBID e marquei p/ confirmar no edital.
- **Valor alto é válido** (não há teto artificial — usina de R$1bi é real).
- **Confirmação on-demand no relatório:** ao gerar relatório, `garantirValores()` confirma **avaliação + lance mínimo** no detalhe/edital (corrige GrupoLance judicial avaliação=0, etc.); o que não confirmar vira **anomalia**. *(A captura em massa foi revertida — é sob demanda.)*

**Agente que aprende + Saúde do sistema:**
- Nova tabela **`relatorio_anomalias`** + RPC: o gerador de relatório **sinaliza o que achou errado** (`avaliacao_ausente`, `cnj_vazio`, `valor_minimo_ausente`, `valor_sentinela`) → aparece na **verificação de saúde** (sentinela escala p/ ERRO).
- **Chamados de suporte:** a saúde **não fecha mais em lote** (escondia reclamação real) — só sinaliza e o botão **abre a aba Suporte** p/ ver/responder. (O `obs_interna` inexistente que fazia a ação falhar calada foi removido.) Fechei 1 chamado antigo do Igor (era erro de relatório por timeout, já corrigido).
- Aprendizados persistidos em `leiloeiro_conhecimento.observacao` (GrupoLance avaliação no detalhe; SBID9/SBID21 estrangeiros).

**Migrações novas no repo:** `biasi_matricula_backfill.sql`, `cef_editais_mal_gravados_fix.sql`, `sodre_expira_zumbis.sql`, `zuk_matricula_negative_cache.sql`, `saldo_credito_anti_duplicidade.sql`, `saque_exige_cadastro_completo.sql`, `relatorio_anomalias.sql`.

**Próximos passos sugeridos:** validar PECINI (dono); conferir na próxima geração de relatório se `garantirValores` está trazendo avaliação/mínimo (GrupoLance); backfill de UF nos lotes com UF vazia; tratar `valor_minimo_ausente`/`avaliacao_ausente` que aparecerem na saúde.

---

## 1. Projeto & infraestrutura
- **App:** BidPro Brasil — plataforma de leilões de imóveis (React + Vite → Vercel).
- **Repo GitHub:** `tarcisionogueira/tsn-app`
  - `main` → produção (deploy automático Vercel)
  - branch de desenvolvimento por sessão, sempre mesclada em `main` (a desta sessão: `claude/document-inventory-validation-bstmk5`)
- **Supabase:** projeto `zuwfiwokkdytvjixiwac` (região sa-east-1, "supabase-pink-battery"). Postgres 17.
- **Serviços:** Vercel (deploy), Asaas + Mercado Pago (pagamentos), Resend (e-mail), Daily.co (vídeo).
- **Regra de segurança crítica:** e-mail admin `tarcisioaraujo@reimob.com.br` recebe **só** notificações de sistema, **nunca** mensagens de cliente.

## 2. Estado atual do banco (JÁ APLICADO e validado)
Migrações aplicadas e conferidas nesta sessão:
- `config_honorarios` (id=1): **admin 4,5% · advogado 5% · analista 0,5%** (total 10%)
- `perfis.chave_pix`
- `casos.analista_id`, `casos.advogado_id`
- `arrematacoes`: `analista_id`, `advogado_id`, `honorarios_valor`, `honorarios_status`
- Tabela **`saldo_lancamentos`** (razão única) + RLS `saldo_self` (cada um vê o seu; admin vê tudo)
- View **`saldo_usuarios`** (security_invoker): `saldo_disponivel`, `total_sacado`, `saque_pendente`
- Segurança aplicada: 3 views `SECURITY DEFINER` → security_invoker; RLS em config_honorarios/slots_reuniao/disponibilidade_analista; search_path pinado em 14 funções.

Arquivos de migração no repo: `supabase/migrations/add_saque_honorarios_base.sql`, `add_seguranca_views_rls.sql`, `add_leiloeiros_fontes.sql`.

## 3. Feature SAQUE + HONORÁRIOS (arquitetura — ledger único)
**Saldo = soma de `saldo_lancamentos` (status ≠ 'cancelado').** Créditos (+): comissão de venda, honorário de êxito. Débito (−): saque.

Regras do fluxo:
- **Honorário de êxito = 10% do valor de arrematação**, dividido admin 4,5% / advogado 5% / analista 0,5%.
- **Admin absorve a parte da equipe ainda não sorteada** (total sempre 10%).
- **Sorteio (entre ativos):** analista → na **1ª reunião** (`api/agendar-reuniao.js`); advogado → quando o **analista encaminha ao jurídico** (`src/pages/Caso.jsx` `encaminharJuridico`). Só o analista encaminha, nunca o cliente. Admin é fixo.
- **Arrematação** herda a equipe do caso e distribui no status `finalizado` (idempotente via `honorarios_status`) — `api/arrematacoes.js`.
- **Saque** (`api/saque.js`): solicita qualquer dia (reserva no ledger, status 'solicitado'); admin paga **só sexta** (`status='sacado'`) ou recusa. Pagamento manual hoje; deixar pronto para automatizar (cron) depois — no intervalo o dinheiro rende na conta MP.
- **Privacidade:** cada usuário vê só o próprio saldo; admin vê tudo (Admin → Prestação de contas).
- **Comissão fixa de indicação** (sistema/curso/ebook): consultor, analista E advogado podem indicar → credita o ledger (`api/_webhook-core.js`).

Telas: `Perfil.jsx` (saldo + solicitar saque), `Comissoes.jsx` (extrato), `Admin.jsx` aba "Prestação de contas".

## 4. PENDENTE / VALIDAR (fazer na nova sessão com MCP)
1. **Auditoria completa dos fluxos** (com Supabase conectado) — do antes do login ao saque.
2. **Destravar cadastro:** o erro "email rate limit exceeded" é do **Supabase Auth**. Resolver: desligar "Confirm email" (Auth → Providers → Email) **ou** configurar **Resend como SMTP** (Auth → SMTP) — recomendado.
3. **Cadastrar 1 analista + 1 advogado** (ativos, com `chave_pix`) via convite de equipe (Admin → Equipe → Convidar). Sem eles, o admin recebe os 10% inteiros.
4. **Teste ponta a ponta:** caso → agendar reunião (sorteia analista) → encaminhar jurídico (sorteia advogado) → registrar arrematação + finalizar (credita 3 honorários) → solicitar saque → Admin paga (sexta) → conferir `saldo_usuarios` e `saldo_lancamentos`.
5. **Limpeza de teste:** `UPDATE perfis SET ativo=false WHERE cpf IN (...)` e `DELETE FROM saldo_lancamentos WHERE origem_id='TESTE'`. (perfis NÃO tem coluna email — usar cpf/nome.)

## 5. Deferidos (próximas fases)
- **IA lê boleto do sinal + comprovante** anexados na arrematação para aprender o fluxo de leilões.
- **Saque automático** às sextas (cron) após validar o fluxo manual.
- **Privacidade dos percentuais:** `config_honorarios` é legível por logados (um profissional pode *calcular* a fatia do outro). Os valores reais já estão protegidos por RLS. Avaliar restringir os percentuais a admin.
- **Leiloeiros via proxy** (ScraperAPI ou Bright Data) — Fase 1 pronta (`scripts/lib/scraper-core.mjs`, `scripts/scraper-leiloeiros.mjs`, registro `leiloeiros_fontes`). Falta plugar a chave do proxy. ~US$ 12–32/mês.

## 6. Notas técnicas
- Scraper CEF: `scripts/scraper.js` (GitHub Actions, 6h). Coluna `financiamento` (Sim/Não) no índice 8 do CSV — corrigido.
- Proxies de imagem: `api/img-caixa.js` (CEF, padrão `/fotos/F{id}.jpg`), `api/img-proxy.js` (whitelist em `api/_allowed-hosts.js`).
- Senha forte (8+ maiúscula/minúscula/número/especial) validada no front; leaked-password do Supabase exige plano Pro.
- Commits desta sessão: prefixo de fixes/feat, autor `noreply@anthropic.com`, em `main` e na branch de dev.
</content>
