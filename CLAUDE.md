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
   > -- E O QUE O FREIO RESPONDERIA AGORA, sem gastar nada (funcao `stable`, criada em 18/08
   > -- justamente porque a unica forma de saber era gastar por ela). Use ESTA para conferir:
   > select proposito, public.brightdata_decisao(450, proposito) as resposta
   >   from brightdata_reserva order by proposito;
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

   > **1c. CLIENTE 360 · MARKETING · SAÚDE DO SISTEMA — as três telas do negócio** (pedido do
   > dono, 14/08). Custo zero, mesma regra do 1b: ler o banco não custa nada. As três respondem
   > perguntas que nenhuma varredura de código responde — *o cliente está sendo servido? o
   > dinheiro do anúncio está virando gente? o que roda sozinho ainda roda?*
   >
   > **(a) CLIENTE 360 — o cliente está recebendo o que pagou?**
   > ```sql
   > -- painel agregado (é o que a tela /cliente-360 consome): planos, relatórios, falhas, funil
   > select public.admin_360_estatisticas();
   > ```
   > Verde = `clientes_com_erro: 0` **e** `relatorios_falha_24h: 0`. `relatorios_falha_7d` alto
   > com `falhas_recentes` repetindo o MESMO motivo é sintoma de fonte/gate quebrado, não de
   > azar. Olhe também `por_plano` × `relatorios`: **pagante que não gerou nada é churn em
   > formação** — mais barato ver aqui do que na fatura. E `sem_perfil` (triagem não respondida)
   > é o que faz o e-mail de oportunidade sair genérico.
   > ```sql
   > -- pagante sem entrega: assinou e não gerou UM relatório em 14 dias
   > select p.id, p.role, p.created_at::date assinou
   >   from perfis p
   >  where p.role in ('top2','assessorado','clube') and p.ativo
   >    and not exists (select 1 from analises_mercado a where a.user_id=p.id and a.created_at > now()-interval '14 days')
   >  order by 3;
   > ```
   >
   > **(b) MARKETING — o que a verba comprou, e quanto disso chegou aqui**
   > ```sql
   > -- gasto × cliques × conversões (a ingestão roda ~10h50 UTC e traz o dia ANTERIOR:
   > -- antes disso, "último dia = anteontem" é normal, não atraso)
   > select data, canal, gasto, cliques, conversoes from marketing_metricas_dia
   >  where data > current_date - 14 order by data desc;
   > -- O CRUZAMENTO QUE IMPORTA: clique PAGO (painel do Google) × visita que o nosso
   > -- rastreador registrou. Em 14/08: 214 cliques em 14 dias × 19 visitas com gclid.
   > -- Um número sozinho parece saudável; é a razão entre os dois que denuncia perda.
   > select (select sum(cliques) from marketing_metricas_dia where data > current_date-14) as cliques_pagos,
   >        count(*) filter (where gclid is not null or gbraid is not null or wbraid is not null) as visitas_com_gclid,
   >        count(*) filter (where utm_term is not null) as com_utm_term,  -- 0 = pendência A do dono
   >        count(*) as visitas_14d
   >   from visita_origem where primeira_em > now() - interval '14 days';
   > -- fecha o funil: o cadastro sabe de onde veio? (perfis.mkt_* é gravado no cadastro)
   > select coalesce(mkt_utm_source, case when mkt_gclid is not null then '(gclid sem utm)' else '(sem origem)' end) origem,
   >        count(*) cadastros from perfis where created_at > now() - interval '30 days' group by 1 order by 2 desc;
   > ```
   > **Não confunda as três contagens**: `marketing_metricas_dia` é o que o Google COBRA;
   > `visita_origem` é primeiro-toque por dispositivo (não conta revisita); `perfis.mkt_*` é
   > cadastro atribuído. Elas caem naturalmente nessa ordem — o que se vigia é o TAMANHO da
   > queda, não o fato de haver queda.
   >
   > **(c) SAÚDE DO SISTEMA — o que roda sozinho ainda roda?**
   > ```sql
   > -- o health-check já rodou por nós 2×/dia; leia o veredito em vez de refazer o trabalho
   > select executado_em, resumo, jsonb_agg(i) filter (where i->>'status' <> 'ok') as nao_ok
   >   from health_check_logs, lateral jsonb_array_elements(itens) i
   >  where executado_em > now() - interval '36 hours' group by 1,2 order by 1 desc limit 2;
   > -- invariantes de dado (alerta = acima do limite) + backup off-region
   > select * from public.qa_invariantes() where status <> 'ok';
   > select executado_em, ok, arquivos_total, arquivos_novos, arquivos_iguais, falhas
   >   from backup_execucoes order by executado_em desc limit 5;
   > ```
   > **Como ler o backup — a armadilha é `arquivos_iguais = 0`.** O job copia até 1.000 arquivos
   > por rodada. Enquanto ele TERMINA a varredura, `arquivos_iguais` vem alto (achou o que já
   > estava lá). Quando bate no teto de 1.000 com `iguais = 0`, ele nem chegou aos antigos:
   > está **atrás do crescimento diário**, e a distância aumenta todo dia. `ok: false` com
   > `falhas: 0` é exatamente isso — nada falhou, só não coube. Foi o estado encontrado em
   > 14/08 (3 dias seguidos no teto), e o backup off-region é a única defesa contra perda
   > definitiva de arquivo de cliente.
   >
   > **(d) O PROCESSO ESTÁ ÁGIL? — `select * from public.tempo_processo();`** (pedido do dono,
   > 15/08). Custo zero. Separa **dois relógios que aqui são opostos**: o da MÁQUINA (geração
   > de relatório: mediana 0,3 h) e o HUMANO (é onde tudo para). Somar os dois produz a média
   > que não descreve ninguém.
   >
   > ⚠️ **A armadilha que essa função existe para evitar, e que quase virou relatório:** medir
   > "primeira resposta em chamado" como *qualquer mensagem que não seja do cliente* deu
   > **0,0 h de mediana, 22 de 22 respondidos** — agilidade excelente e falsa. Das 34 mensagens
   > de chamado no sistema, **33 são `autor_tipo='ia'`** (saudação proativa, disparada no mesmo
   > segundo) e 1 é do cliente: **nunca houve uma resposta humana**. E `status='finalizado'`
   > **não pode filtrar** a conta — o único chamado em que um cliente escreveu foi encerrado 9
   > dias depois sem ninguém responder; filtrar por status apaga justamente o caso pior.
   > **Fechar não é responder, e bot não é SLA.**
2. **Captura — bug bounty dos leiloeiros (AUTO-APRENDIDO)**: o monitor APRENDE o "normal" de
   cada leiloeiro do próprio histórico (`fonte_baseline_aprendida()` = mín. dos runs saudáveis
   × 0,65) e alerta quando o último scrape cai abaixo — **auto-calibra os ATUAIS e ONBOARDA os
   FUTUROS, sem hardcode** (NÃO recalibre pisos de acervo na mão; deixe o histórico aprender).
   O `monitor-fontes-cron` faz isso todo dia (Seção C3) + grava o snapshot em `fonte_metricas_hist`.
   Cheque rápido no início:
   ```sql
   select * from public.fonte_regressao_suspeita();
   ```
   → vazio = íntegro. Cada linha traz `faltando` (o tamanho do buraco depois dos descontos),
   `expirados_recentes` e `medido_em` — é o bastante para decidir se vale a ofensiva de recon.

   > ⚠️ **Era uma CONSULTA solta aqui até 27/08, e ela errava nos DOIS sentidos.** Trocada por
   > função porque consulta em documento não é testada e envelhece calada.
   > **Falso positivo:** acusou o LEILOFY com 12 lotes contra piso 37 — mas os 51 que saíram
   > em 25/08 tinham todos `data_leilao = 25/08`. O leilão ACONTECEU, a limpeza horária fez o
   > trabalho dela, e o acervo esvaziou como devia. Parser intacto; "consertar" parser são é o
   > pior desfecho possível de um alarme.
   > **Falso negativo, no mesmo instante:** o CALIL (9 lotes contra piso 18) estava invisível,
   > porque a última LINHA dele era `sem_cota` e a consulta olhava a última linha — uma fonte
   > podia se esconder atrás do freio de orçamento indefinidamente.
   > A função corrige os dois: desconta expiração legítima recente e avalia a última
   > **medição** (`status <> 'sem_cota'`), não a última linha. É a **terceira vez** que o
   > instrumento é o errado nesta base (17/08, 18/08 e agora) e a assinatura é sempre a
   > mesma: algo que NÃO é medição da fonte comparado contra o piso da fonte.
   > ⚠️ **O filtro de `sem_cota` é o conserto de 18/08, e a versão sem ele acusa fonte sadia.**
   > Quando o teto semanal do Bright Data recusa, a coleta NÃO É TENTADA e a linha entra com
   > `total = 0` e `status = 'sem_cota'` — o motivo diz por extenso *"decisão de orçamento, não
   > regressão da fonte"*. Comparar esse zero contra o piso aprendido é entregar o **freio de
   > custo como se fosse medição da fonte** (a forma #5 da lista lá em cima), e manda consertar
   > parser que está intacto: em 18/08 acusou CALIL, VEGAS e GESTAOLEILOES com os três acervos
   > íntegros (95 · 21 · 130 lotes). `monitor-fontes-cron.js` sempre soube distinguir — trata
   > `sem_cota` como categoria própria e não empilha o alerta de baseline; era **esta consulta**
   > que não sabia. Zero com `status = 'falhou'` continua sendo alarme de verdade.
   
   Rode a **OFENSIVA de
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

**7b. E A DIREÇÃO CONTRÁRIA (12/08, tarde).** `admin_metricas_negocio()` em produção tinha a chave
`pct_dom_venda`; **nenhuma migração do repositório tinha** — foi aplicada direto no banco e nunca
voltou. Recriar o banco a partir de `supabase/migrations/` faria a chave sumir e o card imprimir
**"0% venda"** com cara de resposta. `verificar:schema` NÃO pega isto (a função existe nos dois
lados; só o corpo divergiu) e não há trava barata que pegue. Regra manual, então: **mudou função no
banco, escreva a migração no mesmo commit.**

**8. CONTAR NÃO-NULOS NÃO É VALIDAR (12/08).** A ingestão do IBGE gravou `ok=true`, 5.570 linhas e
`rotulos_ignorados: []` durante 9 dias trazendo **1 de 4 colunas** — *o que não é PEDIDO nunca
chega para ser ignorado*, então a lista de descartados sai vazia justamente quando mais falta
coisa. As outras três causas do mesmo dia deram número **plausível e errado**: separador decimal
(São Paulo com 1.521.202 km²), rótulo ambíguo (São Paulo com 265 domicílios) e **dois rótulos
distintos gravando na MESMA coluna** (`nascimentos = 100` no Brasil inteiro, porque o percentual
sobrescrevia a contagem — e o detector de ambiguidade não pegou, ele compara colunas, não
rótulos). **Ao ingerir fonte externa, valide contra o número que a fonte PUBLICA**, num caso que
você conhece de cabeça. Contagem de preenchidos teria passado nos quatro.

**9. TRUNCAR CADA TABELA POR CONTA PRÓPRIA E DEPOIS CRUZAR (12/08).** `AnalisesContext` lia
`analises_mercado`, `analises_documental` e `analises_laudo` com `.limit(12)` **cada uma,
ordenada pelo seu próprio `updated_at`**. Os cortes caem em datas diferentes: imóvel com
documental recente e mercadológico antigo aparecia na lista do cliente **sem o relatório de
mercado, que estava no banco o tempo todo** — e abrir a análise dizia "não gerado", com um
clique em Gerar reprocessando IA à toa. Regra: **janela de cache não é janela de dados.** Se
várias leituras vão ser CRUZADAS por uma chave, ou elas vêm de uma consulta só (RPC no
servidor), ou nenhuma delas pode ter `.limit`. A trava `mesma-janela-em-tabelas-diferentes`
pega o sintoma escrito — o MESMO literal de `.limit()` repetido sobre tabelas diferentes.

**9b. E A RETENÇÃO PRECISA APAGAR PELA MESMA UNIDADE QUE O CLIENTE ENXERGA.** No mesmo dia,
`limpar_analises_orfas` expirava POR TABELA, cada linha com a sua `data_leilao` — e como a data
vem preenchida na mercadológica e nula na documental, **o mercadológico vencia sozinho**: meia
análise, com cara de relatório que sumiu. Pior, o branch por leilão exigia `data_leilao` na
PRÓPRIA linha, então quem não tinha data nunca expirava mesmo com o acervo sabendo da praça.
Três invariantes novos em `qa_invariantes()` vigiam isso no rastro do banco:
`analise_sem_mercadologico`, `laudo_sem_base` e `analise_vencida_nao_limpa` (este último é o
que grita se a retenção parar de funcionar — um DELETE que não apaga não dá erro).

## 🔒 As duas travas automáticas (custo zero, sem IA)

| Trava | Onde roda | O que pega |
|---|---|---|
| `npm run verificar:padroes` | `prebuild` (todo `npm run build` e o deploy da Vercel) + CI `verificar-padroes.yml` | As formas 1–6 acima **e**, desde 12/08: `mutacao-sem-binding` (update/insert cujo resultado é descartado — a forma que mandou o e-mail de reunião fantasma), `notify-sem-cancelled` (passo de alerta com `if: failure()` sem `cancelled()`, que deixou 3 dias de coleta truncada sem aviso) e `mesma-janela-em-tabelas-diferentes` (o MESMO `.limit()` em tabelas diferentes no mesmo `Promise.all` — ver a forma 9) |
| `npm run verificar:schema` | CI `verificar-schema.yml` — push, PR e **diário 11h UTC** | A forma 7: toda tabela em `.from('x')` e toda coluna de data em filtro/ordenação, conferidas contra o schema REAL (RPC `schema_inventario()`) |
| `npm run verificar:sintaxe` | `prebuild` (bloqueia o deploy) | **ERRO de parse em `api/`, `scripts/` e `src/`.** O `vite build` só compila `src/` — `api/` vai para a Vercel sem ninguém olhar, e um arquivo quebrado ali é 500 em produção. Só ERROS reprovam; avisos históricos seguem tolerados |

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
