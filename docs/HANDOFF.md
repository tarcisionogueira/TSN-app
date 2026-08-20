# 🗺️ HANDOFF — BidPro Brasil (continuação em nova sessão)

> Cole este documento no início de uma nova sessão do Claude Code (com o **conector Supabase ativo**) para continuar com acesso total ao banco. Peça primeiro uma **auditoria completa dos fluxos** e depois siga pelos "Próximos passos".

---

## 📌 PENDÊNCIAS ABERTAS (para esta sessão — leia primeiro)
_Última atualização: 19/08 manhã. Tudo abaixo de "resolvido" está em produção na `main`._

### 🎉 Estado: G2RS APROVADA (chegou 06:13 de 19/08 na fila do Atendimento)
Campanha Google e canal de e-mail 100% do nosso lado. O que falta é decisão/relógio.

### ✅ FEITO EM 19/08 (noite) — sessão dono+Claude, tudo em produção
- **Webhooks de pagamento (CRÍTICO):** `processarVencido`/`processarRecusado`/`setExpiracaoDocumentos`
  agora LANÇAM em erro de escrita (antes descartavam e devolviam ok — a marca de idempotência
  ficava e a inadimplência se perdia para sempre); `mpGet` do mp-webhook distingue 404 de
  429/5xx (erro do MP virava 200 e o MP parava de reentregar — ativação de plano pago perdida);
  a blindagem "outro mandato ativo" agora falha FECHADA (busca falhou → 5xx/reentrega, nunca
  suspender às cegas).
- **"Arrematei" protege os RELATÓRIOS:** `sinalizar-arremate` marca `arrematado=true` nas TRÊS
  `analises_*` (a retenção decide por elas; antes só documentos eram protegidos e o cron
  apagava os relatórios do imóvel comprado). `Analise.jsx` parou de gravar `false`
  incondicional (apagaria a proteção) e ganhou o laudo.
- **Checkout não desloga quem pagou:** `signInWithPassword` não lança — o `{error}` agora é
  tratado nos 2 fluxos do Checkout e no ProdutoLanding (padrão do Promo.jsx).
- **Atendimento:** mensagem duplicada na tela corrigida (dedup por id contra o realtime) +
  guard de `enviando` no Enter (2 Enters rápidos inseriam 2× no banco).
- **Hardening baixo (os 4):** comparação timing-safe na assinatura Svix · iframe de e-mail sem
  `allow-popups-to-escape-sandbox` · allowlist de host no `download_url` de anexo · REVOKE de
  `brightdata_decisao` (era PUBLIC/anon/authenticated; ficou service_role — migração
  `brightdata_decisao_sem_anon.sql`, aplicada).
- **Reuniões "paradas há 48 dias" eram 3 TESTES do dono** (todas de tarcisioaraujo@, role
  admin, 01-05/07, invisíveis na fila) → canceladas; o health-check agora exclui contas
  internas, igual ao invariante (as duas réguas mediam populações diferentes).
- **4 pagantes sem entrega:** VERIFICADO — recebem e-mails normais (oportunidades/divulgação,
  entregues, último 19/08). Não existe e-mail específico de "pagante sem uso"; criar é decisão
  de comunicação do dono.
- **Runner residencial:** NÃO está rodando (a coleta do GESTAO segue consumindo Bright Data —
  32 req nesta semana). O código está pronto; falta a máquina de casa (ver seção do runner).

### ✅ ONDA 2 DE 19/08 (madrugada) — Caso.jssx/Admin + RESTO DO BUG BOUNTY, tudo em produção
Sinal do dono: "ataque o bloco do Caso.jsx e o resto do bug bounty". ~25 consertos, travas
verdes (a linha de base de padrões perigosos CAIU 415→399) e build limpo. O que mudou:
- **Caso.jsx**: escritas com a identidade do CLIENTE do caso (arrematação/procuração eram
  gravadas como ADMIN no modo suporte — e o rateio de honorários usa esse id); cota lida e
  queimada do cliente visualizado; upsert `ignoreDuplicates` com `.select()` (2º clique não
  cobra mais cota por job que não foi criado); "assinar procuração" com prova (RLS que casa 0
  linhas não vira mais "Procuração assinada!"); tabela local de limites alinhada ao banco
  (explorador 3, pagantes 10, consultor 5); leituras do Promise.all com error checado;
  checklist de certidões escopado ao cliente do caso.
- **Admin.jsx**: concessão do painel de solicitações via RPC `admin_conceder_cota` (o
  read-modify-write podia ZERAR o bônus acumulado e não registrava em cota_concessoes);
  telas de saque/analítico/docs-PJ com `.ok`/`error` checados (falha de leitura não vira mais
  "nenhum saque pendente"/"parceiro sem KYC"); honorários não salvam mais total 0 por campo
  vazio; saveRole/toggleAtivo com prova contra o gatilho protetor.
- **Pré-login**: `handle_new_user` grava `endereco_cidade`/`uf`/`cidades_interesse` do
  "Cidade - UF" do cadastro (migração `handle_new_user_grava_cidade_estruturada`, APLICADA;
  mata o modal que pedia a cidade de novo e os alertas sem região; backfill: 1 perfil);
  nome/telefone via libs no CompletarCadastro(Modal) — fechava o buraco do cadastro GOOGLE
  ("ana" passava); senha FORTE em Promo/ProdutoLanding + api/promo-capturar + api/sdr-capturar
  (eram 6 chars); verificar-cpf devolve 503 em falha (não mais "e-mail livre"); boas-vindas
  sem TypeError e sem reenvio quando a marca falha; ConviteEquipe: contrato que falha agora
  GRITA, telefone sem máscara, refazer foto limpa a aprovada.
- **api/**: radar-editais não carimba `ia_extraido` com a IA fora (lote não queima mais) e
  corte por tempo registra run parcial como erro (o gate do dia repuxa); gerar-analise
  ESTORNA cota/crédito na entrega sem parecer; enriquecer-lote/backfill no caminho novo do
  Bright Data (`semCota` não carimba lote como visitado — forma #5); renovacao-avisos e
  backfill-mp nomeiam paginação interrompida (429 ≠ fim das páginas); meta-insights no
  `isCronAuthorized` (aceitava `x-vercel-cron` como credencial) + segue paging; timingSafeEqual
  por BYTES em ads-metrics-ingest/asaas-webhook (RangeError→500); inbound-juridico: IA fora =
  503 SEM efeitos colaterais (o Resend reentrega; antes o parecer do advogado ficava órfão
  para sempre atrás do dedup); saldo-abandono marca dedup ANTES de enviar; criar-conta-checkout
  upsert com log alto.
- **Telas**: "semelhantes" da ficha com `valor_minimo_ref`/`desconto_percentual` (mesma régua
  da Busca); lixeiras de Arrematados com `.select()`; AceitarParceria com erro visível;
  mudarPlano lê text antes de JSON; asaas_id/downgrade com binding.
- **Runner residencial CONFIRMADO ativo**: coletas residenciais 10/08, 13/08, 16/08 e 19/08
  ~19h BRT (PECINI/RJ/VLANCE; gate 72h) — a "tela preta" do Windows É o runner. RJ de 19/08
  saiu "degradado (paginação interrompida)": não fechar a janela no meio. GESTAO/SOLEON
  ficaram para o próximo disparo. Se o dono quiser janela invisível, wrapper do Agendador.
- Fora de escopo por decisão: e-mail de "pagante sem uso" (dono dispensou). O mandato órfão
  foi resolvido na ONDA 3 (abaixo).

### ✅ ONDA 3 DE 19/08 (madrugada) — mandato órfão, erro do 'find' e dívidas registradas
Sinal do dono: "resolva o que consegue sem mim do mandato, dos 3 erros e dívida registradas".
- **Mandato órfão (assinar-com-cadastro), em DUAS camadas:** (1) timeout/5xx na criação do
  preapproval deixou de ser tratado como recusa — agora re-tenta 1x (o X-Idempotency-Key faz o
  MP devolver o MESMO mandato) e, persistindo a dúvida, BUSCA o mandato por payer_email; se
  nem assim dá para saber, a conta NÃO é apagada (503 orientando a não refazer o pagamento) —
  apagar era a única jogada irreversível. (2) Rede de segurança no mp-webhook: mandato cujo
  external_reference aponta para usuário INEXISTENTE é CANCELADO no MP com log alto — fecha o
  fantasma cobrado por qualquer origem, não só esta.
- **Os "3 erros do 'find'": caso ENCERRADO por cronologia.** Todas as ocorrências (última
  22:53 UTC de 17/08) são ANTERIORES ao conserto do guard `pracasEd = extratoDoc.pracas || []`
  (commit a395092, 23:46 UTC de 17/08 — caminho de visão do edital). O "cliente" era o
  PRÓPRIO DONO testando um lote inativo de Copacabana com praça passada; há 3 gerações dele
  DEPOIS do conserto, todas ok. A análise-teste presa em status 'erro' foi apagada (painel
  360 limpa).
- **Dívida "nome em 2 fontes" PAGA:** as ~12 leituras de `user_metadata.nome` no front agora
  preferem `perfis.nome` (que o AuthContext já expunha), na ordem `impersonate?.nome →
  nomePerfil → metadata` — o modo suporte continua mostrando o nome do CLIENTE. Arquivos:
  Header (inclui ModalFeedback), ChatSuporte, HomeCliente, Atendimento, ProdutoPublico,
  Checkout, Perfil, MeusChamados, OnrRegistro, Contratos. O metadata segue como fallback e o
  invariante `nome_fontes_divergentes` segue de guarda.
- **Dívida do piso ABSOLUTO da PECINI: DESTRAVADA (não forçada).** A baseline não pode migrar
  para `enumerados` ainda — medido: 0-1 run com `enumerados` por fonte (histórico magro; migrar
  agora criaria baseline de mentira). O bloqueio real era a PECINI nunca GRAVAR o número: ela
  só visita lotes novos (total 4-6/run, mediana nunca alcança o gate). Agora os DOIS
  registrarSaude dela gravam `enumerados = lotes.length` (o sitemap inteiro — o que a fonte
  LISTA). Com ~3 runs, o piso aprendido assume sozinho. Migrar `fonte_baseline_aprendida()`
  para preferir `enumerados` fica agendado para quando o histórico existir (~1 semana).

### 📋 LEILOEIROS DO SINDICATO-SP × ACERVO (20/08, pedido do dono — PDF de sindleiloeiro.com.br)
73 leiloeiros sindicalizados no PDF; **~25 casas já cobertas** (Sodré, Calil, Vegas, Lance
Total/extrajust, Lance no Leilão, Líder, Topo, Valero, 3 Torres, Gustavo Reis, SOLD…; GAIA,
RMoysés e Alberto Macedo chegam via agregadores). **29 casas FORA do acervo**, por site:
ricoleiloes (4 leiloeiros!), lanceja (Lance Já), milanleiloes (⚠️ Milan ≠ MILANI do acervo),
vipleiloes (⚠️ ≠ nosso Leilão VIP/leilaovip), leilaoonline.net (2), destakleiloes (2),
3rleiloes.net (2), crisleiloes, franklinleiloes, impactoleiloes, zallileiloes,
fernandoleiloeiro, arremateleilao, teza, leiloesgold, e-leiloeiro, damasioleiloes,
centraljudicial, conceitoleiloes, tmleiloes, leilaobrasil, alexandridisleiloes,
cunhaleiloeiro, bastonleiloes, wspleiloes, lanceleiloes, sumareleiloes, agsleiloes,
kronbergleiloes (⚠️ conferir vs KRON do acervo). Próximo passo: recon de estrutura (ofensiva
de captura) nos priorizados pelo dono — muitos são só veículos/judicial, o recon diz quem tem
IMÓVEL antes de gastar integração. Lista completa com JUCESP/e-mail no chat de 20/08.

### 🔵 Dependem do DONO
1. ~~**Google Ads — formulário de serviços financeiros**~~ → ✅ **ENVIADO (19/08 à noite,
   com o Claude conduzindo)**: formulário dedicado do Google preenchido como "anunciante de
   serviços não financeiros", com o código da G2RS e dados idênticos ao envio (razão social,
   CNPJ, domínio). Confirmação "Seu e-mail foi enviado" na tela. **Aguardando resposta do
   Google por e-mail** — a tarja alaranjada só sai quando o caso for processado. Atenção ao
   caminho: o botão "Corrigir" da tarja leva à G2RS (etapa JÁ aprovada — não reenviar por lá);
   o formulário certo é support.google.com/google-ads/contact/google_ads_financial_services_verification.
2. ~~**Google Ads — conversão de CADASTRO como "principal"**~~ → ✅ **JÁ ERA principal e
   ativa** (3 conversões na quinzena) — e a conferência de 19/08 rendeu um SANEAMENTO: a conta
   tinha 5 ações de conversão e o código dispara só 2. As reais ("Cadastro — BidPro" e "Compra
   de plano — BidPro", rótulos em src/utils/gtag.js) ficaram principais; as 3 mortas ("Plano
   Contratado BidPro" 7658576769 e "Cadastro concluído" — abandonadas em 15/08 — e
   "Visualização de página") foram rebaixadas a secundárias. O "Conversões pendentes" da Compra
   de plano é normal: espera a 1ª venda paga. **Bônus da mesma sessão:** negativas por NÚCLEO
   de marca em frase (12 termos, ex.: "zuk", "arremata ai"±acento, "foi leiloado") aplicadas no
   nível da CAMPANHA — as variações que escapavam das exatas custaram R$ 21 na quinzena.
3. **Tag "Urgente"**: os 2 issues foram consertados no código (tag nas páginas de SEO + guarda
   de hostname). O Google re-escaneia em ~5 dias e o selo regride sozinho. Só reabrir se
   continuar vermelho depois disso.
4. **Revisão da campanha** (~26/08, com 7 dias de dados limpos): decidir landing por cidade
   (`/leiloes/uf/cidade`), migração de lance p/ conversões, orçamento. Os termos já chegam
   sozinhos ao banco (`marketing_termos_dia`) — peça a análise no ritual.

### 🟡 Aguardando o SINAL do dono (patches prontos)
5. **Hardening baixo de segurança** (4 itens, 1 commit quando autorizar): comparação
   timing-safe na assinatura Svix (`inbound-juridico.js`); remover
   `allow-popups-to-escape-sandbox` do iframe (`Atendimento.jsx`); allowlist de host no
   `download_url` de anexo; `REVOKE EXECUTE` de `brightdata_decisao` para anon.
6. **Bug bounty de COMPORTAMENTO**: ✅ RODOU em 19/08 (3 agentes: pré-login · telas logadas ·
   api/) — ~30 achados, top 5 confirmados linha a linha (ver seção "VARREDURA" do 19/08 abaixo:
   inadimplência perdida em silêncio nos webhooks, "Arrematei" que não protege os relatórios,
   Checkout deslogando quem pagou, MP 429→200, Caso.jsx gravando como admin no modo suporte).
   **O que falta é o CONSERTO** — aguardando sinal do dono para a ordem de ataque.
7. **Runner residencial** (~185 req/semana de economia de Bright Data): infra pronta no código
   (`GESTAO_HEADLESS`, `SOLEON_NO_BD`, `scripts/lib/fetch-residencial.mjs`) — falta uma máquina
   ligada em casa. Cloudflare bloqueia datacenter, por isso não roda no GitHub Actions.

### ⏳ Convergem sozinhos (NÃO "consertar")
- **`docs` do Bright Data**: rateio de 25/dia passa a governar a partir de SEGUNDA (semana
  nova). Esta semana já bateu o cap semanal de 150 — normal.
- **Search Console 19/08 "bloqueada pelo robots.txt"**: VERIFICADO, é intencional — o
  robots.txt nasceu em 15/08 e só bloqueia /api/ e as rotas de preview (/c/ /t/ /i/ /p/, já
  noindex); as páginas de SEO (/leiloes*, /leilao/*) e o sitemap estão fora dos Disallow.
  Fecho de 1 min do dono: no relatório do SC, conferir que as URLs de exemplo são só desses
  prefixos.
- **`cadastro_barrado` 8/7**: janela móvel, converge. **`limpeza_encerrados_pulada` 1**: vira
  domingo. **`lote_sem_area` 404↓**: cai a cada rodada.
- **PECINI `alvo=antigos`**: agendada segunda 24/08 15:00 UTC (metragem/matrícula de julho).

### 🟢 Resolvido em 18–19/08 (não retocar — está certo)
Canal de e-mail completo (MX + webhook + corpo via API + anexos + rate limit 15/h + tetos de
anexo nos 2 ramos) · fila de chamados honesta (status `saudacao`) · nome+telefone com regra
única · teto BD 550 permanente + rateio diário · conversão de cadastro nas 3 telas do checkout
· tag Google nas páginas de SEO · recuperação de venda (cron diário, assina "Equipe BidPro") ·
XSS de sessão fechado (JSON-LD + popup do mapa) · Vila Velha regerado (144 m²). Ofensiva de
segurança de 3 frentes: `auditoria_seguranca()` = 0/0, 1 XSS alto consertado, 2 médios
resolvidos, resto bem defendido.

### ⚠️ Dívidas registradas (com alarme em cima, sem pressa)
- ~~Nome do cliente em 2 fontes~~ → ✅ PAGA na ONDA 3 de 19/08: as 12 leituras do front agora
  preferem `perfis.nome` via AuthContext (metadata só como fallback); invariante segue de guarda.
- 2 cadastros legados com nome único (`nome_sem_sobrenome` limite 2 — um 3º = regra vazou).
- Piso ABSOLUTO da PECINI: DESTRAVADO em 19/08 (scraper grava `enumerados`); migrar a
  baseline para `enumerados` quando houver ≥3 amostras (~1 semana) — aí a dívida morre.

---

---

## 🧾 19/08 — O INVARIANTE DE ONTEM PEGOU O PRÓPRIO CONSERTO DE ONTEM (7.721 SELOS)

**Aplicado em produção** (migração `selo_edital_calcula_depois_de_preservar.sql`).

### `selo_documento_dessincronizado` = 7.721 no primeiro dia de vida — e era ORDEM de gatilho
O diagnóstico de abertura achou o invariante criado em 18/08 estourado: 7.721 lotes, **100%
CEF, 100% na direção "arquivo existe, selo desligado"** — todos tocados pelo scraper matinal
das 09:23–09:28. Causa-raiz, provada com repro em transação desfeita:

1. O upsert diário da CEF manda a **página do lote** em `link_edital` (bootstrap deliberado,
   `scripts/scraper.js:380` — o CSV da Caixa não traz o PDF; quem protege o PDF conquistado é
   `trg_preservar_link_edital`).
2. Gatilhos BEFORE disparam em **ordem alfabética**: `set_tem_edital_doc` (s) rodava ANTES de
   `trg_preservar_link_edital` (t). O cálculo do selo via o não-PDF do payload → `false`; o
   preservador restaurava o PDF **depois**. Linha final: link = PDF, selo = false.
3. Todo dia o sync re-apagava os selos: **7.721 editais verdadeiros escondidos na Busca**
   (CEF com selo: 187 → **7.908** após o conserto).

**Conserto:** rename do gatilho para `zzzz_set_tem_edital_doc` (ordena depois de todos os
`trg_*`; o cálculo passa a ver o NEW já preservado) + ressincronização do acervo. Verificado:
invariante de volta a **0**, ordem confirmada em `pg_trigger`. É exatamente a classe que o
invariante foi criado para pegar ("um UPDATE que não dispara não dá erro") — pegou em 24 h.
**Lição para gatilho novo em `imoveis_leilao`: a ordem é alfabética; gatilho que LÊ o que
outro gatilho ARRUMA precisa ordenar depois dele.**

### Resto do diagnóstico de abertura (19/08)
- Segurança `0/0` · regras de negócio `0` · KYC `0` · baseline de fontes limpo (filtro
  `sem_cota` ativo) · fontes cegas `0` · deploys `READY` · backup off-region saudável 4º dia.
- Bright Data 541/550 na semana (vira 24/08); freio respondendo certo (`brightdata_decisao`:
  só `rj` com folga, resto `reservado_para_outros`/`subcota` — decisão de orçamento, não fonte).
- `cadastro_barrado` 8>7: **todas** as 8 recusas são a régua de senha forte (última 15/08) —
  validação funcionando, não bug; se a régua estiver espantando cadastro pago é decisão de dono.
- `relatorio_area_nao_confirmada` 13>2 e `lote_sem_area_nem_matricula` 404>400: fila de
  matrícula existe e roda; acompanhar.
- Atendimento: 3 pedidos de reunião sem data (o mais antigo há 48 dias — pendência do DONO) e
  2 chamados com cliente falando sem resposta humana (~0,5 dia) — a régua de `tempo_processo`
  segue mostrando que o relógio humano é onde tudo para.
- Cliente 360: 4 pagantes sem relatório em 14 dias (2 top2 antigos, 1 assessorado, 1 top2 de
  17/08) — churn em formação, vale contato.
- Marketing: conversões voltaram a aparecer no painel (3 na quinzena), 165 visitas com gclid ×
  283 cliques pagos (razão bem melhor que os 19/214 de 14/08), `utm_term` populando (109).
- `erros_cliente` 14d: `/checkout` Failed to fetch ×4 (caso Romualdo, recuperação já virou
  cron) e 1 null-read em `/imovel/:id` (13/08, ocorrência única).
- `gerar-analise` com 3 erros invisíveis em 7d (2 clientes, último 17/08,
  "Cannot read properties of undefined (reading 'find')") — investigar na próxima rodada.

### Varredura multi-agente de abertura (item 6 do ritual) — 3 agentes, ~30 achados, TOP 5 confirmados no código
**Nenhum conserto aplicado ainda** (só o do selo, acima) — a lista abaixo está confirmada por
leitura direta do código e aguarda priorização do dono. Os cinco que valem a fila:

1. **[CRÍTICO · dinheiro] `api/_webhook-core.js:582/718/726/730`** — `processarVencido` e
   `processarRecusado` descartam o `error` do update em `perfis` e devolvem `{ok:true}`,
   enquanto as irmãs do MESMO arquivo (`:365`, `:493`) fazem `if (error) throw`. Como o
   webhook grava a marca de idempotência ANTES do efeito e só desfaz no `catch`, uma falha
   transitória de escrita vira HTTP 200: o gateway não reentrega, a reentrega é descartada
   como `duplicado`, e o cliente com cobrança vencida/recusada **mantém role pago para
   sempre, sem rastro**. Colateral: `setExpiracaoDocumentos` (`:696`) na mesma família
   (prazo LGPD de 90 dias falha calado).
2. **[CRÍTICO · promessa quebrada] "Arrematei" não protege os relatórios** —
   `api/sinalizar-arremate.js` protege `arrematados` + `imovel_anexos` e **nunca toca
   `analises_mercado/documental/laudo`**; a retenção (`analises_retencao_por_imovel.sql:46-56`)
   decide por `bool_or(arrematado)` **dessas três**. Único escritor: `Analise.jsx:1178-1179`,
   a partir de `d.status === 'arrematado'` que nunca é setado na tela (= grava sempre
   `false`, e sem `analises_laudo`). Cliente arremata, clica no botão que promete "manter o
   relatório", e 15 dias depois da praça o cron apaga os 3 relatórios do imóvel comprado.
3. **[ALTO · venda] `Checkout.jsx:428` e `:746`** — `try { await
   supabase.auth.signInWithPassword(...) } catch {}`: a função **não lança**, devolve
   `{error}` — o catch é código morto. No fluxo PAGO (`:746`) o mandato já foi autorizado no
   MP e a pessoa cai em `/membros` **sem sessão** → PrivateRoute joga no login → "e-mail já
   tem conta". Pagou e não entrou. A cópia certa existe em `Promo.jsx:135-152`. Mesmo defeito
   em `ProdutoLanding.jsx:291`.
4. **[ALTO · dinheiro] `api/mp-webhook.js:104-107, :133, :178-183, :256`** — `mpGet` devolve
   `null` em 429/5xx do MP e os chamadores respondem **200** ("não encontrado") → o MP para de
   reentregar: ativação de plano pago perdida sem rastro. E a blindagem "outro mandato ativo"
   falha para o lado destrutivo (suspende pagante quando a BUSCA falha).
5. **[ALTO · identidade] `Caso.jsx` no modo suporte grava como ADMIN** — `user.id` cru em
   `:876-877` (arrematação nasce atribuída ao admin, e o rateio de honorários usa esse id),
   `:949` (procuração), `:638/:789` (cota lida/queimada do admin); e `:976-986` "assinar
   procuração" sem `.select()` numa policy só-cliente = "Procuração assinada!" sobre zero
   linhas. Além disso `Caso.jsx:33-42` é a 5ª cópia da tabela de limites, divergente do banco
   (explorador 5 vs 3; top2 15 vs 10), e `:770-797` cobra cota sobre upsert
   `ignoreDuplicates` que não criou nada.

**Resto da varredura (confirmado pelos agentes, não re-conferido linha a linha):** cota/crédito
cobrados em relatório sem parecer (`gerar-analise.js:2886-2913`, `semParecer` calculado DEPOIS
da cobrança); `radar-editais-cron.js:172/199` carimba `ia_extraido: true` com a IA fora (lote
sai da fila para sempre) e run truncado por tempo grava "sucesso do dia" (`:333/:387`);
concessão de cota do Admin faz read-modify-write sem a RPC `admin_conceder_cota` e pode ZERAR
bônus (`Admin.jsx:8028-8049`); painel de saques lê `.json()` sem `.ok` → "nenhum saque
pendente" falso (`Admin.jsx:9017/9127`); cidade obrigatória do cadastro nunca chega a
`endereco_cidade/uf` (modal pede de novo + alertas sem região — `Login.jsx:341` vs trigger
`handle_new_user`); 3ª/4ª cópias da regra de nome/telefone sem o conserto no funil Google
(`CompletarCadastroModal.jsx:102/104`, `CompletarCadastro.jsx:80/82`); senha mínima 6 em
`Promo.jsx:124` + `ProdutoLanding.jsx:266` + servidores; `verificar-cpf.js:64` devolve 200
"e-mail livre" em erro de RPC; paginação MP que trata 429 como "fim das páginas"
(`renovacao-avisos-cron.js:100`, `backfill-mp-pagamentos-cron.js:37`);
`enriquecer-backfill-cron.js` ainda usa o caminho LEGADO do Bright Data (recusa de cota
carimba lote como visitado — forma #5); devolutiva jurídica com IA fora fica órfã por dedup
(`inbound-juridico.js:485-493`); `meta-insights-cron.js:30` aceita header `x-vercel-cron` como
credencial (único cron fora de `isCronAuthorized`); "semelhantes" da ficha usa `valor_minimo`
cru onde a Busca usa `valor_minimo_ref` (`ImovelDetalhe.jsx:220-243`). Relatórios completos
dos 3 agentes ficaram na sessão de 19/08.

---


## 🧾 18/08 (3ª sessão, parte 2) — NOME COM REGRA, TETO COM UM NÚMERO SÓ

Tudo desta seção está **em produção** (`main`).

### 1. Os leiloeiros paralisados não eram fonte quebrada — era o número do teto
CALIL, VEGAS e GESTAOLEILOES não coletaram **nenhuma manhã entre 14 e 18/08**, com o acervo
íntegro (95 · 21 · 130) e `tocados_24h = 0`. A coleta da TARDE passava — mesma fonte, mesmo
dia, mesmo site.

A causa era **quem pergunta**. O teto ia por PARÂMETRO: `api/_brightdata.js` manda
`BRIGHTDATA_MAX_REQ_SEMANA || 450`; os disparos manuais mandavam **520**, o número que o
dono escolheu e que está gravado em `brightdata_uso.teto`. Medido com 488 usados e 26
reservados para outros:

| pergunta com | limite | resultado |
|---|---|---|
| 450 | 450 − 26 = **424** | 488 ≥ 424 → **RECUSA** (`teto_global`) |
| 520 | 520 − 26 = **494** | 488 < 494 → **permite** |

Mesmo instante, mesma fonte, respostas opostas. É a **forma #5** da lista do CLAUDE.md: o
freio de orçamento entregue como regressão da fonte. Agora o teto vem da CONFIGURAÇÃO
(semana → último configurado → `p_teto`). **Não afrouxa o freio** — o número passa a ser um
só. Para mudar o teto, escreva em `brightdata_uso.teto`; mexer na env de um chamador só vale
para ele, e foi exatamente esse o defeito.

**Conferir cota deixou de custar cota.** A decisão virou `public.brightdata_decisao(...)` —
`stable`, sem escrita — e `registrar_uso_brightdata` DELEGA a ela. O aviso de 18/08 dizia
"não use a função de reserva para conferir", mas ler as tabelas soltas **não reproduz a
regra** (reserva alheia, sub-cota, teto efetivo): a única forma de saber a resposta era
gastar por ela. O CLAUDE.md já aponta para a função nova.

**Verificado nas duas direções**, em transação desfeita: com o contador em 520 e em 999 a
resposta continua `permitido: false / teto_global`, e a sub-cota de `docs` (150/150) continua
recusando. O freio continua freando. Rollback conferido: 488/520 intactos.

### 2. Os dois alertas "pendentes de medição" — nenhum era achado novo
Os dois eram leitura **anterior** ao conserto:
- **VEGAS** `degradado` com 1 lote: linha de 17/08 **11:00**; o conserto da bimodalidade
  (commit `6dd2702`, usa `enumerados` em vez de `total`) entrou 17/08 **12:38**.
- **GESTAOLEILOES** `falhou`: linha de 18/08 **09:39**; o conserto entrou **10:08**.

As linhas seguintes de CALIL e VEGAS já gravam `enumerados` e `sem_cota` corretamente.

### 3. Nome de cliente: a regra que não existia
A validação era `if (!form.nome)` — qualquer coisa não-vazia passava. Em 53 perfis: **2 com
um nome só, 6 todos em minúsculo, 8 todos em maiúsculo**.

Régua nova **deliberadamente baixa**: nome e sobrenome, sem número. Não é barreira de
entrada — é o mínimo para emitir contrato, conferir CPF ou falar com o cliente.
- `src/lib/nome.js` (front) · `api/_nome.js` (servidor, cópia deliberada) ·
  `normalizar_nome()` + gatilho em `perfis` (a capitalização é arrumada onde **nenhum**
  caminho contorna; o gatilho **nunca rejeita**).
- Aplicado nos **cinco** pontos de entrada: Login, as **três** telas do Checkout e o
  ConviteEquipe — exatamente onde a senha havia sangrado em 15/08.

**Backfill:** 24 dos 53 nomes mudaram, todas por capitalização ou espaço — nenhum nome
alterado em substância. Depois: 0 fora do padrão. Os 2 de nome único (**Daniel**, **Rayane**)
ficaram como estão: inventar sobrenome de cliente seria pior. *Se quiser fechar, pede o
sobrenome no próximo login deles — não dá para deduzir.*

⚠️ **BRINDE, no mesmo arquivo:** `ConviteEquipe.jsx` exigia senha de **8 caracteres e nada
mais**, enquanto Login e Checkout exigem maiúscula, minúscula, número e especial desde
15/08. Era a cópia que não recebeu o conserto — **no fluxo de EQUIPE**, que entra com mais
permissão que cliente. Passou a usar `senhaForte`.

⚠️ **UM BUG MEU, achado só no teste ponta a ponta.** A regra "preserva maiúscula interna"
(para McDonald/DiCaprio) testava apenas `[lower][upper]` — e isso **também casa com
"jOAO"**. O gatilho devolvia `"jOAO da Silva Neto"`: erro de digitação lido como intenção.
Estava nas TRÊS cópias (front, servidor, SQL). Corrigido para exigir que a palavra COMECE em
maiúscula. **Não aparecia em nenhum dos casos que eu mesmo escrevi** — só quando exercitei o
gatilho de verdade. Registro para a próxima: caso de teste que eu invento tem o meu viés.

### 4. O SDK de cartão barrado era um beco sem saída
Investigando a venda perdida, apareceu uma assimetria:

| quem | MP falha → |
|---|---|
| **já tem conta** | fallback automático para Asaas por **link** (sem SDK) |
| **chega novo** | *nenhuma rota* |

O fluxo de criar-conta-e-pagar precisa do SDK do Mercado Pago para tokenizar o cartão, e
`sdk.mercadopago.com` é um dos hosts mais barrados por bloqueador/extensão — a mesma classe
de extensão que substituiu o `window.fetch` daquela pessoa. E o erro era mudo por um detalhe:
`s.onerror` rejeita com um **Event**, cujo `.message` é `undefined`, então caía no genérico
*"Erro ao processar a assinatura."*

Agora a rejeição diz a causa provável e as duas saídas (desativar a extensão, ou "Criar conta
grátis" — botão que já existe na tela e leva ao caminho com plano B). **Não** reescrevi o
fluxo de pagamento nem redirecionei ninguém automaticamente: encadear criação de conta com
cobrança sem decisão do dono trocaria um beco sem saída pelo risco de mandato duplicado, que
este arquivo já pagou (ANTI-DUPLO-MANDATO P0.2).

### Depende do dono
- **A venda Top2 perdida** (tentou 4× entre 06 e 17/08, segue Explorador). O conserto ajuda
  quem chegar agora; **não avisa quem já desistiu** — vale contato direto.
- `analise_sem_mercadologico` (5) e `laudo_sem_base` (1): mesmo lote, um clique em *Gerar*.
- **Teto do Bright Data:** 488/520 nesta semana, 32 de folga; a semana vira **24/08**. Agora
  o número que vale é o de `brightdata_uso.teto` — se quiser outro, é ali.

---

## 🧾 19/08 (manhã) — VEREDITOS + OFENSIVA DE SEGURANÇA

### 🎉 G2RS APROVADA
"A solicitação foi aprovada" chegou na fila do Atendimento às 06:13 (canal e-mail, de
g2no-reply@g2risksolutions.com). O canal de e-mail construído em 18/08 entregou seu
primeiro documento crítico. **Próximo passo do dono:** só agora (após a aprovação da G2RS)
preencher o formulário de serviços financeiros no Google, com dados idênticos aos do envio.

### Os quatro vereditos operacionais
1. **GESTAOLEILOES: era ORÇAMENTO, não fonte quebrada.** A coleta matinal de 19/08 gravou
   `sem_cota` (09:20), não `falhou` — o conserto de 18/08 (migrar para buscarViaBrightData +
   propagar semCota) validado em produção. VEGAS idem (09:25). O alerta morre. Hipótese que
   ficou aberta ontem: **confirmada**.
2. **Recuperação de venda funcionou.** Cron de 13:00 enviou 1 e-mail — para o Romualdo
   (rcronemberger@gmail.com), status `entregue` 13:00:56. Dedup e anti-spam corretos (1 de 1).
3. **Prova das negativas do Ads — LIMPA.** Gasto em marca de terceiro por dia:
   16/08 R$1,24 · 17/08 R$1,33 · **18/08 R$0,00 · 19/08 R$0,00**. As negativas aplicadas na
   noite de 18/08 zeraram o desperdício no mesmo dia. E o script v2 alimenta
   `marketing_termos_dia` sozinho (9 dias no banco) — auditoria de termos virou query do
   ritual, sem exportar zip.
4. **Bright Data 541/550.** GESTAOLEILOES/VEGAS levaram `sem_cota` de manhã = freio legítimo
   sob o teto 550 que o dono escolheu. `docs` está em 150/150 SEMANAL (rateio diário de 25
   governa a partir de segunda, com a semana nova). Consumo sob controle.

### A ofensiva de segurança (autorizada pelo dono) — 3 frentes
**1 achado ALTO consertado na hora + deploy** (`4988e40`): XSS de roubo de sessão — campo
scraped (título de lote) chegando a HTML sem escape, na mesma origem do app logado (token do
Supabase no localStorage). Dois sinks: JSON-LD das páginas de SEO (`api/publico.js:124` —
`JSON.stringify` não neutraliza `</script>`; agora escapa <,>,U+2028/9) e popup do mapa
(`Busca.jsx` — Leaflet bindPopup=innerHTML; helper `escHtml` em 4 pontos). O do popup era
PREEXISTENTE. Ambos provados (JSON reparseia idêntico; `</script>` literal some).

**Confirmados BEM DEFENDIDOS** (as três frentes reportaram explicitamente): RLS das tabelas
novas (fail-closed), funções de cota só service_role, bypass de cota impossível (teto vem da
config), promoção de chamado não forjável, spam de terceiros fechado (user_id sempre do
token), injeção PostgREST (encodeURIComponent em todos os pontos), sandbox do iframe de
e-mail (sem allow-scripts/same-origin), ReDoS sem risco. `auditoria_seguranca()` = 0/0.

**RESOLVIDOS (19/08, após aprovação do dono):**
- ✅ **Rate limiting no inbound**: 15 chamados/remetente/hora, só na CRIAÇÃO de chamado novo
  (resposta a fio existente não conta). Descarta com 200 (não 500, que faria o Resend
  reentregar). Falha na contagem deixa passar (não barra cliente legítimo por erro nosso).
- ✅ **Tetos no ramo jurídico de anexo**: `TIPO_ANEXO_OK` + `ANEXO_MAX_QTD`(5) +
  `ANEXO_MAX_BYTES`(10MB) agora em escopo de módulo, aplicados nos DOIS ramos. Um só lugar.
- Hardening baixo: comparação timing-safe na assinatura Svix; remover
  `allow-popups-to-escape-sandbox`; allowlist de host no download de anexo; REVOKE EXECUTE de
  brightdata_decisao para anon.

### Invariantes (nenhum de segurança)
`bd_teto_saturado` 541 (freio vivo) · `cadastro_barrado` 8/7 (janela móvel, converge) ·
`limpeza_encerrados_pulada` 1 (vira domingo) · `lote_sem_area` 404↓ · `relatorio_area_nao_
confirmada` 13 (filas encaminhadas, observando).

---

## 🧾 18/08 (noite) — O DIA EM QUE O DOMÍNIO PASSOU A RECEBER E-MAIL

### O canal de e-mail, do zero ao helpdesk (com o dono operando DNS/Resend)
`contato@bidprobrasil.com.br` não recebia: **o MX nunca existiu** — o webhook `email.received`
e o `INBOUND_WEBHOOK_SECRET` estavam prontos desde 03/08, esperando. Criado o MX (registro.br:
campo Nome VAZIO, não `@` — o painel sufixa o domínio), a corrente foi provada elo a elo com
e-mails reais, e cada elo quebrado apareceu porque a instrumentação o fez falar:
1. **O webhook anuncia, não carrega**: payload real do `email.received` = attachments, bcc, cc,
   created_at, email_id, from, message_id, received_for, subject, to. SEM text/html. O handler
   fora escrito contra um payload presumido e descartava o e-mail com 200 mudo.
2. **O corpo mora em `GET /emails/receiving/{id}`** — NÃO em `/emails/{id}`, que devolve 404
   (só serve enviados). Contrato lido do SDK OFICIAL (resend@npm) instalado no sandbox, não
   chutado. Anexos: metadados na mesma resposta; binário em `…/attachments/{id}` → download_url.
3. **Render**: texto com `pre-wrap` + links clicáveis (linkify por SPLIT, nunca innerHTML);
   HTML em `chamados_mensagens.conteudo_html`, renderizado SÓ em `<iframe sandbox>` sem
   allow-scripts/same-origin — remetente é qualquer um, a tela é a do ADMIN.
4. **Anexos** (política nova): baixados da API (autenticada), teto 5 × 10 MB, tipos permitidos;
   o resto vira nome registrado. Consertou também o caminho do ADVOGADO, que pulava TODO anexo
   em silêncio (`if (!att?.content) continue` — o payload nunca traz content).
O G2RS foi reenviado (18:31) e a confirmação caiu na fila do Atendimento 1 min depois. A
resposta (até 5 dias) cai lá também.

### NÓS começarmos a conversa não abre chamado
A fila marcava 27 abertos + 1 em atendimento — **28 com ZERO mensagem de cliente** (saudação
proativa da IA + canal do /caso criado ao abrir a página). Status novo `saudacao` (fora da
fila, sem SLA), gatilho `promove_saudacao` promove para `aberto` quando o CLIENTE fala e
carimba `aberto_em` (o relógio conta DALI, não de quando nós falamos). Fila depois: **0**.
Invariante `fila_sem_cliente_falar` (limite 0) testado nas duas direções (0 → 28 ao simular).

### Nome e telefone com regra
`if (!form.nome)` deixou "daniel" e "MOACIR EVERSON GONCALVES" na lista de clientes. Regra
única em `src/lib/nome.js` (front) + `api/_nome.js` (servidor) + `normalizar_nome()` por
gatilho no banco (nunca rejeita, só arruma). ⚠️ O nome vive em DUAS fontes — `perfis.nome`
(admin lê) e `auth.users.raw_user_meta_data.nome` (12 pontos do front do CLIENTE leem,
inclusive o faturamento do checkout): backfill nas duas, invariantes `nome_fontes_divergentes`
(0) e `nome_sem_sobrenome` (2 legados tolerados). Telefone: `src/lib/telefone.js` (10-11
dígitos, DDD) em Login/ConviteEquipe — havia celular com dígito faltando no acervo.

### Bright Data: teto 550 permanente (decisão do dono, 18/08)
`update brightdata_uso set teto=550` na semana corrente — semana nova HERDA o último teto
configurado (regra da migração `brightdata_teto_da_configuracao_e_decisao_gratis`). Conferido:
`brightdata_decisao(450)` responde teto 550 — o número é um só, venha a env que vier.

### Google Ads (campanha 475-979-5747, "Pesquisa — Leilão de Imóveis")
- **`trackCadastro` (CONV_CADASTRO) só disparava no Login.jsx** — as 3 telas de criação de
  conta do CHECKOUT (onde o tráfego pago aterrissa) nunca avisavam o Google. Corrigido: as
  três agora disparam. As "3 conversões" do painel eram só o caminho orgânico do Login.
- Funil 14d medido: 243 cliques → 135 visitas rastreadas → **2 cadastros com gclid** (22 dos
  24 cadastros do período vieram de fora do pago). O vazamento é pós-clique, não o anúncio.
- Tag do Google no painel ainda se chama "Clube Conselheiro" e está marcada **URGENTE** —
  pendência do dono abrir o "Gerenciar".
- Rodapé agora identifica o anunciante (razão social + CNPJ + contato) — exigência prática
  da verificação de anunciante. Falta só o ENDEREÇO (não existe no repo; não inventar).

### Vila Velha (gl_28430, GRUPOLANCE) — a área do relatório
Regerado pelo dono (22:29; `analise_sem_mercadologico` e `laudo_sem_base` → 0). MAS: o acervo
tinha `area_m2 = 0`; os "80 m²" que o dono viu eram os COMPARÁVEIS (apartamentos de 80 m² do
histórico/VivaReal), não o imóvel — o leiloeiro anuncia 168 m² total / 144 m² útil. Aplicado
`area_m2 = 144` (convenção: útil primeiro) + matrícula enfileirada em `documentos_fila` (o
lote TEM matrícula capturada). **Relatório atual subestima: vale regerar quando a matrícula
confirmar a área.**

### Fechamento da noite (últimas horas da sessão)
- **Recuperação de venda virou rotina**: `recuperacao-checkout-cron` (diário 13:00 UTC).
  Rastro = erros_cliente em /checkout + eventos de pagamento falho; anti-spam: só explorador,
  1 e-mail/30 dias, teto 20/dia, janela 10 dias. A trava `verificar:padroes` reprovou a
  primeira versão DUAS vezes (dedup descartado; leitura sem checar error) — corrigido
  abortando. **Comunicação automatizada assina "Equipe BidPro Brasil", NUNCA nome de pessoa**
  (decisão do dono) — o e-mail e a mensagem in-app já enviada foram ajustados.
- **Romualdo**: mensagem in-app enviada (chamado 9f286177…); o e-mail sai no 1º disparo do
  cron. Verificar o resultado (`enviados` no log do cron) na próxima sessão.
- **Negativas aplicadas pelo dono no Ads** (conferidas por print): variações de arremata aí,
  smartleiloes, leilãomap, zuk, smartcaixa, checkmovel, leilaoimovel, auket, bid imoveis,
  arrematadorcaixa, "meu imovel foi leiloado". Origem: relatório de termos 04–17/08 — 76,6%
  do gasto rastreável era marca de TERCEIRO com zero conversões.
- **Falta no Ads (dono)**: colar o script v2 (`docs/google-ads-script-bidpro.js`) e abrir o
  "URGENTE" da tag Google ("Clube Conselheiro") na Central de dados.
- **Vila Velha regerado**: 144 m² (fonte acervo, declarado), valor R$ 846k → R$ 1,63 mi.
  Matrícula foi lida pela fila mas sem área extraível (provável escaneada) — ressalva "não
  confirmada" segue na tela, o que é verdadeiro.

### Contato comercial pendente (dono)
Romualdo José Rocha Cronemberger — tentou assinar o Top2 4× entre 06 e 17/08 (extensão do
navegador bloqueava o fetch), segue explorador. Há uma SAUDAÇÃO dele aberta na fila de 05/08:
responder por ali chega por e-mail.

---

## 🧾 18/08 (3ª sessão) — O SELO PROMETIA DOCUMENTO QUE NÃO EXISTIA EM 2.170 LOTES

Diagnóstico de abertura limpo no de sempre: segurança `0/0`, regras `0`, KYC `0`, nenhum
chamado de cliente sem resposta, 30.412 ativos com 98,3% em 24 h, deploys `READY`, backup
off-region saudável pelo 3º dia (50 arquivos, 33 iguais). Marketing seguiu subindo: 130
visitas com gclid e 74 com `utm_term` em 322 visitas.

### O achado, e como ele mudou de tamanho no meio do caminho
`doc_link_sem_documento` foi de **0 para 38** numa coleta só — todos SODRE, gravados às
11:21. Minha primeira leitura foi *"limpou o dado e não o escritor"*, e eu ia consertar o
`scraper-puppeteer`. **Medir mudou o alvo inteiro.**

`link_edital = url_lote` é a **convenção da base**: o campo guarda a PÁGINA onde o
documento está (SUPERBID, GRUPOLANCE, BIASI, SOLD, VIP, SODRE…). A ficha de detalhe sempre
soube — `ehDocArquivo` exige PDF ou objeto do nosso Storage. A **`Busca.jsx` não**: era a
única tela SEM cópia da regra, e decidia o selo só por `/^https?:\/\//`.

| | selo "📄 Edital" | selo "📄 Matrícula" |
|---|---|---|
| lotes ativos com o selo | 14.287 | 27.936 |
| **sem arquivo em lugar nenhum** | **2.170** | **337** |
| piores | SUPERBID 1.425 · MEGA 192 · LJUD 174 | PESTANA 249 · WEBLEILOES 80 |

A SODRE **não aparece em nenhuma das duas listas**: os 38 lotes entregam o edital pelos
anexos. O invariante acusava quem entrega e não via quem não entrega — falso-positivo e
falso-negativo na mesma régua. **Não mexi no scraper da SODRE**: o defeito estava em quem
LIA o campo como se fosse documento.

### O conserto
- `src/utils/documento.js` — definição única de `ehDocArquivo`/`ehMatriculaValida`/
  `ehRegrasDoc`. Estava copiada em `ImovelDetalhe` e `Analise`, **ausente na Busca** — foi
  por onde entrou. Mesmo remédio que `src/lib/senha.js` deu para a regex de senha.
- `imoveis_leilao.tem_edital_doc` e `tem_matricula_doc`, mantidas por **gatilho**: dizem se
  existe ARQUIVO no link, nos anexos do leiloeiro **ou** no nosso Storage (`imovel_anexos`
  é outra tabela — por isso gatilho, não coluna gerada).
- Os dois selos da Busca (popup do mapa e card da lista) passam a ler esses sinais.

⚠️ **O custo que quase passou.** A primeira versão decidia a matrícula só com link + CEF.
Removeria as 337 mentiras **e apagaria o selo de 1.168 lotes** — 831 deles COM matrícula
nos anexos. *Trocar mentira por sumiço não é conserto.* Com o sinal do banco: **−337
mentiras e +905 selos verdadeiros** que estavam escondidos (link nulo, matrícula no
Storage ou derivada da CEF). No edital, o selo novo é subconjunto **estrito** do antigo.

### O invariante passa a medir ENTREGA, não formato de URL
`doc_link_sem_documento` → **`selo_documento_dessincronizado`**. Com o selo preso aos
sinais, o que vale vigiar é o sinal sair de sincronia: **um UPDATE que não dispara não dá
erro**, e o selo voltaria a mentir calado.

**Como foi verificado** (o padrão da casa: provar nas duas direções)
- Espelho SQL `doc_arquivo` × JS nos MESMOS 9 casos → 9/9 concordam.
- Helper CARREGADO de verdade, 13 casos com controles negativos (`matricula.asp`, rótulo de
  texto no campo de link, `null`, rota terminada em `/`).
- Gatilhos em transação desfeita: inserir anexo acende · **apagar o anexo apaga** · gravar
  `link_edital` PDF acende. Rollback conferido, zero resíduo.
- Invariante corrompido à mão foi a 1 e a 2. **Invariante que só sabe ficar verde não prova
  proteção.**
- Backfill **medido**: 0 divergentes no acervo inteiro, ativos e inativos.

### O `Failed to fetch` do /checkout — não era pagamento, mas tinha parte nossa
Os 4 registros são de UM usuário. Na tabela inteira, **todos** os "Failed to fetch" são do
mesmo `user_id`, em 7 rotas + 3 anônimos em `/login` na mesma janela. Stack com quadros
`<anonymous>` em offset 1:8058 — script injetado. É o **mesmo fenômeno já diagnosticado em
08/08** e escrito em `reportarErro.js`: extensão que substitui `window.fetch`. O filtro
`ehStackDeTerceiro` não pega porque a extensão não deixa marca `chrome-extension://`.
**Não ampliei o filtro** — ele é conservador de propósito, e alargar arriscaria engolir
erro nosso.

**O que era nosso:** `Checkout.jsx` imprime `e.message` cru em 7 telas de erro. Quem tentou
assinar o Top2 **quatro vezes entre 06 e 17/08** leu, na tela de pagamento, o texto do
navegador — *"Failed to fetch"*. Sem idioma, sem causa, sem próximo passo. Segue Explorador
até hoje. `apiCall` passa a traduzir falha de rede em texto acionável, com o original em
`cause`, para o app inteiro.

⚠️ **E o conserto exigiu um cuidado:** envolver TODA rejeição de `fetch` trocaria mensagem
inútil por mensagem **errada** — `AbortSignal.timeout` é usado em `/api/proximidades-imovel`
(35 s) e `/api/gerar-contrato-ia` (180 s), onde o servidor está lento, não inalcançável. Só
`TypeError` é tratado como rede; abort e timeout sobem intactos. 6/6 nos erros reais.

### Depende do dono
- **Venda Top2 perdida há 11 dias**, de uma pessoa identificável que tentou 4×. O conserto
  não avisa quem já desistiu — vale um contato direto.
- Continuam de pé: `analise_sem_mercadologico` (5) e `laudo_sem_base` (1) — o mesmo lote,
  um clique em *Gerar* zera os dois.

### Pendente de medição (a coleta de amanhã decide)
- **GESTAOLEILOES** ainda aparece `falhou`/0, mas a linha é de **09:39, 29 min antes** do
  conserto de hoje. Se vier `sem_cota`, era orçamento; se vier `falhou`, é achado novo.
- **VEGAS** coletou **1 lote em 17/08** (`degradado`, "queda vs anterior 1<40") e ontem
  entrou `sem_cota`. O filtro de `sem_cota` esconde a linha de 17/08 da consulta do ritual —
  pode ser regressão real mascarada por um dia de cota. **Vale olhar amanhã.**

---

## 🧾 18/08 (sessão seguinte) — O FREIO DE CUSTO AINDA CHEGAVA COM CARA DE FONTE QUEBRADA

Diagnóstico de abertura limpo em quase tudo: segurança `0/0`, regras de negócio `0`, KYC `0`,
nenhum chamado de cliente sem resposta, 30.275 lotes ativos com 98,5% atualizados em 24 h, todos
os deploys `READY`. **O backup off-region recuperou** — 15/08 ainda batia no teto (1.000 arquivos,
`iguais = 0`); 16, 17 e 18/08 vieram com ~50 e `iguais = 33`, que é o estado saudável descrito no
CLAUDE.md. **E o rastreio de marketing fechou muito**: `visitas_com_gclid` foi de 19 (14/08) para
**112** em 294 visitas, e `utm_term` saiu de 0 para 56 — a pendência A do dono, resolvida.

### O achado: a checagem do ritual acusava três fontes sadias

`fonte_baseline_aprendida` apontou CALIL, GESTAOLEILOES e VEGAS abaixo do piso, com `total = 0`.
Os três acervos estavam **íntegros** (95 · 21 · 130 lotes). Eram duas coisas diferentes:

**1. A consulta do item 2 do CLAUDE.md não filtrava `status`.** CALIL e VEGAS gravam
`status = 'sem_cota'`, com o motivo escrito por extenso: *"coleta não tentada (decisão de
orçamento, não regressão da fonte)"*. `monitor-fontes-cron.js:183` sempre soube disso — trata
`sem_cota` como categoria própria e não empilha o alerta de baseline. Era **a consulta do ritual**
que pegava a última linha e comparava sem olhar o status: o freio de custo entregue como medição
da fonte, a forma #5 da lista, dentro da própria rotina que existe para pegá-la.

**2. `scraper-gestao.mjs` não sabia dizer "sem cota" — e por isso o GESTAOLEILOES parecia quebrado.**
Ele usava `fetchViaBrightData`, o wrapper legado cujo docblock avisa: *"Para COLETA — onde `null`
vira dado faltando sem ninguém perceber — use `buscarViaBrightData`"*. O wrapper engole o
`ErroBrightData` (inclusive `semCota`) e devolve `null` → a home não vem em domínio nenhum → 0
eventos → grava `falhou` com *"nada pronto (0 lotes brutos)"*.

A trava `brightdata-null-em-coletor` existe e pega isso. O arquivo estava isento por uma nota de
11/08: *"o `null` aqui é um fallback DELIBERADO (tenta o grátis/residencial, o pago é a segunda
chance)"*. **A justificativa não descrevia o código:** a escolha é por variável de ambiente,
ANTES da chamada (`GESTAO_HEADLESS === '1'`), e no modo pago o `null` não tinha segunda chance —
virava `return null` seco. A isenção protegia um fallback inexistente naquele caminho.

Evidência de que já disparava: em **5 de 5 manhãs** (13, 14, 15, 16 e 18/08) o GESTAOLEILOES
falhou com "nada pronto" no **mesmo segundo de cron** em que CALIL e VEGAS gravaram `sem_cota`
(09:39:33 · :34 · :35 hoje), enquanto as coletas da tarde passaram (13/08 → 110 lotes, 16/08 →
130). A recusa vem do teto **global** (475/450), não da sub-cota `gestao` (30/150) — por isso
atinge os três juntos.

O acervo nunca correu risco: coleta zerada não dispara o sweep destrutivo. O custo era o alerta
mentiroso, que manda consertar parser intacto — o modo de falha que o próprio comentário do
monitor descreve: *"é como um alerta ruidoso vira alerta ignorado"*.

### O conserto
- `scripts/scraper-gestao.mjs` migrado para `buscarViaBrightData`, com `ErroBrightData` capturado
  em `bd()`. Continua devolvendo `null` ao chamador **de propósito** — deixar a exceção subir
  mataria a execução antes de gravar `fonte_saude` e sumiria a fonte do monitor, que é o buraco
  que o `scraper-rj` pagou em 11/08. O que mudou é que o MOTIVO não se perde mais no caminho.
- O sinal chega aos dois pontos que gravam saúde: no zero vira `status = 'sem_cota'`, e na coleta
  **parcial** (cota estourada no meio) suprime a acusação de regressão sem mascarar o total.
- `exitCode = 1` **fica nos dois casos**: "não coletei" é verdade em ambos, e sair com 0 seria o
  check verde sobre acervo parado de 11/08. Quem separa as duas ações é o status, não o exit.
- Arquivo REMOVIDO da linha de base de `padroes-perigosos.baseline.json`.
- A consulta do item 2 do CLAUDE.md ganhou `and u.status <> 'sem_cota'` com o aviso de não remover.

### Como foi verificado (e o que ainda não está provado)
A trava foi testada nas DUAS direções — reprova o import antigo, passa no novo — porque lint que
só passa não prova proteção. Os nomes importados foram carregados de verdade (o `ReferenceError`
que quase escapou ontem não sai no `node --check`). E `registrarSaude` foi exercitada com um
Supabase falso em 4 casos, **dois deles controles negativos**: zero sem cota continua `falhou`, e
queda sem o sinal continua `degradado`. O conserto não mascara falha real.

⚠️ **O que continua sendo hipótese:** a causa do zero do GESTAOLEILOES é inferida da coincidência
de 5/5 e do teto global — não vi o log da execução. A consulta corrigida ainda o mostra, com
`status = 'falhou'`, porque aquela linha é de ANTES do conserto. **A próxima coleta matinal decide:**
se vier `sem_cota`, era orçamento e o alerta some; se vier `falhou` de novo, a fonte está quebrada
de verdade e aí é achado novo. O conserto transformou a suposição em medição — não a confirmou.

---

## 🧾 18/08 — FECHAMENTO DA SESSÃO (alertas, o que converge sozinho, o que depende do dono)

### A sessão em uma frase
Dezoito consertos, todos da MESMA família: **ausência entregue como medição**. O que mudou hoje
não foi a quantidade de bugs achados — foi o lugar onde eles foram achados. Nenhum dos seis
piores apareceu em varredura de código; todos apareceram no **rastro que deixaram no banco**.

### Os alertas — o que EU resolvi hoje
| Invariante | Antes | Agora | Como |
|---|---|---|---|
| `uf_cef_congelada` | 1 (RJ, 12 dias) | **0** | causa-raiz do 21000 (trigger `BEFORE` fazendo `update` na própria tabela) + upsert em blocos com bisseção |
| `doc_link_sem_documento` | 6 | **0** | `nomeiaUmDocumento()` + limpeza de 12 linhas |
| `bem_movel_no_acervo` | 3 | **0** | gate ancorado no título, com sinal imobiliário — 0 falso-positivo em 31.049 lotes |
| `pino_generico_como_rua` | 99 | **0** | `demover_pinos_genericos()` na limpeza diária (o trigger não convergia sozinho — eu tinha ASSUMIDO que sim) |
| `edital_eq_matricula` | 6 | **0** | limpo + `trg_flagrar_edital_suspeito` armado para nomear o culpado na próxima |
| `reuniao_solicitada_parada` | 3 | **0** | conta interna não é cliente esperando |
| `documentos_fila` (70% "erro") | 177 erros | **177 `sem_documento`** | "olhei e não tinha" virou estado terminal, não falha retentada 4× |

Além disso, enfileirei as matrículas nunca lidas por trás de `relatorio_area_nao_confirmada`:
**8 lotes CEF** em `cef_matricula_fila` e **1 WEBLEILOES** em `documentos_fila` (2 já estavam
na fila). Quando lerem, a área passa a ser confirmada em documento, não declarada pelo anúncio.

### Os alertas que CONVERGEM SOZINHOS — e a data
Estes não precisam de ninguém. Estão listados para que ninguém os "conserte" à toa:
- **`cadastro_barrado` (8/7)** — janela móvel de 7 dias. Sai sozinho em **19/08**.
- **`bd_teto_saturado` (457/450)** e **`limpeza_encerrados_pulada` (1, PECINI)** — os dois são o
  MESMO fato: a semana do Bright Data saturou. Ela vira em **24/08** e ambos zeram. A limpeza da
  PECINI foi pulada porque o teto recusou a leitura, não porque a fonte esteja ruim.
- **`lote_sem_area_nem_matricula` (457/400)** — o backfill ampliado hoje passa a alcançá-los sem
  UMA requisição a mais. Cai a cada rodada diária.

### O que NÃO converge sozinho — depende de um clique do dono (ver lista de amanhã)
`analise_sem_mercadologico` (5/4) e `laudo_sem_base` (1/0) são **o mesmo lote**. Confirmei que a
retenção está CERTA em mantê-lo (`ativo = true`, sem nenhuma data de praça — não é órfão), e que
`regenerar-relatorios-cron` **não vai pegá-lo**: a janela é de 72 h e o relatório é de 31/07.
Não consigo disparar daqui (o sandbox não alcança produção — `curl` para o domínio devolve 000).
Um clique em **Gerar** zera os dois.

### As travas que nasceram hoje (custo zero, sem IA)
- `sweep-apoiado-no-coletado` em `verificar:padroes` — pega varredura destrutiva apoiada no que
  foi COLETADO em vez do que foi GRAVADO. **A primeira versão dessa trava passou verde nas duas
  versões defeituosas do código**: ela testava o arquivo inteiro, e um `console.log` dez linhas
  adiante a desarmava. A versão que ficou testa a condição do `if` que envolve a varredura, e foi
  conferida contra o código ANTES e DEPOIS do conserto.
- Invariantes novos: `doc_link_sem_documento`, `bem_movel_no_acervo`, `uf_cef_congelada`,
  `limpeza_encerrados_pulada`, `lote_sem_area_nem_matricula`, `edital_eq_matricula`.

### Duas coisas que EU errei hoje, registradas para não repetir
1. **Assumi convergência em vez de medir.** Tirei o `update` do trigger e afirmei que a regra
   convergiria "porque a coleta reescreve todas". O trigger retorna cedo quando nada muda:
   `pino_generico_como_rua` foi de 0 a 99 em minutos. Regra: **quem afirma que converge, mede.**
2. **Chamei desconhecido de diagnóstico.** O detector de bisseção rotulava como *colisão* qualquer
   "bloco falhou, metades passaram" — o que também descreve falha transitória. Depois do conserto
   do trigger, 19 blocos viraram 1, e eu persegui esse 1 à toa. Agora ele lê a mensagem do banco.

### Agendamentos armados ao encerrar
- **Hoje 12:00 UTC** — PECINI, fila de 5, teto 520.
- **Segunda 24/08 15:00 UTC** — PECINI `alvo=antigos`, teto 520 (relê o já capturado, mais
  desatualizado primeiro — é o que traz metragem e matrícula dos lotes de julho).

⚠️ **Medido ao encerrar, e a primeira leitura estava errada.** Com o teto PADRÃO (500) o freio
recusa: `usado_total 457 · reservado para outros 43 · motivo reservado_para_outros`. Foi isso que
eu vi primeiro, e quase registrei como "os disparos de hoje serão recusados". **Não serão**: os
dois triggers passam `teto_semana=520`, que é o número que o dono já escolheu, e com 520 o freio
responde `permitido: true`. O que estava errado não era o freio nem o agendamento — era eu ter
medido com um teto que os disparos não usam.

⚠️ **E a checagem cobrou um request.** `registrar_uso_brightdata` é **reserva atômica**: ela
CONCEDE ao responder, não simula. Usei-a como sonda e o ledger da PECINI ficou em
`requests 69 · sucessos 68` — uma permissão concedida e nunca gasta. No fornecedor não custou
nada (nenhum fetch saiu); custou uma unidade do NOSSO teto. Deixei como está, porque corrigir o
ledger à mão seria pior que o +1 honesto. **Para conferir cota sem gastar, leia
`brightdata_uso_proposito` e `brightdata_reserva` — nunca chame a função de reserva.**

---

## 🧾 18/08 — VARREDURA FINAL DA LISTA (itens 6, 8, 10, 13 e a fila de reunião)

### 6. `edital_eq_matricula` — instrumentado, causa ainda desconhecida
Eliminei por leitura de código TODOS os escritores de `link_edital`: `scripts/scraper.js`
(grava `linkDetalhe`, que é guardado contra PDF de matrícula), `captura-matricula-cef` e
`backfill-edital-cef` (ambos com `EXCLUI /editais/matricula/` nas DUAS saídas — conferido),
`enriquecer-lote` (só grava se estiver vazio) e `reativar_imoveis_cef` (só mexe em `ativo`).
E o INSERT não podia ter produzido aquilo: `url_lote` das linhas afetadas usa `hdnimovel`, que
só vem do CSV, e nesse caminho `link_edital` recebe o MESMO valor.

Parei de teorizar — foi o que me custou tempo na colisão do upsert — e instrumentei: trigger
`trg_flagrar_edital_suspeito` + tabela `edital_suspeito_log` registram operação, autor
(`session_user`), `application_name` e valores quando `link_edital` VIRA um PDF de matrícula.
Testado em transação com rollback: capturou `UPDATE / postgres`. **A próxima ocorrência diz
quem foi.**

### 8. Os 457 sem área nem matrícula — o backfill não os alcançava
416 nunca tinham sido enriquecidos porque `enriquecer-backfill-cron` só mirava quem faltava
DATA. A metragem mora na MESMA página que ele já baixa: filtro ampliado e extração de área +
descrição do html já em mãos — **zero requisição a mais** nos lotes que ele já visitaria. A
descrição só substitui quando é ECO DO TÍTULO; texto que já diz algo nunca é sobrescrito.
BIASI 225 · SUPERBID 143 · PECINI 24 · SOLD 20 · LJUD 13.

### 10. Os dois invariantes de relatório
`relatorio_yield_sem_x100` (1): relatório de 31/07 com `yieldBruto = 0,05` — a razão, sem o
×100. O código calcula no servidor desde 14/08, então é legado. **NÃO multipliquei por 100**:
`valorEstimadoImovel` está ZERADO no relatório, o número não é recalculável a partir dele, e
multiplicar seria afirmar o que não dá para conferir. Marcado como `erro` para regeração.

`relatorio_area_nao_confirmada` (16): **não é número mentindo**. A tela já declara "conforme o
anúncio do leiloeiro — não confirmada na matrícula". É lacuna divulgada.

**E aí veio o achado maior:** `documentos_fila` com 177 erros contra 75 ok (70%), TODOS
`nenhum_documento_encontrado`. Não é fila quebrada — a exceção só é lançada DEPOIS de a página
carregar e ser varrida (o anti-bot já foi tratado; quando barra, o Bright Data assume). **É
medição, não falha.** Arquivada como erro, era retentada 4× para reaprender a mesma coisa e
afogava falha de verdade na contagem. Virou estado terminal `sem_documento`, com negative-cache
imediato. 177 linhas reclassificadas.

### 13. Backlog das entidades HTML — de 28 para 12
Fechados os que ainda decidiam valor: `enriquecer-lote` (`extrairAvaliacao`, serve TODAS as
fontes), `scraper-core` (título do `<h1>`), `scraper.js` (título dos cards, 4 coletores),
`scraper-leiloeiros` (descrição do Superbid), `scraper-rj`, `scraper-soleon` (CALIL/VEGAS/
TORRES3) e `scraper-gestao`. O que sobra é ruído de comentário ou caminho que não decide valor.

**O lint salvou um erro meu:** os imports de `decodificarEntidades` não entraram nos três
scrapers — minha condição testava se o nome do módulo aparecia no arquivo, e ele aparecia num
COMENTÁRIO que eu tinha acabado de escrever. Seria `ReferenceError` no primeiro lote. Os cinco
módulos foram CARREGADOS de verdade depois, não só lintados.

### Fila de reunião: conta interna não é cliente esperando
Os 3 pedidos parados eram do PRÓPRIO DONO (`role = admin`), de 01 e 05/07, testando a tela.
Mesmo defeito da retenção que "nudava o admin". O invariante passou a ignorar conta interna.

**O que NÃO mascarei:** `analise_sem_mercadologico` (5) e `laudo_sem_base` (1) subiram por
causa minha, ao invalidar o relatório de 31/07. Eles medem INTEGRIDADE, não atendimento —
excluir conta interna ali esconderia bug real que aparecesse primeiro num teste. O lote é do
dono; regerar o mercadológico zera os dois.

---

## 🧾 18/08 — DOIS GATES QUE OLHAVAM O NÚMERO ERRADO (limpeza de encerrados + cadastro)

### 9. A limpeza de encerrados: um teto que se alimentava do próprio erro

`desativar_imoveis_leiloeiro_stale` pulava a fonte quando os candidatos passavam de 40% do
acervo. **Esse teto se alimenta do próprio erro:** fonte que fica para trás acumula lotes não
vistos, o reap cresce, o teto trava com mais força, e ela nunca se recupera. VIP travada em 61%
e PECINI em 77% — nenhuma das duas jamais teve UM lote encerrado removido.

A prova de que era a guarda e não a coleta: **a VIP coletou 42–63 lotes todo dia nos últimos 17
dias**, com o acervo parado em 99. A coleta estava saudável o tempo todo; o acervo é que estava
inflado por lotes que saíram do site entre 13 e 14/08 — todos com `data_leilao` nulo, então a
varredura de leilão encerrado também não os alcançava.

O gate deixou de perguntar *"quanto eu removeria?"* (relativo ao acervo, logo contaminado) e
passou a perguntar **"a última coleta veio saudável?"**, contra o piso APRENDIDO da própria
fonte. Sem baseline não desativa nada — silêncio não autoriza. Simulado em todas as fontes antes
de aplicar: VIP 60, CALIL 34 (que já limpava), **0 nas outras 20**, RJLEILOES e TOTALLEILOES
pulados por falta de baseline. Executado: 94. VIP 99→39, CALIL 129→95.

`fontes_com_limpeza_pulada()` reescrita junto — **invariante que descreve regra revogada é pior
que invariante nenhum**.

**PECINI ficou de fora por motivo estrutural** e foi resolvida por outro caminho: o coletor dela
visita 4–6 lotes por rodada de propósito (cota), então o total COLETADO nunca descreve o que o
site tem. A resposta vem da ENUMERAÇÃO do sitemap — 52 lotes em 1 requisição, sem visitar nada.
Lote ativo que o sitemap não lista saiu do site: isso é medição, não silêncio. O piso da
enumeração ficou ABSOLUTO (40) e está anotado como dívida consciente — `fonte_baseline_aprendida`
aprende do total coletado, e misturar as duas medidas corromperia ambas.

### 11. O conserto do cadastro foi aplicado numa cópia e não na outra

Os 8 eventos de `cadastro_barrado` são todos a mesma causa (senha fora da regra) e todos
ANTERIORES ao conserto: 12/08 cinco tentativas em 2m16s **da mesma pessoa**, 13/08 duas, 15/08
às 02:57. As correções do `Login.jsx` entraram em 15/08 às 10:38 e 12:04. Zero falhas desde
então — o alarme é artefato da janela de 7 dias.

Mas a pergunta rendeu: **o conserto não foi aplicado ao `Checkout.jsx`**. Lá o checklist existe
e os três botões de criar conta eram desabilitados só por `suLoading` — a pessoa via o que
faltava, clicava assim mesmo e tomava o erro. No funil PAGANTE.

Causa de fundo: o regex estava copiado em CINCO lugares do front e a lista de requisitos em
outros três. **Cópia que não recebe o conserto é a que sangra.** Agora `src/lib/senha.js` tem
uma definição só, e `requisitosSenha()` devolve a MESMA lista que a validação aplica — checklist
e regra não podem divergir. O servidor mantém a sua checagem: front é conveniência, servidor é
garantia.

**Bug que eu mesmo introduzi no caminho, para o registro:** ao trocar o `const senhaForte` local
(booleano) pela função importada de mesmo nome, três usos em `RedefinirSenha.jsx` passaram a
testar a FUNÇÃO — sempre truthy. O rótulo ficaria "Forte" para qualquer senha e o botão nunca
travaria. `eslint --quiet` não pega: é código válido. Só apareceu porque reli as linhas que
tinha tocado.

---

## 🧾 18/08 — O GATE DE "ISTO É IMÓVEL?" (bem móvel fora do acervo)

Havia um CARRO ativo na plataforma de imóveis: `pecini_10532`, *"VW/SAVEIRO CL 1.6 MI / CL/ C
1.6 Aeronaves em leilão"*. Os coletores aceitam tudo que a fonte enumera (o sitemap da PECINI
lista veículos) e `inferirTipo` só o classificava como `'outros'` — não existia gate perguntando
se o LOTE é um imóvel.

**Censo completo (31.049 ativos).** Três bens móveis, três fontes:

| fonte | título | valor | `tipo` gravado |
|---|---|---|---|
| VIP | Honda/CG 150 Titan KS, Ano 2007 | R$ 7.652 | `imovel` |
| GRUPOLANCE | Veículo LR Evoque Pure P5D, 2011/2012 | R$ 96.763 | **`casa`** |
| PECINI | VW/SAVEIRO CL 1.6 MI | R$ 15.473 | `outros` |

No caso GRUPOLANCE a URL do próprio leiloeiro é `/imoveis/casas/sp/…` — ele também errou.

**O QUE O CENSO EVITOU, e é o ponto.** Uma regra por PALAVRA SOLTA acusaria 19 lotes, e 16 são
IMÓVEIS DE VERDADE: `Terreno 480 m² … Furnas IATE Clube` (condomínio), `Apartamento — JOIAS DE
SANTA BARBARA` (empreendimento, 12 lotes CEF), `Casa — BALNEARIO JOIA` (bairro), `Garagem para
quatro VEÍCULOS, do Edifício` (**vaga de garagem é imóvel**) e dois apartamentos da SODRE que
citam "veículo" na descrição. **Barrar 16 imóveis reais para pegar 3 carros seria estrago maior
que o problema.**

A regra tem duas partes: (a) sinal de móvel ANCORADO NO TÍTULO — começa com "Veículo", categoria
de móvel, marca com barra (`VW/`, `Honda/`) ou par de anos (`2011/2012`); menção no meio da
descrição não conta; (b) ausência de sinal IMOBILIÁRIO em título+descrição — se fala de
apartamento, casa, terreno, garagem, matrícula ou m², o lote FICA.

Conferida contra as 31.049 linhas ANTES de aplicar: 3 barrados, 3 corretos, 0 falso positivo.
Mais 9 casos sintéticos: 9/9. Mora no BANCO (trigger), como a fração ideal e pelo mesmo motivo —
gate em JS pega só quem passa por ele. **Sem cópia em JavaScript, de propósito: uma definição
só.** Regra em `regra_negocio`; `auditoria_regras_negocio()` acusou minha própria regra como
ÓRFÃ até a função citar a chave `acervo.bem_movel` no corpo — o vínculo é verificado contra o
CORPO, não contra a intenção. Invariante `bem_movel_no_acervo`, limite 0.

### E o invariante do pino genérico pegou o MEU erro, minutos depois

Ao tirar o `update` de dentro do trigger (item anterior), escrevi que a regra convergiria
sozinha: *"a linha irmã se rebaixa quando for escrita, e a coleta reescreve todas"*. **Errado.**
O trigger tem early-return quando latitude/longitude/nível/endereço vêm IGUAIS — o caso da
recoleta rotineira. A irmã nunca reavalia. `pino_generico_como_rua` foi de 0 → 99 na coleta
seguinte.

**O registro de método vale mais que o conserto:** eu havia CONFERIDO que a regra ainda funciona
(escrever `'rua'` numa linha em conflito devolve `'cidade'`) e o teste passou — porque escrever
MUDA o campo e desarma o early-return. *O teste provou o caminho que eu executei, não o que a
produção executa.* **Convergência assumida não é convergência medida.**

Conserto: `demover_pinos_genericos()`, varredura periódica fora de qualquer upsert, pendurada no
cron `limpar-imoveis-stale` (05h UTC). Invariante de volta a 0.

---

## 🧾 18/08 — A COLISÃO DO UPSERT: O TRIGGER ESCREVIA NA TABELA QUE ESTAVA SENDO UPSERTADA

Fechado. O `ON CONFLICT DO UPDATE command cannot affect row a second time` (21000) que derrubou
8.200 lotes da CEF/RJ e manteve o acervo 12 dias congelado **não vinha de chave duplicada**.

**Hipóteses eliminadas, na ordem em que caíram** — vale guardar a lista, porque cada uma parecia
óbvia na vez dela:
1. duplicata em `fonte+fonte_id` no payload → o dedup acusa ZERO;
2. `id` viajando no payload → não viaja;
3. outra UNIQUE servindo de árbitro → só há `(id)`, `(fonte_id)`, `(fonte, fonte_id)`;
4. trigger reescrevendo `fonte`/`fonte_id` → nenhum dos 11 toca essas colunas;
5. collation não-determinística → ambas são determinísticas.

**Causa real.** `trg_geocode_pino_generico` é BEFORE INSERT OR UPDATE em `imoveis_leilao` e, ao
detectar pino genérico (duas vias diferentes na MESMA coordenada), rodava
`update public.imoveis_leilao …` — **na própria tabela que o `INSERT … ON CONFLICT` estava
processando**. Com duas linhas do lote na mesma coordenada, a segunda já tinha sido tocada pelo
UPDATE do trigger da primeira, e o Postgres se recusa a afetar a mesma linha duas vezes na mesma
instrução. A colisão era do TRIGGER — por isso a bissecção via "colisão entre linhas" e todas
entravam quando separadas.

**Por que caiu justo no RJ:** é o estado com mais lotes empilhados na mesma coordenada — 5.106
linhas em 687 coordenadas (GO 1.139, SP 1.002). Em blocos de 500 o par é quase certo.

**E não é da CEF.** O trigger vale para TODAS as fontes: qualquer coletor que mandasse duas
linhas coincidentes no mesmo lote perdia o lote inteiro. Este era o item que valia atacar
primeiro justamente por isso.

**Reproduzido antes de consertar**, com duas linhas reais de `fonte_id` distintos que só
compartilham a coordenada → `sqlstate=21000`. Depois do conserto, a MESMA instrução passa.

Conserto: o trigger rebaixa SÓ A PRÓPRIA LINHA. A regra não se perde — a detecção não filtra por
`geocod_nivel`, então a linha irmã se rebaixa quando for escrita, e a coleta reescreve todas
(conferido: escrever `'rua'` numa linha em conflito devolve `'cidade'`). Passivo de 21 linhas
rebaixado de uma vez, fora de qualquer upsert.

Invariante `pino_generico_como_rua`, limite 25 e não 0 — há janela legítima entre o lote novo e a
próxima escrita da irmã. **Convergência que para de acontecer não dá erro**, só deixa pino
impreciso passando por preciso; é isso que o número vigia.

### A lição de método, que é maior que o bug

Duas ferramentas de diagnóstico foram escritas antes da resposta aparecer, e as duas foram
decisivas: a **bissecção** (que separou "linha ruim sozinha" de "colisão entre linhas" e provou
que não havia linha ruim) e a **reprodução em transação com rollback** (que transformou cinco
hipóteses plausíveis numa medição). Nenhuma leitura de código encontrou isto — o código está
correto em toda linha isolada; o que não fecha é a INTERAÇÃO entre um BEFORE trigger e o
`ON CONFLICT` que o chama.

---

## 🧾 18/08 — REVISÃO DO SETOR: O SWEEP QUE APAGA ACERVO OLHAVA O NÚMERO ERRADO

Pedido do dono: revisar por completo o setor dos defeitos da sessão, não por amostragem. A
varredura das famílias rendeu um achado NOVO e mais grave que todos os do dia.

### O achado: `lido × gravado`, agora com ação DESTRUTIVA

Em DOIS coletores o sweep que desativa "o que saiu do site" se apoiava no número de linhas
**baixadas**, não nas **gravadas**. Rodada que baixa 500 e falha em todos os upserts tem
`gravados = 0` e mesmo assim entrava no sweep — aposentando o acervo INTEIRO da fonte, porque
nada tinha `atualizado_em` novo.

| arquivo | fontes que servem | acervo em risco |
|---|---|---|
| `api/scraper-leiloeiros.js` | sold, superbid, mega, mgl, ccj, biasi, destak, ljud | LJUD 869 · SUPERBID 1.474 · MEGA 580 · BIASI 469 |
| `scripts/scraper-puppeteer.mjs` (canônico) | MEGA, SUPERBID, LJUD, GRUPOLANCE, ZUK, BIASI, PESTANA | o grosso do acervo fora da CEF |

No canônico era pior: `salvarImoveis` engolia o erro do upsert num `console.error` e não devolvia
nada. E o bloco do MEGA **reimplementava `salvarEFinalizar` inteiro**, por isso ficou de fora de
consertos anteriores — trocado por uma chamada à função compartilhada. *Duas cópias da mesma
regra divergem no primeiro ajuste, e a que fica para trás é a que apaga acervo.*

Agora os dois gates olham o gravado, e **coleta parcial nunca desativa**: se parte não gravou, os
lotes de fora seriam aposentados por falha nossa, não por terem saído do site.

### Nota de método: a primeira versão da trava não guardava nada

A trava `sweep-apoiado-no-coletado` que escrevi passou **verde nas duas versões defeituosas**.
Ela testava o arquivo inteiro, e um `console.log('… imóveis salvos')` a dez linhas de distância
desarmava a regra. É a própria família auditada, cometida dentro da ferramenta que a persegue.
A versão final testa a CONDIÇÃO do `if` que libera o sweep, ignora sweep por IDADE (90 dias) e
foi conferida contra o código ANTES e DEPOIS do conserto nos dois arquivos. **Trava nova só vale
depois de provada contra o defeito que ela diz pegar.**

### A biblioteca compartilhada tinha ficado para trás dos dois consertos de ontem

`scripts/lib/scraper-core.mjs` atende RJ, GESTAO, PECINI, SOLEON, SATO e o canônico:
- `extrairData` não decodificava — site que publica `Leil&atilde;o`/`pra&ccedil;a` não casa com
  âncora nenhuma e a função cai no fallback "primeira data futura do texto", que num portal é
  data de cadastro ou de outro lote. **Data errada com cara de certa.**
- O laço de âncoras aceitava qualquer href — `/preview/` rotulado "Matrícula" virava
  `link_matricula` NOT NULL. Agora passa por `nomeiaUmDocumento`.

### Dois flagrados benignos, anotados com `padrao-ok` e o motivo

- `api/scraper-caixa.js` — endpoint LEGADO (handler devolve 410 na 1ª linha, bloco inalcançável).
  Mas é o **pior código dos três**: DELETE FÍSICO, gate em `imoveis.length > 0`, retorno do
  upsert descartado, erro em `.catch(() => {})`. Só não faz estrago porque filtra `fonte=eq.caixa`
  e o acervo usa `'CEF'`. **Consertar só o nome da fonte o tornaria destrutivo.**
- `scripts/scraper-sato.mjs` — gate no coletado, mas o upsert faz `process.exit(1)` na 1ª falha.

### Efeito colateral da coleta do RJ, achado e limpo na mesma passada

`edital_eq_matricula` saltou para 166 (limite 8) — todos CEF/RJ, gravados na madrugada:
`link_edital` apontando para `/editais/matricula/RJ/*.pdf`, ou seja, o botão "Edital" abria a
matrícula. `url_lote` mostra que a linha nasceu com o link certo, então **algo sobrescreve
depois da inserção e não foi identificado**. Dado corrigido (`link_edital = url_lote`, 166
linhas); a causa fica em aberto e o invariante vigia — se voltar amanhã, é sinal de que o
escritor ainda está lá.

---

## 🧾 18/08 — CEF/RJ CONGELADO 12 DIAS, COM O RUN VERDE TODO DIA

Pedido do dono: *"ataca a CEF"*. O defeito era outro e maior do que o que eu tinha reportado.

**O RJ estava parado desde 05/08: 7.783 lotes ativos, um terço do acervo CEF**, servidos ao
cliente com preço e status de 12 dias atrás. O scraper diário rodava, terminava com sucesso e
imprimia `✅ Scraping concluído. 25407 imóveis processados` — número que INCLUÍA os 8.200 do RJ
que não entraram. A linha que explicava tudo estava no log, sozinha, entre dois estados:

```
CEF CSV RJ...
  CEF CSV RJ: 8200 imóveis, 8200 com foto
Erro ao salvar: ON CONFLICT DO UPDATE command cannot affect row a second time
CEF CSV MG...
```

**Causa-raiz:** o CSV da Caixa repete o mesmo `n do imovel` em algumas UFs. Upsert com duas
linhas de mesma chave faz o Postgres abortar o COMANDO INTEIRO (21000) — ele se recusa a
atualizar a mesma linha duas vezes na mesma instrução. Não é erro de UMA linha: é o estado
inteiro que não entra.

**Três defeitos empilhados**, e é a soma que dá 12 dias de silêncio:
1. o upsert morria por linha duplicada;
2. `salvarImoveis` fazia `return` mudo no erro e o laço seguia para a próxima UF;
3. `total += imoveis.length` somava o LIDO, não o GRAVADO — `fonte_saude` registrava 25.407 e
   status `ok` justamente no dia em que um terço não foi salvo.

O passo `Notify on failure` existia e nunca era alcançado: exit 0.

Consertos: dedup por `fonte+fonte_id` antes do upsert (com contagem de duplicadas no log),
`salvarImoveis` devolvendo `{salvos, erro}`, `fonte_saude` só `ok` se NENHUMA UF falhou, e exit 1
quando alguma UF não grava.

**Por que nenhuma varredura pegou.** `desativar_imoveis_cef_vencidos` compara cada lote com o
`max(atualizado_em)` do PRÓPRIO estado. Estado inteiro congelado deixa todos igualmente velhos e
nenhum vira candidato — **o estado parece perfeitamente consistente consigo mesmo**. A métrica é
relativa ao último scrape, então "não houve scrape" é invisível para ela. É a mesma família do
teto do Bright Data e da limpeza pulada: *a régua é relativa ao próprio evento que falhou.*

Invariante novo `uf_cef_congelada` compara a UF com o último scrape da FONTE. Acusou RJ com
286,4 h (11,9 dias).

### RESULTADO: RJ DESCONGELADO — e o diagnóstico que sobrou aberto

O dedup por `fonte+fonte_id` **não resolveu**: a coleta seguinte acusou ZERO duplicadas e morreu
com o mesmo 21000. Minha hipótese da chave estava errada, e daqui não dá para baixar o CSV da
Caixa (o proxy bloqueia o domínio) para olhar o dado bruto.

Em vez de uma terceira adivinhação, o código passou a RESPONDER: upsert em blocos de 500, e
bloco que falha parte no meio até isolar. A bissecção separa dois diagnósticos que saíam iguais —
*linha ruim sozinha* (lote de 1 que falha) versus *duas linhas que colidem entre si* (lote falha,
as duas metades passam).

**Rodada de 18/08 00:34 — `alvo` RJ, com o conserto:**

| | antes | depois |
|---|---|---|
| RJ ativos | 7.783 | **8.575** |
| último scrape do RJ | 05/08 | **18/08 00:35** |
| gravados | 0 | **8.200** |
| `uf_cef_congelada` | RJ, 286,4 h | **vazio** |
| CEF ativos (total) | 23.870 | 24.662 |

Ainda 1.017 lotes reativados (voltaram ao CSV e estavam `ativo=false`).

**O diagnóstico foi COLISÃO ENTRE LINHAS, em 19 blocos** — não há linha ruim; separadas, todas
as 8.200 entram. Os intervalos que a bissecção registrou se aninham terminando sempre nos mesmos
ids, o que aponta os envolvidos:

```
125 linha(s) — cef_1555510299037 … cef_1444403961591
250 linha(s) — cef_8444426361009 … cef_1444403961591
 16 linha(s) — cef_8787701708291 … cef_8787701378780
 31 linha(s) — cef_8555539071806 … cef_8787701378780
 62 linha(s) — cef_8787701927082 … cef_8787701378780
```

**O QUE FICA ABERTO, e não é para varrer para baixo do tapete:** *por que* duas linhas com
`fonte_id` distintos colidem no árbitro `(fonte, fonte_id)` continua **sem explicação**. Checado e
descartado: não há duplicata em `fonte+fonte_id` (o dedup acusa 0); os quatro ids acima são linhas
distintas e todas gravaram; o payload não carrega a coluna `id`; `dedup_chave` é removido antes do
upsert; as três únicas UNIQUE da tabela são `(id)`, `(fonte_id)` e `(fonte, fonte_id)`. Sobra
investigar os 11 triggers BEFORE INSERT/UPDATE — se algum reescrever `fonte`/`fonte_id`, o
conflito é avaliado DEPOIS deles, e aí duas linhas distintas na entrada viram a mesma na hora do
árbitro. **É por aí que a próxima sessão deve começar**, com os intervalos acima.

O efeito está mitigado (nenhuma linha derruba as outras) e instrumentado (o log nomeia o caso a
cada rodada). Mas mitigado não é entendido, e a distinção importa: se a causa for um trigger,
ela vale para TODAS as fontes, não só a CEF.

### CORREÇÃO DE UM NÚMERO MEU (17/08)

Reportei *"CEF: 2.206 lotes ativos com a última praça vencida"* como defeito. **Não é.** São
lotes de VENDA DIRETA, onde a data é vestigial e a venda é contínua — `leilao_ja_encerrado` os
exclui de propósito. E os 559 extrajudiciais com 1ª praça passada têm TODOS a 2ª praça no futuro,
ou seja, corretamente ativos. Apliquei a regra de leilão a quem não é leilão — exatamente o tipo
de erro que este documento existe para evitar em terceiros.

---

## 🧾 18/08 — A LIMPEZA DE LOTES ENCERRADOS É PULADA EM SILÊNCIO

Pergunta do dono: *"os 28 fora do sitemap, verifica se ainda estão ativos"*. Estão — e não por
descuido pontual. **Não são 28, são 58**, e a rotina que existe para desativá-los é
sistematicamente pulada.

`desativar_imoveis_leiloeiro_stale` (cron `limpar-imoveis-stale`, 05h UTC) pega, por fonte, o
ÚLTIMO scrape (`max(atualizado_em)`) e marca como candidato todo lote ativo não tocado nas 36h
anteriores a ele — *"não veio no último scrape, logo saiu do site"*. Se os candidatos passarem de
**40%** do acervo da fonte, ela **PULA**: guarda anti-regressão, para um scrape degradado não
zerar uma fonte inteira.

**O que a guarda não distingue: scrape DEGRADADO de scrape PARCIAL POR DESENHO.** O scraper da
PECINI visita só os lotes NOVOS — 4 a 6 por rodada — então todo o resto fica "não visto" por
construção. Medido em 18/08:

| fonte | candidatos / acervo | % | desfecho |
|---|---|---|---|
| PECINI | 58 / 75 | **77,3%** | PULADA (e assim toda vez) |
| VIP | 61 / 100 | **61,0%** | PULADA — medido hoje, não é projeção |
| CALIL | 34 / 129 | 26,4% | limpa normalmente (faz passada completa) |

Quanto MENOS completa é a passada do scraper, mais a limpeza é pulada — o contrário do que a
fonte precisa. E a função já devolve `fontes_puladas` no JSON desde que existe: o cron loga e
**ninguém lê**. Uma fonte pode passar meses sem ter um único lote encerrado removido, sem uma
linha de alerta em lugar nenhum.

Novo invariante `limpeza_encerrados_pulada` (limite 0) + função `fontes_com_limpeza_pulada()`,
aplicados. Hoje acusa 2. A função OMITE de propósito a cláusula `max(atualizado_em) < now() - 2h`
da original: aquilo é janela de execução, não critério de saúde, e mantê-la faz a fonte
recém-coletada sumir do diagnóstico logo depois de rodar — foi assim que a PECINI escapou da
primeira medição.

**O que este achado NÃO autoriza: desativar os 58.** Eles não foram vistos e recusados pelo site
— eles **não foram olhados**. Marcar como encerrado o que nunca foi verificado é afirmar uma
medição que não houve. A resposta de verdade vem da passada COMPLETA já agendada para 24/08
(`PECINI_ALVO=antigos`): depois dela, quem não voltou é que sumiu de fato.

### O susto que não era: 80 → 75 ativos na PECINI

Entre 23h52 e 00h12 a PECINI perdeu 5 ativos e eu quase reportei sumiço de linha. Não houve: os
5 são lotes com `data_leilao = 2026-08-17` desativados quando o dia virou — a varredura de leilão
encerrado fazendo o trabalho dela. Some da vista porque a desativação **não toca `atualizado_em`**
e não existe coluna `desativado_em`: o acervo não guarda QUANDO nem POR QUE um lote foi desativado.
Isso é um buraco de auditoria de verdade, e é o motivo de eu ter levado quatro consultas para
descobrir algo que deveria ser uma leitura.

### Dois achados de acervo, de brinde

- **`pecini_10532` é um carro.** Título: *"VW/SAVEIRO CL 1.6 MI — Aeronaves em leilão"*, ativo,
  numa plataforma de imóveis. O sitemap da PECINI lista veículos e o scraper aceita tudo que
  vem; `inferirTipo` só o classifica como `outros`. Não há gate de "isto é imóvel?".
- **CEF: 2.206 lotes ativos com a última praça já vencida**, o mais antigo de 13/07. Fora do
  escopo desta pergunta, mas é a maior ocorrência do acervo e a CEF é justamente a fonte que o
  sweep de leiloeiro exclui (`fonte not in ('CEF',…)`) — ela tem o caminho próprio
  (`desativar_imoveis_cef_vencidos`), que evidentemente não está dando conta.

---

## 🧾 17/08 (madrugada) — O LANCE ESTAVA NA PÁGINA, NUMA FORMA QUE NADA AQUI LIA

Fechamento dos dois itens que a coleta da PECINI deixou abertos.

### A. Os 10 lotes perdidos por `valor_minimo = 0` — recon, não palpite

O caminho barato aqui **não era alargar o regex no escuro**. O modo `PECINI_DEBUG=1` existe para
descobrir os rótulos reais sem acesso ao site (o proxy daqui bloqueia o Pecini), só que estava
limitado aos **3 primeiros** lotes — e os primeiros a passar são os que deram certo. Agora o dump
sai **sempre que o lance não foi lido**, que é a única página com algo a ensinar.

Um dry-run com debug (14 lotes, ~15 requests, zero gravação) devolveu a resposta, idêntica nos 7:

```
26. Lances Iniciais : 1&ordm; Leil&atilde;o: R$ 25.789,00
                      2&ordm; Leil&atilde;o: R$ 15.473,40
```

**Duas causas empilhadas** — por isso nenhuma tentativa isolada teria funcionado:

1. O texto contra o qual os regexes rodam só decodificava `&nbsp;`. Nem `1º` nem `Leilão`
   **existem** nesse texto: há `1&ordm;` e `Leil&atilde;o`. É a **terceira vez no dia** que a
   mesma entidade não decodificada aparece com outra roupa — rótulo de anexo (a matrícula),
   descrição do corpo, e agora o lance.
2. O regex exigia `"Público Leilão"` e a fonte escreve só `"1º Leilão:"`. Mesmo com o texto
   decodificado, o rótulo não casaria.

Conserto: `txt` passa por `decodificarEntidades`, e o rótulo da praça exige o **ordinal**
(1º/2º/1ª/2ª) OU a palavra "Público" antes de "Leilão" — um `"Leilão:"` solto aparece em menu e
em texto corrido, e aceitá-lo transformaria qualquer `R$` da página em lance. Conferido contra as
7 strings reais do recon + 3 casos de ruído (menu, "Faixa de Preço", formato antigo).

Dois dos 10 agora caem em `DESCARTADO(fracao_ideal)` em vez de `(valor)` — é o gate certo,
alcançado pela descrição de corpo que passou a ser lida hoje. Regra de negócio funcionando, não
perda.

**Nota de método que vale guardar:** `min R$0` produzia `desconto_percentual = 100` e
`score_viabilidade = 100` — o lote mais atraente do acervo, fabricado por não ter lido o preço.
Não chegou a acontecer: `checarQualidade` descarta sem `valor_minimo`, e a varredura completa
confirma **0 lotes ativos** com `valor_minimo = 0` e `valor_avaliacao > 0` em TODAS as fontes. O
gate é a única coisa entre esse cálculo e o cliente — não afrouxar.

### A2. Resultado da coleta com o conserto (23:51) — e um terceiro achado no caminho

`6 prontos · 1 descartado · 10 sem detalhe`, contra os 4/10/7 de antes. Os lotes que estavam
perdidos entraram com preço:

| lote | avaliação | lance (menor praça) | desconto |
|---|---|---|---|
| 10499 Campinas | 471.263,27 | **235.631,64** | 50% |
| 10531 Guarulhos | 704.132,49 | **649.804,17** | 8% |
| 10478 Limeira | 561.030,90 | **336.618,54** | 40% |
| 10544 Pereira Barreto | 119.326,04 | **68.412,22** | 43% |

Acervo PECINI: **74 → 80 ativos**. 10531 e 10544 não tinham rótulo de Avaliação nenhum — a
avaliação veio da 1ª praça, como a regra manda.

**O terceiro achado.** Os 5 últimos lotes saíram com `- 10511: detalhe não veio (teto BD?)`.
Com interrogação, porque o scraper NÃO SABIA: `fetchViaBrightData` engole o `ErroBrightData` e
devolve `null` igual para recusa de orçamento e para falha de rede. O ledger sabia:
**457 de 500 usados, 43 ainda reservados para o RJ** → `reservado_para_outros`. O freio agindo
exatamente como projetado, e o log adivinhando.

É a forma 5 do CLAUDE.md ("o freio de custo entregue como conteúdo") no seu formato mais brando —
não virou dado falso porque `bd()` é fallback e o gate exige linha no acervo. Mas foi essa mesma
indistinção que escondeu 4 semanas de saturação em agosto. Agora `bd()` usa
`buscarViaBrightData` num try/catch: o chamador continua vendo `null`, o log diz
`RECUSADO PELO FREIO DE CUSTO: reservado_para_outros (…)`, o laço PARA em vez de repetir a
recusa lote a lote, e `fonte_saude` grava `sem cota: <motivo>` em vez de "nada pronto".

Os 5 lotes seguem como `novos` e entram na próxima rodada — nada se perdeu.

### B. `bd_teto_saturado` mirava num número que se moveu

Comparava contra o literal **405** (90% de 450). Desde ontem o teto é parâmetro de disparo (500 na
última rodada) e o banco não tinha onde lê-lo: 429 requests acusando "perto do teto" contra um
teto que era 500. Um alarme que dispara sem motivo é um alarme que se aprende a ignorar.

O número existia — `registrar_uso_brightdata(p_teto, …)` recebe o teto em toda chamada, decide com
ele e joga fora. Agora grava em `brightdata_uso.teto` e o invariante compara contra 90% dele; sem
teto na linha (semanas anteriores) cai no 450 histórico e o limite continua 405. Hoje: **429/450 =
ok**. O teto gravado é o da ÚLTIMA chamada permitida, não o maior já usado — o que interessa ao
alarme é o teto que a PRÓXIMA chamada vai encontrar.

---

## 🧾 17/08 (noite) — A MATRÍCULA "VEIO" APONTANDO PARA UMA PASTA VAZIA

Coleta da PECINI disparada com o teto do Bright Data em 500. **Rodou de verdade** — sem recusa de
cota: 52 lotes no sitemap, 31 já no banco, 21 novos processados → **4 gravados**, 10 descartados
por valor, 7 páginas sem lote. 40 s de execução, e o tempo curto é o normal para 21 páginas.

**E a matrícula NÃO veio.** Ela foi *reconhecida* pela primeira vez — o conserto da tarde
(decodificar entidades antes de classificar o rótulo) fez o link `Matr&#xED;cula` finalmente
casar. Só que o href é `https://www.pecinileiloes.com.br/preview/`: **a rota que serve os
documentos, sem o arquivo**. Os editais da MESMA página vêm completos (`/preview/<uuid>.pdf`).

`link_matricula` ficou NOT NULL nos 4, a ficha anunciaria "matrícula disponível", e quem
clicasse cairia numa pasta vazia. É a forma da casa — **ausência entregue como presença** —
migrada do campo de TEXTO para o campo de LINK. Sem erro em lugar nenhum: a coleta gravou com
sucesso um endereço que não leva a documento algum.

**Varredura completa (não amostra):** 6 âncoras assim entre os 30.446 ativos — 4 matrículas
PECINI e 2 editais SODRE (que apontavam para a própria página do lote com `#`). Mais 6 em lotes
encerrados. Os outros 27.896 links de matrícula nomeiam arquivo ou id.

Conserto: `nomeiaUmDocumento()` em `api/_doc-scan.js` (vale para TODAS as fontes, é o vasculhador
do `enriquecer-lote`) — documento é identificado por segmento final de caminho ou por query
string; caminho terminado em `/` sem query é a rota. Mesma regra na 2ª passada do
`scraper-pecini.mjs`, que antes de descartar tenta recuperar o id de um atributo da própria
âncora. Invariante `doc_link_sem_documento` (limite 0) aplicado; hoje em 0/0.

**No mesmo caminho:** `decodificarEntidades` só tratava entidade NUMÉRICA. As nomeadas passavam
cruas — a 1ª descrição de corpo da PECINI entrou com `im&oacute;vel` e `&aacute;rea`. A que morde
de verdade é **`m&sup2;`**, a forma HTML mais comum de m²: sem decodificar, `extrairAreaM2` não
enxerga a unidade e a área que ESTÁ na página sai 0, sem erro. Hoje o acervo tem 0 ocorrências de
`&sup2;` gravado — é endurecimento antes de espalhar, não conserto de dano medido.

### O que a coleta expôs e ainda está aberto

- **10 de 21 lotes novos descartados por VALOR** — é a maior perda da PECINI hoje, maior que a
  área. Padrão no log: `aval R$471263 · min R$0` (3 lotes vieram `aval R$0 · min R$0`). O 2º lance
  não é lido para metade dos lotes, e sem ele o gate descarta. Próxima ofensiva da PECINI: o
  parser de praças, não o de metragem.
- **Área: 0 nos 4 gravados.** Num deles a descrição de corpo veio real ("Mede 9,00m de frente…
  21,00m da frente aos fundos") — dimensões sem m² declarado, então 0 ali é a resposta honesta,
  não falha. Nos outros 3 a meta tag institucional ainda prevaleceu (corpo sem sinal forte).
- **O lote de Sorocaba não foi tocado**: o scraper só processa lotes NOVOS. Os anexos dele ainda
  guardam o rótulo cru `Edital do Leil&#xE3;o`, prova de que não é relido desde antes do conserto.
  Zerei `enriquecido_em` em 12 lotes PECINI (Sorocaba incluído) — o freio de 12 h os prendia ao
  código antigo. A releitura acontece sozinha na próxima abertura da ficha, a 1 request cada.
- **`bd_teto_saturado` acusando 429 contra limite 405 fixo.** O teto real virou parâmetro de
  disparo (500 nesta rodada) e o banco não tem onde lê-lo — `brightdata_uso` não guarda `teto`.
  O alarme erra para o lado seguro (dispara cedo), mas está calibrado num número que se moveu.
  Conserto certo: a reserva gravar o teto vigente na semana.

---

## 🧾 17/08 — TRÊS ALARMES, E O ERRADO ERA O INSTRUMENTO NOS TRÊS

Dia de diagnóstico. Os três achados têm a mesma assinatura: **um número que media duas coisas
diferentes sob um nome só**. Nenhum apareceu em varredura de código — os três só existem no
rastro que deixaram no banco.

### A. Proximidades: o vazio não era do Overpass, era da coordenada

`proximidades_vazio_falso` subiu 924 → 987 → **1.075** em três dias. A causa não era "o Overpass
às vezes falha": era **quem ele atendia**. Por nível de geocode, nos lotes ativos:

| `geocod_nivel` | vazios | cheios |
|---|---|---|
| **endereco** | **0** | 13.077 |
| cidade | 1.035 | 1.488 |
| bairro | 272 | 776 |
| rua | 110 | 185 |

**Zero falso vazio onde a coordenada é precisa.** Os 1.417 vivem todos em coordenada imprecisa —
exatamente a população que `enriquecer-osm.mjs` recusava (`.eq('geocod_nivel','endereco')`) e que
sobrava para o Overpass público, o único caminho do sistema capaz de gravar `{}`.

E o vazio é **comprovadamente falso**, não propriedade do lugar: na MESMA coordenada, no MESMO
dia, o acervo tem os dois desfechos. `-23.5329,-46.6395` (centroide SP): **36 vazios × 55
cheios**. `-22.9129,-43.2003` (RJ): 33 × 78. Não existe leitura em que o centro de São Paulo não
tenha escola em 4 km — e a ficha **afirmava** a ausência.

Três defeitos estruturais que a corroboração de 3 observações não pegava:

1. **O contador não era zerado ao confirmar.** O lote voltava da revalidação de 30 dias já com 3,
   e o PRIMEIRO vazio dava 4 ≥ 3, reconfirmando na hora — a rotina que existe para CURAR o engano
   carimbava-o. 50 lotes com contador > 3, **dois em 26**: 23 reconfirmações sem uma única
   segunda opinião.
2. **As "3 execuções diferentes" não tinham espaçamento nem diversidade.** O cron roda a cada 15
   min: as 3 cabiam em 45 minutos, mesma janela de carga, sem exigir espelhos distintos. É o erro
   que o cabeçalho de `_proximidades.js` documenta ("corroboração instantânea não corrobora
   nada"), reintroduzido pela porta dos fundos — 45 minutos no lugar de 0 segundo.
3. **O on-demand alimentava o MESMO contador sem espaçamento nenhum.** Cliente recarregando a
   ficha 3× fabricava a "corroboração temporal" sozinho.

**Decisão do dono:** `cidade` não calcula (a ficha diz "localização aproximada", que é a verdade);
`rua`/`bairro` passam ao extrato local — mesma fonte com 0 falsos em 13.077 lotes — com rótulo de
que a distância parte do centro da região. `score_localizacao` segue exclusivo de `endereco`:
**nota a partir de coordenada aproximada seria enganosa, listar a escola mais próxima não é.**
Vazio só é aceito com 3 observações espaçadas ≥ 6h **e** de ≥ 2 espelhos distintos.

> `proximidades_vazio_em` **já existia no banco e não era usada em NENHUM ponto do repositório,
> nem em migração**: uma sessão anterior criou a coluna para este mesmo espaçamento e nunca ligou
> o fio. É a forma 7b em espelho — o banco tinha o que o código não pedia. Agora é lida e escrita.
> Nova: `proximidades_espelhos` — até hoje o sistema **não guardava qual espelho respondeu**, e
> por isso o mecanismo só pôde ser inferido, nunca provado.

Reparo: os 1.418 `{}` voltaram a `null`. **Invariante em 0.**

### B. VEGAS: não regrediu — o alerta comparava coisas diferentes

"queda vs anterior (1<40)" num dia em que o scraper funcionou como deveria:

| dia | `fonte_saude.total` | lotes realmente criados |
|---|---|---|
| 13/08 | 40 | **0** |
| 16/08 | 40 | **0** |
| 17/08 | 1 | **1** |

Nos dias "saudáveis" a VEGAS **não capturou nada**: `(novos.length ? novos : urls)` — sem
novidade, o coletor re-raspa até 40 conhecidos para atualizar preço e data, trabalho legítimo que
enche `total` com o teto do lote. Em 17/08 a listagem tinha UM lote inédito, ele foi capturado, e
`total` valeu 1. O monitor comparou **1 captura contra 40 re-verificações**. As irmãs de
plataforma provam o código: CALIL (60) e TORRES3 (2) rodaram o MESMO `scraper-soleon.mjs` no mesmo
ciclo, sem queixa. **Nada a consertar na captura — o defeito era do instrumento.**

Novo `fonte_saude.enumerados` = quantos lotes a fonte LISTA. Não depende de quanto já temos, e é o
que regride quando o site muda de verdade. Quando existe nos dois lados, decide.

> ⚠️ **Pendente de propósito:** `fonte_baseline_aprendida()` segue aprendendo o piso a partir de
> `total`, então o piso das fontes com fallback continua contaminado pela re-raspagem. Trocar
> agora não ajudaria — não há histórico de `enumerados` para aprender. **Migrar a baseline para
> `enumerados` depois de alguns dias de coleta.**

### C. Atendimento: atribuir ao admin não é avisar o admin

O dono: *"já tínhamos alinhado que os chamados e agendamentos deveriam ser direcionados para mim
até ter equipe. Não apareceu nada."* Certo nas duas metades, e elas não se contradizem.

O direcionamento **funciona** — `trg_solicitacao_cai_para_admin` e `trg_chamado_cai_para_admin`
gravaram o admin como responsável em todos, conferido linha a linha, nenhum órfão. Só que tudo
acontece **inteiramente dentro do banco**: as solicitações são inseridas direto do navegador
(`Analise.jsx`), sem endpoint, e `emails_log` **não tem UM registro de aviso de solicitação ou
chamado em toda a história do sistema**. Dar dono a uma fila não é contar a alguém que ela existe.

3 pedidos parados há 46, 46 e 42 dias, atribuídos corretamente, sem um único sinal sair daqui.
Novo item no `/api/health-check` (já roda 2×/dia, custo zero, só escreve quando há problema).
Consulta validada contra o banco: retorna os 3, com a idade certa.

### D. Fração ideal fora do acervo — a regra que existia e não valia

Veio de um print de **relatório PAGO**: "Casa 245 m² — Praia de Fora — Palhoça/SC", desconto
79,16%, ROI 205,65%, parecer *"Operação viável, vale avançar"*. A descrição do próprio
leiloeiro dizia **"Casa 245 m² … Judicial Lote 1 3 Praças"** e nós gravamos `tipo='terreno'`:
a avaliação saiu a R$ 852,63/m² **de terreno**, com a construção valendo **zero**.

> **Falso alarme que quase virou achado, registrado para ninguém repetir:** ROI e TIR idênticos
> (205,65%) NÃO são bug. A projeção é de 12 meses, e nesse horizonte a TIR anualizada é igual
> ao ROI por definição. `calcularTIR` (bisseção + anualização) está correto.

Puxando o fio: **120 lotes ativos de parte/fração ideal**, 100 tratados como imóvel INTEIRO e
57 com área preenchida — o R$/m² rodando sobre o bem todo enquanto o cliente compraria uma
fatia. Arrematar 50% indiviso é virar condômino de um desconhecido, sem ocupar nem vender
livremente, dependendo de ação de extinção de condomínio.

**A regra já existia e não valia:** `scraper-sato.mjs` exclui `parte ideal` e o comentário lá a
chama de "padrão do repo" — mas morava dentro de UM coletor. Dos 120, **117 entraram pelo
`scraper-puppeteer.mjs`**, que nem passa por `checarQualidade`.

**Decisão do dono:** excluir. Implementado em três camadas — `checarQualidade`, filtro no
coletor genérico e **gatilho no banco** (o único que sobrevive a um coletor novo escrito sem ler
o comentário). Testado: forçar `ativo = true` numa linha barrada devolve `false`. Regra gravada
em `regra_negocio` com `aplicada_por` — auditoria em 0 críticos. Acervo 30.571 → 30.442.

> **Regra do dono para o dia em que alguém pensar em readmiti-las:** valor **proporcional à
> parte leiloada**; no BidScore, a atratividade comercial **cai quase integralmente**. Está
> gravada na descrição da regra em `regra_negocio`.

### E. Qualidade de captura — o que o print da VIP escancarou (ABERTO)

Um lote VIP atualizado pelo nosso scraper **no mesmo dia** exibia: 1ª praça **vencida** como
preço atual (R$ 369.216,42 quando a 2ª praça, em 3 dias, é R$ 221.529,86), *"data a confirmar no
edital"* com a data publicada na página, e `modalidade='extrajudicial'` num lote com processo do
TJ-SP. Medido no acervo:

| defeito | lotes ativos |
|---|---|
| **sem data de leilão** (dizem "a confirmar no edital") | **16.236** (53%) |
| **com data já vencida** | **2.900** |
| descrição diz *judicial* → marcado `extrajudicial` | **1.022** |
| `casa` classificada como `terreno` | 38 |
| `casa` com área > 2.000 m² (provável terreno) | 54 |
| com `numero_processo` preenchido | **3** de 30.571 |
| **2ª praça capturada fora da CEF** | **0** em 11 fontes |

⚠️ `data_leilao` é coluna **`text`**, não `timestamp` — comparação exige cast e nenhum índice de
data funciona. É parte de por que "já venceu" nunca foi vigiado.

**Decisão pendente do dono:** qual valor é "o preço" do lote quando há 2 ou 3 praças — decide
filtro da busca, ordenação, BidScore e a projeção do relatório vendido, de uma vez só.

### F. CENSO COMPLETO DO ACERVO — a metragem que nunca foi capturada (17/08)

Pedido do dono: *"faça uma inspeção completa do acervo… avalie completo e não por amostragem"*.
30.442 lotes ativos, contados inteiros.

| | lotes |
|---|---|
| **sem metragem** | **2.227** |
| └ e sem matrícula em lugar nenhum | **495** |
| ⠀⠀├ com edital em PDF (recuperável pela visão) | **337** |
| ⠀⠀└ sem edital nenhum (sem saída hoje) | **158** |

Por fonte — *sem área / recuperável / sem saída*: PESTANA 584/7/0 · BIASI 472/225/0 ·
SUPERBID 377/28/**136** · LJUD 258/15/0 · CALIL 92/1/0 · GESTAOLEILOES 88/0/0 ·
GRUPOLANCE 58/8/0 · LEILOTECH 47/4/0 · **PECINI 42/19/0** (o lote de Sorocaba é um destes) ·
LEILOFY 35/0/0 · VIP 33/27/0 · SBID9 29/0/0 · VLANCE 25/0/0 · SOLD 21/0/**20**.

**A causa de fundo, medida no mesmo censo:** fora da CEF, a `descricao` do lote **é o título e
nada mais**.

| fonte | descrição sem conteúdo próprio |
|---|---|
| SUPERBID | 1.492 de 1.494 |
| PESTANA | 1.029 de 1.029 |
| LJUD | 981 de 981 |
| MEGA | 649 de 649 |
| BIASI | 472 de 472 (e **100% sem área**) |
| GRUPOLANCE | 470 de 470 |
| ZUK | 420 de 420 |

Os coletores gravam a **manchete** do anúncio e descartam o corpo — que é onde está a metragem
que o dono lê no site do leiloeiro. **A CEF é a exceção que prova a regra:** a descrição dela
também é template, mas template **com dado** ("Casa, X de área total, Y de área privativa"), e
por isso a CEF tem **zero** lote sem área.

> **Método, para quem repetir a inspeção:** descrição de imóvel real é ÚNICA por lote. Duas
> tentativas falharam antes de acertar — normalizar números agrupou a CEF inteira num molde só
> (os números *são* o conteúdo dela), e exigir repetição exata não pega quem monta
> "título + sufixo fixo". O teste que funciona é **remover o título e medir o resíduo**:
> resíduo vazio = a descrição não acrescenta nada. Mesmo esse escapa da PECINI, cujo título não
> aparece literal na descrição — daí o critério final ser **operacional** (`área = 0` +
> `sem matrícula`), que não depende de adivinhar o formato do texto.

**Novo invariante `lote_sem_area_nem_matricula`** (495, limite **400** → em alerta). Havia 23
invariantes e **nenhum** olhava a metragem do lote: `relatorio_area_nao_confirmada` fala de
relatório emitido e `aval_ausente_com_doc` fala de avaliação. Por isso os 2.227 cresceram em
silêncio. O limite ficou ABAIXO do valor atual de propósito — calibrar no valor de hoje faria
o invariante nascer verde e normalizar o problema, que é o oposto de vigiar.

**Fica aberto:** os **158 sem saída** (SUPERBID 136, SOLD 20) não têm área, matrícula nem
edital — para eles o conserto é de **captura** (parser por leiloeiro), não de leitura. E o
scraper da PECINI grava a meta-descrição de marketing do site (*"Pecini Leilões, especialistas
em leilões judiciais e extrajudiciais"*) no lugar da descrição do imóvel.

### O que fica para a próxima sessão

- **`aval_ausente_com_doc` 4.158** (limite 4.000) · `relatorio_area_nao_confirmada` 14 (2) ·
  `cadastro_barrado` 8 (7) · `relatorio_yield_sem_x100` 1 (0). Nenhum foi tocado hoje.
- **Bright Data: o propósito `docs` está no teto exato** (150/150, reserva 0). O total da semana
  (295) está longe do limite global (405), então `bd_teto_saturado` não dispara — quem trava é a
  cota do propósito, e o alarme não olha para ela.
- **GESTAOLEILOES: 130 lotes ativos, 0% com documento.** Documental sem o que ler.
- `/checkout` "Failed to fetch" ×3 (última 16/08 11:39) segue sem causa.
- **Google Ads:** as 9 tarefas estão concluídas, mas o card **"Anúncios financiados por" ainda
  exibe TARCISIO DE SOUZA NOGUEIRA DE ARAUJO** (pessoa física), resposta dada em 3/08 — antes de
  toda a frente de identidade. É a mesma classe de divergência que reprovou a verificação. Conferir
  se atualiza sozinho após a aprovação; se não, editar para NOGUEIRA EMPREENDIMENTOS LTDA.
- 2 assinantes `top2` (01/07 e 06/08) sem UM relatório em 14 dias — churn em formação.
- Backup off-region **recuperou** (16 e 17/08 `ok: true`, 49 arquivos) e `utm_term` **chegou**
  (12 visitas em 14 dias, era 0). As duas pendências de 16/08 estão fechadas.

---

## 🧾 16/08 — O DIA EM QUE `authorized` NÃO ERA PAGAMENTO

Sessão longa, três frentes. A do meio é a que vale ler inteira.

### A. O 1º assinante Pro recebeu "bem-vindo" e nunca pagou

`erik_migli@hotmail.com` assinou o Investidor Pro em 16/08. O Mercado Pago mandou "você tem um
novo assinante", nós mandamos **"Bem-vindo ao Investidor Pro"** às 11:39:20 — e às 12:01:32 a
cobrança de R$ 49,90 foi **RECUSADA** (`cc_rejected_high_risk`). `date_approved: null`,
`net_received_amount: 0`. Zero real entrou. O cliente ficou com dois "parabéns" na caixa de
entrada e nenhum acesso; o dono achou que a plataforma estava errada, e ela estava certa.

**CAUSA:** `authorized` foi lido como pagamento. Não é. Num preapproval é o **mandato aceito**
— o MP valida o cartão com uma transação de **R$ 0,00** (`card_validation`) e ganha permissão
de cobrar; a primeira cobrança é ASSÍNCRONA e pode ser recusada minutos depois. Num pagamento
avulso, `authorized` é valor autorizado e **não capturado** (`captured:false`,
`pending_capture`, `net_received_amount: 0`) — reserva no cartão, não caixa.

A varredura pedida pelo dono ("garanta que não se repita, tampouco com outros produtos") achou
a mesma confusão em **oito** lugares, atingindo assinatura mensal, Pro anual, assessoria,
Clube, produtos e recarga de crédito — incluindo `PagamentoServico.jsx`, que disparava o evento
**Purchase para Meta e Google Ads** em cima do mandato, ou seja, ensinava as campanhas a
otimizar por venda que não aconteceu. E os **dois crons de reconciliação**, que rodam sozinhos:
o do MP varria `preapproval/search?status=authorized` e concedia o plano a quem estivesse como
Explorador — **sem olhar pagamento nenhum**. Bastava o cartão ser válido.

**Decisão do dono (opção 1): acesso só com dinheiro na conta.** A trava mora dentro de
`ativarPlanoDireto` (`api/_webhook-core.js`) de propósito — todo caminho de ativação passa por
lá, então um chamador novo nasce protegido. A exceção é deliberada: quem **já tem histórico de
pagamento** continua reativável sem cobrança nova, senão a correção trocaria um buraco de
acesso por um buraco de atendimento (cliente adimplente preso como Explorador quando um webhook
se perde). As boas-vindas migraram para o ramo de cobrança RECEBIDA.

> ⚠️ **Dois defeitos se anulavam.** `assinar-com-cadastro.js` também gravava `plano: 'top2'`,
> que viola `perfis_plano_check`, derrubando o upsert inteiro dentro de um try/catch que só
> logava — por esse caminho o `role` **nunca** era gravado, nem para quem pagava. Era esse bug
> que segurava o buraco de acesso. **Corrigir só um abriria o outro.** Quando encontrar dois
> defeitos que se cancelam, trate-os como um só.

Reparo de dado: `plano_pago_em` do não-pagante foi limpo. Ela é a âncora da garantia de 7 dias
(CDC art. 49): mantida, queimaria a janela do cliente se o MP cobrasse depois, e ainda furaria a
trava nova — histórico de pagamento é justamente o que libera sem cobrança.

### B. Duas telas que mediam a própria ausência de medição

**O painel do Google Ads era um desenho.** Quatro caixas com `status: true` escrito à mão, que
exibiam verde desde o dia em que foram escritas e exibiriam o mesmo com a conta desligada. Ao
lado, o investimento vinha de dados frescos — daí o relato do dono: *"o Google não atualiza, só
aumenta o investimento"*. Descrição literal da tela. Os dados nunca foram o problema: batem
**exato** com o painel do Google nas cinco métricas (235 cliques, R$ 343,81, 3.367 impressões,
2 conversões, CPC R$ 1,46).

**E o card que substituiu o desenho nasceu com o mesmo defeito.** Ele mostrou "18% de cobertura"
e me levou a diagnosticar vazamento de rastreamento que não existe. `visita_origem` começa em
**12/08 21:49** — antes disso não havia rastreador nas páginas públicas. A janela do painel é de
30 dias: dez dias sem instrumentação entravam no denominador como perda. Medido só onde havia
medição, a captura é ~1:1 (13/08: 15 cliques → 13 dispositivos; 14/08: 12 → 11; 15/08: 13 → 18).

> **A lição, que é a do CLAUDE.md e mesmo assim foi cometida dentro do card que existe para
> caçá-la:** não distinguir "não foi medido" de "medido e deu zero". O aviso está escrito seis
> linhas acima do snippet em `api/publico.js`. Ao criar métrica nova, pergunte **desde quando o
> denominador é observável** — e faça a tela DIZER que recortou a janela.

### C. O lead que o fluxo entregou sem servir para nada

Rastreio de uma simulação do dono na Alavancagem, 19:35. Por fora tudo verde: lead gravado,
chamado com `user_id`, aviso à equipe **entregue**, zero erro. O lead saiu **sem telefone** —
com o número no perfil o tempo todo — e **sem vínculo de conta**. O e-mail para a equipe, que é
desenhado para o contato em um clique, saiu dizendo "WhatsApp: não informado".

A tela lia `perfis.telefone` no navegador e reenviava no corpo; falhando essa leitura, o estado
vira `{}` e o botão continua habilitado. Corrigido na raiz: **com o token na mão, o servidor não
precisa acreditar no cliente** — busca com a service key. E o lead passou a gravar `user_id`,
coisa que o chamado já fazia no mesmo arquivo.

**Efeito colateral bom:** provou que `ADMIN_EMAIL` já estava definida — pendência aberta desde
15/08 que ninguém sabia estar resolvida.

### D. Fontes: "não tentei" deixou de ser "falhou"

`_saude-fonte.mjs` gravava `status='falhou'` quando a recusa era de **orçamento**. O `semCota`
já era honrado no motivo e no teste de regressão — só não no campo que o monitor e os painéis
leem. Efeito: CALIL, VEGAS, TORRES3 e RJLEILOES contadas 3 dias como paradas **sem nunca terem
sido tentadas** (teto do Bright Data). Agora existe `sem_cota`, com alerta próprio, porque a
ação que resolve é oposta: liberar verba × consertar parser.

> Correção de rumo registrada: eu disse que a CREPALDI estava "enterrada no ruído". Não estava —
> ela já é `FONTES_PARADAS` e o monitor nunca alertou sobre ela. O fato real é que ela **nunca
> funcionou**: zero lotes na história.

### E. Google Ads — identidade verificada como a empresa certa

A conta declarava o nome de **pessoa física** e a G2RS foi emitida para a **NOGUEIRA
EMPREENDIMENTOS LTDA** — era essa divergência que reprovava a verificação. Criado o perfil de
pagamentos da Nogueira (3493-7551-9656) e **verificação concluída**. Cartões de pagamento
preservados; campanhas não pararam.

O logo do site foi trocado pela **arte registrada no INPI** (944274056, mista, titular Nogueira,
depósito 30/06/2026), extraída do próprio PDF do INPI — que a guarda **partida em duas faixas**,
por isso a metade com o "BRASIL" aparecia separada. O revisor do Google abre o site para
comparar com o logo declarado; exibir arte diferente criaria sozinho a divergência que o dia
inteiro serviu para fechar.

**As cinco tarefas foram enviadas no mesmo dia** — nome da empresa, logo, organizações
afiliadas, relações comerciais e operações comerciais. Análise de 1 a 10 dias.

> O código da G2RS **não** entra em "Pedir a certificação" — aquele formulário é de cripto e
> produtos especulativos. Vai num formulário dedicado da política de serviços financeiros do
> Brasil, e só depois da verificação do anunciante. Detalhe em `docs/PENDENCIAS_DONO.md`.

**O que foi declarado — guardar para manter consistência se voltar exigência.** Respostas
divergentes entre tarefas é o que levanta dúvida no revisor:

| Pergunta | Resposta dada | Por quê |
|---|---|---|
| Modelo de negócios | **Proprietário do serviço anunciado** (opção 1) | Vende a PRÓPRIA assinatura; ninguém compra imóvel pela BidPro. "Marketplace" implicaria intermediar venda de terceiro e contradiria a resposta de responsabilidade pela entrega |
| Responsável pela entrega | NOGUEIRA | Software próprio, sem fabricante |
| Quem cria o conteúdo | NOGUEIRA | Sem agência |
| Usa outro nome comercial? | **Sim** — BidPro Brasil (INPI 944274056) e Clube Conselheiro | Marcar "não" seria desmentido pelo Cartão CNPJ, onde **Clube Conselheiro** é o nome fantasia |
| Usa outras marcas/conteúdo? | **Não** | Não reivindica franquia, endosso, revenda nem licença. A citação a "Caixa" na `/leiloes` é uso nominativo. Marcar "sim" exigiria autorização documental que não existe — nem precisa existir |
| Licenças | Nenhuma necessária | SaaS. Não é corretagem, crédito nem consórcio |

Nos campos abertos foi declarada, de forma proativa, a página `/alavancagem` como informativa
sobre home equity e consórcio, com registro de interesse — sem concessão nem administração.
Deliberado: é provavelmente o que puxou a conta para o regime de serviços financeiros, e
declarar com o enquadramento certo é melhor que o revisor descobrir e concluir sozinho.

### O que fica de olho para a próxima sessão

- **`proximidades_vazio_falso` cresceu no dia: 924 → 987** (limite 300). É o maior desvio aberto
  em `qa_invariantes()` e está piorando, não estabilizado.
- `relatorio_area_nao_confirmada` 14 (limite 2) · `cadastro_barrado` 8 (7) ·
  `relatorio_yield_sem_x100` 1 (0) · `aval_ausente_com_doc` 4.130 (4.000).
- `reuniao_solicitada_parada` 3 — mediana de **45,6 dias**. Não tem conserto de código: depende
  de nomear analista.
- `/checkout` "Failed to fetch", 3 ocorrências, última 16/08 11:39 — dentro do fluxo do Erik.
  Não bloqueou a assinatura (a conta foi criada e o MP chamado), e segue **sem causa
  identificada**. Deixado aberto de propósito em `erros_cliente`.
- **Amanhã:** conferir em Admin → Marketing se o aviso de `utm_term` sumiu (o sufixo
  `utm_term={keyword}&utm_content={creative}` foi salvo em 16/08) e se o card de cobertura
  passou a mostrar "desde 12/08".

---

## 🔔 LEIA ISTO NA PRÓXIMA SESSÃO — logo DEPOIS do ritual de abertura

> Instrução explícita do dono ao encerrar 15/08: *"liste o que ficou pendente da minha parte e me
> lembre no início da próxima sessão, após as verificações iniciais"*. Ou seja: faça o heartbeat e
> os diagnósticos do `CLAUDE.md` **primeiro**, e então, ANTES de qualquer trabalho novo, entregue
> os dois blocos abaixo.

### 1️⃣ Pendências DO DONO — lembrar sem ele precisar perguntar

| # | Item | Por que trava | Como conferir se já foi feito |
|---|---|---|---|
| ~~**A**~~ | ~~`ADMIN_EMAIL` na Vercel~~ — ✅ **RESOLVIDO 16/08** | Estava definida o tempo todo | Provado: aviso de lead entregue em 16/08 19:35 (`emails_log`, `lead_alavancagem`, `entregue`) |
| **B** | **Nomear um analista** | `select count(*) from perfis where role='analista' and ativo` deu **0**. Há 42 horários livres e 3 pedidos de reunião parados desde 1 e 5 de julho. O trigger faz o pedido cair para o admin — dá dono à fila, **não substitui a pessoa** | `select count(*) from perfis where role='analista' and ativo;` → > 0 = resolvido |
| **C** | **Regerar o mercadológico de UM lote** — `1d117f3c-b7ed-413d-ac22-f9db9f7bd82c` ("Apartamento, 2 quartos, Praia da Costa, Vila Velha/ES") | Dois alertas vermelhos (`analise_sem_mercadologico`, `laudo_sem_base`) são este único lote. O cron de regeração tem janela de 72 h e o relatório é de 31/07 — não o alcança. **Um clique em Gerar zera os dois** | `select * from public.qa_invariantes() where chave in ('analise_sem_mercadologico','laudo_sem_base');` → `ok` = resolvido |
| **D** | **Tornar 520 o teto PADRÃO do Bright Data** (hoje o padrão é 500) | Nada está travado: os disparos agendados já passam `teto_semana=520` e o freio autoriza. O risco é o disparo FUTURO feito sem preencher o campo — cai no 500, e com `reservado p/ outros 43` é recusado em silêncio de agenda. Foi assim que a PECINI ficou parada desde julho. Virar padrão é decisão de GASTO, por isso é sua | `select proposito, requests, sucessos from brightdata_uso_proposito where semana = date_trunc('week', now())::date order by 2 desc;` (leitura pura — **não** chamar `registrar_uso_brightdata`, que concede ao responder) |
| **E** | **Chaves de API Asaas / Mercado Pago sem escopo de permissão** | Auditoria de segurança pede chave com escopo mínimo; as atuais são plenas | Painel de cada gateway → conferir escopo da chave em uso |
| **F** | **Google G2RS** (ID `475-979-5747`) e **integração WebISS para NFS-e** | G2RS: ao reenviar, escolher a **segunda** opção — *"avaliada anteriormente… atualizar os campos"* — **nunca** "nova solicitação" (recomeça a fila). WebISS: sem ela, nota fiscal continua manual | Confirmação por e-mail do Google · emissão automática saindo no painel |

Detalhe completo e passo a passo: `docs/PENDENCIAS_DONO.md`, seção **"NOVO EM 15/08"**.
Uma Routine semanal (`trig_0125Q6eF32hazyZk4rVj16Tg`, segundas 9h BRT) cobra o item **B** e se
apaga quando ele confirmar. **C e D são de 18/08 e têm prazo curto**: C é um clique e apaga dois
alertas vermelhos; D precisa de decisão ANTES de 24/08, senão a semana vira e a PECINI passa mais
uma sem reler os antigos.

### 2️⃣ ~~Assunto marcado para a sessão de 16/08~~ — ✅ **RESOLVIDO E EM PRODUÇÃO**

> **A resposta:** o painel do Google Ads era um **array literal** com `status: true` escrito à
> mão. Não consultava nada — e o investimento ao lado vinha de dados frescos, então a frase do
> dono descrevia a tela ao pé da letra. Trocado por medição real (RPC `admin_ads_rastreamento`),
> com relógio por card e capacidade de dizer "não consegui verificar". Ver o bloco **16/08 · B**
> no topo deste arquivo — inclusive a armadilha em que o card NOVO caiu e como foi corrigida.
>
> _O registro histórico abaixo fica porque a hipótese que ele desloca continua válida como
> método: quando a tela discorda do banco, comece comparando o que a tela consulta._

<details><summary>Retrato original de 15/08 (histórico)</summary>

> **"O Google não está atualizando, somente aumentando o investimento, na minha tela de marketing."**

Fiz só o retrato, **sem investigar** (ele pediu para ver na sessão seguinte). E o retrato já
desloca a hipótese — **a INGESTÃO está viva**:

| | |
|---|---|
| Último dia ingerido | **14/08** (a ingestão roda ~10h50 UTC e traz o dia ANTERIOR — em 15/08 isso é o normal, não atraso) |
| Últimos 14 dias | R$ 326,89 · **222 cliques** · 2 conversões |
| Cliques e impressões | **variam todo dia** (12, 15, 20, 18, 20, 20, 11…), não estão congelados |
| `atualizado_em` | avança; a rodada de 15/08 reescreveu os 8 dias mais recentes (janela móvel — esperado) |

> 🔎 **Então o dado do Google chega e se move. A suspeita passa para a TELA.** Hipóteses a testar,
> todas da família clássica desta base: (a) a tela soma/filtra por coluna de data errada e o
> PostgREST devolve 400 que vira lista vazia — atenção, `marketing_metricas_dia` usa **`data`**,
> não `created_at`/`criado_em`; (b) `.limit()` truncando a janela; (c) a tela mostra gasto
> ACUMULADO e cliques de um recorte diferente, dando a sensação de "só o investimento sobe".
> **Comece comparando o que a tela consulta com estes números** — se divergirem, o defeito é dela.
>
> Vale olhar junto o cruzamento que já era pendência: **222 cliques pagos × 41 visitas com
> `gclid`** em 14 dias, e **20 cadastros**. A queda entre as três é natural; o TAMANHO dela é que
> se vigia. E `utm_term` segue em 0 (pendência A do dono, de 14/08).

</details>

> ✅ **`utm_term` também foi resolvido em 16/08** — o dono salvou o sufixo de URL final
> `utm_term={keyword}&utm_content={creative}` no Google Ads. Conferir a partir de 17/08 se o
> aviso some do painel. E o cruzamento "cliques × visitas com gclid" citado acima **não é** a
> perda que parecia: ver 16/08 · B.

---

> 📋 **Pendências que dependem do DONO** (painéis/planos): ver `docs/PENDENCIAS_DONO.md`. Ao iniciar sessão, se o dono perguntar "o que falta que depende de mim?", liste de lá. **Topo da fila em 02/08: (-4) Google Search Console + Perfil da Empresa** — as 33 mil páginas novas estão no ar e o Google ainda não sabe; e **(-3) Cloudflare R2**, único item que protege contra perda definitiva de arquivo de cliente. Depois: Resend (URL com `www` + Re-enable), Google Ads (verificação até **02/09** — a data 31/08 que aparece em blocos antigos foi reemitida pelo Google em 03/08), Asaas (reativar webhook), Upstash (grátis). **Novo em 12/08: (-1.5) MX do domínio** — `suporte@` e `privacidade@` são publicados no site e não recebem nada; o inbound já está pronto no código.

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
>
> 🐛 **Camada 3 — bug bounty do CÓDIGO (item 6 do ritual):** rodou pela 1ª vez em 05/08.
> 6 lentes → 24 achados → verificação adversarial. Resultado e estado de cada um em
> `docs/VARREDURA_BUGS_2026-08-05.md`. **Aprendizado do formato:** o workflow travou em
> 8/24 vereditos — na próxima, verificar em lotes menores e persistir o resultado a cada
> lote, para que uma parada não leve o trabalho junto.
> Checagem rápida a qualquer momento: `select public.auditoria_seguranca();` → `0 crítico / 0 atenção` = íntegro.
> **Auditorias ofensivas completas: 15/07/2026 (×2).** Total de correções: 15 (1ª rodada) + escalonamento por convite (CRÍTICO) + IDOR do MP (ALTO) + escala. Refazer a ofensiva quando entrarem rotas/pagamento/RLS novos (a Rotina mensal já faz isso sozinha).

## 🧭 15/08 (noite) — NAVEGAÇÃO, TERMOS E O BUG QUE EU MESMO CRIEI

Rodada final do dia, toda a partir do dono inspecionando pelo celular.

### A. O texto do Programa de Parceiros dizia o CONTRÁRIO da regra

A home afirmava *"para receber as comissões, é preciso ter uma assinatura ativa"*. A regra
`comissao.gratis_ganha`, ativa desde 08/08 e aplicada por `pode_ganhar_comissao()`, diz o
oposto — conferido no banco: **`pode_ganhar_comissao('explorador')` = true**.

E o TERMO de parceiro estava pior, em dois itens:

| Item | O que dizia | Por que é grave |
|---|---|---|
| 2. Elegibilidade | exigia "assinatura ativa (paga)" para PARTICIPAR | barrava a entrada que a regra abriu |
| 4. Condições | "a comissão só é devida se, na data da cobrança, sua assinatura estiver em dia" | **negava o ganho já conquistado** |

Reescritos (**v6 → v7**), com o item 5 passando a declarar o teto: até **R$ 2.500/mês** sem NF
e sem plano pago; acima disso, pagante + nota fiscal do **valor integral sacado no mês**, não só
do excedente.

> ✅ **A versão sobe e NINGUÉM é obrigado a re-aceitar** — verificado antes de mexer, porque o
> contrário travaria saques: `aceitar_parceria()` devolve a data existente sem tocar na versão
> quando já houve aceite, e o gate de saque olha os TERMOS DE USO da plataforma
> (`saque.exige_termos_vigentes`), não este termo.
>
> ⚠️ O "R$ 2.500,00" agora é **cópia** de `regra_negocio.saque.teto_sem_nf`. Em texto jurídico a
> cópia é inevitável (número por extenso, não ponteiro), mas **quem mudar o teto no banco sobe a
> versão do termo no mesmo commit** — a consulta de conferência está anotada no arquivo.

### B. Um modal por vez — `src/utils/filaModais.js`

Seis popups podiam querer a tela juntos. O `App.jsx` já os ordenava no JSX com o comentário de
que boas-vindas "entra por último para nunca cobrir uma pendência que trava a conta" — mas
**ordem no JSX não é exclusão mútua**: os seis renderizam e quem tem maior `z-index` fica por
cima. Numa conta nova, vídeo de boas-vindas + tour de 5 passos + botão do chat, empilhados.

Cada modal continua decidindo sozinho **se** quer aparecer; a fila decide **quando**. Prioridade
por custo de ignorar: `contrato > cadastro > bonus > boas-vindas > tour > sugestao`. Quem espera
aparece quando o da frente sai — **fila, não filtro**. Id não registrado passa direto com aviso
no console, em vez de sumir sem explicação.

**E o tour foi desligado** (`tour_etapas.ativo = false` na versão 2026-08, com migração para não
voltar num banco recriado): a fila resolvia a sobreposição, mas o dono apontou o excesso — *"você
já tem o vídeo"*. Dois onboardings em sequência continuam sendo dois. Nada apagado; reverter é um
`update`.

### C. O chat: de botão flutuante a tópico de menu — e o bug que isso criou

O flutuante saiu **de vez** (decisão do dono: tópico de menu "fica melhor e muito profissional",
**também no desktop**). Antes disso, no mesmo dia, ele já tinha deixado de abrir sozinho e virado
badge — depois do caso do João, que achou que o site tinha quebrado.

> 🔴 **E aqui eu criei um bug, relatado no minuto seguinte: clicar em "Assistente" não fazia
> nada.** O botão morava DENTRO do `ChatSuporte` e herdava a condição do componente (equipe e
> modo suporte não veem o widget — quem atende responde pelo Atendimento). Ao mover o acesso para
> o Header, **separei o gatilho da coisa que ele aciona**, e as duas pontas passaram a discordar:
> o menu oferecia para qualquer logado, o chat não desenhava nada para admin.
>
> **O que escondeu o defeito de mim:** nos prints anteriores o botão funcionava — porque o dono
> estava SIMULANDO explorador. Testei o caminho onde funcionava, não o caminho real dele.
>
> Correção: `src/utils/chatDisponivel.js`, uma resposta só para as duas pontas (e a terceira
> cópia, dentro do próprio ChatSuporte, também eliminada). Recebe o papel EFETIVO de propósito —
> o admin que simula explorador PRECISA ver o chat. Conferido em **7 casos**: admin sem simular
> (não), admin simulando (sim), modo suporte (não), analista (não), pagante (sim), explorador
> (sim), deslogado (não).

### D. Voltar do imóvel caía na página 1 da busca

Rastro em `eventos_atividade` — o ciclo três vezes em quatro minutos:

```
/buscar → imóvel → volta → "Próxima →" → imóvel → volta → "Próxima →" → imóvel → volta → página "3"
```

**A causa não era o botão:** `nav(-1)` está correto. A Busca remonta do zero, e `filtros`,
`sortBy` e `raio` **já sobreviviam** por `sessionStorage` — só a página não. Lacuna dentro de uma
família que já existia, e por isso invisível: a tela voltava com os filtros certos, o que dava a
impressão de ter restaurado tudo.

A página passa a ser persistida igual, e a restauração é consumida **uma vez**, na primeira busca
após a remontagem. Mudou filtro → página 1 (recorte novo não tem "página 3"); deep-link de e-mail
descarta a restauração; "limpar filtros" apaga a página guardada.

### E. Termos passam a ser pedidos no MOMENTO que importa

Decisão do dono: *"veja a melhor hora para colocar para aceitar novamente, como num upgrade de
plano ou na hora de solicitar um saque"*. O mecanismo de abrir sob demanda **já existia**
(`abrirTermosModal` + `termosUsoPendente`, usados pelo gate de relatórios); faltava desligar a
abertura automática no login e ligar os dois momentos:

- **Checkout** — barra ANTES de ir ao gateway (aceitar depois de pagar seria pedir concordância
  sobre algo já feito);
- **Minha Rede** — o servidor **já exigia** a versão vigente, então sem este gate o cliente só
  descobriria **pela recusa**: pede o dinheiro e leva um "não" que não sabe resolver.

**Mudou ONDE se pergunta, não SE se exige.** Ninguém passa a sacar sem aceitar.

### 🧪 Lição de MÉTODO minha, para não repetir

Cometi o mesmo erro **três vezes**: rodar `npm run build` enquanto o `verificar:responsivo`
estava em execução. O `vite preview` serve do disco, então o app troca debaixo da checagem e os
achados viram `supabaseKey is required` — ruído meu, não defeito do código. **Essa verificação só
depois de parar de mexer.** A rodada final, com o código congelado em `9a5ea9b`, fechou
**✓ 48 checagens (6 tamanhos × 8 rotas), 0 achados**.

### 🔎 Achado de brinde no rastro do dono

Às 23:22, num imóvel que ele abriu: `api_erro` em **`/api/proximidades-imovel`**. É a mesma
família do invariante `proximidades_vazio_falso`, hoje em **799 / 300** — o que ficou para a
decisão dele em 18/08. Ele tropeçou nele ao vivo.

---

## 📚 15/08 — ÍNDICE DO DIA (tudo o que entrou, em ordem)

Dia longo. Este índice existe para a próxima sessão achar a seção certa sem reler tudo. **O fio
condutor foi o mesmo em quase todos os itens: a informação já estava lá e ninguém a lia — ou
pior, a ausência dela virava uma AFIRMAÇÃO na tela.**

| # | O que foi | Onde ler | Prova / número |
|---|---|---|---|
| 1 | **Edital atrás da página do lote** — `pdfsNaPagina` segue os PDFs linkados no HTML | *"EDITAL ATRÁS DA PÁGINA DO LOTE"* | 5.601 lotes (40%), não os 93% que eu havia reportado errado |
| 2 | **Correção do MEU diagnóstico** — regex case-sensitive; a Caixa publica `.PDF` maiúsculo | idem | 8.504 sempre foram PDF e o código sempre os leu |
| 3 | **Sem analista, reunião e chamado caem para o admin** (2 triggers + backfill) | *"A regra do dono"* | 3/3 solicitações e 22/22 chamados com dono; 0 órfãos |
| 4 | **Invariante da reunião ficou verde por engano** — media `analista_id`, não o atendimento | idem, subseção 🔴 | corrigido no mesmo dia; volta a acusar 3 |
| 5 | **`tempo_processo()`** — agilidade separando relógio da MÁQUINA do HUMANO | *"tempo médio de evolução"* (commit) | mediana 0,3 h de geração × 44,9 dias de reunião parada |
| 6 | **A armadilha do bot como SLA** — 33 de 34 mensagens são da IA; nunca houve resposta humana | `CLAUDE.md` §1c(d) | mediria "0,0 h, 22 de 22 respondidos" |
| 7 | **Tempo entre despachos (CNJ)** — nº do processo grátis no edital + série + cadência | *"TEMPO ENTRE DESPACHOS"* | 1.782 lotes judiciais tinham **3** números; monitor 0 → 114 |
| 8 | **Simulação de papel não simulava** — `role` passa a ser o EFETIVO | *"A SIMULAÇÃO QUE NÃO SIMULAVA"* | 29 componentes liam o papel real × 12 o efetivo |
| 9 | **Simulação em conta NOVA** — identidade simulada; cai na home em qualquer papel | idem | 151 leituras por `user.id` cru × 57 por `effectiveUserId` |
| 10 | **Simular é olhar, nunca escrever** — trava no `fetch` do cliente Supabase | idem | 13 leituras conhecidas passando, 7 escritas barradas |
| 11 | **Chat proativo vira badge** — sem abrir sozinho, sem tomar a tela | *"o chat que sequestrou a tela"* | o painel era 100vw × 100dvh no celular |
| 12 | **Badge passa a contar a mensagem da IA** | idem | sem isso, a saudação ficaria invisível |
| 13 | **Auditoria de fechamento** — e a divergência arquivo × banco que ela achou | seção abaixo | 10/10 objetos aplicados; CI verde nas duas travas |
| 14 | **Texto do parceiro contradizia a regra** — home + termo (itens 2, 4 e 5), v6 → v7 | *"NAVEGAÇÃO, TERMOS…"* A | `pode_ganhar_comissao('explorador')` = true |
| 15 | **Um modal por vez** (`filaModais.js`) + tour desligado | idem, B | 6 popups disputavam a mesma tela |
| 16 | **Chat vira tópico de menu** nas duas larguras; flutuante removido | idem, C | — |
| 17 | **O "Assistente" não abria nada** — bug que EU criei ao mover o botão | idem, C | 7/7 casos conferidos em `chatDisponivel.js` |
| 18 | **Voltar do imóvel retoma a página da busca** | idem, D | 3 ciclos perdidos em 4 min, no rastro |
| 19 | **Termos pedidos no upgrade e no saque**, não ao logar | idem, E | — |

**Migrações aplicadas hoje (9):** `tour_desativado_video_ja_cobre` + `atendimento_cai_para_admin_sem_analista` ·
`qa_invariante_solicitacao_reuniao_parada` · `qa_invariante_reuniao_parada_mede_o_atendimento` ·
`tempo_processo_medir_agilidade` (+ `_inclui_fechado_sem_resposta` e `_alinha_banco_ao_arquivo`) ·
`processo_movimentos_e_cadencia` · `cotas_do_papel_para_simulacao` ·
`suporte_nao_lidas_conta_mensagem_da_ia`.

**Funções novas para consultar a qualquer momento (custo zero):**
`public.tempo_processo()` · `public.processo_cadencia(numero)` · `public.cotas_do_papel(papel)`.

**Utilitários novos no front, cada um existindo para que uma regra tenha UM dono:**
`src/utils/filaModais.js` (quem ocupa a tela) · `src/utils/chatDisponivel.js` (quem tem chat).

---

## ✅ 15/08 — FECHAMENTO DO DIA: o que foi verificado, e o que NÃO está resolvido

Auditoria de encerramento (pedido do dono: *"garanto aqui o resto que esteja resolvido... e que
esteja tudo em produção"*). Verificado agora, não presumido:

| Checagem | Resultado |
|---|---|
| `git status` · HEAD × `origin/main` | limpo · **iguais** (`9a5ea9b`, revisado ao fim da noite) |
| Deploy de produção | **READY**, aliasado em `www.bidprobrasil.com.br` |
| CI no commit final | **Padrões perigosos** ✅ · **Deriva código × banco** ✅ |
| `auditoria_seguranca()` | **0 crítico / 0 atenção** |
| `auditoria_regras_negocio()` | **0 crítico** |
| Objetos de banco criados hoje | **10 de 10 aplicados** |
| `verificar:responsivo` | **48 checagens (6 tamanhos × 8 rotas), 0 achados** — refeito sobre `9a5ea9b` |
| Deploy de `9a5ea9b` | **READY**, aliasado em `www.bidprobrasil.com.br` |

> 🔎 **Uma divergência ACHADA e fechada nesta auditoria — é a forma 7b em miniatura.** O arquivo
> `tempo_processo_medir_agilidade.sql` escrevia o rótulo `mercadológico → documental` (seta) e o
> banco tinha `->`, porque apliquei via MCP com o texto transliterado. Recriar o banco pelo
> repositório mudaria o rótulo. Reaplicado a partir do arquivo: **banco e arquivo idênticos**.
> Lembrete de que a regra vale para o detalhe também — não só para a lógica.

### ❌ O que NÃO está resolvido (8 invariantes em alerta)

Nenhum destes é regressão do dia; todos têm dono e motivo. **Não leia esta seção como "pendência
menor" — leia como a lista do que ainda mente se ninguém olhar.**

| Invariante | Valor / limite | Situação |
|---|---|---|
| `reuniao_solicitada_parada` | 3 / 0 | **Vermelho por desenho** até alguém de fato atender. Depende do dono (nomear analista) |
| `backup_sem_arquivo_cliente` | 342 / 0 | **Correção NO AR, ainda não exercitada.** A última execução é de 15/08 04:43, ANTES do conserto do manifesto. A rodada de 16/08 ~04:43 UTC é a prova — conferir `arquivos_total` (esperado ~49, não 1.000) |
| `proximidades_vazio_falso` | 799 / 300 | Decisão do dono adiada para 18/08 |
| `bd_teto_saturado` | 480 / 405 | Decisão do dono adiada para 18/08 |
| `relatorio_area_nao_confirmada` | 14 / 2 | Caminho de GERAÇÃO corrigido; os relatórios ANTIGOS não foram regerados |
| `relatorio_yield_sem_x100` | 1 / 0 | idem — 1 registro histórico |
| `cadastro_barrado` | 8 / 7 | marginal, 7 dias |
| `aval_ausente_com_doc` | 4.137 / 4.000 | gap de captura, marginal |

### ⚠️ O que subiu SEM verificação automática (dito aqui para ninguém supor o contrário)

1. **A simulação de papel não foi testada logada** — este ambiente não tem sessão. Validada por
   leitura de código e pela conferência da régua de RPC contra os nomes reais do projeto (13
   leituras conhecidas passando, 7 escritas conhecidas barradas).
2. **Tudo o que só existe LOGADO** — `verificar:responsivo` roda deslogado, então não alcança:
   os 64 px do painel do chat, a **fila de modais**, o **retorno à página da busca**, a
   **simulação em conta nova** e os gates de termos no checkout/saque. Todos validados por
   leitura de código e, quando havia regra pura, por teste direto da função (7/7 em
   `chatDisponivel`). Falta o passeio no aparelho.
3. **`processo_cadencia()` ainda não tem movimento coletado** — o CNJ é bloqueado pela rede deste
   ambiente; o cron roda 1×/dia, 40 por rodada, e os 114 monitorados levam ~3 dias.
4. **A heurística `[edital-html]`** só foi testada contra HTML construído por mim, não contra o
   site real de um leiloeiro.

### ⏰ Lembrete automático das pendências do dono

Routine semanal **"Pendências do dono — BidPro (semanal)"** (`trig_0125Q6eF32hazyZk4rVj16Tg`),
segundas 12h UTC (9h BRT), com push e e-mail. Ela **não tem o conector do Supabase** — foi criada
de uma sessão que não pôde repassá-lo —, então o prompt foi reescrito para NÃO fingir que consulta
o banco: lembra os dois itens e pede confirmação. Quando o dono disser que resolveu os dois, ela
se apaga sozinha.

---

## 🎭 15/08 — A SIMULAÇÃO QUE NÃO SIMULAVA, e o chat que sequestrou a tela do João

### A. Simular Explorador mostrava uma tela que não existe para ninguém

O print do dono: cabeçalho **"Simulando como Explorador"** e, logo abaixo, **"Análises
ilimitadas"** — que é o que o **admin** tem. Explorador tem **3 amostras vitalícias**.

**Causa de fundo, e é o número que conta:** a simulação vivia só em `effectiveRole`, e o
acervo estava partido ao meio.

| Leem o papel… | Componentes |
|---|---|
| `role` (o **REAL**) | **29** |
| `effectiveRole` (o simulado) | 12 |

> No modo simulação a **maioria** das telas seguia desenhando para o admin e a minoria
> desenhava para o explorador. O resultado não era nem um nem outro: **era uma tela que
> nenhum usuário vê** — inútil justamente para o fim de validar.

Corrigir 29 arquivos teria vida curta: o 30º componente nasceria lendo `role`, como os 29
nasceram. A regra passa a ser **segura por padrão** — **`role` é o que a pessoa VÊ**; quem
precisa do papel verdadeiro pede **`roleReal`**, e a exceção fica explícita em quem a usa
(hoje só `podeImpersonar` e o controle de simulação). `isAdmin` acompanha. **A saída não
depende disso:** "Voltar ao Admin" vive no banner do Header, desenhado a partir de
`roleSimulado`, fora da troca — sem isso, simular explorador trancaria o admin fora do
`/admin` sem porta de volta.

**Causa do número errado:** na simulação de papel o usuário **continua sendo o admin** (ao
contrário do modo suporte, em que o id muda), então `minhas_cotas` respondia — com toda a
razão — sobre a linha do admin. Nova RPC **`cotas_do_papel(role)`** (só admin) responde pelo
PAPEL, chamando `limite_ia`, a mesma fonte de `limite_ia_efetivo`. **Nada de tabela de limites
no front:** é o defeito documentado em `cotaAnalise.js` — já esteve copiada em 4 telas e as 4
divergiram, uma delas dando `limite: null` (= "ilimitado") a quem tem 5.

> 🔒 **Trava que a mudança exigiu — SIMULAR É OLHAR, NUNCA ESCREVER.** Com `role` efetivo, o
> admin simulando explorador satisfaz `ehCliente` e dispararia a saudação proativa contra a
> conta **dele**: chamado real criado, mensagem gravada e `suporte_saudacao_em` carimbado — o
> que ainda bloquearia a saudação verdadeira dele por 30 dias. A ferramenta de inspecionar
> produzindo o dado que deveria só observar.

**Banner:** a frase agora vive dentro de um `<span>`. Em container flex cada trecho de texto
solto vira item anônimo — o texto quebrava em três peças e o `gap: 12` jogava a vírgula para o
início da linha de baixo. Era o que aparecia no print.

### B. O chat abriu sozinho e tomou a tela inteira do João

Ele criou a conta e, 4,5 s depois, o chat abriu. No celular o painel era
`min(420px,100vw) × min(620px,100dvh)` = **a tela inteira**. Ele achou que era erro do site —
no primeiro contato com o produto.

Decisão do dono: *"apenas um botãozinho em algum local, com um número, assim como funciona no
Instagram"*. Saíram as **duas** aberturas automáticas — a da saudação e a de resposta nova
(esta última **revertendo pedido anterior dele**, agora com caso concreto contra).

> ⚠️ **O que quase transformou a correção em silêncio:** o badge contava só
> `autor_tipo='atendente'`. Tirar a abertura sem mexer nisso deixaria a saudação (que é `'ia'`)
> **invisível — nem abre, nem avisa**: trocaríamos "interrompe demais" por "não comunica nada".
> A RPC passa a contar toda mensagem que não seja do cliente.

**Distinção que ficou escrita nos dois lados, porque as regras parecem se contradizer:** em
`tempo_processo()` a mensagem da IA **NÃO** conta como resposta (lá a pergunta é *"alguém
atendeu esta pessoa?"*, e bot não é SLA); no badge ela **conta** (a pergunta é *"há algo que o
cliente ainda não leu?"*, e é exatamente o que ele não leu). **Mesma tabela, perguntas
diferentes. Não unifique.**

O painel também deixa **64 px de sobra no topo**: folha branca de borda a borda não parece
painel, parece página quebrada.

---

## ⚖️ 15/08 — TEMPO ENTRE DESPACHOS: o processo judicial está andando?

Pedido do dono, e **eu tinha entendido errado antes**: "tempo de evolução do processo" é o
**processo JUDICIAL** — o intervalo entre despachos do juiz num feito ligado ao leilão — não o
funil interno do cliente. As duas medidas existem agora e não se confundem:
`tempo_processo()` é o nosso; **`processo_cadencia()` é o do juiz**.

### O que já existia, e por que mesmo assim o número era impossível

A integração com o **DataJud do CNJ** está pronta e é madura (`_cnj.js`, 248 linhas: consulta
por número ou parte, mapa de 25 riscos, classificação de fase e desfecho). Ainda assim a
pergunta não tinha resposta, por **três lacunas em série** — todas medidas antes de escrever
qualquer linha:

| Lacuna | Estado em 15/08 |
|---|---|
| **1. A chave** | **1.782 lotes judiciais ativos, 3 com `numero_processo`** (0,17%) |
| **2. A série** | o cron gravava só `total_mov` e `ultima_data` — **intervalo incalculável por construção** |
| **3. A conta** | não existia |
| *(consequência)* | `processos_monitorados` **vazia**, com o cron rodando todo dia sem ter o que checar |

> A lacuna 1 é o padrão da casa outra vez: **o número não faltava na fonte**. Todo edital
> judicial o traz. Ele só era lido pela **IA do relatório documental**, que roda quando um
> cliente paga — e foram **17 documentais na história do sistema**. Daí 3 números.

### O que foi feito

**`extrairNumeroProcessoTexto()`** (`_doc-extracao.js`) — regex + **dígito verificador do CNJ**
(MOD 97-10, Res. 65/2008). O DV não é enfeite: sem ele qualquer sequência de 20 dígitos do
edital (protocolo, CNPJ concatenado, conta) viraria "processo" e o monitor sairia consultando
lixo — errando em silêncio. Validado antes de plugar: **8/8 processos reais do acervo
aprovados, 0/4 lixos aceitos**, e extração correta de texto com CNPJ e protocolo por perto.
Plugado no `extratoEdital`, que já baixa o edital: **custo zero, sem IA**. Só grava quando o
edital **pertence ao lote** e **não sobrescreve** número de procedência melhor.

**`processo_movimentos`** — a série, com índice único `(numero, data, codigo, descricao)`. Sem
essa unicidade o cron duplicaria os mesmos movimentos a cada rodada e **a mediana de intervalo
tenderia a zero: um "processo muito ágil" fabricado pelo próprio coletor**.

**`processo_cadencia(numero)`** — mediana e média de dias entre despachos, dias desde o último,
maior intervalo, e um `veredito` de régua **auto-aprendida do próprio processo** (mesma ideia
de `fonte_baseline_aprendida()`): não existe "rápido" universal — execução fiscal e inventário
não são comparáveis. O que se pode afirmar é que o processo está mais devagar **do que ele
vinha**. `andando` · `lento` (>1,5× a própria mediana) · `parado` (>3×) · `sem base` (<3
intervalos — dizer "ágil" com 2 pontos seria inventar). Matemática validada com série
sintética nos três vereditos antes de subir.

**Monitor semeado: 0 → 114 processos** (dos editais capturados pelos scrapers + lotes com a
chave).

### ⏳ O que ainda não dá para responder, e quando dará

**Nenhum movimento foi coletado ainda.** O CNJ está **bloqueado pela política de rede deste
ambiente** (403 no CONNECT do proxy) — em produção a chamada funciona, daqui não. O
`cnj-monitor-cron` roda **1×/dia às 10h UTC, 40 processos por rodada**: os 114 levam **~3 dias**
para o primeiro ciclo completo. Antes disso `processo_cadencia()` devolve vazio, que é o
correto — e não deve ser lido como "os processos estão parados".

⚠️ **Ressalva que precisa viajar junto com o número:** o DataJud **não é tempo real** e o
`formatarProcesso` traz os **20 movimentos mais recentes**. A mediana daqui é a cadência
**recente**, não a história inteira — que é justamente o que "está rápido AGORA?" pergunta. Um
feito de 1998 não terá seus 400 movimentos aqui; `movimentos_conhecidos` diz quantos entraram
na conta para ninguém confundir os dois.

---

## 📑 15/08 — EDITAL ATRÁS DA PÁGINA DO LOTE, e a investigação das reuniões

### ⚠️ Antes: uma correção do MEU diagnóstico

Reportei *"13.060 de 14.105 (93%) com edital em HTML"*. **Estava errado.** O regex da minha
query era **case-sensitive**, e a Caixa publica `.PDF` em **maiúsculo**.

| | |
|---|---|
| Com `link_edital` | 14.105 |
| **PDF de verdade** (case-insensitive) | **8.504** |
| **HTML de verdade** | **5.601 (40%)** |

Os 8.504 sempre foram PDF, e o código — que usa `/\.pdf/i` — sempre os leu. **Meu
diagnóstico inflou o problema em mais do dobro; o código estava certo.**

### O problema real, que existe: 5.601 lotes

| Fonte | Lotes com edital em página |
|---|---|
| SUPERBID | 1.514 |
| PESTANA | 1.029 |
| MEGA | 659 |
| ZUK | 510 |
| GRUPOLANCE | 478 |
| BIASI | 458 |

Essas páginas eram **excluídas dos candidatos de propósito** (*"o valor não está no HTML
cru"*) — verdade para o VALOR, mas jogava fora o resto: **o edital em PDF quase sempre está
linkado ali dentro**. Foi por esse caminho que a condição de pagamento do lote de Morada dos
Pinheiros se perdeu.

**`pdfsNaPagina`** baixa a página, colhe os `href` `.pdf` (resolvendo relativo contra a base) e
ordena por probabilidade de ser o edital: *"edital"* no href/texto vale **+10**,
*"regras/condições"* **+5**, e **matrícula/certidão/laudo/foto entram NEGATIVO** (−8) — são
documentos úteis, mas quem os procura é o `extratoMatricula`; aqui só tomariam a vaga.
**Genérico: nenhuma regra por leiloeiro.** Só roda quando não há PDF direto.

### 📅 Investigação das reuniões: 3 solicitações, 0 agendadas

| | |
|---|---|
| Solicitações | 3, todas em `status='solicitado'` |
| Desde | **1 e 5 de julho** (41 a 45 dias) |
| `analista_id` / `reuniao_em` | nulos nas três |
| Slots futuros disponíveis | **42** |
| **Perfis com `role='analista'` ativos** | **0** |

> 🔴 **A causa não é de código: não existe nenhum analista cadastrado.** O único papel de equipe
> no sistema é o admin. Há 42 horários livres e ninguém para ocupá-los. **É decisão do dono
> nomear alguém.**
>
> **O agravante é o de sempre:** ninguém foi avisado. Um cliente pediu para falar com um
> analista e ficou **45 dias no silêncio** — do lado dele, o pedido simplesmente não existiu.
> Nenhuma exceção, nenhum erro, nenhum alarme; só um pedido parado. Invariante
> **`reuniao_solicitada_parada`** passa a vigiar (acusa **3** hoje, limite 0).

### 👤 A regra do dono: sem analista, o atendimento cai para ele

> Decisão de 15/08, com estas palavras: *"os pedidos de reunião, assim como os chamados, devem
> cair para mim"*.

O defeito de fundo era **a fila existir sem dono**. Linha com `analista_id` nulo não aparece
como "minha" para ninguém — some. A regra resolve na raiz: **enquanto não houver analista, o
pedido é do admin**, desde o instante em que nasce.

**Feito por TRIGGER `before insert`** (`atendimento_cai_para_admin_sem_analista.sql`), não no
front, porque a solicitação nasce em **três telas diferentes** (`Analise.jsx` ×2, `Painel.jsx`)
com `insert` direto no banco. *Regra de negócio que mora na tela é regra que a próxima tela
esquece* — foi assim que o "Explorador indica mas só saca sendo pagante" ficou dois meses
valendo só no comentário. O trigger **não sequestra trabalho de equipe**: havendo analista (ou
consultor, no caso do chamado) ativo, ele não age.

| Depois do backfill | Total | Com dono | Órfãos |
|---|---|---|---|
| `solicitacoes` | 3 | **3** | **0** |
| `chamados` abertos | 22 | **22** | **0** |

**Mesma regra em `chamados.atendente_id`** — chamado aberto sem atendente também não era de
ninguém. E em `api/duvida.js` o **aviso por e-mail à equipe deixou de ser restrito à origem
`alavancagem`**: o que sustentava a exceção era a ideia de que o fluxo de planos não promete
contato ativo, mas **sem analista nem consultor ativo, a alternativa ao aviso não é "a equipe vê
no painel" — é ninguém ver**.

> ⚠️ **Depende do dono:** o aviso só sai com **`ADMIN_EMAIL`** definida no painel da Vercel
> (pendência aberta desde 14/08). Sem ela o chamado é registrado normalmente e o log diz, com
> essas palavras, `[duvida] chamado SEM aviso: ADMIN_EMAIL não definido` — a falha declara que
> falhou, em vez de sumir.
>
> **E continua valendo:** o trigger dá dono à fila, não substitui um analista. Nomear alguém
> segue sendo decisão do dono; os 42 slots livres continuam livres.

#### 🔴 O invariante ficou verde por engano — e foi corrigido no mesmo dia

Logo depois do backfill, `reuniao_solicitada_parada` **caiu de 3 para 0**. Nada tinha sido
resolvido: os três pedidos seguem em `status='solicitado'`, `reuniao_em` nulo, desde 1 e 5 de
julho. **Mudou uma coluna, não o atendimento.**

A causa era o próprio instrumento: ele media `analista_id is null` — *"parado **sem
analista**"*. Ter dono era **condição** para o atendimento acontecer, não **prova** de que
aconteceu; usar a condição como métrica faz o alarme se apagar exatamente no primeiro passo,
que é quando ele mais precisa continuar aceso. É a família de defeito da casa — *resposta de
erro entregue como conteúdo válido* — desta vez dentro da própria trava.

**A régua passa a ser o que o CLIENTE percebe:** pedido aberto há mais de 3 dias **sem reunião
marcada**, com dono ou sem (`qa_invariante_reuniao_parada_mede_o_atendimento.sql`). Acusa **3,
`alerta`** — e vai continuar acusando até alguém de fato atender. É o comportamento correto.

---

## 🔁 15/08 — REVISÃO DE TODOS OS RELATÓRIOS: forma de pagamento + proximidade das amostras

### A. Forma de pagamento — a revisão dos 52 imóveis com relatório

| | |
|---|---|
| Imóveis com relatório | 52 |
| Tratados como **à vista** | 34 |
| Com o erro detectável pelo **título** | **1** (o caso do dono) |
| **À vista SEM confirmação em documento nenhum** | **29** |
| Com pagamento confirmado em documento | 9 |

> 🔴 **E aí apareceu o achado grande.** Dos 29 sem confirmação, **21 são da Caixa** — e a
> `ficha_cef` traz **`financiamento` e `fgts` em TODOS os 24.207 lotes CEF ativos**. O dado está
> no acervo **desde a captura**, não custa nada, e não era lido em lugar nenhum.

| Situação no acervo CEF | Lotes | Gravados como à vista |
|---|---|---|
| `financiamento: true` | 218 | **8** ← erro direto |
| `fgts: true` | 7.413 | **7.191** |

**Corrigido:** os **8 lotes** com financiamento explícito passaram a `financiado` no acervo
(update aplicado). E a ficha da Caixa entrou na cascata de forma de pagamento, na posição que
lhe cabe: **documento lido > edital > ficha oficial da Caixa > título do anúncio** — é a fonte
mais barata das quatro, sem PDF e sem IA.

> **O padrão que o dia inteiro repetiu:** na maior parte das vezes a informação **já estava lá**,
> publicada pelo leiloeiro ou pelo vendedor. O defeito era não lê-la — e, pior, transformar a
> ausência numa **afirmação**.

### B. Proximidade das amostras — por evidência, não por declaração

O `perto()` era `!Number.isFinite(d) || d <= 2`: **amostra sem distância passava**. Como a
distância vem do modelo, era aprovar por omissão — **a trava nunca reprovou uma amostra sequer**
em 389.

| Grau (medido sobre as 389 já emitidas) | n | % |
|---|---|---|
| **NENHUMA âncora** → passa a ser descartada | **122** | 31% |
| fraca (outro bairro) | 109 | 28% |
| média (mesmo bairro) | 54 | 14% |
| **forte (mesmo condomínio)** → passa a receber a coordenada | **54** | 14% |
| forte (≤250 m) — já recebia | 36 | 9% |
| **forte (mesma rua)** → passa a receber | **9** | 2% |

> **Ganho duplo:** descarta as 122 sem âncora **e promove 63** que hoje são rebaixadas apesar de
> comprovadamente do mesmo lugar. Amostras no recorte mais preciso: **36 → 99 (+175%)**.

O relatório passa a carregar `mercado.proximidadeAmostras` — a assertividade vira **número
visível**, não promessa do texto. A auditoria avisa quando não há nenhuma amostra forte, ou
quando os descartes superam os aproveitados.

### C. Diagnóstico do FLUXO COMPLETO — medido, não consertado

| Etapa | Número |
|---|---|
| Lotes ativos | 30.853 |
| Com matrícula disponível | 28.883 |
| **Matrícula lida** | **428** (1,5%) |
| **`link_edital` que é HTML, não PDF** | **13.060 de 14.105 (93%)** |
| Forma de pagamento lida | 2.470 |

Funil: **56 mercadológicos → 17 documentais → 5 laudos → 3 solicitações → 0 reuniões agendadas.**

> 🔵 **A MAIOR ALAVANCA QUE SOBROU: o edital em HTML.** 93% dos `link_edital` apontam para a
> página da oferta, não para o PDF — foi por isso que o edital do lote do dono nunca foi lido e a
> forma de pagamento se perdeu. Resolver isso exige extrair o PDF da página, leiloeiro a
> leiloeiro, e **destrava condições, custos e pagamento para 13 mil lotes de uma vez**.
>
> **Também em aberto:** o Índice como funcionalidade separada (só pesquisa mercadológica e ticket
> médio de venda/locação, sem viabilidade financeira) — não implementado, é trabalho próprio. E
> as 0 reuniões agendadas com 3 solicitações merecem investigação própria.

---

## 💸 15/08 — "À VISTA" NUM LOTE ANUNCIADO COMO "ENTRADA 30% + 240X"

Achado do dono. O relatório imprimia **"Custo mensal a suportar: R$ 0,00 · Sem parcela (à
vista)"** para um lote cujo **próprio título** anuncia *"Entrada 30% + 240x"*.

> **Não é detalhe de apresentação:** a premissa de pagamento define **capital necessário na
> arrematação, custo mensal, ROI e teto de lance** — o diagnóstico inteiro. E era pior que um
> número errado: `forma_pagamento='a_vista'` alimenta `somenteAVista`, que **desabilita o botão
> do cenário financiado**. O investidor não via a opção que o edital lhe dá, e **não tinha como
> corrigir na mão**.

**Extensão no acervo ativo:** **132** lotes com entrada/parcelamento no título gravados como
`a_vista` · **164** que citam financiamento no título e também estão como à vista.

**Por que passou:** `link_edital` deste lote aponta para a **página HTML da oferta**, não um PDF
— então `condicoesEdital` ficou `null` e nada corrigiu o acervo. A informação estava no **título**
o tempo todo.

**Três correções:**
1. **Ler a condição do título.** `extrairPagamentoTexto` já pegava a entrada (30%) mas não o
   `+ 240x` — o padrão de parcelas só cobria a redação do edital ("em até 60 parcelas"). O `+` ou
   o `em` antes do número é o que separa "240x" de área/medida; testado contra
   `"medindo 20x25 metros"`, `"396m2"` e `"3x de frente"`, que **não podem** casar.
2. **O acervo deixa de ter a última palavra** contra o que o leiloeiro publicou: qualquer indício
   de parcelamento em `doc_fatos.pagamento` **destrava o cenário financiado** na tela, e a
   condição passa a ser publicada na ficha do imóvel.
3. **A inspeção final acusa** (`pagamento_contradiz_documento`, **crítico**). Vale para o inverso
   (relatório parcelado onde o edital exige à vista) e para a **hipoteca**, que muda quem paga o quê.

> É o mesmo defeito de sempre, agora na forma de pagamento: **informação que o leiloeiro
> publicou, que ninguém leu, e cuja ausência virou uma afirmação — "à vista" — em vez de uma
> pergunta.**

### ✅ Confirmações desta rodada (logs de produção, 13:16)

```
[metragem-doc]        {"leu":true,"via":"visao","deCache":true,"gastoMs":762,"matricula":234.6}
[auditoria-relatorio] {"criticos":[],"faltando":[],"avisos":["base_fina","comparaveis_de_outro_tamanho"]}
```
- A **inspeção final está rodando em produção** e já classificou corretamente.
- A matrícula agora vem **do cache** (762 ms, sem custo de IA) — o "paga uma vez por lote" funciona.
- O aluguel foi encontrado nesta rodada (**R$ 16.000/mês**), então os campos de locação deixaram
  de ser o problema deste lote.

### 🔎 O que a inspeção das AMOSTRAS mostrou (pedido do dono)

**Amostras: condizentes.** As 4 do nível 1 são do **mesmo condomínio e da mesma rua**
(Alameda das Carnaúbas / Residencial Morada dos Pinheiros). R$/m² das amostras: 5.106 · 6.111 ·
7.111 · 8.542; relatório **7.387**; Índice BidPro 6.827; FipeZAP 8.978 — **o valor cai entre as
duas referências independentes**.

**Geolocalização do imóvel: boa** — `geocod_nivel: 'rua'`, coordenada coerente com a nuvem de
lotes da cidade.

> 🔴 **Mas o georreferenciamento das AMOSTRAS não é verificado.** Das 385 amostras de nível 1 já
> emitidas, **279 (72%) não trazem distância nenhuma** — e a trava de 2 km criada em 03/08 as
> aprova **por omissão**: `!Number.isFinite(d) || d <= 2` põe *"não sei a distância"* no mesmo
> ramo de *"está perto"*. **A trava nunca reprovou uma amostra sequer** (0 acima de 2 km em 385).
> Ausência tratada como aprovação, mais uma vez.
>
> **NÃO mudei o comportamento dela, e é deliberado:** exigir distância descartaria 72% das
> amostras e esvaziaria relatórios hoje corretos por outro caminho — o nível 1 casa por
> **condomínio e endereço**, âncora de proximidade tão boa quanto coordenada (é o caso deste
> lote). Entrou só a declaração: `proximidade_nao_verificada` acusa quando não há âncora
> **nenhuma**. **Mudar a trava é decisão do dono** — afeta o Índice inteiro.

---

## 🧪 15/08 — AMOSTRA PARA O DONO REGERAR E INSPECIONAR

**Não consigo gerar por ele:** `/api/gerar-analise` exige token de usuário (`getUser(req)`), e
não se fabrica token de cliente. A amostra abaixo foi escolhida por **critério**, não por
conveniência: uma fonte por linha, cada uma exercitando um caminho de leitura DIFERENTE.

| # | Fonte | O que este caso testa | Imóvel | Área do anúncio |
|---|---|---|---|---|
| 1 | **PESTANA** | matrícula por **endpoint de API sem `.pdf`** → classificação por magic bytes | `c17e9f72-ec0a-4583-8094-dde34bcda421` · Porto Alegre/RS | 57,9 m² |
| 2 | **WEBLEILOES** | idem, **e já tem relatório antigo** → compara antes/depois | `e7bd0637-2bec-48d8-b527-7f818ac6d32a` · Guarulhos/SP | 46,08 m² |
| 3 | **CEF** | PDF da Caixa (precisa passar pelo Bright Data) | `dc88d3a8-d294-44b6-84bd-21ad544f3ffe` · Boa Vista/RR | 387 m² |
| 4 | **MEGA** | título diz **"Terreno de 378 m²"** → candidato ao mesmo defeito | `60ac13cb-f93c-44d1-8153-80e9065e2d2d` · Planaltina/GO | 378 m² |
| 5 | **SUPERBID** | mesma fonte do caso original, título diz **"ÁREA TOTAL"** | `0da0063b-c023-48ec-802f-ecb5b27be44f` · Artur Nogueira/SP | 600,3 m² |
| 6 | **VIP** | título diz **"Área total do terreno"** — divergência quase certa | `c63326c3-f147-46f8-a18c-fb7d32dc559f` · Nova Olinda do MA | 9.282 m² |
| 7 | **ZUK** | fonte **login-gated** (matrícula sob demanda) | `001b6858-e971-4556-a93e-e1fb1c21b0fb` · Taboão da Serra/SP | 135 m² |
| 8 | SUPERBID | **Morada dos Pinheiros** — já corrigido, mas o gate de auditoria subiu DEPOIS | `6dc2382e-3157-4426-b547-66f3552b4dba` | 396 m² |

URL: `https://www.bidprobrasil.com.br/#/imovel/<id>`

> **Os casos 4, 5 e 6 são os mais informativos:** o próprio título do leiloeiro já diz que a
> metragem publicada é do TERRENO / área total. Se a leitura estiver funcionando, o relatório
> tem de sair com `fonte: "matricula"` e o aviso de divergência — exatamente como Morada dos
> Pinheiros (396 → 234,6).

**Query de verificação depois de regerar:**
```sql
select left(i.titulo,42) titulo, i.fonte,
       a.result->'mercado'->'metodologia'->'area'->>'fonte'  as fonte_area,
       a.result->'mercado'->'metodologia'->'area'->>'valor'  as area_usada,
       a.result->'divergenciaArea'->>'diferencaPct'          as divergencia_pct,
       jsonb_array_length(coalesce(a.result->'auditoria'->'criticos','[]'::jsonb)) as criticos,
       jsonb_array_length(coalesce(a.result->'auditoria'->'avisos','[]'::jsonb))   as avisos,
       a.updated_at
  from analises_mercado a join imoveis_leilao i on i.id::text = a.imovel_id::text
 where a.imovel_id::text in (
   'c17e9f72-ec0a-4583-8094-dde34bcda421','e7bd0637-2bec-48d8-b527-7f818ac6d32a',
   'dc88d3a8-d294-44b6-84bd-21ad544f3ffe','60ac13cb-f93c-44d1-8153-80e9065e2d2d',
   '0da0063b-c023-48ec-802f-ecb5b27be44f','c63326c3-f147-46f8-a18c-fb7d32dc559f',
   '001b6858-e971-4556-a93e-e1fb1c21b0fb','6dc2382e-3157-4426-b547-66f3552b4dba')
 order by a.updated_at desc;
```
**Verde é** `fonte_area = 'matricula'` e `criticos = 0`. Nos logs da Vercel, a linha que conta é
`[metragem-doc]` — ela agora sai **sempre**, com `leu`, `via`, `janelaMs` e `gastoMs`.

---

## ✅ 15/08 — A MATRÍCULA DE MORADA DOS PINHEIROS FOI LIDA (confirmado em produção)

Regeração às 12:35, com o deploy da correção da variável de ambiente:
```
[matricula-visao] {"motivo":"ok","areaPrivativaM2":234.6,"areaTerrenoM2":396.8,"numeroMatricula":"5709"}
[metragem-doc]    {"leu":true,"via":"visao","gastoMs":5512,"anuncio":396,"matricula":234.6,"usadaNaBusca":234.6}
```
- `metodologia.area` → **`fonte: "matricula"`, `valor: 234.6`**
- `divergenciaArea` → **anúncio 396 × matrícula 234,6 = −41%**, agora declarado ao cliente
- `areaAlerta` → **null** (sumiu: com a área certa, os comparáveis fecham)
- O valor deixou de ser ancorado na avaliação e passou a **R$ 1.771.561** por comparáveis

> 📌 **E fica provada a hipótese:** a matrícula diz **terreno 396,8 m²** e **construída
> 234,6 m²**. O leiloeiro publicou a área do TERRENO como área do imóvel — é a origem de
> todo o problema. A leitura por visão levou **5,5 segundos**.

---

## 🔬 15/08 — INSPEÇÃO FINAL ANTES DE LIBERAR O RELATÓRIO (pedido do dono)

**Por que precisa existir:** todo defeito que chegou ao cliente neste projeto tinha a mesma
assinatura — **cada peça, isolada, parecia certa**. O que denunciava era o **cruzamento**, e
ninguém cruzava. Só em agosto: aluguel R$ 0,00 contra o Índice com 20 amostras; área 396 no
cálculo contra 234,6 na matrícula; rentabilidade em razão onde o certo era percentual.

**`api/_auditoria-relatorio.js`** roda como última etapa da geração e cruza:

| Verifica | Achado |
|---|---|
| Rentabilidade × aluguel × valor (a conta fecha?) | `yield_nao_fecha` |
| Rentabilidade sem aluguel que a sustente | `yield_sem_aluguel` |
| Yield gravado como razão (falta ×100) | `yield_sem_x100` |
| Área da metodologia × área que o cálculo usou | `area_divergente_interna` |
| Valor de mercado × preço/m² × área | `valor_nao_fecha_com_m2` |
| Preço/m² × FipeZAP **e** Índice ao mesmo tempo | `preco_m2_fora_das_referencias` |
| Aluguel ausente × locação na base própria | `aluguel_ausente_com_indice` |
| Área não confirmada havendo matrícula | `area_nao_confirmada` |
| Sem comparáveis · base fina · sem parecer/valor/preço | `sem_*`, `base_fina` |

> 🔵 **NÃO retém o relatório, e é decisão consciente.** Cliente sem nada, com a cota gasta,
> troca um erro visível por um prejuízo invisível. O achado é **declarado**: ressalva no topo
> da tela, e o indicador contraditório entra em `suprimir` e aparece como “—”. Mostrar o
> número **e** o aviso deixaria o cliente escolher em qual acreditar — que é o que não se
> quer. É a regra do projeto aplicada a ela mesma.

### 📋 REVISÃO DOS 56 RELATÓRIOS JÁ EMITIDOS

A função é **pura** justamente para poder rodar sobre o acervo sem tocar em nada:

| | |
|---|---|
| Com achado **crítico** | **13** |
| Com informação **faltando** | **3** |
| Totalmente limpos | **13** |

| Achado | n |
|---|---|
| `sem_comparaveis` | **24** |
| `area_nao_confirmada` | **15** |
| `yield_nao_fecha` | **12** |
| `sem_valor_mercado` | 3 |
| `sem_preco_m2` · `area_incoerente_com_comparaveis` · `yield_sem_x100` · `base_fina` · `aluguel_ausente_com_indice` | 1 cada |

> ✅ **Os 12 `yield_nao_fecha` são TODOS anteriores a 14/08** — data em que o servidor passou
> a calcular o yield em vez de aceitar o do modelo. **A auditoria confirma que aquela correção
> funcionou:** nenhum relatório posterior aparece. É o primeiro uso dela como instrumento de
> verificação, e não só de alarme.

> ⚠️ **Um erro meu no caminho, registrado porque é a lição da semana.** A primeira versão da
> regra do yield usava `result.valorMercado` como denominador e acusou **13** relatórios. O
> denominador certo é `consolidado.valorEstimadoImovel` — `valorMercado` pode ter sido
> **ancorado na avaliação** quando a área é suspeita, e comparar a conta com um número que não
> a originou **acusa inocente**. Só apareceu porque fui ver os números de quatro casos antes de
> reportar. Corrigida a regra: 12 dos 13 eram defeito real, 1 era da regra.

---

## 📊 15/08 — QUADROS DO RELATÓRIO SE CONTRADIZENDO: "medida ausente" virava "zero"

Achado do dono na tela do mercadológico: o resumo mostrava **"Aluguel médio R$ 0,00/mês"** e
**"Rentabilidade 0,00% a.a."** e, **duas seções abaixo**, o Índice BidPro da **mesma cidade**
exibia **R$ 37,25/m²/mês com 20 amostras**. Dois quadros do mesmo relatório, um dizendo que não
há locação e o outro mostrando locação medida.

**A construção é sempre a mesma: `fmt(x || 0)`.** A busca não achou locações, `aluguelMedio`
chega `0`/`null` — que significa *"não medi"* — e o `|| 0` o transforma num **número**, que a
tela imprime como resultado.

> **Por que é mais grave do que parece cosmético:** "R$ 0,00/mês" não é um campo vazio, é a
> **afirmação** de que o imóvel não rende aluguel. Em rentabilidade vira **conclusão de
> investimento**, e no PDF vira documento que o cliente arquiva e mostra a terceiros.

**Extensão medida nos 56 relatórios concluídos:**
| | |
|---|---|
| Com a contradição exata (aluguel 0 + Índice com locação) | **1** |
| Exibindo **"Rentabilidade 0,00% a.a."** | **8** |
| Exibindo **"Valorização 12M 0,00%"** | **14** |
| Exibindo preço/m² zero | 1 |

**Correções** (`moedaOuTraco` / `pctOuTraco` em `utils/calculos`, devolvem `—`):
- resumo, níveis 1 e 2, valorização do FipeZAP;
- PDF: aluguel líquido, VPL, **"1ª Parcela: R$ 0,00"** e **"Parcela Fixa: R$ 0,00"** (mesmo
  defeito, num número que o cliente usa para decidir financiamento);
- na **valorização** o critério é outro de propósito: valorização **negativa é dado legítimo**,
  o que não é medida ali é o **zero exato**.
- **Nota de coerência** fecha o vão: sem locação nos anúncios mas com locação na base própria,
  o relatório passa a **dizer isso**, com R$/m²/mês e nº de amostras. E explica por que **não**
  projeta o aluguel multiplicando pela área: ela pode não estar confirmada na matrícula.

> ✅ **Não precisa regerar nada.** A correção é de apresentação e lê o mesmo dado já gravado —
> os 8 relatórios com "0,00%" passam a mostrar `—` na próxima abertura.

### 📐 A área da matrícula no resumo da página do imóvel (pedido do dono)

O bloco de documentação já exibia *"Área privativa (matrícula)"* quando a leitura apura — mas o
**Resumo** seguia mostrando só a do leiloeiro: a mesma página trazia **dois números de área sem
dizer que discordavam**. Agora o Resumo mostra a da matrícula e, quando diverge mais de 10% da
anunciada, **as duas lado a lado** (`236 m² (matrícula) · anúncio: 396 m²`). O número do anúncio
deixa de passar por medida confirmada.

### 🔒 Trava `medida-ausente-virando-zero`

Acusa `fmt(x||0)` em número exibido. **Escopo:** o que o cliente recebe como laudo (`Analise`,
`ImovelDetalhe`, `*PDF.jsx`). **Fora:** painel de gestão — ali *"R$ 0,00 recebido"* é medida de
verdade, e sem esse recorte a regra acusaria 7 linhas legítimas do Admin. Não acusa
`x > 0 ? fmt(x) : '—'` nem `||0` neutro dentro de conta com guarda externa.

> ⚠️ **Dois defeitos da própria trava, corrigidos antes de subir** — e valem como método:
> 1. o regex era `fmtPct?\(`, em que o `?` vale **só para o `t`**: casava `fmtPc(` e deixava
>    passar **`fmt(`**, que é a metade mais comum dos casos;
> 2. o escopo inicial pegava o Admin.
>
> Os dois só apareceram porque **testei a regra contra as formas boas e ruins** antes de
> confiar nela. É a regra que assumi hoje de manhã: *trava nova só vale depois de vê-la
> acusar um caso que você sabe que existe — e ignorar um que você sabe que é legítimo.*

### 🟠 O que NÃO foi feito (para não passar por completo)

A varredura foi da **classe** de defeito que o dono mostrou — zero-como-afirmação — e ela está
coberta nos três relatórios (`DocumentalPDF` e `LaudoPDF` já não tinham nenhuma ocorrência, e a
trava agora vigia os três). **Não** houve revisão texto a texto de cada parágrafo do documental
e do laudo, nem auditoria de todos os cruzamentos possíveis entre seções. Os cruzamentos
tratados hoje foram os dois concretos: **aluguel × Índice BidPro** e **área do anúncio ×
matrícula**.

---

## 🚨 15/08 (tarde) — A CORREÇÃO DA MATRÍCULA NÃO CORRIGIA NADA: variável de ambiente errada

O dono regerou o mercadológico de Morada dos Pinheiros às 12:01, **depois** do deploy, e a área
continuou vindo do anúncio. **A causa é minha, e tem três camadas — as três valem como aula.**

### 1. A causa raiz: `CLAUDE_API_KEY` não existe. O projeto usa `CLAUDE_KEY`.

A guarda na primeira linha de `matriculaPorVisao` era `if (!process.env.CLAUDE_API_KEY) return null`.
O nome certo é **`CLAUDE_KEY`**, usado em 27 arquivos. A guarda batia **sempre**, a função
devolvia `null` antes de fazer coisa alguma, e a leitura por visão **não rodou uma única vez**.

> **Por que isso é grave além do próprio bug:** o desfecho é *idêntico* a "o documento não tem a
> área" — que é exatamente o defeito que a função foi escrita para corrigir. `process.env.X`
> inexistente é `undefined` em silêncio: **compila, passa no lint, passa no build**, e nenhuma
> ferramenta do projeto pegava.

### 2. Não havia como ver: a função saía calada

O log da geração das 12:00 **não tinha uma linha sobre matrícula** — nem sucesso, nem falha, nem
"tentei". E o `[metragem-doc]` só era emitido **quando a leitura dava certo**, ou seja, calava-se
justamente no caso que precisava ser investigado. Agora:
- `[matricula-visao]` registra **toda** desistência com motivo (sem chave, host bloqueado, sem
  tempo, download falhou, formato ilegível, IA errou, IA não achou metragem, ok);
- `[matricula-extrato]` registra o desfecho da cascata (candidatos, se sobrou parcial, sobra de tempo);
- `[metragem-doc]` virou **incondicional**, com janela, gasto e restante em ms.

### 3. E o orçamento de tempo não cabia — nem com a chave certa teria funcionado

A janela de colheita era `min(16s, restante − 210s)`. Quando a leitura do endereço no documento
consome tempo — **foi o caso**, o log mostra `[endereco-busca] rua:true` — o `restante()` cai
abaixo de 210s, a janela vira **zero** e o `colher` resolve `null` no mesmo instante. A "segunda
chance" mais adiante esperava **2,5 s**, e uma leitura por visão leva dezenas de segundos: era
decorativa.

Agora a janela vem do tempo realmente disponível — até **45 s** na primeira colheita, **30 s** na
segunda. A metragem não é enfeite: **todo o valor de mercado pendura nela**, e a busca de
comparáveis precisa do tamanho certo antes de sair procurando. Também: `urlParaVisao` passa a
nascer com o primeiro candidato — antes, se o laço saísse por fim de orçamento antes de processar
qualquer um, a visão nem era tentada.

### 🔒 Trava nova: nome de variável de ambiente que não existe

Regra: nome usado em **um** arquivo cujos segmentos contêm os de outro usado em **dois ou mais**
é quase sempre typo (`CLAUDE_API_KEY` ⊃ `CLAUDE_KEY`, 1 contra 27). Três pares legítimos do
acervo entram como exceção declarada em `ENV_PARES_LEGITIMOS` (`ONR_ALERT_EMAIL`,
`GOOGLE_ADS_LOGIN_CUSTOMER_ID`, `ADMIN_ALERT_EMAIL`). **Provado nos dois sentidos:** passa no
código correto, reprova com o erro reintroduzido e aponta o arquivo.

> A trava tropeçou uma vez antes de ficar de pé, e vale registrar: usei o removedor de
> comentários do verificador de schema e ele **se perdeu neste arquivo** — as regras aqui são
> regexes literais cheias de aspas (`['"]`), o parser lê cada aspa como início de string e
> dessincroniza; o comentário de bloco sobrevivia e a trava acusava a **própria documentação**.
> Agora o comentário é ignorado **por linha**, o que para achar `process.env.X` basta e não tem
> como se perder.

### ✅ O QUE CONFERIR NA PRÓXIMA GERAÇÃO

Regere o mercadológico do lote e olhe **primeiro o log**, não o relatório:
```
[metragem-doc]  {"leu":true,"via":"visao","matricula":236,...}
[matricula-visao] {"motivo":"ok","areaPrivativaM2":236,...}
```
E no banco:
```sql
select result->'mercado'->'metodologia'->'area' as area, result->'divergenciaArea' as divergencia
  from analises_mercado where imovel_id::text='6dc2382e-3157-4426-b547-66f3552b4dba'
 order by created_at desc limit 1;
```
**Verde é** `fonte: "matricula"` com `valor: 236`. **Se falhar de novo, o log agora DIZ o motivo** —
é essa a diferença desta rodada para a anterior.

> ℹ️ **Sobre os "118 m²" que apareceram na tela:** é o número inferido
> (`avaliação ÷ R$/m²` = 893.125 ÷ 7.575). Ele **saiu do código** no deploy das 11:55 e não é
> mais exibido; se ainda aparecer, é o bundle antigo no navegador — recarregue com
> Ctrl+Shift+R. O problema de fundo nunca foi o texto: era a matrícula não ser lida.

---

## 🔎 15/08 (fim do dia) — INSPEÇÃO 360 DO USO REAL + revisão de não-regressão

Pedido do dono: garantir que os erros do dia não voltem, e inspecionar o sistema **pelo uso
real dos últimos dias**, logados e visitantes.

### A. O funil do VISITANTE (sem conta) — 7 dias, medido

| Etapa | Pessoas | % do topo |
|---|---|---|
| Visitantes únicos | **166** | 100% |
| Saíram na 1ª página | 63 | 38% |
| **Abriram um lote** | **69** | **42%** |
| Viram planos | 15 | 9% |
| Clicaram em "criar conta" | 13 | 8% |
| Chegaram no login | 24 | 14% |
| Contas criadas (7d) | ~10 | 6% |

Média de 3,6 páginas por visitante. **Entrada:** 73 pessoas pelo Google (84 pageviews, 37 rotas
distintas — as páginas de SEO estão trazendo gente), 18 diretas, 1 pelo Bing.

> **A leitura:** o topo funciona — 42% abrem um lote. **A queda dura é de lote → planos** (69 →
> 15). Quem vê o imóvel raramente chega à oferta. Isso conversa com o gargalo de conversão de
> 14/08 (39 de 44 clientes no plano grátis): o problema não é atrair, é converter.

### B. O que os LOGADOS fizeram — 7 dias

| Papel | Pessoas ativas | Pageviews | Erros |
|---|---|---|---|
| explorador | 11 | 144 | 3 |
| admin (você) | 1 | 485 | 13 |
| top2 | 1 | 38 | 0 |
| assessorado | 1 | 8 | 0 |

**Relatórios: 19 mercadológicos concluídos, 3 documentais, 0 laudos. Zero com status de erro.**

> 🔴 **O número que explica o caso de Morada dos Pinheiros:** 19 mercadológicos para 3
> documentais significa **16 relatórios de mercado gerados sem que ninguém lesse a matrícula**.
> O caso que você achou **não é exceção — é o padrão**, e é exatamente o que a correção de hoje
> (leitura por visão + cascata por formato) ataca. O invariante
> `relatorio_area_nao_confirmada` (15, limite 2) é o placar dessa correção.

### C. Erros que os clientes tomaram — e o que é bug, o que não é

| Alvo | N (7d) | Pessoas | Veredito |
|---|---|---|---|
| `login_falha` | 15 | 8 | "Email not confirmed" e senha errada — **atrito real**, ver abaixo |
| `/api/proximidades-imovel` 502/504 | 9 | 3 | **NÃO é bug.** É o comportamento deliberado de 10/08: quando o Overpass não responde, devolve 502 `retryable` para a tela dizer "tentar novamente" em vez de mentir "não há nada por perto". O tracker registra como `api_erro` — **não confunda com falha** |
| `cadastro_falha` | 8 | 3 | **Era bug de fluxo. Corrigido hoje** (ver D) |
| `gerar-analise` | 5 | 1 | Timeouts/500 esparsos, todos na sua conta; nenhum relatório ficou com status de erro |
| `/api/coleta-cliente` 401 | 2 | 1 | Chamada sem sessão na home; sem efeito para o cliente |

### D. 🔴 O CADASTRO: informar não é impedir (corrigido hoje)

Em 12/08 a lista de requisitos de senha ao vivo entrou justamente porque um visitante tentou
cinco vezes e foi embora sem conta. **Mas ela informa e não impede:** o botão continuou
aceitando o clique com senha inválida, e o erro só aparecia depois de enviar.

**O rastro prova que não bastou** — houve recusa em **13/08 (duas seguidas, mesma pessoa)** e
outra em **15/08**, de pessoas diferentes, ambas **posteriores** àquela correção. Agora a senha
entra no gate do botão, e a regra virou constante única (`SENHA_FORTE`) usada na validação e no
gate — estava duplicada em dois lugares.

### E. Revisão de não-regressão — cada erro de hoje × a trava que o pega

| Erro de hoje | O que impede a volta | Estado |
|---|---|---|
| Backup copiando espelho, 0 arquivo de cliente | invariante **`backup_sem_arquivo_cliente`** (novo) | acusa **342** hoje; deve zerar amanhã |
| `perfis.whatsapp` inexistente | `verificar:schema` estendido a `.select()` | 280 pares conferidos, 0 falso-positivo |
| Área do relatório não confirmada | invariante **`relatorio_area_nao_confirmada`** | acusa **15** (limite 2) |
| Documento ilegível virando texto | `_doc-leitura.js` + log `[lerDoc] formato não legível` | 11 formatos testados |
| Cabeçalho de `/leiloes` fora do padrão | **`/leiloes` entrou no `verificar:responsivo`** | era a rota que ninguém media |
| Cadastro recusado após o clique | gate de senha no botão | — |
| Pisca de tela no login | *sem trava automática* | **lacuna assumida**: é comportamental, e nenhuma trava barata pega |

> ⚠️ **Dois erros MEUS no caminho, registrados porque a lição é a do dia.** A 1ª versão do
> invariante do backup comparava o manifesto ATUAL (49, já corrigido) com o processado da
> execução ANTIGA (658) e dava **0 por subtração negativa** — verde acidental dentro da trava
> escrita para pegar verde acidental. E a 2ª versão **não chegou a aplicar**: o
> `regexp_replace` levava a flag `'n'`, que impede o ponto de atravessar quebra de linha, então
> o replace não casava, o `def` voltava intacto e o `execute` recriava a função **idêntica, em
> silêncio**. Só apareceu porque conferi o valor contra a execução real (1000−658−0 = 342).
> **Trava nova só vale depois de vê-la acusar um caso que você sabe que existe.**

---

## 🚀 15/08 — TUDO DO DIA ESTÁ EM PRODUÇÃO (`main` em `ea5b874`)

Deploy `dpl_2usPX1LTe7vTPoDGCEPKoW1TMurv` **READY**, com `www.bidprobrasil.com.br` apontando
para ele. Zero erro de runtime e zero `erros_cliente` nos 30 min seguintes.

> ⚠️ **ARMADILHA DO REPOSITÓRIO LOCAL, para a próxima sessão não cair nela.** O branch `main`
> **local** deste ambiente estava numa **história não relacionada**, parada em 10/08
> (`8a3547d`, "Fechamento de 09/08"): `git checkout main && git merge` respondeu
> **"refusing to merge unrelated histories"** e trocou o working tree por arquivos de 6 dias
> atrás. Nada se perdeu — o trabalho estava commitado e empurrado —, mas um merge feito às
> pressas ali teria criado uma bagunça de verdade.
> **O `main` de verdade é o `origin/main`.** Conferido antes de subir: o `main` local não tinha
> **nenhum** commit posterior a 10/08, então era linha órfã (resquício de reescrita de
> história), e o `origin/main` (`b7bf990`) era ancestral direto da branch do dia.
> **O que funcionou, e é o caminho a repetir:**
> ```bash
> git push origin <branch-do-dia>:main   # fast-forward b7bf990..ea5b874
> git branch -f main origin/main         # realinha o local e desarma a armadilha
> ```
> O `main` local **já foi realinhado** nesta sessão, então a pegadinha não deve reaparecer.

**Validação rodada antes de subir** (o checklist do CLAUDE.md, mais o que dava para medir):
| | |
|---|---|
| `npm run build` limpo (com `verificar:padroes` + `verificar:sintaxe`) | ✅ |
| `verificar:responsivo` — 7 rotas × 6 larguras, app **hidratado** | ✅ zero achados |
| `/leiloes` em 6 larguras + menu aberto em 320px | ✅ zero achados |
| Deriva código × banco — 87 tabelas e ~290 colunas contra o schema real | ✅ zero |
| `auditoria_seguranca()` · `auditoria_regras_negocio()` | ✅ 0/0 · 0 crítico |

> O `verificar:schema` não roda neste ambiente (não há `SUPABASE_SERVICE_KEY` aqui). A
> verificação equivalente foi feita **pelo MCP**, extraindo as referências com
> `verificar-schema-codigo.mjs --listar` e conferindo tabela a tabela contra
> `information_schema`. O CI continua sendo quem roda a trava de verdade.

---

## 🩺 ABERTURA DE 15/08 — o backup off-region não copiava NADA do cliente há 4 dias

> Ritual rodado às 10h30 UTC. Heartbeat carimbado. **Segurança 0/0 · regras de negócio 0 crítico
> · nenhuma fonte abaixo do piso aprendido · KYC 0 · chamado de cliente sem resposta 0 ·
> relatórios com falha em 24h: 0.** Dois achados, os dois consertados hoje — e os dois da mesma
> família: **número plausível cobrindo uma falha que não sabe que falhou.**

### 🔴 1. O backup off-region copiava 100% espelho e 0% arquivo de cliente

**Sintoma que estava à vista e foi lido errado:** `ok: false` com `falhas: 0` e
`arquivos_iguais: 0` nos dias 12, 13, 14 e 15/08. O CLAUDE.md ensina a ler isso como "o job está
atrás do crescimento diário" — e foi assim que passou em 14/08. **Era outra coisa.**

**Medido hoje:** o manifesto tinha **11.878 arquivos / 17 GB**, num cron desenhado para ~50
arquivos / ~14 MB. E dos 49 uploads irrecuperáveis — KYC, contrato, comprovante, matrícula
manual — **49 estavam FORA da janela**. Zero copiados. Os `658 arquivos novos` da rodada de hoje
eram 658 PDFs de leiloeiro.

| | 12/08 | 13/08 | 14/08 | 15/08 |
|---|---|---|---|---|
| "arquivos novos" | 668 | 613 | 736 | 658 |
| arquivos de cliente entre eles | **0** | **0** | **0** | **0** |

**Causa-raiz, em duas partes que só juntas produzem o efeito:**
1. **O filtro anti-raspado ficou para trás.** A regra do desenho é "o que vem do leiloeiro fica
   de fora, é recuperável pela captura", escrita como `name not ilike '%_auto%'`. O espelhamento
   de documentos (`api/espelhar-docs-cron.js`) nasceu **depois** gravando `espelho/FONTE/<id>/…`,
   sem esse sufixo — e entrou inteiro no manifesto.
2. **`order by updated_at desc` + truncagem do PostgREST.** O espelho grava centenas por dia
   (3.169 objetos mexidos em 24h) e ocupava sozinho o topo da ordenação, empurrando para fora das
   1.000 linhas os uploads humanos, que quase nunca mudam. Daí `arquivos_iguais: 0` todo dia: o
   conjunto dos 1.000 mais recentes muda diariamente. **Uma cópia que nunca converge, do material
   que nem precisava ser copiado.**

> ⚠️ **A leitura que quase repetiu o erro de ontem:** `arquivos_novos: 658` parece progresso.
> Progresso e trabalho inútil produzem o mesmo número — só a composição os separa, e o painel não
> mostrava composição. `rows.length` = 1.000 era indistinguível de "o manifesto tem 1.000
> arquivos": **corte entregue como conteúdo**, a forma nº 5, num job cuja única razão de existir
> é proteger o arquivo do cliente contra perda definitiva.

**Correções** (`backup_manifesto_exclui_espelho_e_declara_total.sql`, **já aplicada no banco**, +
`api/backup-r2-cron.js`):
- `espelho/` sai do manifesto → **de volta a 49 arquivos / 14 MB**, o desenho original.
- **Ordenação invertida** (mais antigo primeiro): se o orçamento de tempo cortar a fila de novo,
  quem fica para depois é o recém-criado, não o arquivo velho que nunca foi copiado.
- **A função declara o `total` REAL em cada linha** e o cron compara recebido × existente. Com
  truncagem detectada o run não pode ser `ok` e a limpeza de órfãos não roda — apagar com base em
  listagem parcial removeria justamente as cópias insubstituíveis. Vale para qualquer crescimento
  futuro, não só para este.

> 📌 **Efeito colateral que também se resolve:** a limpeza LGPD (passo 3 — o que sai da origem tem
> de sair do backup) estava **pulada desde 11/08** com `storage_incompleto`, porque a fila nunca
> terminava. Com o manifesto no tamanho certo ela volta a rodar.
>
> ✅ **CONFERIR NA PRÓXIMA ABERTURA** (o cron roda 04:43 UTC de 16/08):
> ```sql
> select executado_em, ok, arquivos_total, arquivos_novos, arquivos_iguais, falhas,
>        detalhe->'storage'->>'truncado' as truncado, detalhe->'limpeza'->>'pulada' as limpeza
>   from backup_execucoes order by executado_em desc limit 3;
> ```
> **Verde é:** `ok: true` · `arquivos_total: ~49` · `truncado: null` · `limpeza.pulada: null`. Na
> 1ª rodada `arquivos_novos` deve ser ~49 (nenhum estava lá); da 2ª em diante, `arquivos_iguais`
> alto e `novos` perto de 0 — **é `iguais` subindo que prova que a cópia converge.**
>
> 🔵 **DECISÃO DO DONO (não é urgente, mas é uma escolha real):** o espelho ficou **sem cópia
> off-region**. Ele é PDF público do leiloeiro, e existe justamente porque o leiloeiro pode tirar
> o arquivo do ar — então não é 100% recapturável. Excluí-lo restaura o desenho e é o certo hoje
> (17 GB não podem competir com 14 MB pelo mesmo tempo de execução). Se você quiser o espelho
> protegido também, isso é **manifesto próprio, com orçamento próprio** — e custo de R$ no R2 a
> dimensionar. Nunca a mesma fila.

### 🔴 2. `/alavancagem` pedia `perfis.whatsapp` — coluna que nunca existiu

Achado em `erros_cliente`: `Supabase 400 em "perfis": column perfis.whatsapp does not exist`, na
tela que subiu ontem. A única coluna de contato em `perfis` é `telefone`.

**O que o cliente via:** o `error` era conferido (o comentário de ontem previa isso), então a tela
não quebrava — ela mostrava o cliente logado **sem telefone nenhum**, e o lead chegava à equipe
**sem número e sem o botão de WhatsApp** do aviso. Numa tela que promete "alguém da equipe entra
em contato", o contato é o produto. **Corrigido** (`src/pages/Alavancagem.jsx`).

### 🔒 3. A trava de schema passa a conferir as colunas pedidas em `.select()`

Era a lacuna exata que deixou o item 2 passar: `perfis` existe e `whatsapp` não é coluna de data —
nem o item 1 nem o item 2 do `verificar:schema` a alcançavam. Agora um terceiro item confere
**toda coluna pedida em `.select('a, b, c')`** contra o schema real.

**Conservador por desenho:** o `select` do PostgREST aceita embed (`perfis(nome)`), alias, cast,
json path e `*`; se o literal contiver qualquer coisa fora de identificadores simples separados
por vírgula, ele é **ignorado por inteiro**. Uma trava que grita errado é desligada pela equipe em
uma semana. **Medido:** 280 pares tabela.coluna conferidos contra o banco → **zero falso-positivo,
zero achado além do `whatsapp`**; e com o bug reintroduzido, ela reprova.

### 🎨 4. O cabeçalho de `/leiloes` voltou ao layout do app (pedido do dono)

A revisão de 14/08 acertou tinta e fonte, mas manteve **medidas próprias** — e era isso que
quebrava a continuidade ao navegar entre a página pública e o app:

| | Antes (`/leiloes`) | App (`Header.jsx`) | Agora |
|---|---|---|---|
| Faixa | 1080 | **1280** | 1280 |
| Logo | 34px | **40px** | 40px |
| Sub-linha "LEILÃO & INVESTIMENTOS" | tinha | **não existe** | removida |
| Links de navegação | **nenhum** | Home · Calculadora · Buscar Leilões · Planos | os 4, mesma ordem |
| Botão | só CTA azul | "Entrar" com borda #334155 | Entrar **+** CTA |

O menu do celular virou um **`<details>`** — o hambúrguer do app em HTML puro, no mesmo ponto de
virada de 768px. **Nenhuma linha de JS** foi acrescentada: a página continua pronta no HTML que o
servidor devolve, que é o que a faz servir para o robô do buscador.

> O **"Criar conta grátis" ficou**, e é uma escolha: ele não existe no app, mas aqui é o CTA da
> página de aquisição — o principal ativo de SEO. Tirá-lo custaria conversão sem aproximar o
> layout. Se você preferir o cabeçalho idêntico ao app, é só remover os dois `<a class="cta">`.

**Medido:** `/leiloes` em 6 larguras (320→1280), zero achados, com o menu aberto em 320px sem
vazar. ⚠️ `/leiloes` **não estava** nas 7 rotas testadas em 14/08 (ela é servida por
`api/publico.js`, fora do SPA) — vale incluí-la nas próximas varreduras.

### ⚡ 5. O pisca de tela ao entrar — validado, e não era impressão

**Causa:** `loading` do AuthContext começa `true` e o `getSession()` é assíncrono, então
`isLoggedIn` vale `false` no primeiro render **mesmo com sessão válida no storage**. E
`src/App.jsx:300` decidia a rota `/` só por `isLoggedIn` — **a única decisão de conteúdo do
arquivo que ignorava `loading`**, enquanto `PrivateRoute` e `ImovelRota` logo acima já esperavam.
Resultado: quem estava logado via a **Landing de visitante** por um instante, e a tela trocava
sozinha. Acontece **no login, no F5 e ao reabrir o PWA**.

O cabeçalho fazia a metade de cima do mesmo pisca: durante o `loading` ele mostrava o menu
público e o botão **"Entrar"** — e dizer "Entrar" para quem acabou de entrar é a leitura mais
parecida com "o login não funcionou". O comentário no código dizia que isso *evitava* flash; não
evitava, só escolhia **qual** flash mostrar.

**Correção:** enquanto o auth não resolve, o cabeçalho não afirma nada e a rota `/` mostra o mesmo
spinner do `Suspense`. Custo para o visitante: nenhum na prática — sem sessão o AuthContext faz
`setLoading(false)` **sem ir à rede** (lê o localStorage).

> 🔬 **Até onde a validação foi, com honestidade.** A causa é determinística e foi confirmada por
> leitura: `loading` inicia `true`, `getSession()` é Promise, os providers **não** bloqueiam o
> render (ambos devolvem `{children}` sempre), e a rota `/` era a única sem o guarda. **O que eu
> NÃO consegui** foi reproduzir com uma sessão real: o navegador deste ambiente não alcança a
> internet (proxy) e não há credencial de cliente — plantar um token forjado trava o supabase-js
> antes do React montar, que é artefato do ambiente, não do produto.
> **O teste de 10 segundos, que só você pode fazer:** entre no site, aperte **F5** na tela inicial
> e veja se a landing de visitante ainda pisca antes da sua Home. Depois do deploy, não deve mais.

### 📐 6. A METRAGEM DA MATRÍCULA — a leitura nunca rodou, e a conta virou medida na tela

**Achado do dono**, num relatório de Morada dos Pinheiros gerado às 10:53 de 15/08: lote
anunciado com **396 m²**, casa de **236 m²** na matrícula, relatório mostrando **~129 m²**.

> 🔵 **NÃO É A IA — e isso importa antes de qualquer decisão de trocar de modelo.** Nenhuma IA
> leu a matrícula neste relatório. A metragem é lida por **regex determinístico** (custo zero),
> e o regex não achou nada. Os 129 m² não vieram de leitura nenhuma: são
> `avaliação ÷ R$/m² dos comparáveis` = `893.125 ÷ 6.903 = 129`. O front imprimia isso como
> *"os comparáveis indicam cerca de 129 m² privativos"*. **Trocar o modelo não mudaria nada**,
> porque nenhum modelo foi consultado nesse ponto. Os comparáveis da IA (R$ 6.903/m² em
> Morada dos Pinheiros) estão plausíveis; o que estava errado era a metragem embaixo deles.

**A extensão, medida — não era caso isolado:**
| | |
|---|---|
| Lotes ativos com matrícula disponível | **28.355** |
| Deles, com a área lida (`ficha_juridica`) | **5** (0,02%) |
| Relatórios de mercado com `metodologia.area.fonte = 'matricula'` | **0**, de 56 |
| Relatórios em 7 dias com matrícula disponível e área não confirmada | **15** |

O caminho "confirmar a metragem ANTES de pesquisar" existe **desde 06/08** e **nunca chegou a
rodar em produção**. Ninguém media a taxa de sucesso dele — e o defeito é justamente do tipo
que não aparece: sem área da matrícula, o relatório **segue** com a do anúncio, sem erro.

**As quatro correções, em ordem de custo:**
1. **Regex ampliado (custo zero).** Três redações comuns de matrícula de casa escapavam:
   `área construída: 236,00 m²` (o `\s+` era obrigatório antes do separador, e não há espaço
   antes dos dois-pontos), `área EDIFICADA de …` (qualificador que faltava na lista) e
   `casa com 236,00 m² de área construída` (número antes do qualificador). **Medido:** 11
   redações extraem 236, e `área comum` / `fração ideal` / terreno sem benfeitoria continuam
   **não** virando área privativa.
2. **Fallback por VISÃO — o degrau que faltava.** Matrícula escaneada não tem camada de texto e
   **nenhum regex a resolve**: era a causa real dos 0%. Chamada curta (só as três áreas e o
   número, `max_tokens: 300`), gravada em `doc_extracoes` **por imóvel** — paga-se **uma vez por
   lote** e mercadológico, documental e laudo herdam. Confiança 85: acima do regex (60), abaixo
   da visão completa do documental (90), que continua mandando.
   > Junto, um caso que anulava a cascata: quando o regex lia **só o terreno**, a função
   > retornava satisfeita. É o pior desfecho possível para dar por encerrado — é o **mesmo
   > número que o anúncio já trazia**, e devolvê-lo fazia o relatório seguir com a área do lote
   > achando que tinha confirmado a do imóvel.
3. **O número inferido saiu da tela.** O aviso agora diz o que se sabe (a área do anúncio não se
   sustenta contra os comparáveis) sem afirmar o que não se sabe, e aponta o caminho real:
   gerar o documental, que lê a matrícula.
4. **A origem da metragem passa a ser declarada.** O gerador já gravava
   `metodologia.area.fonte`, e o comentário dele afirmava que `'acervo'`/`'informada'` seria
   *"declarado ao cliente"* — **o campo era gravado e nunca lido no front**. A metragem do
   anúncio aparecia com a mesma cara de um dado conferido. E o aviso de área suspeita só dispara
   quando os comparáveis passam de **3×** o R$/m² da avaliação: **abaixo disso o erro passava
   inteiramente calado**, que é o caso mais comum.

**Para não voltar:** invariante **`relatorio_area_nao_confirmada`** vigia o DESFECHO — relatório
dos últimos 7 dias, com matrícula disponível, cuja área não veio dela. Hoje **15** (limite 2). É
o número que tem de cair.

> ⚠️ **O QUE FALTA CONFERIR, e depende de rodar em produção.** A rede externa deste ambiente é
> bloqueada, então **não consegui baixar o PDF da matrícula** para confirmar os 236 m² nem medir
> se o regex novo sozinho já resolveria esse caso (suspeita: o PDF é escaneado, e aí quem
> resolve é a visão). **Depois do deploy, regere o mercadológico desse lote** e confira:
> ```sql
> select a.result->'mercado'->'metodologia'->'area' as area,
>        a.result->'divergenciaArea' as divergencia, a.created_at
>   from analises_mercado a where a.imovel_id::text='6dc2382e-3157-4426-b547-66f3552b4dba'
>  order by a.created_at desc limit 2;
> ```
> **Verde é** `fonte: "matricula"` e `valor: 236`. Se vier `divergenciaArea` apontando
> 396 → 236, melhor ainda: é o aviso explícito de que anúncio e matrícula discordam. O log
> `[matricula-visao]` na Vercel mostra quando a visão entrou.

### 📄 7. A leitura de documento passa a depender do CONTEÚDO, não da extensão da URL

Pedido do dono, na sequência do item 6: **ler a documentação seja qual for o formato e seja
qual for o relatório**. Mapeando o acervo apareceram duas lacunas reais — não hipotéticas:

| Lacuna | Tamanho no acervo |
|---|---|
| **URL sem extensão** — PESTANA/WEBLEILOES/CALIL servem o documento por endpoint de API (`.../lotes/424396/matricula/6863598`) | **10.263** documentos ativos, dos quais **~2.100 são MATRÍCULAS** |
| **Binário não-PDF virando texto** — os dois caminhos terminavam num `buf.toString('utf8')` | 3 imagens hoje, mas **qualquer** formato novo cairia aí |

> 🔴 **A segunda é a mais perigosa e é a forma nº 1 do CLAUDE.md.** Uma matrícula
> **fotografada** (JPEG/PNG) virava uma tira de caracteres aleatórios e seguia adiante como
> "texto do documento" — no documental, **ia dentro do prompt**. A IA respondia sobre nada e o
> sistema registrava que tinha lido. Todo o código decidia o tipo perguntando "termina em
> `.pdf`?", e nenhuma das ~2.100 matrículas de API responde sim a essa pergunta.

**`api/_doc-leitura.js`** centraliza a decisão e classifica por **magic bytes** — nunca pela
URL, nunca só pelo content-type (leiloeiro manda `application/octet-stream` para PDF o tempo
todo). O que não dá para ler volta `desconhecido` **com motivo**, nunca como texto vazio — que
é indistinguível de "o documento não diz nada".

**Cobertura depois da mudança:**

| Formato | Mercadológico | Documental |
|---|---|---|
| PDF com camada de texto | regex (custo zero) | `document` |
| **PDF escaneado** | **visão** | `document` |
| **Imagem JPG/PNG/GIF/WebP** | **visão** | **`image`** (antes: lixo no prompt) |
| **URL sem extensão** | **magic bytes** | **magic bytes** |
| TIFF / BMP / DOCX / zip | declarado com motivo | declarado com motivo |

O **laudo** herda de graça: ele consolida mercadológico + documental, não lê documento próprio.

**Três correções que apareceram no caminho:**
- **`temTextoUtil`** separa *"PDF sem camada de texto"* de *"documento que não diz a área"*.
  Eram tratados igual — e é por isso que 28.355 matrículas disponíveis rendiam 5 áreas lidas:
  o escaneado devolve um punhado de caracteres de cabeçalho, o regex não acha nada, e ninguém
  escalava para a visão.
- **A dedup por conteúdo do documental** hasheava `doc.text`, que está vazio num bloco de
  imagem: todas as imagens dariam o **mesmo hash** e, da segunda em diante, cada uma seria
  descartada como duplicata. (Bug que a própria mudança teria criado, pego antes de subir.)
- **O passe focado** que resgata CPF/nome/processo filtrava só blocos `document`; passa a
  incluir `image` — que é justamente onde mora a página escaneada que ele existe para ler.

> 🔵 **DECISÃO CONSCIENTE — TIFF, BMP e DOCX ficam declarados, não convertidos.** A API não os
> aceita e converter exigiria dependência de imagem nova (`sharp`, ~30 MB com binário nativo)
> numa serverless, para um acervo que hoje tem **3 imagens no total**. O motivo vai ao log
> (`[lerDoc] formato não legível`), então **o dia em que passarem a aparecer, aparece medido** —
> e aí a decisão é informada, não adivinhada. Se quiser antecipar, é meia hora de trabalho.

**Medido:** 11 formatos classificados corretamente, incluindo os 4 que a IA não lê (recusados
com motivo, sem virar texto) e o binário aleatório.

### 🟠 O que NÃO consertei — e por quê

| O quê | Estado | Leitura |
|---|---|---|
| `proximidades_vazio_falso` **745**/300 (era 440 em 13/08, 666 em 14/08) | aberto | **Medi a composição hoje e ela muda o diagnóstico:** são lotes capturados em **13–15/08** (PESTANA 263, LJUD 153, GRUPOLANCE 107), não acervo antigo. Não é relatório mentindo — é a **fila do job OSM (05h UTC) andando mais devagar que a captura**. O limite de 300 mede uma coisa e o alerta virou outra. A calibragem continua sendo sua decisão, mas agora com a causa certa |
| `bd_teto_saturado` 480/405 | aberto | Decisão sua marcada para **18/08** |
| `cadastro_barrado` **8**/7 (alerta novo) | aberto | Todas as 8 são a MESMA mensagem: senha fora da regra. **5 delas em 3 minutos, do mesmo cadastro (12/08 15:13–15:16)** — alguém tentou cinco vezes e não conseguiu criar conta. Vale conferir se a tela mostra os requisitos ANTES de tentar, não só depois de recusar |
| `relatorio_yield_sem_x100` 1/0 | aberto | O relatório de Sorocaba, esperando regeração (o dado de ENTRADA é que está errado) |
| Os ~22 chamados sem aviso | aberto | Decisão sua, herdada de 14/08 |

---

## 🏁 FECHAMENTO DE 14/08 — leia ESTE bloco primeiro

**O dia foi de três naturezas diferentes, e misturá-las confunde:** (a) consertos que foram para
produção, (b) uma tela nova de Alavancagem, (c) um **planejamento longo que NÃO é código** e não
pode aparecer para cliente nenhum.

### 1. O que entrou em PRODUÇÃO hoje

| O quê | Onde |
|---|---|
| **Tela `/alavancagem`** (Home Equity + Consórcio) e o card na home | `src/pages/Alavancagem.jsx`, `src/pages/HomeCliente.jsx` |
| Aviso à equipe quando chega interesse de alavancagem | `api/duvida.js` |
| Página pública do lote no código da marca | `api/publico.js` |
| Três atritos do cadastro (termos repetidos, vídeo, parada na tela de planos) | `Login.jsx`, `TriagemPerfil.jsx`, `CompletarCadastroModal.jsx` |
| Região de interesse deixando de ser apagada pela triagem + trigger que a deriva da cidade | migrações `perfis_regiao_*` |
| Botões flutuantes sobrepondo a barra de ações e contador de análises fora da barra fixa | `App.jsx`, `ChatSuporte.jsx`, `ImovelDetalhe.jsx` |

> ⚠️ **DEPENDE DO DONO, e é de um minuto:** o aviso usa `ADMIN_EMAIL` (nome da variável; valor no
> painel da Vercel). **Se ela não estiver definida em produção, o e-mail não sai** — o código
> registra `[duvida] lead de alavancagem SEM aviso` no log, mas o lead continua salvo. Vale mandar
> um interesse de teste pela tela e confirmar que o e-mail chegou.

### 2. A tela de Alavancagem — o que ela é, e o que ela NÃO é

É **material explicativo + sinalização de interesse**. Não é ficha de proposta, não aprova nada,
não simula contratação. Os dois botões abrem o mesmo formulário curto.

**Para onde vai o interesse** (perguntado pelo dono):

`formulário` → `POST /api/duvida` → **lead em `sdr_leads`** (sem duplicar por e-mail/whatsapp) +
**chamado em `chamados`** com a 1ª mensagem → aparece na tela **`/atendimento`**.

> 🔴 **E foi aqui que apareceu o furo, medido:** o chamado é o REGISTRO, não o aviso. **Ninguém é
> notificado quando um entra.** Havia **22 chamados abertos, 11 criados nos últimos 7 dias.** Numa
> dúvida sobre planos isso passa; na Alavancagem não, porque ali a tela **promete** que "alguém da
> equipe entra em contato". Promessa sem aviso é fila.
>
> **Corrigido hoje, restrito às origens `alavancagem_*`:** e-mail para `ADMIN_EMAIL` com
> `reply_to` do interessado (responder já fala com ele) e **botão de WhatsApp** quando há telefone.
> Best-effort: falha de e-mail nunca derruba o registro. Ligar o aviso para TODA origem mudaria o
> comportamento do fluxo de planos, que hoje não promete contato ativo — por isso ficou restrito.
>
> **Fica em aberto (decisão do dono):** os outros ~22 chamados continuam sem aviso nenhum. Ou a
> equipe abre o `/atendimento` como rotina, ou vale estender o alerta.

**Enquadramento, escrito na própria tela:** a BidPro **não é instituição financeira nem
administradora de consórcio**; a operação é da parceira e depende de análise dela. Os números são
**exemplos ilustrativos** e cada um diz de onde saiu.

**Cliente logado só CONFIRMA — não preenche nada** (pedido do dono no fim do dia): nome, e-mail e
WhatsApp aparecem lidos do cadastro, com link para Meu Perfil, e há um único aceite — *"Confirmo
que tenho interesse e autorizo que a equipe entre em contato comigo"*. O botão só habilita depois
do aceite, e a autorização fica escrita na mensagem do chamado. **Visitante mantém o formulário**,
porque a tela é pública e sem ele não haveria como contatar quem não tem conta.

> 🔒 **Duas mudanças que o desenho novo exigiu, e não são cosméticas:**
> 1. **A identidade do logado vem do TOKEN, nunca do corpo.** O front manda só o `Authorization`;
>    `api/duvida.js` lê o usuário e usa o e-mail dele. Sem isso, aceitar o e-mail do corpo
>    permitiria abrir chamado em nome de outra pessoa — e, agora que o chamado nasce com
>    `user_id`, vinculá-lo a um `user_id` alheio. O `nome` do corpo continua aceito **apenas como
>    fallback de exibição**.
> 2. **O chamado do cliente logado carrega `user_id`**, então aparece em "Meus chamados" dele e o
>    Cliente 360 o liga ao cliente certo, em vez de ficar solto como visitante.
>
> E o `verificar:padroes` pegou um defeito **meu** no caminho: eu lia a sessão desestruturando só
> `data`. Se o `getSession` falhasse, o header não ia, o corpo do logado não leva identidade por
> desenho, e a pessoa receberia um 400 pedindo "um e-mail válido" — erro sem relação com a causa.
> Agora o `error` é conferido e a mensagem diz que a sessão expirou.

**Correção do dono, em duas rodadas, que vale decorar:** carta de consórcio **não arremata em
leilão nenhum**, judicial ou extrajudicial — a administradora só libera contra compra e venda
comum, com escritura e registro. Ela entra **depois**, comprando o imóvel de quem já arrematou.
Eu errei duas vezes até acertar (primeiro dizendo que servia no leilão, depois mantendo
"extrajudicial" como exceção). O ganho: **o consórcio é uma ALTERNATIVA à venda parcelada** — o
comprador paga à vista com a carta, o vendedor realiza o deságio, e nenhum risco de crédito fica
conosco.

### 3. Cliente 360 e Marketing — a avaliação de hoje

**Saúde: verde.** `clientes_com_erro: 0` · `relatorios_falha_24h: 0` · `erros_invisiveis_24h: 0` ·
`erros_cliente` não resolvidos em 14 dias: **1** (`/imovel/:id`, "Cannot read properties of null",
1 ocorrência em 13/08). `relatorios_falha_7d: 5`.

**Marketing — o número que manda:**

| | |
|---|---|
| Gasto (29/07 a 13/08) | **R$ 413,46** |
| Cliques | 270 · CPC médio **R$ 1,53** |
| Conversões que o Google registra | **1** |
| Cadastros em 30 dias | 31, dos quais **5** atribuídos ao google |
| **Custo por cadastro atribuído** | **≈ R$ 83** |
| **Pagantes vindos do google** | **0** |

> **A leitura honesta: o anúncio traz gente, e a gente não vira pagante.** Dos 44 clientes,
> **39 são Explorador (grátis)**, 4 Investidor Pro e 1 Assessorado. O gargalo não está no topo do
> funil, está na conversão para pagante — gastar mais em anúncio hoje só aumenta a base grátis.

**E a medição continua furada, o que impede decidir onde investir:**
- **210 cliques pagos em 14 dias × 26 visitas com `gclid`** (~12%). Parte é revisita do mesmo
  dispositivo (o `visita_origem` é primeiro-toque), mas a distância é grande demais para ser só isso.
- **`utm_term` = 0.** Continua sem saber **qual termo** de busca paga. É a pendência A do dono.
- **26 dos 31 cadastros do mês entraram sem origem nenhuma.**

**Sinal de atrito capturado no funil público, hoje às 23:03:** `login_falha` com
`"Email not confirmed"`, precedido de três cliques em "Criar conta grátis". Alguém criou a conta e
tentou entrar antes de confirmar o e-mail. Vale conferir se a tela explica isso com clareza.

**`qa_invariantes()` — 3 alertas abertos:**
| Chave | Valor / limite | O que é |
|---|---|---|
| `proximidades_vazio_falso` | 666 / 300 | relatório dizendo "nenhum ponto de interesse" em cidade mapeada |
| `bd_teto_saturado` | 480 / 405 | cota semanal do Bright Data perto do teto |
| `relatorio_yield_sem_x100` | 1 / 0 | o relatório de Sorocaba, que espera regeração (o dado de ENTRADA é que está errado) |

### 4. Trava nova: `npm run verificar:responsivo`

Hoje apareceram **quatro defeitos de tela num dia só** que nenhuma trava pegava, porque nenhuma
delas **olha a página renderizada**: zoom do iOS ao focar campo com fonte < 16px, rolagem
horizontal, botões fixos sobrepostos, e uma tabela escondendo uma coluna inteira no celular.

**Estado da medição em 14/08: ✅ 7 rotas × 6 larguras = 42 combinações, ZERO achados.**
`/` · `/alavancagem` · `/planos` · `/login` · `/calculadora` · `/termos` · `/privacidade`, em
320 · 375 · 390 · 430 · 768 · 1280. Nenhuma rolagem horizontal, nenhum campo abaixo de 16px em
tela de toque, nenhum elemento fixo sobreposto, nenhum erro de JavaScript.

> ⚠️ **A armadilha que quase me fez dar esse verde antes da hora, e que vale para quem rodar
> depois:** na primeira tentativa o build local estava SEM `VITE_SUPABASE_ANON_KEY`, o app não
> hidratava e o script acusava `erro-js: supabaseKey is required` nas seis larguras. Medir layout
> numa página que nem chegou a ser desenhada não significa nada — **"nenhum achado" ali seria um
> falso verde**, exatamente a família de defeito que este projeto cataloga. O script reprova nesse
> caso em vez de passar, que é o comportamento certo. **Antes de confiar no resultado, confirme que
> não há `erro-js` na saída.** Rode com um build que tenha a chave, ou contra o deploy:
> `npm run verificar:responsivo https://www.bidprobrasil.com.br`.

`scripts/verificar-responsivo.mjs` abre as rotas públicas em **6 larguras** (320 · 375 · 390 · 430
· 768 · 1280) e reprova quando encontra: rolagem horizontal, campo com fonte < 16px em tela de
toque, elementos fixos/sticky sobrepostos, ou erro de JavaScript. **Não está no `prebuild`** de
propósito — precisa de servidor de pé e do Chromium, e pôr isso no caminho do deploy trocaria uma
classe de falha por outra, como já foi decidido para o `verificar:schema`. **Rode ao mexer em tela.**

### 5. O PLANEJAMENTO — `docs/PLANO_ARREMATADOS.md` (13 seções, nada implementado)

⚠️ **Nada disso é código e nada aparece para cliente.** O documento cresceu numa conversa longa com
o dono e virou o desenho do produto financeiro e modular. **Ao retomar, comece pela seção 8**, que
é o mapa: o que já está decidido, as decisões abertas em ordem de quanto destravam, e o que
depende de advogado, contador, comercial ou BCB.

**As decisões que mais destravam, se o dono só puder responder três:**
1. **Quem assume o risco de crédito.** É de onde sai toda a conta de capital. Não custa nada
   responder e destrava a figura jurídica, o funding e o contrato.
2. **Mensalidade fixa × percentual sobre o negócio.** Deixou de ser escolha comercial: é a
   principal prova de que a atividade é serviço e não corretagem.
3. **Resolvedor único de direito de acesso.** Com add-on sobre o Explorador, `role` deixa de
   significar "é pagante" — e o código usa a mesma variável para as duas coisas. Dois pontos já
   medidos quebram: `AuthContext.jsx:62` (inadimplência nunca alcança o Explorador que paga
   módulo) e `Consultor.jsx:496` (cliente pagante contado como não-pagante).

**Achados de planejamento que valem dinheiro e não dependem de nada:**
- **Home equity via correspondente bancário** — sem capital, sem autorização do BCB, sem risco de
  crédito, e o público já é nosso: quem arrematou com deságio e tem o imóvel quitado é o perfil
  ideal, e nós conhecemos o portfólio, coisa que o banco não conhece.
- **Módulo de contratos + cobrança por assinatura** — a máquina já existe (contratos, recorrência
  MP, conciliação); fatura sem capital e sem regulador financeiro, e produz o histórico de
  adimplência que qualquer funding vai exigir depois.
- **1% a.m. é preço de prazo curto.** Em 240 meses o total vira 2,64× o emprestado antes do IPCA, e
  a taxa real (12,68% a.a.) é mais que o dobro de um financiamento bancário. Se o prazo vai a 10 ou
  20 anos, a taxa tem que cair.


## 🩺 ABERTURA DE 14/08 — diagnóstico, 2 consertos e 3 checagens novas na rotina

> Ritual de abertura rodado às 10h UTC. Heartbeat carimbado. **Segurança 0/0, regras de negócio
> 0 crítico, nenhuma fonte abaixo do piso aprendido, KYC 0, fila de geocode 0.** O que segue é o
> que NÃO estava verde — e os dois consertos que já subiram.

### 🔴 CONSERTADO: o espelhamento de documentos estava PARADO (achado hoje, corrigido hoje)

**Sintoma:** `[espelhar-docs] enfileirar 400 {"code":"23514"}` de 4 em 4 horas desde 12/08, e
**zero** documentos enfileirados em 14/08 (contra 978 em 13/08 e 997 em 12/08).

**Causa-raiz:** `enfileirar_espelho_documentos()` copiava `anexos[].tipo` **cru** do leiloeiro
para `documento_espelho.tipo`, que tem CHECK restrito a 6 valores. A MEGA passou a publicar 44
anexos com `tipo: 'proposta'` — rótulo legítimo do site dela, desconhecido nosso. Como o INSERT
é **uma instrução para o lote inteiro** (limite 500), uma linha inválida derruba o lote TODO. E
como as 44 nunca entram, elas seguem "novas" e envenenam a rodada seguinte, e a seguinte: o
enfileiramento morreu de vez assim que a janela de 500 alcançou a primeira delas.

**Por que passou:** o erro só existia no `console.error` da Vercel, e o contador caía para `0` —
o **mesmo 0** de "não havia nada novo para enfileirar". O cron respondia `ok: true`. É a forma
**#5 do CLAUDE.md** (freio/erro entregue como conteúdo) num cron cuja razão de existir é
proteger o documento do cliente contra o leiloeiro tirar o PDF do ar.

**Correção (2 camadas):**
1. `supabase/migrations/espelho_documentos_tipo_normalizado.sql` — novo `doc_tipo_normalizado()`
   mapeia o rótulo do leiloeiro (com acento, maiúscula ou abreviado) para a nossa taxonomia e
   joga **desconhecido em `'outro'`**. Leiloeiro inventar categoria amanhã vira um documento a
   menos classificado, não a fila inteira parada. **Já aplicada no banco** — a chamada seguinte
   enfileirou **486** documentos represados.
2. `api/espelhar-docs-cron.js` — `enfileirados` começa em **`null`**, não 0, e o motivo do erro
   viaja na resposta (`erro_enfileirar`). "Não consegui" deixa de se parecer com "não havia nada".

### 🔴 CONSERTADO: "Falha de conexão ao gerar" num relatório que estava sendo gerado normalmente

**Relatado pelo dono ao vivo** (imóvel em Itapevi): a tela deu erro e "se recarregou sozinha".
O rastro em `eventos_atividade` fecha o caso sem margem para dúvida:

| Hora | O que aconteceu |
|---|---|
| 13:00:15 | clique em **Gerar** |
| 13:00:17 | servidor cria a linha em `analises_mercado` |
| **13:01:58** | **`api_falha_rede` · `/api/gerar-analise` · "Load failed"** — a conexão do fetch caiu |
| 13:03:40 | **servidor conclui a análise normalmente** (`status: concluida`, sem `erro`) |
| 13:04:01 | dono clica em **Abrir** — o relatório estava lá |

**A geração roda no SERVIDOR e é persistente** — o cabeçalho de `AnalisesContext.jsx` diz que o
cliente pode até fechar a aba. Ou seja, perder a conexão HTTP significa "perdi o canal ao vivo",
**não** "a geração falhou". Mas o `.catch` do `apiCall` pintava `status: 'erro'` na hora, com
"Falha de conexão ao gerar. Tente novamente." — e o polling de 12s depois relia o banco e
desfazia. Erro falso na cara do cliente, e pior: **um convite a clicar em Gerar de novo, que
queima cota e reprocessa IA de um relatório já pronto.**

Por que a conexão cai: a requisição fica **mais de 3 minutos sem trafegar byte** (o servidor tem
`maxDuration` de 5 min). Navegador, rede móvel e gateway derrubam conexão ociosa bem antes disso
— não é caso raro, é o caso comum de quem gera relatório no celular.

**Correção:** antes de acusar erro, o cliente **pergunta ao banco** (`reconciliarFalhaDeRede`,
até 3 leituras em ~24s). Achou linha `gerando`/`concluida` → segue quieto e deixa o polling
terminar. Achou linha com `erro` do servidor → mostra o erro **real** dele. Não achou linha
nenhuma → aí sim foi falha de verdade e a mensagem aparece como antes. Vale para os três
relatórios, e cobre de quebra o **504 do gateway**, que caía neste mesmo `catch`.

**E o pedido do dono — "se dá erro e se resolve sozinho, some da tela e aparece no Cliente 360":**
o cliente passa a emitir `geracao_recuperada`, o 360 ganha o card **"Rede recup. (7d)"** (âmbar,
nunca vermelho: não houve prejuízo) e a linha do tempo mostra *"Falha de rede recuperada
(invisível ao cliente)"*. O que se vigia é a **repetição** — o mesmo cliente ou a mesma rota
aparecendo várias vezes é rede/timeout a investigar.

> **Uma armadilha evitada por pouco, e um bug antigo achado no caminho.** `api/track.js` tem uma
> allowlist de tipos de evento: `geracao_recuperada` seria **descartado em silêncio** e o card
> novo mostraria zero para sempre — eu teria construído o erro invisível que é invisível também
> no diagnóstico. Ao corrigir, apareceu que **`limite_sessao` estava nessa situação desde 11/08**:
> o tracker emite esse aviso justamente para o 360 não parecer um dia que acaba no meio da tarde,
> e ele nunca chegava. O aviso contra o silêncio estava sendo silenciado. Os dois entraram.

### 🔴 CONSERTADO: busca por raio lenta — e o mapa mostrando 3,5% da área

**Pergunta do dono:** "se já temos a geocodificação de todos os lotes, por que o raio de Cotia
demora tanto?" **Resposta: o banco não tem nada a ver com isso** — a RPC `buscar_por_raio_v2`
responde a Cotia/30 km em **80 ms**, com o índice GiST `idx_imoveis_earth` em uso.

O tempo estava no MAPA. `MapaEmbutido` fazia `.limit(2000)` **sem recorte geográfico e sem
`order by`**, e só depois aplicava o raio por haversine no navegador. Duas consequências, a
segunda pior que a primeira:

| | |
|---|---|
| **Custo** | **1,5 MB de JSON** por busca, descendo pelo 5G |
| **Erro** | os 2.000 são uma fatia **arbitrária** de 29.941 lotes do Brasil inteiro. Dos **794** lotes realmente dentro de 30 km de Cotia, só **28** caíam nessa fatia |

Ou seja: o mapa desenhava **3,5%** da área e parecia completo. O lento e o errado tinham a mesma
causa. Pior ainda, o container do mapa usa `display:none` na vista **Lista** — mas o componente
segue montado, então **na vista Lista (padrão no celular) esse 1,5 MB era baixado para um mapa
que o usuário não está vendo**, competindo com a requisição da lista.

*Correção:* (a) o recorte vira faixa de lat/long no servidor (servida pelo `idx_imoveis_coords`),
e o haversine só apara os cantos do quadrado; (b) nada é carregado enquanto o mapa está
invisível; (c) `{ data, error }` passa a checar `error` — era `const { data } =`, então falha de
leitura virava "nenhum imóvel no mapa" (forma #2); (d) se o teto de 2.000 for atingido DENTRO da
área, a tela avisa em vez de truncar calada.

### 🔴 CONSERTADO: aluguel em terreno, e a rentabilidade 100× menor em metade dos relatórios

**Pergunta do dono:** "gerei o relatório de um lote em condomínio e apareceu aluguel. Está
correto?" **Não.** E ao investigar, apareceu um segundo defeito, maior, no mesmo card.

**(1) Lote não se aluga — regra de 03/08 que o código não aplicava.** O prompt manda o modelo
devolver `locacoes: []` para terreno, com a frase *"rentabilidade de aluguel para lote é
informação FALSA, não informação faltante"*, e `locacoesDaBase` obedece. O caminho do **modelo**
não: a regra vivia só como instrução em texto, e o modelo a ignorou. O lote de Cotia saiu com
**R$ 3.000,00/mês** — preço de casa, não de terreno vazio. É o §2b do CLAUDE.md em estado puro.

**(2) O yield vinha do modelo, e veio como RAZÃO.** No mesmo relatório: `0,09`, que é
36.000/322.500 — sem o ×100 que o próprio prompt pede. A tela imprimiu **"0,09% a.a." onde o
certo era 11,16% a.a.** Medido no acervo: **25 dos 56** relatórios concluídos estavam assim —
**quase metade do que já foi entregue a cliente, com a rentabilidade cem vezes menor.** O sinal
de que ninguém conferia estava à vista: bruto e líquido saíam **idênticos**, quando o líquido é
15% menor por definição.

*Correção:* o yield deixa de ser opinião e vira conta do servidor (`aluguel × 12 / valor × 100`;
líquido = bruto × 0,85), e terreno zera locação/aluguel/yield **declarando** que não se aplica —
a tela troca os três cards por essa frase, porque "R$ 0,00" e "0,00%" também seriam afirmações
falsas.

*Reparo do acervo, sem reprocessar IA (os dois números da conta já estavam no JSON):*
- **23 relatórios recalculados** — yields agora de **0,96% a 11,16% a.a.** (média 7,09%).
- **2 relatórios de terreno** (Cotia e Sorocaba) com locação/aluguel/yield zerados e a frase de
  "não se aplica".
- Ambos reversíveis: `yield_backfill_2026_08_14` e `terreno_locacao_backfill_2026_08_14`.

> **Sobraram 2, de causa diferente — e NÃO foram tocados de propósito**, porque o defeito neles
> não é a conta, é a entrada (recalcular sobre entrada errada só troca um número errado por
> outro mais convincente). **Precisam ser REGERADOS:** `8407e489…` (Sorocaba) tem
> `aluguelMedio: 27,62`, que é R$/m²·mês e não valor mensal; `e0d7ea4c…` (Vila Velha, 31/07) tem
> `valorEstimadoImovel: 0`, ou seja, não há denominador. O invariante novo fica **em alerta (1)**
> até o segundo ser regerado — de propósito.

*Travas:* `qa_invariantes()` ganhou `relatorio_yield_sem_x100` e `relatorio_lote_com_aluguel`,
ambas com limite 0. **Não** entraram em `regra_negocio`: `auditoria_regras_negocio()` valida
`aplicada_por` contra funções **do banco**, e estas são aplicadas em `api/gerar-analise.js` —
registrá-las lá criava 3 críticos permanentes numa auditoria que estava em 0. Alarme falso não é
garantia; a guarda certa para regra do app é o rastro dela no dado.

> ⚠️ **Um quase-acidente que vale como aviso (a lição 7b de novo).** Ao escrever a migração dos
> invariantes, parti do último `qa_invariantes*.sql` do repositório — e ele estava **atrasado em
> relação ao banco**: faltavam `analise_sem_mercadologico`, `analise_vencida_nao_limpa`,
> `cadastro_barrado` e `laudo_sem_base`. Replicar aquele arquivo teria **apagado os quatro**. A
> versão commitada foi escrita a partir da definição VIVA e conferida chave a chave contra
> `select chave from qa_invariantes()` — 20 = 20. **Ao mexer nessa função, parta do banco, não
> do último .sql.**

### 🔴 CONSERTADO: o zoom do iPhone que nunca volta ("perde o dimensionamento ao trocar de tela")

**Relatado pelo dono com print** (tela de filtros da Busca, iPhone): o app aparece deslocado,
com o logo e o menu ☰ **cortados pela esquerda**, e só volta ao normal dando zoom out na mão.
Queixa registrada como recorrente.

**Não era vazamento de layout** — e essa distinção é a chave do diagnóstico. Vazamento corta
pela **direita**, e o `#root { overflow-x: clip }` já cuidava dele. O print está cortado pela
**esquerda**, o que é outra coisa: a página inteira está **ampliada**, com o viewport visual
deslocado. Quem faz isso é o Safari do iOS — ele **dá zoom na página inteira quando um campo
com `font-size` menor que 16px recebe foco**. E o zoom **não volta**: nem ao sair do campo, nem
ao trocar de tela, porque é escala do viewport visual, não estado da página. Basta o usuário
tocar UM campo e o app fica torto pelo resto da sessão. No print foi o campo de bairro dos
filtros (`fontSize: 13`), mas **o app tem 468 campos e a maioria usa 11–14px**: qualquer um
deles produz exatamente o mesmo efeito. Por isso "já está repetitivo" — cada tela nova era uma
chance nova de disparar.

Não há saída pelo `<meta viewport>`: `maximum-scale=1` e `user-scalable=no` são **ignorados pelo
iOS desde a versão 10** — e, se funcionassem, tirariam o zoom de pinça do usuário, que é
acessibilidade. O único jeito de o iOS não dar o zoom é o campo **já estar em 16px** ao receber
foco.

*Correção* (`src/index.css`, uma regra, não 468 edições): em ponteiro grosso (toque),
`input`/`select`/`textarea` vão a 16px. `!important` é obrigatório aqui — os 468 campos definem
`fontSize` em `style={{…}}` inline, e inline vence folha de estilo. No desktop nada muda: lá não
existe esse zoom e os campos seguem compactos. Entrou junto `text-size-adjust: 100%`, que impede
o navegador de inflar a tipografia por conta própria ao girar a tela (outro "parece defeito de
responsividade" que é o navegador reescalando).

*Medido, não suposto* — Chromium em viewport de iPhone 13 (390×844, toque), comparando o mesmo
build com a regra ligada e removida do CSSOM:

| Rota | Antes | Depois | Largura |
|---|---|---|---|
| `/` | 1/1 campo < 16px | **0** | 390/390 ✅ |
| `/login` | 2/2 (e-mail e senha, 14px) | **0** | 390/390 ✅ |
| `/cadastro` | 1/1 | **0** | 390/390 ✅ |
| `/recuperar-senha` | 1/1 | **0** | 390/390 ✅ |
| `/planos` | — | — | 390/390 ✅ |

O teste também confirma o ponto que era a única dúvida real: **a regra vence o estilo inline**
(os campos do login estão inline em 14px e passaram a 16). Nenhuma rota pública vaza na
horizontal; o único elemento fora da tela é um círculo decorativo com `right: -40px` dentro de um
card em `/planos`, que deve mesmo ser cortado.

> ⚠️ **O que NÃO foi medido:** as telas atrás do login (a própria Busca do print, Análise,
> Painel) — o ambiente de teste não tem credencial de cliente. A regra é global e o campo do
> print está coberto por ela, mas a confirmação visual no iPhone é sua.

### 🟡 CONSERTADO: a assinatura do defeito de proximidades voltou de 0 para 110 — e NÃO é um quarto escritor

A checagem combinada no fechamento de ontem (`pontos_proximos='{}'` com `proximidades_vazios=0`
tem que continuar em 0) deu **110**. Investigado antes de concluir: **todas CEF, todas com
`proximidades_em` de 29/07 a 09/08** — ou seja, anteriores à correção de 13/08 12h15 — e todas
com `atualizado_em` de hoje 09:56, o scrape da CEF. Não é escritor novo: é o **reparo de 13/08
ter sido de tiro único sobre os lotes ATIVOS**, e a reativação trazer o resíduo de volta.
Reaplicado o mesmo UPDATE (idempotente): **110 → 0**, os lotes voltaram para a fila do cron.

> **Para as próximas aberturas:** um valor > 0 aqui só é "quarto escritor" se `proximidades_em`
> for **posterior a 13/08 12h15**. Anterior a isso é resíduo reimportado por reativação, e o
> conserto é reaplicar o UPDATE de `proximidades_reparo_residuo_job_osm.sql`.

### 🟠 O que está amarelo e é DECISÃO, não conserto

| O quê | Número de hoje | Leitura |
|---|---|---|
| **Bright Data — teto** | Ledger travado em **480** desde 12/08 09h | Deixou de ser assunto de orçamento: hoje às 09:39 **TORRES3, VEGAS e CALIL** não foram coletadas ("SEM COTA — coleta não tentada") e **RJLEILOES** bateu `teto_global`. O monitor está honesto (declara o motivo, não finge acervo zero), mas o acervo dessas 4 fontes congela até a decisão de **18/08** |
| **`proximidades_vazio_falso`** | **617** (limite 300), era 440 ontem | Todos os 617 são vazios **corroborados** (`vazios >= 1`), escritos de 10/08 para cá — é a drenagem prevista, não o defeito. Segue pendente a **calibragem do limite**, que é decisão sua |
| **Backup off-region (R2)** | **3 dias seguidos** batendo o teto de 1.000 arquivos/rodada, com `arquivos_iguais = 0` | **É o achado mais sério do dia depois do espelho.** Até 11/08 a rodada terminava (536 arquivos, 188 já iguais). De 12/08 em diante ela para no teto sem chegar aos antigos: o backup está **atrás do crescimento diário** do bucket `documentos` (25,0 → 26,8 GB em 24h) e a distância aumenta todo dia. `ok: false` com `falhas: 0` é exatamente isso: nada falhou, só não coube. **Precisa subir o teto por rodada ou rodar mais vezes** — é a única defesa contra perda definitiva de arquivo de cliente |
| **Pagante sem entrega** | **2 Investidor Pro** sem gerar 1 relatório em 14 dias | Um assinou em **01/07** (6 semanas sem usar). É churn em formação, e aparece aqui antes de aparecer na fatura |
| **Marketing — vazamento de clique** | **214 cliques pagos** em 14 dias × **19 visitas com gclid** registradas | Ver abaixo |
| `erros_cliente` | 1 ocorrência, `/imovel/:id` | `Cannot read properties of null (reading 'id')`, 13/08 17:32, **não repetiu**. Com sourcemap ligado o stack agora resolve — se voltar, dá para nomear o arquivo |

### 📣 MARKETING — o número que só aparece cruzando duas fontes

O painel do Google cobrou **214 cliques / R$ 318 / 14 dias** com **1 conversão**. O nosso
`visita_origem` registrou **19** visitas com `gclid` no mesmo período. Cada número sozinho parece
saudável; a **razão entre eles** é que denuncia. Parte da distância é esperada (`visita_origem` é
primeiro-toque por dispositivo e não reconta revisita), mas 214 → 19 é grande demais para ser só
isso. Fecha o funil: **29 cadastros em 30 dias, 5 atribuídos ao `google` e 24 sem origem
nenhuma** — e `utm_term` **nulo em 43 de 43** visitas, que é exatamente a pendência **A** da sua
lista. Enquanto ela não entra, não há como saber qual palavra-chave traz gente; e enquanto o
vazio de 214→19 não for explicado, não há como saber se o problema é a palavra ou o rastreio.

### ✅ Rotina de abertura AMPLIADA (pedido de hoje) — Cliente 360, Marketing e Saúde do sistema

Entraram no `CLAUDE.md` como **item 1c**, junto do 1b, com as consultas prontas e — o que
importa mais — **como ler cada uma**: por que `arquivos_iguais = 0` no backup é pior que uma
falha declarada, por que as três contagens de marketing caem naturalmente (e o que se vigia é o
tamanho da queda, não a queda), e por que pagante sem relatório é o sinal de churn mais barato
que existe. Custo zero, mesma regra do 1b: ler o banco não custa nada.

---

## ✅ CHECKLIST DE 14/08 — o que ficou para o DONO (leia isto primeiro)

> Escrito no encerramento de 13/08, a pedido do dono. **Tudo que não dependia dele já está em
> produção** (`main` em `ea063bc`, 10 commits no dia, CI verde). O que segue depende de acesso a
> painel, contratação ou decisão — nada aqui é código pendente.

### 🔴 Segurança — os 3 de maior retorno (minutos cada, exceto o 3)

| ✓ | O quê | Por que importa | Onde |
|---|---|---|---|
| ☐ | **Ligar MFA** em Supabase, Vercel e GitHub | **É o item de maior retorno da lista inteira.** Uma senha de admin comprometida entrega o banco todo — RLS não protege contra credencial legítima | Supabase: Account → Security → Enable MFA · Vercel: Settings → Authentication · GitHub: Settings → Password and authentication |
| ☐ | **Confirmar PITR** ligado | Backup diário perde até 24h. PITR recupera ao segundo, e é o que salva de um `DELETE` errado | Dashboard → Database → Backups. Se não vier no plano, avaliar custo × risco |
| ☐ | **Testar UMA restauração** | Backup nunca testado não é backup, é esperança. Uma vez por ano basta | Restaurar num projeto novo e conferir uma tabela |
| ☐ | **Contratar pentest externo com laudo** | Maior lacuna técnica; vale ~6 pontos da nota sozinho, e é o que cliente corporativo pede | Escopo mínimo: auth, RLS, webhooks de pagamento, upload de documento |
| ☐ | **Nomear e publicar o Encarregado (DPO)** | Exigência da LGPD: identificação pública | Definir a pessoa + publicar na Política de Privacidade |
| ☐ | **Política de rotação de credenciais** | Calendário anual **e sempre após saída de pessoa com acesso** | — |

### 🟠 Pendências que já vinham de 12/08 (nenhuma resolvida em 13/08)

| ✓ | # | O quê | Estado |
|---|---|---|---|
| ☐ | **C** | **MX do domínio → inbound do Resend** | ⚠️ **SUBIU DE PRIORIDADE.** Descobri montando o mapa de segurança que `privacidade@bidprobrasil.com.br` está **publicado no site e não recebe nada**. Isso deixou de ser assunto de produto: canal de privacidade publicado que não funciona é **lacuna de conformidade LGPD** |
| ☐ | **A** | **Sufixo UTM** com `utm_term` e `utm_content` | Medido em 13/08: **6 cliques do Ads em 14 dias, `utm_term` nulo em 6 de 6**. Sem isso não se sabe qual palavra-chave traz gente |
| ☐ | **B** | **Verificação do anunciante Google Ads** (caso `1-3785000040835`) | Prazo **02/09** |
| ☐ | **E** | **Bright Data — decisão do teto** | Saturado (480/405). Decisão marcada para **18/08** |
| ☐ | **D** | Nome fantasia e objeto social na Junta | Com o contador |
| ☐ | **F** | "Uso ocasional" como coluna nova | Decisão |

### 🧪 Os dois testes que só o dono pode fazer

| ✓ | Teste | O que conferir |
|---|---|---|
| ☐ | **Regerar o mercadológico de Lavras** (Av. José Brumatti 2856, Guarulhos) | (a) as imobiliárias de Guarulhos aparecem entre as FONTES? (b) os anúncios de R$ 250–270 mil entram na amostra? (c) o `baseCalculo` mostra a fórmula e os descartes? |
| ☐ | **Gerar um documental de leilão JUDICIAL com financiamento a assumir** | A ressalva sai como **bloqueante e no topo** da seção 6? |
| ☐ | **Abrir a lista do Cliente 360 e a tela de imóvel no celular, sem zoom** | Algum campo ainda vaza pela lateral? |

### 🤖 O que roda sozinho e eu confiro na abertura de amanhã

- **Job OSM, 05h UTC** — primeira rodada com o código novo (a correção subiu às 12h15 de 13/08,
  DEPOIS da execução de ontem). A consulta que decide: a assinatura do defeito
  (`pontos_proximos='{}'` com `proximidades_vazios=0`) tem que continuar em **0**. Se sair de
  zero, apareceu um quarto escritor.
- **`proximidades_vazio_falso`** — hoje 440/300, mas **não é o defeito**: são vazios corroborados
  com 3+ observações. A decisão pendente é de **calibragem do limite**, e é sua (§2 do
  encerramento).
- **O erro anônimo em `/imovel/:id`** — se repetir, agora o stack **resolve para arquivo e linha**
  (sourcemap ligado em 13/08).

---

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

## 🔔 VERIFICAÇÕES INICIAIS DA SESSÃO DE 06/08 (combinado com o dono no fim do dia 05/08)

> Rodar ANTES de qualquer outra coisa e reportar em bloco, junto com o ritual normal.

| # | O que validar | Como | Verde é |
|---|---|---|---|
| 1 | **Re-verificação dos 16 achados** ⏰ *combinado com o dono* | `docs/VARREDURA_BUGS_2026-08-05.md` — os marcados **⏳ A VERIFICAR**. Rodar a verificação ADVERSARIAL (refutar primeiro; dúvida = não confirmado). O workflow anterior travou em 8/24 | Cada um vira CONFIRMADO (com repro) ou REFUTADO (com motivo). Atualizar o doc |
| 2 | **Lote do Rafael** (fechamento do caso) | `select endereco, latitude, longitude, geocod_nivel from imoveis_leilao where fonte_id='zuk_37094-231508';` | Coordenada **≠** `-23.4675941,-46.5277704` e nível ≠ 'refazer'. Depois: regerar o mercadológico e conferir se o **Nível 1 traz amostras** |
| 3 | **Drenagem do pino genérico** | `select count(*) from imoveis_leilao where ativo and geocod_nivel='refazer';` · `select public.geocode_pinos_genericos_total();` | Fila caindo dos 3.519; o total de pinos genéricos seguir **~0** (se subir, a regressão voltou) |
| 4 | **Aluguel do Índice** | Gerar/abrir o Índice de uma cidade com locação e conferir o card | Ou valor MEDIDO, ou o selo **ESTIMADO** com a base declarada — nunca um número mudo |
| 5 | **Cache de documento pegando** | `select count(*), count(*) filter (where extrator::text like '%visao%') from doc_extracoes;` | Deixar de ser 0 conforme relatórios rodam; 2º relatório do mesmo lote não deve reler documento |

### 📌 Os 2 planejamentos que ficaram para 06/08 (o dono decidiu adiar, não descartar)

1. **Fluxo de arremate (itens 2 e 7 da varredura)** — desenho já apresentado e aprovado em
   linhas gerais pelo dono; falta detalhar e implementar. Regras que ELE definiu:
   botão só para **assessorado e clube**; **um único arrematante por lote**; para liberar,
   informar o **valor da arrematação** + anexar **comprovante** (auto de arrematação ou
   e-mail do leiloeiro com o valor). Desenho proposto: estados `declarado → confirmado →
   recusado`, índice único parcial `(imovel_id) where estado in ('declarado','confirmado')`,
   e o RLS `imovel_anexos_meu_arremate_delete` passando a exigir `estado='confirmado'`.
   **PERGUNTA ABERTA AO DONO:** manter o DELETE do cliente após confirmação, ou remover de
   vez (recomendação: remover — documento de arremate é prova e a retenção é obrigação
   nossa; cliente pede, equipe executa). **Momento ideal: hoje há 0 arremates**, zero
   retrabalho. O botão legado do Painel (`Painel.jsx:447`, grava com id `tsn_…` fora do
   `sinalizar-arremate`) morre nesse mesmo movimento.
2. **Jurídico — reatribuição que perde a pasta (item 3)** — plano apresentado: gravar em
   DOIS TEMPOS (`reatribuicao_pendente` → envia → efetiva), retomada automática das
   pendências > 30 min, e usar o **webhook do Resend que já existe** para que `delivered`
   efetive e `bounced` devolva a pasta ao advogado anterior. Junto vai o achado #24 do
   mesmo arquivo (a escalação ao admin repete todo dia útil porque o `select` não traz
   `juridico_escalado_admin` e o flag de dedup nunca é lido).

---

## 🏁 FECHAMENTO DE 07/08 — leia este bloco primeiro

**O dia começou com dois sintomas relatados pelo dono nos 3 relatórios de um imóvel em Cotia e
terminou com uma causa-raiz sistêmica encontrada, corrigida, e o estrago limpo.**

| | |
|---|---|
| Commits em `main` | `0e1c9f3` · `27af5c4` · `d7d663e` |
| Deploy | `dpl_4FMF2z69ytcXZzKAfdEiSgbbe4jj` **READY** em produção |
| `auditoria_seguranca()` | **0 crítico / 0 atenção** |
| `npm run build` | OK (o único erro de lint é pré-existente em `_proximidades.js`/`_meta-capi.js`) |
| Achados fechados | 2 de hoje + **14 dos 19** da varredura de 05/08 |
| Relatórios inválidos | 15 removidos (+1 laudo), com backup reversível |
| Aprendizado das amostras | **preservado integralmente** — 1.549 → 1.549 |

**A lição do dia, em uma frase:** o servidor descobria o dado certo e continuava imprimindo o do
cliente. Não era um bug, era um PADRÃO — e ele já tinha vazado para o aluguel (43 de 55 relatórios
com yield 0,00%), para o gate do laudo, para o corpus de calibração e para a tela de Arrematados.
Ao revisar código novo, a pergunta de rotina passa a ser: *"o servidor descobre este valor durante
a geração? Então ele não pode reimprimir o que o cliente mandou antes da descoberta."*

**➡️ A lista de bugs em aberto para validar e resolver na próxima sessão está em
`docs/BUGS_ABERTOS_2026-08-07.md`** — 10 itens priorizados (P1 a P4), cada um com o que confirmar
antes de mexer, mais 6 validações de produção para rodar na abertura.

**Decisões do dono registradas hoje (não reabrir):**
- **Cota fica em 10 relatórios + 10 documentais + 3 índices.** Conferido: `limite_ia` já estava
  assim e a apresentação também — não havia nada a ajustar.
- **Plano legado mantido em 15 + 5** para os 2 assinantes Pro antigos. Ao investigar, os "15" não
  eram config desatualizada e sim um *grandfathering* deliberado (`plano_legado = true`); igualar
  teria retirado benefício de pagante. `plano_legado` não é atribuído a contas novas.

---

## ⏰ CONFERIR A PARTIR DE 10/08 — as conversões do Google destravaram?

> **Depende só do tempo passar.** Corrigido em 08/08 (`bdd9b4b`): `src/utils/gtag.js` empurrava um
> **Array** na `dataLayer` em vez do objeto **`arguments`**, e o gtag.js do Google descarta comandos
> nesse formato **em silêncio**. Por isso as ações "Cadastro — BidPro" e "Compra de plano" estavam
> **INATIVAS com 0 conversões**, apesar de 5 cadastros reais vindos de clique pago com `gclid`
> gravado no banco.
>
> ```sql
> -- 1. o Google passou a contar?
> select data, impressoes, cliques, gasto, conversoes from marketing_metricas_dia order by data desc limit 5;
> -- 2. a landing nova está atribuindo? (utm novo = 'pesquisa-leilao-imoveis')
> select created_at, mkt_gclid is not null as tem_gclid, mkt_utm_campaign
>   from perfis where created_at > '2026-08-08' order by created_at desc;
> ```
> **Se `conversoes` seguir 0 COM cadastro por gclid no período, o problema NÃO é o gtag:** investigar
> consent/bloqueio e avaliar a conversão **offline server-side** (`api/_google-ads.js`, hoje dormente
> por falta das credenciais da API do Google Ads). As 5 conversões antigas estão perdidas para o
> navegador — só o caminho offline as recuperaria.

---

## 🔚 SESSÃO DE 13/08 — leia ESTE bloco primeiro

> **O dia em uma frase:** o ritual saiu verde em tudo que ele cobre, e os dois alertas que
> sobraram tinham a MESMA causa de fundo — **um escritor que ninguém tinha mapeado, gravando
> ausência como se fosse conteúdo.**

### O que o ritual mediu (verde, para ninguém refazer)

| Verificação | Resultado |
|---|---|
| `auditoria_seguranca()` | **0 crítico / 0 atenção** |
| `auditoria_regras_negocio()` | **0 crítico** |
| Erros de cliente abertos (14d) | **0** |
| Chamados do cliente sem resposta | **0** |
| KYC ilegível pelo servidor | **0** |
| Fontes no ponto cego do monitor | **0** |
| Baseline de captura (regressão) | **vazio** = íntegro |
| Deploys Vercel (últimos 20) | **todos READY** |
| Acervo | 30.026 ativos · 21.571 tocados em 24h · fila de geocode **325** |
| Cliente 360 | RPC íntegra · 39 clientes · **0 com erro** · funil 7d: 90 visitantes, 317 pageviews |

### 1. `proximidades_vazio_falso` — o TERCEIRO escritor (causa-raiz do alerta que crescia)

O fechamento de 12/08 deixou este alerta em movimento (400 → 412 → 452) e a pergunta "é coleta
nova ou regravação?". **Não era nenhuma das duas.** Estava em **580** na abertura.

Em 10/08 o vazio falso foi corrigido em DOIS caminhos: o cron (3 observações em execuções
diferentes antes de aceitar `{}`) e o on-demand (502 "indeterminado" em vez de gravar vazio).
Ficou de fora **`scripts/enriquecer-osm.mjs`**, job diário das 05h UTC, que gravava
`pontos_proximos = nearest` mesmo com `nearest = {}` e carimbava `proximidades_em`.

**Assinatura no banco:** `pontos_proximos = '{}'` com `proximidades_vazios = 0` — estado que o
cron é **incapaz** de produzir, porque ele grava o contador junto do `{}`. Eram **293** assim,
53 carimbados às 06:19 do próprio dia 13/08, **em 7 segundos e 37 cidades** (o cron faz 12 por
rodada de 300s — não era ele).

**O estrago maior não era o vazio, era o carimbo.** A fila de revalidação do cron procura
`proximidades_em < now() - 30 dias`, e o job recarimbava **12.820 dos 13.101** lotes com
geocode preciso a cada 48h. Nenhum envelhecia o bastante para ser reconferido: **a auto-cura
de 10/08 estava desligada**, e o `{}` "com validade de 30 dias" era renovado todo dia.

*Corrigido na raiz:* sem POI encontrado, o job grava só `score_localizacao` e **não toca** em
`pontos_proximos` nem em `proximidades_em` — o lote segue para o cron corroborar. Mais duas
coisas que o recon achou de graça:
- **Piso mínimo de POIs** (`OSM_POIS_MINIMO`, 50 mil). `existsSync` provava que o arquivo
  existe, não que veio inteiro: um PBF truncado zerava as proximidades do **país inteiro** num
  run, cada linha carimbada como resposta boa. Agora aborta antes de gravar.
- **`praia` preservada.** A categoria só existe no helper do Overpass; o job não a calcula e a
  **apagava** dos 412 lotes de praia toda vez que os tocava. Agora mescla o que só o Overpass sabe.

*Reparo do acervo:* `supabase/migrations/proximidades_reparo_residuo_job_osm.sql` devolveu à
fila os não corroborados (`proximidades_vazios = 0`). **580 → 345**, e a assinatura do defeito
em **0**. Os 345 que restam são vazios que o cron **confirmou** em execuções distintas — ficam
como estão, agora com o relógio de 30 dias voltando a correr de verdade. O invariante segue
acima do limite (300) até esse ciclo drenar; **é drenagem, não defeito**.

### 2. `edital_eq_matricula` = 399 — o botão "Edital" abria a matrícula

Alerta que **não constava** no fechamento de ontem. 399 lotes (410 contando os que apontam para
o caminho da matrícula sem serem idênticos), **todos CEF, todos extrajudicial**:
`link_edital = https://venda-imoveis.caixa.gov.br/editais/matricula/AM/1444401910191.pdf`.
O cliente clicava em "Edital" e recebia a **matrícula** — outro documento, sem as regras do
leilão, e que **abre normalmente**, o que torna o engano invisível.

*Causa:* em `backfill-edital-cef.mjs`, quando a Caixa não publica edital o script devolvia
`sem_edital` e **não escrevia nada** — o `link_edital` antigo (a matrícula) ficava valendo.
"A Caixa não publicou edital" era gravado como "o edital é este outro documento aqui".

*Corrigido:* o backfill passa a gravar `link_edital = null` nesse caso, e
`supabase/migrations/edital_cef_nao_e_matricula.sql` limpou os 410 do acervo.
Invariante: **399 → 0**.

### 3. Marketing — o Ads está entregando, mas medindo pela metade

**6 cliques em 14 dias**, todos com `gclid`, campanha `pesquisa-leilao-imoveis`, o último hoje
11:38 (eram 2 ontem à noite — está crescendo). Mas **`utm_term` e `utm_content` seguem nulos em
6 de 6**: a pendência (A) do dono, o sufixo de UTM, **não foi aplicada**. Sem isso não se sabe
QUAL palavra-chave traz gente, e as negativas continuam saindo de lista genérica.

### 4. Fluxo dos 3 relatórios unificado (pedido do dono, na mesma sessão)

> *"Ao gerar o relatório documental ele vai para uma tela à parte e não fica como quando clico
> no mercadológico, na mesma tela e mostrando a evolução da elaboração embaixo. Poderia
> organizar o fluxo para ser o mesmo nos 3?"*

**Não era escolha de design, era assimetria de implementação.** O que estava assim:

| | Mercadológico | Documental | Laudo |
|---|---|---|---|
| Fica no hub ao gerar | ✅ | ✅ (só saltava quando faltam docs) | ❌ `setRelSel('laudo')` incondicional |
| Coluna `progresso` | ✅ | ❌ não existia | ❌ não existia |
| Backend emite etapas | ✅ 7 pontos | ❌ zero | ❌ zero |
| Barra de evolução | ✅ | ❌ render travado em `c.k==='mercado'` | ❌ idem |

O laudo **arrancava** o cliente do hub e o jogava numa tela à parte com um spinner mudo. O
documental ficava no hub, mas sem nada para mostrar — o spinner era a única prova de vida.

*Unificado nas três camadas:*
- **Banco** (`progresso_documental_e_laudo.sql`): `progresso jsonb` nas outras duas tabelas,
  mesmo formato do mercadológico. `rowToEntry` do `AnalisesContext` é compartilhado, então
  o dado flui para os três sem mudança por tabela.
- **Backends**: `gerar-documental.js` emite 4 etapas REAIS, na ordem em que executa
  (reunindo documentos · processo no CNJ · leitura jurídica · certidões fiscais), com
  contagem por etapa; `gerar-laudo-viabilidade.js` emite 2 (cruzando as bases · parecer
  final) — ele consolida, não reprocessa, então são duas fases honestas e não quatro
  inventadas para a barra parecer cheia.
- **Tela**: o `setRelSel('laudo')` saiu; a barra deixou de ser travada em `mercado` e cada
  card lê o progresso da **sua** entrada (`c.entry`).

**Duas decisões que valem entender:** (a) o documental **continua** navegando quando faltam
documentos — ali a tela separada é onde se anexa o PDF, então o salto leva a uma AÇÃO, não a
uma espera; (b) as etapas distinguem `pulado` de `concluído com zero`. Sem número de processo
para consultar, o CNJ sai como traço, não como "0 processos" — a mesma distinção entre "não
procurei" e "procurei e não achei" que o CLAUDE.md cobra no resto da base. E a etapa de
certidões vira `erro` se a consulta cair, em vez de girar para sempre.

### 5. MERCADOLÓGICO — o preço do m² saiu da IA e virou código (pedido do dono)

O dono trouxe um caso concreto: apto em Guarulhos, corretora e Google mostrando R$ 250–270 mil,
sistema fechando ~R$ 200 mil. **A investigação achou um problema mais fundo que o número:**
o relatório NÃO calculava o preço do m² — pedia o número à IA. `valorEstimadoImovel` era um campo
do JSON que o modelo preenchia, e a regra "quanto mais perto, maior a influência" **não existia
em lugar nenhum do código**. Resultado medido: a MESMA microrregião precificada entre R$ 4.209 e
R$ 7.248/m² conforme a análise (72% de amplitude), com o nível 1 saindo mais barato que o nível 2
em 4 de 8 análises.

**Cinco defeitos nas amostras reais** (análises `bc8a88cf` e `ea0f6aa9`):
1. **O próprio lote como comparável** — `fonte: "Imóveis de Leilão Caixa"`, `valor: 94.815,14`
   (o lance mínimo, ao centavo) a R$ 2.280/m². **6 das 54 análises (11%).**
2. **Aluguel contado como venda** — R$ 3.200/mês em 40 m² = R$ 80/m².
3. **Teto de distância nunca verificado** — comparáveis a 6 e 7 km a R$ 13.800/m² inflaram o
   nível 2 para R$ 7.248/m². O prompt chamava de "REGRA DURA"; nada no código conferia.
4. **Anúncio sem preço contava como amostra** — "2 amostras" onde havia 1.
5. Comparável de outra praça dentro do raio.

*Corrigido* — `api/_valor-mercado.js`, determinístico: peso 1/(1+d/250m) × recência 1/(1+anos),
descarte com motivo registrado, ampliação para 2 km abaixo de **10 amostras** (era 5), e
`baseCalculo` imprimindo a fórmula. Só para m² privativo/construído — terreno/rural/hectare
seguem com o método type-aware da IA.

### 6. A BUSCA passa a começar pelas imobiliárias locais

O dono suspeitava que o sistema errava em **localizar** as imobiliárias. **A medição não
confirmou:** `fonte_local_cidade` tem Guarulhos com 13 imobiliárias, 88 reusos, todas frescas, e
42,5% das amostras do acervo já vêm de fontes locais reais (Lopes 40, Morada na Praia 14,
J.A.D.S. 10, Menezes 8). **O defeito era de PRIORIDADE:** (a) o prompt punha "FONTES (grandes
portais)" primeiro e as locais como *"além dos portais, busque também"* — suplemento, não base;
(b) a lista concreta da praça era **colada no fim do prompt** (`prompt + cacheTxt + fontesTxt`),
depois de ~200 linhas e desgrudada da seção de fontes. Por isso a análise do imóvel do dono saiu
com Wimoveis/ZAP/QuintoAndar/VivaReal e **zero imobiliária local, tendo 13 conhecidas**.

*Corrigido:* bloco FONTES em dois passos — passo 1 locais (com a lista conhecida DENTRO dele),
passo 2 portais como complemento; buscas por BAIRRO, não só cidade.

### 7. A REVISÃO de custo-benefício (pedido do dono, antes de publicar)

A revisão pegou **um defeito que eu mesmo tinha introduzido**, e ele valia o passo: o orçamento
de buscas é por INSTRUÇÃO (`webUses`, que cai de 6 para **2** quando a base própria já cobre a
praça — a economia criada em 06/08). Meu bloco novo mandava fazer **4 buscas só no passo 1**, mais
os portais. Ou o modelo estouraria o teto e o custo subiria em toda análise cacheada, desfazendo
em silêncio aquela economia, ou obedeceria o teto e nunca chegaria aos portais — menos amostras
que antes. **Os dois desfechos ruins.**

*Resolvido pela própria memória:* quando a praça já tem imobiliárias conhecidas, o prompt agora
diz para **não gastar busca descobrindo** — a lista está ali, vá direto aos sites. A memória
passa a PAGAR em custo, que era o ponto dela. Só quando a lista está vazia é que se gasta uma
busca de descoberta.

Mais duas travas da mesma revisão:
- **Mínimo de 3 amostras para substituir o número da IA.** Com 1 ou 2, a média ponderada é o
  preço de UM anúncio com nome de estatística — exatamente o que este trabalho veio criticar. O
  valor determinístico continua gravado em `mercado.valorPonderado` com `aplicado: false` e o
  motivo, para o cliente e a auditoria verem, mas não vira a capa.
- **O `catch` do refinamento deixou de ser mudo:** vai para o log do servidor e para
  `mercado.valorPonderado.motivo`. Um refinamento que falha em silêncio é a família do dia.
- `amostrasDescartadas` limitado a 40 por análise (o total por motivo já vai no `baseCalculo`).

### ⚠️ O QUE ESPERA VOCÊ NA ABERTURA

1. **`proximidades_vazio_falso` deve seguir CAINDO sozinho** conforme o cron (a cada 15 min)
   drena. Verde = ≤ 300. Se voltar a SUBIR, a assinatura é o que diz se é escritor novo:
   `select count(*) from imoveis_leilao where ativo and pontos_proximos='{}'::jsonb and coalesce(proximidades_vazios,0)=0;`
   → tem que continuar **0**. Se sair de zero, apareceu um quarto escritor.
2. **O job OSM das 05h UTC de 14/08 é a prova de fogo** da correção — o log agora separa
   `com pontos` de `sem POI (deixados p/ o cron)`. Se `sem POI` vier alto, o problema é o
   extrato de POIs, não o Brasil ter ficado sem escolas.
3. **Pendências do dono seguem as de 12/08** (A: sufixo UTM · B: verificação do Ads, prazo
   02/09 · C: MX do domínio · D: Junta · E: teto Bright Data, decisão 18/08 · F: "uso ocasional").
   `bd_teto_saturado` continua em 480/405 — é o item E, decisão marcada.

---

### ⚠️ ENCERRAMENTO DE 13/08 — estado MEDIDO e o que espera amanhã

> **`main` em `ea063bc` · 10 commits no dia · deploy READY · CI verde · working tree limpo.**

**Verificação de fechamento (tudo remedido agora, não de memória):**

| Verificação | Resultado |
|---|---|
| `auditoria_seguranca()` | **0 crítico / 0 atenção** |
| `auditoria_regras_negocio()` | **0 crítico** |
| KYC ilegível pelo servidor | **0** |
| Fontes no ponto cego do monitor | **0** |
| `edital_eq_matricula` | 399 → **0** ✅ |
| Resíduo de proximidades (assinatura do defeito) | 293 → **0** ✅ |
| As 3 migrações escritas hoje | **as 3 aplicadas** (conferido em `information_schema`, não no repo) |
| `verificar:padroes` · `:sintaxe` · `:schema` | **passando** |
| Erros de cliente abertos | **1** (ver abaixo — não estava lá de manhã) |

### 🔴 OS DOIS ITENS QUE FICAM ABERTOS

**1. Um erro de cliente novo — DIAGNÓSTICO AVANÇOU, causa ainda não cravada.**
`/imovel/:id` · `Cannot read properties of null (reading 'id')` · **13/08 17:32 UTC** ·
**visitante anônimo** · 1 ocorrência · URL real: `/#/imovel/d36e7e4f-0367-47ba-9ea5-cef15bd839dd`.

> ⚠️ **CORREÇÃO de uma afirmação minha, feita 2h antes neste mesmo documento.** Escrevi que
> "`erros_cliente` não guarda o stack". **Está errado:** a coluna `stack` existe, o front sempre
> a envia e `api/log-erro-cliente.js` a grava (4.000 chars). Eu havia concluído isso sem
> conferir o schema — o mesmo atalho que este projeto persegue em toda parte. Fica registrado
> porque a conclusão errada quase virou uma tarefa de instrumentação que já estava pronta.

**O que o stack revelou:** é erro de **RENDER** (tem `componentStack`), dentro de um `Suspense`,
e o quadro que lança é `at qs (index-a4hI7HCk.js:33:30918)` — o **chunk principal**, não o da
página. Eliminei por leitura de código, um a um: `ImovelGate` (tem `if (im === null) return`
antes de tocar `im.id`), `ChatSuporte` (os três efeitos checam `user?.id`), `SugestaoImovel` e
`ToastRelatorioPronto` (só montam logado, `App.jsx:288/293`), `BoasVindasModal` (o `curso.id`
está dentro de um `onClick`). Todos guardados.

**O que impedia fechar, e foi resolvido:** o build não gerava sourcemap, então `qs` não vira
nome nenhum. **`vite.config.js` agora tem `build.sourcemap: true`** — o repositório é público
(CLAUDE.md), então o mapa não expõe nada que já não esteja no GitHub, e nenhum segredo vive em
bundle de front. **Na próxima ocorrência o stack resolve para arquivo e linha**, e a consulta
que já existe basta:
```sql
select msg, url, stack from erros_cliente where not resolvido and rota = '/imovel/:id';
```
> A lição vale além deste erro: eu passei a sessão eliminando candidatos por leitura porque a
> evidência tinha sido apagada no build. Não era falta de zelo na busca — era o sinal ter sido
> destruído antes de eu precisar dele. É a mesma família do resto do dia, um passo antes.

**Achado colateral, esse já corrigido:** `ImovelGate` lia `{ data }` sem `error` (forma 2). Numa
rota PÚBLICA — as 33 mil páginas indexadas — uma falha de leitura virava "imóvel não encontrado",
e quem veio do Google concluiria que o anúncio saiu do ar. Agora a falha tem estado próprio.

**2. `proximidades_vazio_falso` = 440 (limite 300) — mas NÃO é o defeito voltando.**
A assinatura do defeito (`pontos_proximos='{}'` com `proximidades_vazios=0`, estado que só o job
OSM produzia) está em **0** e não saiu de lá. Os 440 são vazios que o cron **corroborou** com 3+
observações em execuções distintas: 120 foram confirmados entre 12h30 e 23h45 de hoje, todos com
`obs >= 3`, acumuladas ao longo de dias. É a corroboração funcionando.
**A pergunta que sobra é do dono, e é de calibragem, não de bug:** com 14,7 mil lotes com pontos
em 1.197 cidades, ter ~440 lotes sem NENHUM POI num raio de 4 km (periferia rural de cidade
mapeada) é plausível. Ou o limite de 300 subiu de escala e deve ser recalibrado, ou há vazio
falso residual de outra origem. **Não recalibrei por conta própria** — mexer no limite sem
decidir qual das duas é o caso transformaria o alerta em enfeite.

### ⚖️ NOVO — FINANCIAMENTO A ASSUMIR EM LEILÃO JUDICIAL vira ressalva MÁXIMA

> Registro do dono (13/08): *"na avaliação documental, quando é um leilão judicial e você tem que
> assumir um financiamento, é uma questão muito preocupante. Sei que no laudo documental isso é
> apresentado, mas é interessante colocar como uma ressalva maior."*

**Por que ele tem razão, e por que era fraco antes.** No leilão judicial a REGRA é a arrematação
EXTINGUIR os ônus, com o credor se satisfazendo no PREÇO (art. 908 §1º do CPC, art. 1.499 do CC):
quem arremata recebe o imóvel livre. Quando o edital inverte isso e manda o arrematante ASSUMIR
um financiamento existente, a operação **muda de natureza** — existe uma dívida que ACOMPANHA o
imóvel e se soma ao lance, ao leiloeiro e às custas. **O desconto aparente pode ser menor que o
saldo assumido, ou inexistir.** É a diferença entre comprar um imóvel e comprar a posição de
devedor. E em alienação fiduciária levada a leilão JUDICIAL pode estar sendo alienado o DIREITO
DO DEVEDOR FIDUCIANTE, não a propriedade plena.

**O que estava errado:** o modelo **não era sequer perguntado**. Não havia campo nenhum sobre
isso em `extracao` — o assunto só aparecia se a IA, por conta própria, o mencionasse no texto
corrido do parecer. Uma ressalva que depende de o modelo lembrar não é uma ressalva.

*Feito, em três camadas:*
1. **Campo novo na extração:** `financiamentoAssumido` (sim/nao/nao_consta), `financiamentoSaldo`
   e `financiamentoCredor`, com as expressões a procurar no edital e na matrícula ("assumir o
   saldo devedor", "sub-rogação no contrato de financiamento", "dívida junto ao agente
   financeiro") e o aviso de NÃO confundir com a dívida que originou o leilão e se extingue.
2. **Regra de classificação no prompt:** severidade **bloqueante**, a seção 6 do parecer ABRE por
   este ponto, e se o saldo não constar é obrigatório dizer com todas as letras que o valor da
   dívida assumida é desconhecido e precisa vir do agente financeiro ANTES do lance.
3. **Risco DETERMINÍSTICO montado pelo servidor** (junto do bloco antifraude, `gerar-documental.js`):
   com `financiamentoAssumido = sim`, o item entra na mesma lista que a tela ordena por
   severidade — **não depende da redação do parecer para aparecer em destaque**. É a mesma
   escolha do resto do dia: o que importa não pode depender de o modelo lembrar.

### 🔐 SEGURANÇA — hardening feito e o mapa de requisitos (novo: `docs/SEGURANCA_REQUISITOS.md`)

> Intenção do dono: *"não são os certificados, mas atender a todos os requisitos deles para
> cobrir qualquer eventualidade."*

**Feito em 13/08:**
- **21 funções próprias ganharam `search_path` fixo** (`public, extensions, pg_temp`) — migração
  aplicada e espelhada no repo. `pg_temp` por ÚLTIMO de propósito: é a inversão da ordem que é o
  risco. Verificado: 21 → **0**, e as funções testadas contra dado real continuam corretas.
  > ⚠️ **Correção de uma afirmação minha, na mesma sessão:** eu classifiquei isso como "vetor
  > clássico de escalação de privilégio". **Exagerei.** Medido depois, **nenhuma das 21 era
  > SECURITY DEFINER** — sem DEFINER a função roda com o privilégio de quem chama, então não há
  > escalação. O risco real era sequestro de RESOLUÇÃO. Corrigir foi certo; a gravidade era menor
  > do que eu disse, e o registro precisa dizer isso.
- **15 funções `SECURITY DEFINER` executáveis por anon: auditadas uma a uma, nenhuma ação.**
  5 são gatilhos (ruído do detector), 5 são públicas por TOKEN por desenho (contrato/convite —
  quem assina não tem conta), 3 devolvem o papel do próprio chamador, e as 2 que eu havia
  marcado para revisão foram lidas linha a linha: `obter_arquivo_ebook` só entrega pago com
  compra ativa; `registrar_imovel_visto` sai se `auth.uid()` for nulo. Corretas.
- **`extension_in_public` (cube/earthdistance): aceito com registro.** Mover exige recriar os
  índices geoespaciais do Índice — risco de mudança maior que o do achado.
- **Advisor: 0 ERROR.** Os 95 WARN decompostos no documento — não são 95 problemas, são ~3.

**Documento novo `docs/SEGURANCA_REQUISITOS.md`** com: mapa de 18 requisitos ISO 27001/SOC 2 pelo
MÉRITO (✅/🟡/🔴, sem candidatura a certificado), **plano de resposta a incidente** (severidade
S1–S4, conter antes de entender, preservar evidência antes de corrigir, e o prazo da ANPD —
3 dias úteis do CONHECIMENTO, Resolução CD/ANPD 15/2024), registro de fornecedores críticos com
o que acontece se cada um cair, e os 7 itens que dependem do dono com o passo exato.

**Nota de postura: 72 → 80.** Teto sem ação do dono: ~85. O pentest externo sozinho vale ~6.

> **Os 3 itens de maior retorno, todos do dono:** (1) **MFA** em Supabase/Vercel/GitHub — uma
> senha de admin comprometida entrega o banco inteiro; (2) confirmar **PITR** e testar UMA
> restauração (backup nunca testado não é backup, é esperança); (3) **pentest externo com laudo**.
> Detalhe: o canal `privacidade@` está publicado no site e **não recebe** enquanto o MX não for
> configurado — isso é lacuna de conformidade, não só de produto.

### 🔥 A PROVA DE FOGO É AMANHÃ ÀS 05h UTC

O job `enriquecer-osm` roda 05:00 UTC. A correção dele foi ao ar às 12h15 de hoje, **depois** da
execução de hoje — então a rodada de 14/08 é a primeira com o código novo. Conferir:
```sql
-- tem que continuar ZERO. Se sair de zero, apareceu um QUARTO escritor.
select count(*) from imoveis_leilao
 where ativo and pontos_proximos='{}'::jsonb and coalesce(proximidades_vazios,0)=0;
```
E no log do workflow, a linha nova separa `com pontos` de `sem POI (deixados p/ o cron)` — se
`sem POI` vier alto, o problema é o extrato de POIs, não o Brasil ter ficado sem escolas.

### 🧪 O TESTE QUE DEPENDE DO DONO

**Regerar o mercadológico do imóvel de Lavras** (Av. José Brumatti 2856, Guarulhos) e conferir 3
coisas: (a) as imobiliárias de Guarulhos aparecem entre as FONTES das amostras? (b) os anúncios
de R$ 250–270 mil que o dono achou no Google entram? (c) o `baseCalculo` mostra a fórmula e os
descartes?

> **A ressalva que precisa sobreviver ao fim do dia:** a conta foi consertada e ficou auditável,
> mas **a diferença para os R$ 250–270 mil era de RECALL DA BUSCA, não de cálculo**. Medido: com
> as amostras que o sistema achou, o valor determinístico dá R$ 201.300 contra os R$ 202.653 da
> IA — praticamente igual. Se depois deste deploy os anúncios continuarem não entrando, o
> gargalo é a cobertura do Gemini grounding, e o próximo passo é uma segunda passada focada no
> ENDEREÇO exato. Não mexi nisso porque quero o número real antes.

### ⏳ Pendências do DONO (as de 12/08 seguem, nenhuma foi resolvida hoje)

(A) sufixo UTM com `utm_term`/`utm_content` — **medido hoje: 6 cliques do Ads em 14 dias, todos
com `gclid` e `utm_term` NULO em 6 de 6**; (B) verificação do anunciante Google Ads, prazo 02/09;
(C) MX do domínio; (D) nome fantasia/objeto social na Junta; (E) Bright Data, teto saturado
(480/405), decisão marcada para 18/08; (F) "uso ocasional" como coluna.

---

## 🏁 O QUE FOI FEITO EM 13/08 — os 10 commits

1. **`05eedcd` — Proximidades e edital CEF.** O terceiro escritor de `pontos_proximos`
   (`enriquecer-osm.mjs`) gravava vazio como resposta E recarimbava `proximidades_em` de 12.820
   dos 13.101 lotes a cada 48h, **desligando a auto-cura de 30 dias criada em 10/08**. Mais: o
   botão "Edital" de 399 lotes CEF abria a MATRÍCULA.
2. **`d77e24e` — Fluxo igual nos 3 relatórios.** O laudo arrancava o cliente do hub; documental
   e laudo não tinham etapas para mostrar. Coluna `progresso` nas 3 tabelas, 4 etapas reais no
   documental, 2 no laudo, barra unificada.
3. **`413535f` — Preço do m² ponderado.** A conta saiu da IA e virou código
   (`api/_valor-mercado.js`).
4. **`35fadb1` — Busca começa pelas imobiliárias locais.** A hipótese do dono ("erra em
   localizar") **não se confirmou** — Guarulhos tinha 13 imobiliárias mapeadas e 88 reusos. O
   defeito era de PRIORIDADE: o prompt punha os portais primeiro e colava a lista da praça no FIM.
5. **`b9a76d9` — Revisão de custo-benefício.** Pegou um defeito MEU: o bloco novo pedia 4 buscas
   onde o orçamento é 2, o que desfaria em silêncio a economia de 06/08. Resolvido pela memória
   (praça conhecida não gasta busca de descoberta) + mínimo de 3 amostras para substituir a IA.
6. **`ed98bde` — Mobile.** Selos vazando no 360 (`min-width: auto` + `flexShrink: 0`) e rolagem
   lateral na tela de imóvel (rótulos de largura fixa sem `flexWrap`).
7. **`d4f2ca9` — As duas classes viraram TRAVA.** `flash-de-vazio-no-carregamento` e
   `flex-rotulo-fixo-sem-quebra` entram com **linha de base ZERO** (portão duro);
   `flex-2col-sem-minwidth0` com base de 33 arquivos. **Testadas de ponta a ponta:** arquivo com
   as construções reprova com `exit=1` e volta a passar quando removido.

**O fio que costura o dia inteiro:** todo defeito de hoje foi *ausência entregue como resposta* —
o vazio do Overpass, o lance mínimo como comparável de mercado, o aluguel como venda, o spinner
mudo no lugar da etapa, e o `useState([])` que afirma "nenhum" antes de o servidor responder.

---

## 🔚 SESSÃO DE 12/08 — leia ESTE bloco primeiro

> **O dia em uma frase:** começou como ritual de verificação e virou a maior varredura da base até
> hoje — **46 commits**, e o padrão que se repetiu do primeiro ao último achado foi sempre o mesmo:
> **código correto entregando resposta errada em silêncio.**
>
> **Índice do dia** (cada item tem sua seção abaixo):
> 1–6 · os seis achados do ritual de abertura ⟶ 7 · auditoria das 11 caixas do Dashboard ⟶
> 8–9 · travas novas ⟶ 10 · Brasil mapeado + Censo IBGE reformado ⟶ 11 · MRR ⟶ 12 · "o
> mercadológico sumiu" (janela de 12 + retenção pela metade) ⟶ 13 · Atendimento recebendo e-mail ⟶
> 14 · Cliente 360: um cadastro perdido em tempo real ⟶ 15 · as 33 mil páginas sem medição ⟶
> 15b · medição do Google Ads ⟶ 16 · cobertura das travas.
>
> **Se for ler só uma coisa:** o encerramento no fim deste bloco, com o alerta que estava
> **crescendo** quando o dia fechou.

### 🔚 (abertura) — o ritual e os seis primeiros achados

> Sessão de **verificações iniciais** pedida pelo dono (saúde de sistema, otimizações e Cliente
> 360). O ritual saiu **verde em tudo que ele já cobria** — e foi a varredura **schema × código**,
> a mesma que fechou 11/08, que achou **seis defeitos novos**, dois deles batendo no cliente.
> Todos corrigidos nesta sessão.

### O que o ritual mediu (verde, para ninguém refazer)

| Verificação | Resultado |
|---|---|
| `auditoria_seguranca()` | **0 crítico / 0 atenção** (reconferido depois das 2 migrações) |
| `auditoria_regras_negocio()` | **0 crítico** |
| Erros de cliente abertos (14d) | **0** |
| Chamados do cliente sem resposta | **0** |
| KYC ilegível pelo servidor | **0** |
| Fontes no ponto cego do monitor | **0** |
| Deploys Vercel | todos **READY** |
| Acervo | 30.999 ativos · 20.747 tocados em 24h · fila de geocode **104** (era 3.519 em 06/08) |

**Espelho — item 3 do encerramento de 11/08: FECHADO ✅.** A correção do teto invisível do
PostgREST funcionou como previsto: fila **5.560 → 2.144**, copiados **2.239 → 6.075**, 9.353 MB.
O limite voltou a ser o tempo, não o lote.

### Os seis achados — e o que cada um ensinou

**1. O cliente recebia o e-mail de uma reunião que não existia.** `solicitacoes.reuniao_em` e
`reuniao_duracao_min` **nunca foram criadas** (o código veio no commit `e41fc0c` de 10/08; a
migração não). O `update` do Admin não checava `error`: o 400 era engolido e **nada** era gravado
— nem checklist, nem notas, nem link, nem status. E `salvarENotificar` seguia adiante, criava a
sala Daily.co e **disparava o e-mail**. Do outro lado, o card "Próximas Reuniões" do Painel lia a
mesma coluna ausente dentro de um `Promise.all` e não mostrava nada. Sintoma zero dos dois lados.
Prova de que nunca funcionou: 3 solicitações no acervo, **0 com `google_meet_link`**.
*Corrigido:* colunas criadas (+ índice parcial), e-mail só depois de PROVAR a gravação, e o Painel
reportando falha em `erros_cliente`.

**2. `/registro-imovel` (ONR) inteiro sobre uma tabela inexistente.** `add_onr_protocolos.sql`
estava no repo desde 10/08 e nunca foi aplicada. Lista caindo em `data || []` (vazia, com cara de
funcionando); protocolar jogava o erro cru do PostgREST na tela. *Corrigido:* migração aplicada
(com `REVOKE` de anon — a tabela guarda CPF/CNPJ), tela distinguindo "nenhum protocolo" de "não
consegui ler", e o update de status provando o que mudou com `.select()`.

**3. O timeout que não avisa — 3 dias de coleta truncada em silêncio.** O scraper Puppeteer diário
passou dos 90 min e o job termina `cancelled`; **`cancelled` não é `failure()`**, então o passo
"Notify on failure" ficava *skipped*. O corte cai sempre na CAUDA da lista: **SUPORTE, GRUPOLANCE e
WEBLEILOES sem coletar desde 09/08**, 557 lotes congelados. Medido: em 09/08 a rodada completa
levou ~87 min — encostada no teto. *Corrigido:* timeout 150, notify em `failure() || cancelled()`,
**nos três** workflows que têm notify (os três tinham a mesma cegueira), e as 3 fontes disparadas
à mão.

**4. A cota negando, gravada como regressão do leiloeiro.** Bright Data saturado (450/450; como o
propósito `rj` reserva 60 e usou 30, o teto efetivo dos demais caiu para **420**). CALIL, VEGAS e
TORRES3 saíram com `0 lotes enumerados (via null)` **em 0,6 s** e viraram
`REGRESSÃO: caiu de 6 para 0`. Orçamento lido como quebra de site — e as duas coisas pedem ações
**opostas**. *Corrigido:* `scraper-soleon` passa a usar `buscarViaBrightData` (que LANÇA com o
motivo) e o `semCota` chega até `registrarSaude`, que não acusa mais regressão quando o zero veio
do orçamento.

**5. PESTANA caiu de 1.014 para 0 — e era falha TRANSITÓRIA se apresentando como leiloeiro
quebrado.** Rodada das 12:13 deu `total 0 · falhou`; às 13:08, **sem tocar em nada**, voltou a
**992 · ok**. A causa é estrutural no scraper, não no site: `/api/v2/leilao` é o gargalo de TODA a
fonte e era chamada **uma única vez** — um piscar de rede devolvia `null`, o scraper retornava `[]`
e um acervo de mil lotes virava `REGRESSÃO: caiu de 1014 para 0` no monitor. *Corrigido:* 3
tentativas com backoff antes de desistir. O acervo nunca chegou a ser perdido (os lotes seguiram
ativos), mas o alarme era falso e teria custado uma investigação inteira.

**6. O freio de custo que nunca freou.** `scripts/lib/scraper-core.mjs` tinha limitador de cota
mensal de proxy, teto em dólar e alerta de 80%/100% — e a tabela `proxy_uso` **nunca existiu**.
`carregarUso` lia sem checar `error` (zero a cada execução), `dentroDoLimite()` respondia "pode
gastar" para sempre, e **nenhum** dos cinco scrapers importava essas funções. Código morto que se
lia como rede de proteção. *Removido*, com nota apontando para o controle real (`api/_brightdata.js`).

> **O método que achou 1, 2 e 6 virou TRAVA AUTOMÁTICA** (ver a seção seguinte): extrair todos os
> `.from('tabela')` do código e as colunas de data usadas em filtro/ordenação, e conferir contra o
> schema real. Nenhum dos três apareceria em leitura de código — o código está certo; o banco é que
> não recebeu a migração. **Não precisa mais rodar isso à mão:** `npm run verificar:schema` faz, e
> o CI roda a cada push e todo dia às 11h UTC.

### 📊 Auditoria das 11 caixas do Dashboard (12/08) — 10 certas, 1 impossível

O dono pediu parecer sobre a origem dos dados. Conferi caixa a caixa, recalculando cada número
direto no banco sem passar pelas RPCs. **Origem:** a linha de cima vem de `admin_dashboard_contadores`
(+ MRR calculado no NAVEGADOR sobre `planos_config`); as 7 de baixo vêm de `admin_metricas_negocio`.

**Dez batiam exatamente.** O que não batia, e o que enganava:

| # | Achado | Estado |
|---|---|---|
| 1 | **"Cidades maduras" era um zero ESTRUTURAL** — `cidades_indice_maduras(6,'residencial')` filtrava um `tipo` que não existe nos níveis bairro/grid (lá é apartamento/casa/terreno). Nunca casava com nada. Real: **3 maduras · 19 em progresso**. E o card anuncia *"libera desconto×índice"* — regra de negócio pendurada num indicador que não podia disparar | ✅ `p_tipo` vazio = todos os tipos |
| 2 | **54% das buscas eram do dono** (1.182 de 2.206), num painel que se lê como uso de cliente. Uso real: **1.024** | ✅ card virou "Buscas de clientes", internas reveladas ao lado |
| 3 | **A metade de cima falhava em silêncio**: RPC sem checar `error` → tudo virava zero, e *"0 inadimplentes"* tem cara de dia bom. O painel de baixo já checava e se escondia — mesma tela, dois comportamentos | ✅ aviso explícito |
| 4 | **MRR: anual contado a preço mensal** (R$49,90 em vez de R$37,49 — +33%) e **inadimplente contado no topo mas não no detalhe**. Zero anuais e zero inadimplentes hoje, então o número está certo; erraria na primeira venda anual | ✅ base do MRR já cruzada no servidor |
| 5 | **Amostras: `(n1)+(n2)` com um lado nulo descarta a LINHA inteira** do `sum()`. As 51 atuais têm os dois níveis, então 1.524 está correto | ✅ coalesce por nível |

> **Leitura que continua valendo para o dono, e não é bug:** dos R$ 699,60 de MRR, **R$ 500 (71%)
> são amortização do pacote Assessoria** (R$6.000÷12), que é prazo fixo, não assinatura — se não
> renovar, o MRR cai 71%. E "39 usuários" inclui a conta admin e 33 exploradores gratuitos:
> **pagantes são 5**.

### 🔒 As travas criadas para que esta família não volte (12/08, EM PRODUÇÃO)

Corrigir os seis achados não impede a MESMA família de voltar na próxima feature. Cada classe
ganhou uma trava **determinística, custo zero, sem IA**:

| Trava | Onde roda | Pega |
|---|---|---|
| `npm run verificar:schema` (**nova**) | CI `verificar-schema.yml` — push, PR e **diário 11h UTC** | Toda tabela em `.from('x')` (88) e coluna de data em filtro/ordenação (54) conferidas contra o schema REAL, pela RPC `schema_inventario()` |
| `mutacao-sem-binding` (**nova regra**) | `prebuild` — todo build e o deploy da Vercel | `await supabase.from(...).update/insert` cujo resultado é descartado: a forma exata que mandou o e-mail de reunião fantasma |
| `notify-sem-cancelled` (**nova regra**) | idem | Passo de alerta com `if: failure()` sem `cancelled()`. **Linha de base ZERO** = portão duro |

Três decisões que valem entender antes de mexer:

1. **O verificador de schema NÃO está no `prebuild`.** Ele fala com o banco; pôr isso no caminho
   do build faria o deploy da Vercel depender da disponibilidade do Supabase — trocaria uma classe
   de falha por outra. Roda **também agendado**, porque a deriva nasce dos dois lados: renomear uma
   coluna quebra código que ninguém tocou, e aí não há push nenhum para disparar a checagem.
2. **Ele reprova quando NÃO CONSEGUE verificar** (saída 2). Tratar "não consegui checar" como "está
   tudo bem" seria cometer, dentro da própria trava, o defeito que ela existe para pegar.
3. **`mutacao-sem-binding` entrou com 96 ocorrências históricas na linha de base** (total 395, era
   299). É deliberado: só ocorrência NOVA reprova. Não saia refatorando as 96.

> **A trava caiu na própria armadilha, e o registro disso é a parte útil.** O primeiro CI reprovou
> acusando `imoveis_leilao` — 66 colunas, existe desde sempre. A RPC devolvia uma linha por coluna
> (2.136) e **o PostgREST corta em 1.000 sem erro**: o verificador recebia meio schema. É a mesma
> armadilha que `api/publico.js` e o cron do espelho já documentam aqui. Corrigido devolvendo **um
> único jsonb** (uma linha nunca é truncada) e, mais importante, o verificador agora **reprova se a
> RPC voltar a devolver array**. Lição para a próxima trava que alguém escrever: o teto de 1.000 do
> PostgREST é característica do TRANSPORTE, não detalhe de cada chamada.
>
> Por que passou de primeira: validei o extrator e os pares por SQL, mas nunca exercitei o caminho
> completo do script (sem credencial na sessão, ele parava na saída 2). Agora há teste de ponta a
> ponta com servidor falso nos três casos — completo passa; faltando `reuniao_em`/`onr_protocolos`
> reprova apontando arquivo e linha; array reprova como "não verificado".

### ⚠️ O QUE ESPERA VOCÊ NA ABERTURA

1. **Tudo já está em produção** — `main` recebeu os commits (fast-forward de `3591829`), o deploy
   da Vercel saiu READY e o CI das duas travas passou (`verificar-padroes` e `verificar-schema`,
   ambos `success`). As migrações de banco já valiam antes, por terem sido aplicadas direto.
   > ⚠️ **Cuidado com o `main` LOCAL deste clone:** ele aponta para um histórico NÃO RELACIONADO
   > (`27091e6`, 52 commits divergentes) e `git merge` recusa com "unrelated histories". Não é o
   > `origin/main`. Para publicar, use `git push origin HEAD:main` a partir da branch de trabalho
   > — foi o que se fez aqui. Não tente "consertar" o main local sem entender de onde ele veio.
2. **As fontes paradas já foram recoletadas à mão**, em vez de esperar o cron — e a defasagem de
   3 dias era real, não só congelamento: GRUPOLANCE **434 → 453** ativos, WEBLEILOES **89 → 90**,
   SUPORTE atualizado, PESTANA de volta a **992 · ok**. A rodada fechou em 11 min com `success`.
   > Nota de método: o recon do PESTANA **não pôde** rodar desta sessão — a política de rede do
   > ambiente bloqueia `pestanaleiloes.com.br` (403 no CONNECT do proxy). A saída foi usar o
   > próprio scraper como sonda, via `workflow_dispatch` com `fontes=PESTANA`, porque o log dele
   > já separa os três pontos de quebra possíveis. Vale lembrar disso na próxima vez que um recon
   > parecer impossível daqui.
3. **Bright Data — a decisão do teto continua marcada para 18/08**, agora com um dado a mais: a
   saturação NÃO é teórica, ela já negou coleta de 3 fontes em 12/08. Semana atual: 480 requests
   (o total passa de 450 porque a reserva do `rj` empresta acima do teto global, por definição).
4. **Confirme que o notify de cancelamento funciona de verdade** no próximo estouro — a correção
   é da classe certa, mas só o primeiro cancelamento real prova.

---

## 🗺️ SESSÃO DE 12/08 (tarde e noite) — o Brasil mapeado, e o Censo que nunca tinha entrado

> O dono pediu um card de **"% do Brasil mapeado"**. Para responder isso era preciso ter área,
> domicílios e população por município — e a ingestão do IBGE, que se declarava `ok=true` desde
> 03/08, **não tinha trazido praticamente nada**. O dia virou a reforma dessa ingestão. Terminou
> com **7 fontes verdes, 8 colunas preenchidas nos 5.570 municípios** e números que batem com o
> IBGE publicado na terceira casa.

### 1. A regra do dono que define o NUMERADOR (não mudar sem falar com ele)

> *"os imóveis em leilão em si não devem ser usados, pois é muito comum avaliações defasadas de
> anos ou infladas por alguma questão desconhecida de quem as avaliou"*

O mapeamento é alimentado **só por amostras de mercado** (o que abastece o Índice e os
relatórios). O **acervo de leilão entra apenas como população de referência** — serve para
perguntar "cobrimos onde anunciamos?", **nunca** como fonte de valor. Cada relatório gerado e
cada Índice novo aumentam o mapeamento sozinhos; é assim que o número cresce sem custo extra.

### 2. As quatro causas que mantinham a ingestão do Censo vazia

Todas as quatro produziam **dado plausível e errado**, não erro — nenhuma apareceria em leitura
de código:

| # | Causa | Sintoma |
|---|---|---|
| 1 | **O que não é PEDIDO nunca chega para ser ignorado.** O filtro de variáveis no metadado emagrecia a chamada, e `rotulos_ignorados: []` saía vazio | `ok=true`, 5.570 linhas, **1 de 4 colunas** |
| 2 | **Separador decimal.** O IBGE v3 usa ponto como DECIMAL; o parser tratava como separador de milhar | São Paulo com **1.521.202 km²** (mil vezes o real) |
| 3 | **Rótulo ambíguo.** *"Média de moradores em domicílios ocupados"* casava com o regex de `domicilios_ocupados` antes do regex certo | São Paulo com **265 domicílios** |
| 4 | **Colisão de rótulos.** *"Nascidos vivos"* e *"Nascidos vivos — percentual do total"* casavam com o MESMO regex e gravavam na MESMA coluna; o percentual sobrescrevia a contagem | **`nascimentos = 100` nos 5.570 municípios** |

**O detector de ambiguidade que criei para a causa 3 NÃO pegou a causa 4** — ele compara
colunas, e a colisão é entre RÓTULOS. Ficaram os dois: `colunaPara()` recusa rótulo ambíguo, e
um `Map` de rótulo→coluna recusa dois rótulos distintos escrevendo na mesma coluna. Hoje a
ingestão devolve `colunas_faltando`, `colisoes_de_rotulo` e `variaveis_do_agregado`, e
**ingestão parcial sai `ok=false`** — antes saía verde.

Ferramentas que sobraram e valem para a próxima fonte: `?metadados=<agregado>` lista as
variáveis E as classificações reais; `?buscar=<termo>` procura no catálogo do IBGE. Com elas o
ajuste dos regex vira leitura, não tentativa e erro. Ambas pelo workflow
`socio-reingerir.yml` (nunca com o segredo na URL — vai no header).

### 3. Os números fecharam contra o IBGE publicado — esta é a prova, não a contagem de não-nulos

Contar linhas preenchidas foi exatamente o que deixou passar as quatro causas acima. O teste que
vale é **comparar com o número que o IBGE publica**:

| Medida | BidPro | IBGE | |
|---|---|---|---|
| População (Censo 2022) | 203.080.756 | 203.080.756 | ✅ exato |
| População estimada 2025 | 213.421.037 | ~213,4 mi | ✅ |
| Domicílios ocupados | 72.456.368 | 72,48 mi | ✅ |
| Domicílios vagos | 11.400.705 (**12,6%**) | 11,39 mi | ✅ |
| Área dos municípios | 8.497.332 km² | 8.510.295 km² | ✅ (−0,15%) |
| Área urbanizada | 45.944 km² | ~48 mil km² (2019) | ✅ |

> **`boaesperancadonorte`/MT sem Censo NÃO é falha:** município instalado em 2025 — tem
> estimativa e não tem Censo 2022. É a 5.571ª linha; as outras 5.570 estão completas.
>
> **`domicilios_vagos` é só "vago", não inclui "uso ocasional"** (a classificação pedida ao IBGE
> é `3[59993,60002]`). É deliberado: segunda residência de veraneio não é estoque parado.
> Balneário Camboriú sai com **6,1% de vagos** por causa disso, e está certo. Se um dia alguém
> quiser a leitura de veraneio, é **coluna nova**, não trocar esta.

### 4. Pressão habitacional: primeira vez com dado real

`socio_derivar()` (já chamada no fim de toda ingestão) só agora teve `domicilios`/`vagos` de
verdade. Resultado nos 5.570: **2.092 demanda reprimida · 2.072 estoque ocioso · 1.406
equilíbrio**, com régua autocalibrada nos tercis do país. Confere com o que se sabe: Balneário
Camboriú (6,1% vagos, +1,96% a.a.) = demanda reprimida; Salvador (16,4% vagos, −0,18% a.a.) =
estoque ocioso. **Não é o déficit da FJP** — o `pressao_metodo` diz isso em toda linha.

### 5. As três leituras de cobertura, e por que são três

Uma sozinha engana. Estado ao fechar:

| Leitura | Valor | Responde |
|---|---|---|
| **Brasil mapeado (domicílios)** | **13,3% venda · 9,0% locação** (29 de 5.571 municípios) | Quanto do ESTOQUE DE MORADIA do país já tem valor de referência |
| **Território (mancha urbana)** | **2,3%** — 55,7 de 2.452 km² urbanizados | Quanto do que é cidade está mapeado |
| **Índice cobre o acervo** | **10,9%** — 209 de 1.913 imóveis | Cobrimos onde de fato anunciamos |

A mancha urbana é o denominador em destaque porque a área do município inclui zona rural que
ninguém precisa mapear (Cuiabá: 4.327 km² de município contra 160,6 km² de mancha). A área
municipal fica ao lado como piso conservador — **0,38%**.

> ⚠️ **O número do Brasil mapeado CAIU no fim do dia (de ~20% para 13,3%) e a queda é o
> conserto.** Enquanto `domicilios_ocupados` ainda guardava lixo e a mesma cidade existia com
> duas grafias em `cidade_indicadores`, o numerador contava cidade repetida sobre um denominador
> errado. Hoje `sem_par_ibge = 0` (todas as 29 casam com o IBGE) e o denominador bate com o
> Censo. **13,3% é o número certo. Não "restaure" o maior.**

### 6. `cidade_norm`: uma convenção só, com trava no banco

A mesma cidade estava gravada de duas formas (`'sao paulo'` e `'saopaulo'`) **na mesma tabela**.
Custo medido: o relatório de Feira de Santana enxergava **54 de 171 amostras** da própria
cidade; Lauro de Freitas, 20 de 79. *Corrigido:* dados unificados, trigger
`trg_cidade_norm_sem_espaco()` em 4 tabelas (a grafia errada não volta) e **7 pontos de chamada**
em `api/indice-*.js` passando a normalizar. Conferir a qualquer momento:
`select replace(cidade_norm,' ','') k, uf, count(distinct cidade_norm) from cidade_indicadores
group by 1,2 having count(distinct cidade_norm) > 1;` → vazio = íntegro.

Na mesma linha, a normalização de **bairro** no `indice_cobertura_resumo` era unilateral (tirava
acento/espaço só do lado do imóvel e comparava com o lado do Índice, que os mantinha): só bairro
de palavra única casava — **6 de 23**. Agora **17 de 23**. O defeito era meu, e estava dentro da
função escrita para medir cobertura.

### 7. MRR: dois números, porque eram duas coisas

O card único misturava assinatura com pacote de prazo fixo. Agora: **"Recebido no período"
(R$ 4.615,13)** e **"Assinaturas (MRR)" (R$ 199,60)**. A amortização do pacote Assessoria e o
Clube saem do MRR e entram no recebido — é o que o dono pediu ao dizer que queria faturamento
real, e evita anunciar como recorrente o que acaba quando o contrato acaba.

### 8. Cliente 360 enxerga o pré-login

A linha do tempo de navegação agora marca **`pré-cadastro`** no que a pessoa fez antes de ter
conta. Verificado: `src/utils/tracker.js` **sempre** manda `anon_id`, e **zero** eventos
registrados desde 05/08 estão sem ele — os 2.389 sem `anon_id` são históricos e não voltam.
Nada a corrigir; a ponte melhora sozinha com o tempo.

### 9. Verificação de fim de dia — o que foi checado e deu certo

- **`indice_amostras`: 0 geocodificáveis pendentes.** As 944 sem coordenada **não têm cep, nem
  endereço, nem condomínio** — geocodificar é impossível, não "ainda não tentado". Fecha a
  pergunta de custo×benefício: não há o que rodar aqui.
- **7 fontes IBGE verdes.** `estimativa_populacao` falhou uma vez com `fetch failed` (rede do
  IBGE) e **foi gravada como falha** — no regime antigo teria saído verde. Refeita: 5.571 linhas,
  `ok=true`.
- **Segurança/regras/erros de cliente/chamados/KYC: tudo em zero**, reconferido depois das
  migrações.
- **`relatorio_anomalias` tem 7 em aberto, e NÃO são bug** (24/07 a 09/08): 5 `cnj_vazio`
  (o DataJud não devolveu o processo — segredo de justiça ou fora da cobertura), 1
  `mercado_area_incoerente` (comparáveis a R$ 10.200/m² contra avaliação de R$ 2.846/m²; a área
  de 210 m² é provavelmente TOTAL, não privativa — o sistema ancorou na avaliação em vez de
  publicar o número inflado) e 1 `avaliacao_ausente`. É o ledger fazendo exatamente o que
  existe para fazer: **declarar a incerteza em vez de fingir número**. Não marcar como
  resolvido sem tratar — a fila baixa é sinal de saúde, zero forçado seria mentira.

### 10. 🔴 A deriva que faltava — banco que MUDA e não volta para o repositório

Achado ao verificar o próprio trabalho do dia: **`admin_metricas_negocio()` em produção já tinha
`pct_dom_venda`, e nenhuma migração do repositório tinha.** Foi aplicada direto no banco e nunca
voltou. Se alguém recriasse o banco a partir de `supabase/migrations/`, a chave sumiria do JSON e
o card leria `br.pct_dom_venda || 0` → **"0% venda"**, com cara de resposta.

É a mesma família que abriu o dia (`reuniao_em`, `onr_protocolos`: migração escrita que nunca
chegou ao banco), **na direção contrária**. Corrigido em
`supabase/migrations/dashboard_brasil_mapeado_domicilios.sql`, que é cópia fiel do
`pg_get_functiondef()` da produção. Conferi as outras 6 funções tocadas hoje
(`indice_cobertura_resumo`, `cidades_indice_maduras`, `schema_inventario`,
`trg_cidade_norm_sem_espaco`, `socio_derivar`, `admin_dashboard_contadores`) — **só esta havia
derivado**.

> **Lacuna honesta, para quem abrir a próxima sessão:** `npm run verificar:schema` pega tabela e
> coluna que faltam no banco. **Ninguém pega CORPO DE FUNÇÃO que existe nos dois lados e
> divergiu.** Comparar `pg_get_functiondef()` com o texto da migração é frágil (formatação), e a
> versão barata — conferir que todo `.rpc('x')` do código existe no banco — **não pegaria este
> caso**, porque a função existia. Deixei registrado em vez de construir uma trava que dá falsa
> segurança. Enquanto não houver trava: **mudou função no banco, escreva a migração no mesmo
> commit.**

### 11. Trava nova, pequena: workflow manual não sai mais verde por cima de `ok=false`

`socio-reingerir.yml` recebia HTTP 200 com `{"ok":false,"erro":"fetch failed"}` e terminava
**success** — o 200 é de propósito (uma fonte quebrada não pode derrubar as outras no cron
diário), mas o job precisava ler o corpo. Agora testa `ok` e reprova. Mesmo defeito do dia,
na última casa onde ainda morava.

### 12. 🔴 "Os mercadológicos sumiram" — e não tinham sumido (fim do dia, print do dono)

O dono mandou o print de **Minhas Análises**: seis cards, vários com só o chip *"Jurídico:
risco médio"* e nenhum relatório de mercado. Duas causas independentes, e a principal não
apagava nada:

**(a) A lista lia 12 de CADA tabela.** `AnalisesContext` tem `MAX = 12` e consulta
`analises_mercado`, `analises_documental` e `analises_laudo` com `.limit(12)` **cada uma,
ordenada pelo seu próprio `updated_at`**. Com 51 mercadológicos e 19 documentais na conta do
dono, os cortes caem em datas diferentes: imóvel com documental recente e mercadológico antigo
aparecia sem o chip de mercado. **O relatório estava no banco o tempo todo** — SAMAMBAIA era o
27º mercadológico e o 8º documental.

Não era cosmético, e é por isso que a correção foi uma RPC e não um `12 → 60`:

| Sintoma | Causa |
|---|---|
| Abrir análise antiga mostrava "não gerado" | `Analise.jsx` lê do MESMO contexto truncado — e um clique em Gerar reprocessava a IA de um relatório existente (não recobra cota; gasta) |
| Dois cards com o nome trocado (*"Rua Marte, N. 429"*) | O título canônico vem da mercadológica; a documental grava o endereço da matrícula |
| Aviso *"Leilão em … arrematou?"* não aparecia | `data_leilao` costuma vir NULA na documental — sem a linha de mercado, a tela achava que não havia data |

*Corrigido:* RPC **`minhas_analises_lista()`** — uma linha por imóvel, montada no servidor, com
título/imóvel preferindo a mercadológica, **data de leilão efetiva** (maior entre as análises e
a praça do acervo) e, de cada relatório, só o status e as poucas flags que o card desenha (o
`result`, 12 kB em média, não viaja: 39 imóveis = 102 kB). Mais **`garantirCarregado(imovelId)`**
no contexto, com os imóveis pedidos por id **FIXADOS** para o corte em `MAX` não os descartar —
sem o pin, a análise antiga buscada por id era jogada fora no mesmo instante por ser velha.

**(b) A retenção apagava POR TABELA, e não enxergava a praça do acervo.**
`limpar_analises_orfas` varria `analises_mercado` e `analises_documental` em blocos separados,
cada uma com a SUA `data_leilao` e o SEU `created_at` — e como a data costuma vir preenchida na
mercadológica e nula na documental, **o mercadológico vencia sozinho**. Pior: o branch por
leilão exigia `a.data_leilao is not null`, então linha sem data própria **nunca** expirava por
leilão, mesmo com o acervo sabendo que a praça foi há semanas. E `analises_laudo` não aparecia
em branch nenhum. *Corrigido:* decisão por `(user_id, imovel_id)`, última praça = maior data
entre acervo e análises, apagando os três juntos. Rodado agora: **4 imóveis** (3 do dono, 1 de
outro cliente), um deles com praça em **21/07** ainda ocupando a lista.

> **Regra do dono preservada:** lote com leilão passado **continua** na lista até vencer o prazo
> de 15 dias — é a janela do "Arrematei". Quem some é o vencido. E o filtro de prazo **não** foi
> reimplementado na tela: quem tira da lista é a retenção apagando. Duas verdades divergiriam no
> dia em que alguém mudasse `ANALISE_LIMPAR_DIAS`.

**Documental sem mercadológico:** o gate de ordem **já existia** no servidor
(`gerar-documental.js`, 409 `precisaMercado`) e na UI (`seqBloqueado`). Sobraram 4 análises
anteriores a ele; o card agora diz **"Mercadológico pendente — gere primeiro"** em vez de
exibir só o chip jurídico com cara de análise completa. Os documentais em si estão sadios:
15 dos 17 com `preliminar: false` e 5 documentos lidos em média — "risco médio" é veredito, não
falta de leitura.

> **A trava pegou a mim, no mesmo dia:** `auditoria_seguranca()` acusou `minhas_analises_lista`
> em `rpc_definer_anon` minutos depois do deploy. `revoke ... from anon` **não basta** — o grant
> padrão do Postgres é para `PUBLIC`, e anon herda dele. Vale para toda RPC nova.

### 13. 📬 O Atendimento passa a receber e-mail — e dois defeitos vivos no caminho

Saiu de uma pergunta do dono no meio da verificação da G2RS: *"tínhamos criado o suporte@ para
cair na tela do atendimento como um chamado, não?"*. **Não — nunca existiu.** E o que existia
era pior do que a ausência:

**(a) O sistema convidava a resposta e jogava fora.** A home publica `suporte@bidprobrasil.com.br`;
os Termos e a Política publicam `privacidade@bidprobrasil.com.br`. E `api/notificar-cliente.js`
responde ao cliente com `reply_to: suporte@` e o texto **"é só responder este e-mail"**. Do outro
lado, `api/inbound-juridico.js` — único ponto de entrada de e-mail — fazia:

```js
if (!caso) return json({ ok: true, unmatched: true });
```

Todo e-mail que não casasse com um caso jurídico **sumia com HTTP 200**, sem log e sem alerta.
Inclui pedido de titular de dados endereçado ao `privacidade@`, que a LGPD (Art. 18) obriga a
atender.

**(b) `chamados.user_id` era NOT NULL, e `api/duvida.js` insere `user_id: null` desde sempre.**
O insert era rejeitado; o `const [chamado] = await res.json()` estourava sobre o corpo de erro (que
é objeto, não array), caía no catch e o visitante recebia *"Não foi possível registrar sua dúvida
agora"*. Medido: **`sdr_leads` vazia e ZERO chamados com segmento `curioso`** — o formulário de
dúvida da Landing nunca gravou nada. A intenção sempre foi aceitar nulo: a própria RLS
(`chamados_staff_escopo`) trata `WHEN user_id IS NULL THEN 'curioso'`. Só a constraint ficou para
trás.

**O que passa a existir:** e-mail sem caso jurídico vira **chamado** (`canal='email'`), com três
formas de casar com um fio existente antes de abrir outro — token do reply-to (`suporte+<token>@`),
`In-Reply-To`/`References` contra o Message-ID já gravado, e remetente com chamado aberto no canal
e-mail. `notificar-cliente` passa a mandar o reply-to **com token**, criado na primeira resposta
inclusive em chamado nascido no app: quem prefere responder por e-mail continua na mesma conversa.
Dedup por Message-ID (índice único parcial), porque o webhook reentrega. Na tela: badge
**"✉ por e-mail"** no chamado e na mensagem, e aviso acima da caixa de resposta dizendo para onde a
resposta vai.

> **Duas decisões que valem entender antes de mexer:**
> 1. **Anexo de e-mail NÃO é armazenado, só o nome.** O remetente aqui é qualquer um da internet;
>    guardar o conteúdo abriria um caminho de upload não autenticado para o nosso storage — abuso
>    de espaço e, pior, hospedagem de arquivo com URL assinada nossa. O atendente pede reenvio.
> 2. **A busca do fio LANÇA em não-2xx e devolve 500** para o Resend reentregar. Um `{}` silencioso
>    ali fragmentaria a conversa do cliente sem erro à vista. Quem pegou isso foi a própria trava
>    `json-inline-sem-resposta`, no meu código novo, minutos depois de eu escrevê-lo.
>
> 🔴 **FALTA O DONO:** apontar o **MX de `bidprobrasil.com.br` para o inbound do Resend**. O código
> está pronto e testado no banco (chamado com `user_id` nulo entra, dedup bloqueia a reentrega),
> mas **sem o MX nada chega**. Enquanto isso, `suporte@` continua sendo endereço publicado que não
> recebe.

### 14. 👤 Revisão do Cliente 360 no fim do dia — um cadastro perdido em tempo real

Pedido do dono ao encerrar: "veja o Cliente 360 caso alguém tenha acessado". **Foi a varredura
mais barata do dia e achou o defeito que mais custa dinheiro.**

**6 visitantes em 12 h · 131 eventos · 13 buscas · 0 erros de cliente abertos.** Três deles
passaram pelo `/login` e **nenhum criou conta**. Um em especial, `anon:c472a6bf`, entre 15h11 e
15h17:

| Hora | O que fez |
|---|---|
| 15:12:57 | aceitou os Termos |
| 15:13:57 | "Criar conta grátis" → *"A senha deve ter ao menos 8 caracteres, com letra maiúscula, minúscula, número e caractere especial."* |
| 15:14:34 · 15:14:45 · 15:15:24 | mesma tentativa, **mesma mensagem**, três vezes |
| 15:15:51 | tentou "Cadastrar com Google" |
| 15:16:13 | voltou à senha — **5ª recusa** |
| 15:16:19 | "Entrar com Google" |
| 15:17:45 | voltou para a home e **sumiu** |

A regra existia só em dois lugares ruins: miúda entre parênteses no rótulo, e como ERRO **depois**
do submit, com os quatro requisitos numa frase só — sem dizer **qual** faltava. E o mesmo produto
já fazia certo no **Checkout**, com a lista de requisitos ao vivo (✓/○). Só o Login, que é a porta
por onde entra o tráfego pago, tinha ficado de fora. *Corrigido:* a mesma lista ao vivo no cadastro.

**Segundo achado, do mesmo rastro:** `Password is known to be weak and easy to guess` (4×, 2
pessoas) caía **em inglês** na tela — não é regra de complexidade, é a checagem de senha VAZADA do
Supabase, então a pessoa vê os cinco requisitos com ✓ e mesmo assim é recusada, sem entender.
*Corrigido:* mensagem em português que explica exatamente isso.

> **Para acompanhar, não para consertar:** `Email not confirmed` — 7×, **6 pessoas** em 12 dias.
> O fluxo já trata (estado `emailNaoConfirmado` + botão de reenvio), então não é bug; é a taxa
> natural de quem não clica no link na hora. Vale olhar de novo se crescer.
>
> **O método vale mais que os dois achados:** nenhum dos dois aparece em varredura de código —
> o código está sintaticamente correto nos dois casos. Só o rastro de quem usou mostra. Rodar
> `eventos_atividade` por `tipo='api_erro'` agrupado por pessoa é uma consulta e custa zero.

### 15. 🕸️ O ponto cego de aquisição: 33 mil páginas sem medição nenhuma

Pedido do dono ao fechar: *"precisa monitorar o que ocorre no sistema mesmo para pessoas que não
são clientes ainda, para saber onde estamos pecando"*. Fui medir e o resultado foi pior do que
"faltava um painel".

**Em 30 dias, visitante anônimo aparece em CINCO rotas:** `/`, `/planos`, `/login`, `/termos`,
`/privacidade`. **Zero** nas ~33 mil páginas de acervo público — o principal ativo de aquisição
do site, aquele que motivou o Search Console e as 33 mil URLs no sitemap.

E eram **duas** barreiras, não uma:

1. `/leiloes` **não é rota do React** — é servida por `api/publico.js`, fora da SPA. O tracker
   monta no `main.jsx`, então nunca rodou lá.
2. Mesmo se rodasse, `api/track.js` descartava: a allowlist `ROTA_PUBLICA` não tinha `leiloes`,
   e o descarte é um **204 silencioso**. Filtro que recusa sem dizer — a forma da casa.

Não dava para distinguir **"o SEO não traz ninguém"** de **"não estamos medindo"**, que são
diagnósticos opostos e levam a decisões opostas.

*Corrigido:* `leiloes` na allowlist + snippet mínimo injetado no HTML público, que reusa a **mesma
chave `bp_aid`** do tracker do app — é isso que costura a visita anônima ao Cliente 360 quando a
pessoa cria conta depois. Ignora bot que executa JS (Googlebot renderiza) e guarda só o **host**
do referrer, não a URL.

**Novo: RPC `funil_publico(dias)` + painel "Funil de quem ainda não é cliente"** no topo do
Dashboard — degraus (chegou → viu acervo → viu planos → foi ao cadastro → tentou → criou conta),
**de onde vieram**, páginas mais vistas e **onde travaram, com o motivo escrito**. Estado ao criar
(30 dias): 213 visitantes · 59 viram planos · 22 foram ao cadastro · **10 tentaram e 10 tomaram
erro** · 26 criaram conta.

> **Uma honestidade embutida no painel:** origem sem referrer aparece como **"(não medido)"**, não
> como "(direto)". A origem só passou a ser coletada hoje; rotular o histórico como tráfego direto
> faria o painel afirmar que SEO e anúncio não trazem ninguém — conclusão oposta à realidade.
>
> ⏰ **CALIBRAR EM 48 H:** *não* criei invariante para a medição das páginas públicas, porque hoje
> o valor é 0 e não há linha de base — alarme que nasce vermelho é pior que alarme nenhum. Na
> próxima sessão, rodar
> `select count(distinct anon_id) from eventos_atividade where rota like '/leiloes%' and criado_em > now()-interval '2 days';`
> Se vier **> 0**, a instrumentação funciona: calibrar `qa_invariantes` com um piso. Se vier
> **0**, aí sim é diagnóstico — ou o snippet não roda, ou o SEO realmente não traz ninguém.

### 15b. 📣 Medição do Google Ads — o site já faz a parte dele

Complemento do item 15, no mesmo dia. Além de não medir as páginas públicas, **a query string era
descartada em todo o caminho**: o tracker manda só o `pathname`. Ou seja, `gclid` e `utm_*`
nunca chegavam a lugar nenhum — não existia atribuição de campanha, nem poderia existir.

*Corrigido:* tabela **`visita_origem`** (chave = `anon_id`, o mesmo `bp_aid` do Cliente 360) com
`gclid`/`gbraid`/`wbraid` + os cinco `utm_*` + host do referrer + landing. Capturada nos **dois**
lados (app e páginas públicas), persistida no navegador e gravada **uma vez só por visitante**.

> **`Prefer: resolution=ignore-duplicates` é o coração disto.** Garante *first touch*: a pessoa
> volta depois pelo orgânico e o crédito continua com o clique que a trouxe. Com *last touch*, o
> Ads pareceria não converter nada — a última visita sempre sobrescreveria a campanha.

O painel do funil passou a mostrar **origem → viraram conta**, que é o que responde "esta campanha
vale o que custa". Hoje tudo aparece como **(não medido)**: é honesto, o histórico não tem como
ser atribuído retroativamente. A partir do próximo clique com `gclid`, aparece
`Google Ads · <campanha>`.

**O que o site NÃO pode saber, e por isso virou pendência do dono** (`PENDENCIAS_DONO.md`,
item **-1.2**): impressão, clique, CTR e **custo** só existem no Google. E o auto-tagging precisa
estar ligado na conta, senão o `gclid` não chega na URL e nada é atribuído. O passo que mais muda
resultado é o **Offline Conversion Import** pelo `gclid` — devolver ao Google o valor real da
venda, para ele otimizar por dinheiro e não por clique; exige credenciar a Google Ads API.

### 16. 🔒 Cobertura das travas — o que de hoje pode voltar, e o que não pode

| Defeito de hoje | O que impede de voltar | Onde roda |
|---|---|---|
| Migração escrita que nunca chegou ao banco | `verificar:schema` | CI + diário 11h |
| `update`/`insert` com resultado descartado | `mutacao-sem-binding` | prebuild |
| Alerta de workflow cego a `cancelled()` | `notify-sem-cancelled` (base **0**) | prebuild |
| Erro entregue como conteúdo (`await (await f()).json()`) | `json-inline-sem-resposta` — **pegou meu próprio código hoje** | prebuild |
| Janela de cache usada como janela de dados | `mesma-janela-em-tabelas-diferentes` | prebuild |
| Retenção apagando meia análise | `analise_vencida_nao_limpa` · `analise_sem_mercadologico` · `laudo_sem_base` | monitor diário |
| Cadastro barrando visitante | `cadastro_barrado` | monitor diário |
| Ingestão externa parcial em silêncio | `ok=false` + `colunas_faltando` + detector de colisão de rótulos | toda ingestão |
| Workflow verde por cima de `ok:false` | teste do corpo no `.yml` | manual, provado |
| Mesma cidade em duas grafias | `trg_cidade_norm_sem_espaco` | banco, 4 tabelas |
| **Erro de sintaxe em `api/` indo para produção** | **`verificar:sintaxe` (novo)** | **prebuild — bloqueia o deploy** |

> **A trava nova nasceu de um erro meu, hoje:** pus crases num comentário dentro de um template
> literal e quebrei `api/publico.js`. O `npm run build` **passou** — o Vite só compila `src/`,
> e `api/` vai para a Vercel sem ninguém olhar. Um `export default` quebrado ali seria 500 em
> produção, e a única trava que existia (`verificar:padroes`) é regex, não parser. Agora o
> `prebuild` roda `eslint api scripts src --quiet` (8 s, só ERROS reprovam — os 38 avisos
> históricos seguem tolerados). Testado de ponta a ponta: reintroduzi as crases → build falhou
> com a linha exata; removi → passou.

**As duas lacunas que continuam abertas, ditas na cara:**
1. **Corpo de função que existe nos dois lados e divergiu** (o caso `pct_dom_venda`). Não há trava
   barata e confiável. Regra manual: *mudou função no banco, escreva a migração no mesmo commit.*
2. **Medição das páginas públicas** — instrumentada hoje, sem alarme até haver linha de base (48 h).

### ⚠️ ENCERRAMENTO DE 12/08 — estado medido e o que espera a próxima sessão

> **`main` em `88d664a` · 46 commits no dia · deploy READY · working tree limpo.**
> Segurança **0 crítico / 0 atenção** · regras **0** · erros de cliente **0** · KYC ilegível **0** ·
> fontes IBGE ruins **0** · chamados parados **0** · travas `verificar:padroes`,
> `verificar:schema` e `verificar:sintaxe` passando.

**Nada ficou pela metade no código.** O que sobrou é ação do dono, espera de terceiro, ou o
alerta que cresceu durante o dia (abaixo, primeiro).

### 🔴 COMECE POR AQUI AMANHÃ: `proximidades_vazio_falso` está CRESCENDO

Não é um alerta parado — é um número em movimento, medido no mesmo dia:

| Hora (UTC, 12/08) | Valor | Limite |
|---|---|---|
| 19h02 | 400 | 300 |
| 21h39 | 412 | 300 |
| **00h10 (13/08 UTC — 12/08 21h10 em Brasília)** | **452** | 300 |

**+52 em 5 horas.** É a família de 10/08 voltando: lote ativo com `pontos_proximos = '{}'` numa
cidade onde OUTROS lotes têm proximidades preenchidas — ou seja, não é "a cidade não tem pontos
de interesse", é a chamada falhando e gravando vazio como se fosse resposta. Cada lote nesse
estado entrega ao cliente um relatório dizendo "nenhum ponto de interesse por perto".

Por onde começar: ver se o crescimento acompanha a coleta (lote novo entrando já vazio) ou se é
regravação de lote antigo; e conferir se o Overpass está devolvendo erro dentro de HTTP 200 com
`remark` no corpo — que é a **forma 1** documentada no CLAUDE.md e já mordeu esta base.

### ⏳ Pendências do DONO — o que ficou de hoje

| # | O que | Estado |
|---|---|---|
| A | **Sufixo UTM com `utm_term` e `utm_content`** — colar em Campanha → Configurações → Opções de URL da campanha → Sufixo do URL final: `utm_source=google&utm_medium=cpc&utm_campaign=pesquisa-leilao-imoveis&utm_term={keyword}&utm_content={creative}` | 🔴 **Não aplicado.** Sem isso não se sabe QUAL palavra-chave traz gente, e as negativas continuam saindo de lista genérica. Verificação: `utm_term` deixar de vir nulo em `visita_origem` |
| B | **Verificação do anunciante Google Ads** (caso `1-3785000040835`): resetar + declarar DBA ligando "BidPro Brasil" à razão social | 🔴 Prazo **02/09** |
| C | **MX do domínio → inbound do Resend** (`PENDENCIAS_DONO.md` -1.5) | 🔴 Código pronto e testado; sem o MX nada chega |
| D | **Nome fantasia e objeto social na Junta** — CNPJ ainda diz CLUBE CONSELHEIRO; objeto social não menciona análise | 🟠 Com o contador |
| E | **Bright Data — decisão do teto** | 🟠 Marcada para 18/08 |
| F | **"Uso ocasional" como coluna nova** ao lado de `domicilios_vagos` | 🔵 Decisão |

### ✅ O que o DONO já resolveu hoje (não refazer)

- **Auto-tagging** já estava ligado — e provado pelo dado: 2 cliques com `gclid` às 21:49 e 21:53,
  campanha `pesquisa-leilao-imoveis`, ambos caindo em `/leiloes`.
- **16 palavras-chave negativas** aplicadas na conta.
- **Termos do formulário de lead** aceitos (destrava o formulário no anúncio como plano B para
  quem trava no cadastro do site).
- **G2RS enviada** 12/08 18:57 como **REAPPLICATION** — resposta em até 5 dias corridos, no
  `tarcisioaraujo@reimob.com.br`. **Eu consigo ler e avisar.**

### ⏳ Espera de terceiro

- **G2RS** — até ~17/08.
- **Google Ads API (passo 3)** — não começar antes da verificação do anunciante sair: conta não
  verificada tem entrega restrita, e treinar o algoritmo com dado restrito ensina errado. A
  primeira etapa (developer token) leva dias, então é por ela que se começa quando for a hora.

**As 7 anomalias de relatório seguem abertas de propósito** — são incerteza declarada, não fila de
conserto (ver o item 9 acima). E `bd_teto_saturado` (480/405) é o item E.

---

## 🔚 ENCERRAMENTO DE 11/08 (bloco anterior)

> **`main` em `3ffa533` · 32 commits no dia · deploy de produção READY · banco 0 crítico em tudo.**
> O dia começou na coleta do RJ e terminou numa varredura de fim de dia que achou mais um defeito.
> Abaixo, o estado real ao encerrar e o que espera a próxima sessão.

### Estado medido ao fechar (23h UTC)

| Verificação | Resultado |
|---|---|
| `auditoria_seguranca()` | **0 crítico / 0 atenção** |
| `auditoria_regras_negocio()` | **0 crítico** |
| `auditoria_uso()` (gaps de escrita) | **0** |
| `seguranca_tabelas_sem_rls()` | **vazio** |
| Advisor de segurança do Supabase | **0 ERROR** (eram 2 pela manhã) |
| Erros de cliente abertos | **0** (dois achados e corrigidos hoje) |
| Chamados do cliente sem resposta | **0** |
| Invariantes em alerta | **1** — `bd_teto_saturado 465/405`, decisão marcada para 18/08 |

### ⚠️ O QUE ESPERA VOCÊ NA ABERTURA

1. **G2RS — a submissão FALHOU no envio, e não por conteúdo.** A tela devolveu *"Você não está
   qualificado para enviar uma NOVA solicitação... a ID de cliente do Google já tem uma solicitação
   em andamento"*. Causa: na primeira pergunta ficou marcado **"Esta é uma nova solicitação"**, e o
   certo é a **segunda opção** ("avaliada anteriormente… atualizar os campos"), que exige o
   **código G2RS** do envio original. O dono vai refazer amanhã — **todo o conteúdo já está
   decidido e conferido**, ver `docs/PENDENCIAS_DONO.md` item -1. Se ele não achar o código:
   `FinancialServicesVerification@g2risksolutions.com`, citando a ID `475-979-5747` e o CNPJ.
2. **Do lado do Google ele ainda é PESSOA FÍSICA.** O perfil de pagamentos mostra
   `TARCISIO DE SOUZA NOGUEIRA DE ARAUJO` e a conta do Google Payments ainda se chama
   *"Clube Conselheiro"*. **É a causa provável de uma terceira reprova**, e não se resolve no
   formulário da G2RS. Ressalva: trocar perfil de pagamentos de pessoa física para empresa pode
   não ser editável depois de criado — conferir em `ads.google.com/aw/advertiserverification`.
3. **Espelho — VALIDADO às 01:00, e a medição achou um teto invisível.** A rodada das 00:40 com
   `LOTE 1200` copiou **985** (contra 598 com `LOTE 600`) e ignorou 14: **999**. Esse número
   redondo é a resposta — **o PostgREST corta a resposta em 1.000 linhas sem avisar**, inclusive
   em RPC que devolve conjunto. Pedir 1200 e receber 1000 não gera erro. É a mesma armadilha que
   o `api/publico.js` já documenta neste repositório, e eu escrevi 1200 sem lembrar do precedente.
   O sintoma que denunciava: terminou em **179s de 240s** — de novo não faltou tempo.
   **Corrigido (`051efc2`)**: `LOTE` fica em 1000 e o cron passa a **ler → processar → ler de
   novo** até o orçamento acabar (funciona porque documento copiado sai da fila). A resposta
   agora traz `leituras` e `ms`. **Conferir na rodada das 04:40**: `leituras` ≥ 2 e `ms` perto de
   240000 é a prova de que o limite voltou a ser o tempo.
   Estado ao fechar: **2.239 copiados · 3.379 MB · fila 5.560** — e a fila **caiu** pela primeira
   vez (era 6.059), mesmo com 501 anexos novos entrando na mesma rodada.
4. **Resend: falta só marcar `email.opened` e `email.clicked`** na inscrição do webhook. O DNS está
   pronto (CNAME `links` **Verified**) e `email.delivered` já chega — o endpoint e o segredo estão
   certos. Desde hoje o handler registra **todo evento recebido** em `webhook_eventos_processados`
   (`gateway='resend'`), então o próximo envio diz sozinho se é inscrição ou comportamento real.
   Depois disso, o **backlog de 26 pessoas** está liberado (workflow manual, `limite=2` primeiro).

### Os dois defeitos achados DEPOIS do trabalho do dia — e como apareceram

Os dois são a mesma família e nenhum saiu de varredura de código: um veio do **rastro no banco**,
o outro de **comparar o código com o schema**.

1. **`erros_cliente` acusou às 22:40** — `column solicitacoes.criado_em does not exist` na rota
   `/admin`. A fila de solicitações da equipe aparecia **VAZIA** (400 → `{data}` sem `error` →
   `|| []`), e no painel de produtividade **dois dos quatro** contadores davam zero, porque
   `comissoes` também usa `created_at`. Analista produtivo lido como parado.
2. **A varredura schema × código achou `Caso.jsx`** ordenando `casos` por `criado_em`. O lugar não
   podia ser pior: é a consulta de RESGATE escrita HOJE para o relato *"eu buscando um imóvel deu
   esse erro"* — ela existe para oferecer o caso já existente em vez de tela vermelha, e com a
   coluna errada dava 400 e a pessoa via a tela vermelha do mesmo jeito. **O conserto carregava um
   defeito da mesma família que veio consertar.**

> **A lição, na forma que serve para a próxima vez:** a coluna de data **não é a mesma** em todas as
> tabelas — `criado_em` nas antigas, `created_at` nas novas. Escrever as consultas juntas num
> `Promise.all` faz a inconsistência sumir da vista. Já está registrada como a **sexta forma** no
> `CLAUDE.md`, com o método de varredura (todos os `from('tabela')` × `information_schema`).

### Conferido e íntegro (para ninguém refazer)

- As **36 colunas** de `COLUNAS_BUSCA` existem todas em `imoveis_leilao` — uma inexistente
  derrubaria a busca inteira, não um campo.
- Os guardas de ciclo de vida do Leaflet estão nos **três** arquivos de mapa.
- O painel de geocodificação não tem referência órfã depois de trocar 54 contagens pela RPC.
- `/api/clique` testado em produção: redireciona certo, redireciona também com assinatura inválida
  (é o contrato), e os dois vetores de open redirect (`https://evil.com` e `//evil.com`) caem na
  nossa própria home.
- Health-check das 22:00 confirmou `EMPRESA_CNPJ` — *"configurado e válido (02.311.***)"*.

---

## 🏁 FECHAMENTO DE 11/08 (noite) — eficiência em produção + o 360 medindo clique sozinho

> Pedido do dono: *"resolva o que der sem precisar de mim e vamos validando. agora precisa ter
> eficiência pois já estamos em produção para quando um cliente for usar não ter surpresas. o
> cliente 360 deve monitorar tudo para irmos resolvendo."* Critério aplicado, nesta ordem:
> **primeiro o que falha sem avisar, depois o que pesa no caminho do cliente.**

### O que foi ao ar (`main` em `c8e1c58`)

| # | O quê | Por que importava |
|---|---|---|
| 1 | **Duas tabelas públicas SEM RLS** — `indice_amostra(s)_sem_ancora_20260807`, deixadas por mim em 07/08 | Legíveis por `anon`. Sem PII (amostras de imóvel), mas é a base do Índice. Nosso `auditoria_seguranca()` dizia 0 crítico porque procura **tabela com PII** — o critério certo nunca foi "tem PII?", é "está exposta?" |
| 2 | **`seguranca_tabelas_sem_rls()`** | Fecha a lacuna acima: o próximo backup esquecido aparece no ritual, sem depender do advisor do Supabase |
| 3 | **`maxDuration` em 2 crons** (`financiamento-alertas`, `meta-insights`) | Herdavam o default da Vercel. Cortados no meio: metade da lista sem e-mail, ou o painel de CAC/ROAS com número menor — os dois **sem erro nenhum** |
| 4 | **Busca: `select('*')` → 36 colunas** | A tabela tem 66 colunas / 180 MB; a tela usa 36. As 30 extras incluíam os jsonb pesados. Custo por busca, de cada cliente |
| 5 | **Painel de geocodificação: 54 contagens → 1** | Eram 27 UFs × 2 `count: exact` sobre 180 MB a cada abertura. `count=exact` no PostgREST é `COUNT(*)` de verdade — 54 competindo por conexão com o cliente que busca no mesmo instante |
| 6 | **`/api/clique` — clique medido por nós** | Ver abaixo |
| 7 | **Espelho `LOTE` 600 → 1200** | Medido: 598 cópias em **138s de 240s**. Não faltou tempo, acabou o lote |
| 8 | **Health-check confere `EMPRESA_CNPJ`** | Inclusive o dígito verificador. CNPJ errado é **pior que ausente**: a comparação roda, nunca casa, e toda NF vira "o tomador não é a BidPro" — parece fraude do parceiro sendo erro de digitação nosso |

### O clique de e-mail agora é nosso — e cai no Cliente 360

O rastreio do Resend está desligado e ligar depende de painel + DNS + espera. Mas **todo link
dos nossos e-mails já aponta para o nosso domínio**: `/api/clique` registra e redireciona.
O clique preenche `emails_log.clicado_em` (coluna que existia e **nunca** foi preenchida, porque
só o webhook do Resend a alimentava) e entra em `atividade_log` — ou seja, aparece no **360 ao
lado do resto do que a pessoa fez**, não num painel de terceiro. Ligado no nudge de ativação e
nos dois e-mails de produto.

Três decisões que não devem ser desfeitas sem entender:
1. **O destino é um CAMINHO, nunca uma URL.** Aceitar `?u=https://…` faria disto um **open
   redirect** — link com o nosso domínio na barra levando à página do golpista. `//evil.com` é
   recusado (URL absoluta disfarçada). A assinatura HMAC não protege o destino (esse já é seguro
   por construção): protege a **identidade**, senão qualquer um forja clique alheio e envenena o 360.
2. **A pessoa chega ao destino de qualquer jeito.** Assinatura inválida redireciona igual; falha
   de gravação é engolida antes do 302. Perder a medição de um clique é aceitável; perder o clique não.
3. **O link de descadastro continua direto**, fora do rastreador. Cancelar e-mail tem de funcionar
   mesmo com todo o resto quebrado.

### O que eu NÃO fiz, e por quê

- **Não troquei `count=exact` por `estimated` em `api/publico.js`** (o levantamento sugeria):
  aquele número vai para o **título que o Google indexa** ("1.234 imóveis em leilão em
  Campinas/SP"). Estimado ali é número errado no índice. O outro uso é filtro por chave primária.
- **Não apaguei as 6 tabelas de backup**, que era o plano: as de 07/08 guardam linhas **removidas**
  da base viva (16 análises, 1.700 amostras) — o backup é a única cópia. RLS fecha a exposição com
  zero perda; descartar fica para quando a investigação do Índice for dada por encerrada.
- **As 211 policies sem cláusula `TO`** (de 234) — origem de **478 dos 571** avisos de performance.
  O ganho é grande e o risco também: as páginas públicas leem `imoveis_leilao` como `anon`, então
  aplicar `TO authenticated` em bloco derruba o SEO. Exige sessão própria, tabela a tabela, com a
  busca e o Índice sob teste.
- **Lotes de cron em geral rendem menos do que parecem:** dos 12 sem teto de tempo, quase todos têm
  o lote pequeno **de propósito** (cota paga do Bright Data, chamada de IA, volume de e-mail).
  `enriquecer-datas-cron` (fila 6.608, ~82 dias) é justamente um desses — alargar ali é **gastar**.
  O único com teto arbitrário é `limpar-fotos-orfas-cron`.

### Dois erros meus, pegos pelo próprio teste antes de subir

1. `linkRastreado` com caminho inválido gerava `https://bidprobrasil.com.brhttps://evil.com` —
   link quebrado dentro do e-mail do cliente. Agora cai na home.
2. A fórmula do dígito verificador do CNPJ estava errada e **reprovava o CNPJ correto** — o falso
   alarme que o check existe para evitar. Refeita e validada contra 7 casos, incluindo CNPJs reais.

---

## ⏰ CONFERIR EM 18/08 — os dois números que só o tempo produz

> **Nenhum dos dois dá para responder hoje**, e os dois foram deixados MEDINDO sozinhos em 11/08.
> Um exige uma semana de coleta; o outro exige que o dono ligue uma chave antes de gastar a única
> amostra que temos. Ambos vieram da pergunta dele: *"esse crédito do Bright Data está mesmo sendo
> consumido?"* e *"esses que dependem de mim, qual alternativa resolve com maior segurança dos
> dados, eficiência e custo × benefício?"*

### 1. Bright Data — o teto de 450/semana está certo? (custo zero, é só ler)

Desde 11/08 o ledger separa **permissão concedida** (`requests`, reservada ANTES do fetch) de
**chamada efetivada** (`sucessos`, que é o que o painel cobra). Era a confusão entre as duas que
punha ~2.549 no nosso lado contra ~780 no painel. A query está no **ritual de abertura do
`CLAUDE.md`** (bloco "o que está quebrado agora") — roda sozinha toda sessão, não precisa lembrar.

Em **18/08**, com a primeira semana inteira contabilizada dos dois jeitos:

```sql
select proposito, requests, sucessos, falhas_rede
  from brightdata_uso_proposito
 where semana = '2026-08-17'::date   -- a 1ª semana limpa (a de 10/08 é meio-a-meio)
 order by requests desc;
```

| O que sair | O que significa | O que fazer |
|---|---|---|
| `sucessos` da semana ≈ delta do painel | O ledger é fiel. O teto mede gasto real | Decidir o teto olhando `sucessos`, não `requests` |
| Painel **acima** do nosso | Alguém gasta fora do ledger | `scripts/recon-*.mjs` e `scripts/scraper_vlance.py` chamam a Web Unlocker **direto**, sem passar pela cota — se houve recon na semana, é isso. Se não houve, investigar |
| Painel **abaixo** do nosso | Sobrou reserva não usada | Baixar a reserva de quem não gastou, não o teto global |

**Estado em 11/08 (linha de partida):** `rj` com `requests 15 · sucessos 5 · falhas_rede 0`,
reserva 60 / teto 120, total da semana **465**. Os 10 sem desfecho são anteriores à migração de
hoje — **não são vazamento**, e a partir de 17/08 a coluna fecha. A decisão do teto continua sendo
do dono (item 1 do bloco de 11/08); esta é a medição que faltava para ela deixar de ser palpite.

### 2. Nudge de ativação — a ORDEM importa, e ela não se repete

Medido em 11/08: **136 e-mails nos últimos 30 dias, 55 com confirmação de entrega, ZERO aberturas
e ZERO cliques**. Não é desempenho ruim — é o **tracking de abertura/clique DESLIGADO no Resend**.

O backlog de ativação (26 pessoas que passaram da janela D+2/D+7) é de **uso único**: cada pessoa
recebe uma vez e some da fila. Disparar antes de ligar o tracking queima a única chance de saber se
o nudge funciona, e nenhuma medição posterior recupera isso.

1. **Dono:** ligar o rastreio no Resend — o passo a passo exato já está em
   `docs/PENDENCIAS_DONO.md` **item -2** (subdomínio `links`, CNAMEs, e — a parte que costuma
   ficar de fora — **marcar `email.opened` e `email.clicked` no webhook**; sem isso o rastreio
   liga e nada chega até nós). Custo zero, não muda o conteúdo do e-mail.
2. **Só então:** rodar o workflow **"Nudge de ativação — backlog (manual)"**
   (`.github/workflows/nudge-backlog.yml`, aba Actions → Run workflow). Comece com `limite=2` para
   ver a resposta real; depois `limite=0`. A autorização vai por **header** `x-cron-secret` (o
   segredo vive no painel; URL com segredo vaza em histórico e log — por isso o workflow existe em
   vez de um link para colar no navegador).
3. **Uma semana depois** (a coluna é `enviado_em`, não `criado_em`; hoje só existe **1** e-mail
   `tipo='ativacao'` no acervo de 30 dias — é a linha de base):
   ```sql
   select tipo,
          count(*) enviados,
          count(*) filter (where entregue_em is not null) entregues,
          count(*) filter (where aberto_em  is not null) aberturas,
          count(*) filter (where clicado_em is not null) cliques
     from emails_log
    where enviado_em > now() - interval '14 days'
    group by 1 order by 2 desc;
   ```
   Aberturas > 0 em **qualquer** tipo é a prova de que o canal mede; cliques em `ativacao` é a prova
   de que o nudge converte.

> **Se em 18/08 as aberturas continuarem em 0 com entregas > 0**, o tracking não foi ligado (ou foi
> ligado depois do disparo) — confirmar com o dono ANTES de concluir qualquer coisa sobre o texto do
> e-mail. Zero abertura com tracking desligado não é resultado, é ausência de instrumento: é
> exatamente a mesma armadilha do bloco de 10/08 ("este vazio é resposta, ou é falha que não sabe
> que falhou?"), só que no marketing.

---

## 🏁 FECHAMENTO DE 11/08 — a coleta do RJ, e o que ela revelou sobre o resto

> **`main` em `7fc3777`.** O dia começou validando o freio residencial que consertei de manhã e
> terminou descobrindo que o problema era **quatro defeitos empilhados**, nenhum deles visível em
> log de erro. O fio condutor é o mesmo de 10/08, com uma variação nova: não só "erro entregue
> como conteúdo", mas **freio de custo entregue como conteúdo**. "Sem cota" virava "a fonte não
> tem nada" em toda a cadeia, e o check ficava verde.

### O que estava acontecendo (medido, não deduzido)

| # | Defeito | Como se manifestava |
|---|---------|---------------------|
| 1 | **Teto do Bright Data saturado há 4 semanas** (450/450 desde 20/07; a semana de 10/08 bateu na segunda às 13h) | `fetchViaBrightData` → `null` → `if (!body) break` → "Nenhum lote na listagem" → **exit 0 em 0,6s**, check verde |
| 2 | **As sub-cotas por propósito não existiam** — eram um `Map` em memória do processo; cada run do Actions e cada invocação da Vercel começava do zero | Não limitavam ninguém e não RESERVAVAM nada. O RJ precisa de ~13 req/semana e não tem via grátis (100% Cloudflare): nunca achava crédito livre |
| 3 | **O runner residencial rodava o RJ em DRY-RUN** — faltava `RJ_DRYRUN=0` na linha do runner (as outras fontes já tinham) | O caminho grátis **nunca gravou uma linha de RJ**. Saía com 0, o gate carimbava "coletei", e o carimbo bloqueava o caminho pago. Deadlock |
| 4 | **Preços errados por 20×** — 3 dos 5 ativos com `valor_minimo` = 5% do lance real (a comissão do leiloeiro, pega pelo `Math.min` de todos os R$ da página) | O cliente via R$ 30 mil num imóvel de R$ 600 mil. O próprio TÍTULO trazia o valor certo |

### O que ficou no ar

- **Reserva por propósito no banco** (`brightdata_reserva` + `brightdata_uso_proposito`): o RJ tem
  **60 req/semana garantidos** que ninguém mais consome. Teto global inalterado — reparte, não gasta mais.
- **`buscarViaBrightData` LANÇA com o motivo** (`teto_global` · `subcota` · `reservado_para_outros` ·
  `rede` · `http`). O `fetchViaBrightData` (null) fica para os fallbacks legítimos.
- **`coleta_cliente_concluir` EXIGE PROVA**: só carimba se houver linha gravada no acervo depois do
  claim. *"Concluí" passa a significar "gravei"* — para toda fonte, não só o RJ.
- **Zero lote pronto = código de saída 1 + `fonte_saude` 'falhou'** em SOLEON, PECINI, GESTAO e RJ
  (o `process.exit(0)` fixo do rodapé apagava o `exitCode` que o main tinha acabado de definir).
- **SOLEON registrava saúde só do tenant que coletou** — justo o que coletava zero ficava sem rastro.
- **Espelho de documentos ordenado por DATA DO LEILÃO**, não por ordem de chegada (ver abaixo).

### VALIDADO EM PRODUÇÃO (run 31496700248, 13:32 UTC)

```
página 1: +16 lote(s) · no banco: 9 · novos: 7 · 7 prontos · 0 sem detalhe
✅ 7 imóveis gravados · 🩺 saúde registrada: 7 lotes · ok
```
Custo real: **9 requests** da reserva de 60. RJ ativo de 5 → **11 lotes**, todos com data futura,
edital e anexos. `fonte_cega_no_monitor` 1 → 0 · `valor_diverge_do_titulo` 0.

### ⚠️ ERRO MEU, no mesmo dia — vale mais registrado que escondido

Ao limpar as cidades sujas do RJ ("EM ITABAIANA", "A CIDADE DE BARRA DOS COQUEIROS") apliquei a
regra ao **acervo inteiro** com "cidade" na lista de conectivos. **Cidade Ocidental/GO é um
município**: 756 lotes viraram "Ocidental". Revertido integralmente (0 remanescentes; não existe
município chamado só "Ocidental", então a restauração foi sem ambiguidade). Os ~245 acertos reais
na BIASI ficaram. O `limparCidade` do scraper tinha o **mesmo defeito** e foi corrigido antes de
rodar de novo, com bateria de casos incluindo o que me mordeu: substantivo geográfico só é ruído
quando vem seguido de *de/do/da*; colado direto no nome, **ele É o nome**.

> **A lição, na forma em que serve para a próxima vez:** uma limpeza de texto validada em 4 exemplos
> não está validada. Antes de rodar `update` em acervo inteiro, rode o `select` que mostra
> `antes → depois` agrupado e **leia os pares mais frequentes** — os 733 iguais teriam saltado aos
> olhos em dois segundos.

### 📋 DECISÕES QUE DEPENDEM DO DONO (nenhuma bloqueia nada hoje)

1. **Teto do Bright Data.** Saturado 4 semanas seguidas em 450/semana. Só agora existe contabilidade
   POR PROPÓSITO (`brightdata_uso_proposito`) — em uma semana dá para ver quem come a cota. Decisão:
   subir o teto, ou aceitar que os consumidores oportunistas fiquem sem? Query:
   `select proposito, requests from brightdata_uso_proposito where semana = date_trunc('week', now())::date order by 2 desc;`
2. **Anexos não são espelhados — nenhum.** A fila só cobre `link_matricula` e `link_edital`.
   Estão de fora **9.584 PDFs de anexo** (laudos, publicações, autos de avaliação) de lotes ativos;
   5.766 deles são de leilão nos próximos 30 dias. Espelhar tudo custa ~22 GB de Storage
   (543 docs = 872 MB → ~1,6 MB cada). **Não enfileirei sem sua decisão de custo.**
3. **1.648 lotes ativos com data de leilão no passado** (1.642 são CEF; 1.168 foram atualizados nas
   últimas 24h — ou seja, a CEF segue publicando o lote e a data não é refrescada). Invariante
   `leilao_vencido_ativo` criada como 'gap' com limite 1.800 para vigiar. Investigação do fluxo CEF
   fica para uma sessão própria.
4. **`aval_ausente_com_doc` passou do limite** (3.966 vs 3.800, calibrado em 08/08). Deriva lenta,
   não regressão — reavaliar o limite ou atacar a lacuna.

### 🔭 O QUE OBSERVAR NA PRÓXIMA SESSÃO

| O que | Query | Verde é |
|---|---|---|
| Freio + coleta do RJ na sexta | `select fonte, total, status, executado_em from fonte_saude where fonte='RJLEILOES' order by executado_em desc limit 3;` | Linha nova de sexta 11h UTC (ou terça), `status='ok'` |
| Reserva funcionando | `select proposito, requests from brightdata_uso_proposito where semana=date_trunc('week',now())::date order by 2 desc;` | `rj` avançando; ninguém sozinho comendo tudo |
| Fila de documentos drenando | `select status, count(*) from documento_espelho group by 1;` | `pendente` CAINDO (era 4.079 e crescia) |
| Gate não carimba sem gravar | `select fonte, ultima_em, tentativa_em from coleta_cliente order by fonte;` | `ultima_em` do RJ só anda quando o acervo andou |
| Invariantes | `select chave, valor, limite from public.qa_invariantes() where status='alerta';` | Só os 4 declarados acima |

---

## 🏁 FECHAMENTO DE 10/08 — leia este bloco primeiro

> **19 commits, `main` em `3ba2fa0`.** O dia começou com um ritual de rotina e virou a maior
> limpeza desde que o projeto existe. O fio condutor foi um só, e ele vale mais que a lista:
> **resposta de erro entregue como conteúdo válido.** Apareceu em seis achados independentes, em
> camadas que não se falam. Nenhum tinha aparecido em varredura de código anterior — todos são
> código que PARECE certo.

### Os quatro grandes do dia

| # | o que era | como estava passando |
|---|---|---|
| 1 | **Backup off-region parado há 2 dias** | `registrarExecucao()` é a última instrução do handler: o timeout matava a função ANTES do rastro, então "falhou" e "nunca rodou" davam o mesmo no banco — nada. É a única proteção contra perda definitiva de arquivo de cliente |
| 2 | **51% do acervo dizendo "nenhum ponto de interesse"** | O Overpass devolve erro de runtime em **HTTP 200 com `remark`**. O `.ok` estava checado — o erro vinha DENTRO do 200 |
| 3 | **Extrato carimbando `completo: true` sobre um 403** | `if (!j) break` tratava falha HTTP como "acabaram as páginas" |
| 4 | **Cobrança de assessoria (R$ 4.800–6.000) sem gate e com preço do body** | O gate existia em 3 endpoints, nenhum no caminho que COBRA |

### Bug bounty completo — 28 achados, todos fechados
5 agentes por camada. Lista inteira, com estado e refutados, em
**`docs/VARREDURA_BUGS_2026-08-10.md`**. Fechados em três levas: 6 primeiros (`408abb1`),
as 5 de alta (`e78e511`), 5 médias (`1787f1d`) e os 13 restantes (`219ec6b`).

### 🛡️ O que impede a família de voltar (o entregável mais durável do dia)
1. **`npm run verificar:padroes`** — 4 regras ESTRUTURAIS, linha de base por arquivo, roda no
   `prebuild` (todo build e todo deploy da Vercel) e no CI. Só reprova ocorrência NOVA, então as
   299 históricas ficam como estão e o padrão não cresce. Exceção deliberada:
   `// padrao-ok: <motivo>`. **Achou um bug REAL na primeira execução** — um `signUp` legado sem
   guard, sem nenhum importador, gravando `role:'aluno'`.
2. **`CLAUDE.md` → "A PERGUNTA DE REVISÃO"** — as quatro formas que já morderam esta base.
3. **`qa_invariantes.proximidades_vazio_falso`** — o vazio falso volta a ser visível.
4. **`health-check` → "E-mail de oportunidades"** — lê o rastro do cron de alertas.

### ⚠️ ERREI TRÊS VEZES HOJE. As três estão registradas porque a lição é o valor.

**1. Corroboração instantânea não corrobora nada.** Corrigi as proximidades de manhã pedindo uma
"segunda opinião" a outro espelho do Overpass — no MESMO instante, sob a MESMA carga. Em 3h de
produção: 247 de 248 imóveis "vazio confirmado", incluindo 11 em São Paulo capital. **Duas
observações simultâneas não são duas evidências, são uma.** Só o TEMPO separa "não há POI aqui" de
"os espelhos estavam sobrecarregados". Corrigido com corroboração TEMPORAL
(`imoveis_leilao.proximidades_vazios`, 3 execuções distintas).
E havia um agravante que eu mesmo criei: o `Promise.any` sobre 5 espelhos dispara 5 requisições
POR IMÓVEL — ~800/h contra instâncias públicas que limitam por IP. **A otimização de latência
estava PRODUZINDO o rate-limit que gerava os vazios.**

**2. Lote é teto de contagem, nunca de tempo.** Subi o timeout do Overpass e somei uma rodada,
mantendo LOTE=40: o cron passou a estourar 300s em 44% das execuções. É literalmente o defeito
que eu apontei em três OUTROS crons no mesmo dia e não apliquei neste.

**3. Deduzi errado no Asaas.** Eu disse "a mesma chave responde em `/payments`, logo não é a
chave, é o recurso da conta". Isso pressupõe permissão tudo-ou-nada — e o Asaas tem permissão
**granular por chave**. O log deu a resposta literal: `insufficient_permission`, "a chave não
possui permissão para operações de saque via API". **Quando o fornecedor tem escopo por
credencial, "funciona em X logo a credencial está boa" não se sustenta.**

### Decisões registradas (não reabrir sem motivo novo)

- **Asaas `/transfers`: NÃO habilitar a permissão.** O Asaas classifica até o GET como "operação
  de saque". Habilitar daria poder de MOVIMENTAR DINHEIRO a uma credencial que vive em variável
  de ambiente — para ler uma lista hoje VAZIA (saldo R$ 0,00, zero lançamentos Asaas desde
  junho). A lacuna virou **declarada**: não marca o banco como incompleto, vira aviso. Revisitar
  só quando houver saque de verdade, aí com chave dedicada e escopo mínimo.
- **Downgrade de plano: AGENDADO** para o fim do período pago (`plano_agendado`), nunca cancelar
  e recriar. O que decidiu foi um detalhe: o webhook do MP identifica o plano pelo
  `external_reference`, não pelo valor — baixar só o valor deixaria a pessoa pagando o preço do
  Pro e continuando com o Clube.
- **Saldo ≠ extrato.** O 403 do MP é só no saldo (endpoint não documentado, pode nunca liberar).
  Os lançamentos vêm de outro endpoint e funcionam. Misturar os dois fazia o MP parecer quebrado.
- **Bancos isolados no extrato**: cada conta com veredito próprio; o consolidado é DERIVADO. Um
  403 no Asaas não invalida mais o Mercado Pago.

---

## ⏰ PRÓXIMOS PASSOS — 11/08 (há lembrete agendado para 13h UTC com estas queries)

### 1. As três validações que dependem só do tempo passar
| o quê | quando | verde é |
|---|---|---|
| **Backup off-region** (a prova do P1) | run 04:40 UTC | linha NOVA em `backup_execucoes` com `ok=true`. Conferir também `detalhe.limpeza.pulada` — a limpeza NÃO pode rodar com storage incompleto |
| **RJLEILOES** | cron terça 11h UTC | `atualizado_em` de 11/08 e ≥ 8 ativos. O freio residencial não deve pegar (última coleta ~12 dias) |
| **Proximidades** | contínuo | `com_pontos` **acima de 14.625** (fechou o dia assim, subindo). `vazio` fechou em **38**, todos com ≥3 observações; invariante em **30** |

> **Como ler o resultado das proximidades:** `vazio` crescendo devagar com `com_pontos` subindo =
> funcionando. `vazio` disparando = a corroboração temporal não segurou, reabrir. Conferir também
> se o cron parou de estourar 300s (eram 7 de 16 execuções).

### 2. Nudge de ativação — LIGADO hoje, primeiro disparo real 11/08 12h UTC
1 pessoa na janela (Marlene, BH, etapa d7) — o lote pequeno é natural, não precisou de `?limite`.
**Olhar entrega/abertura/clique ANTES de liberar o backlog** (27 pessoas, `?backlog=1`, uso único).
Só dá para medir abertura se o tracking do Resend estiver ligado — ver abaixo.

### 3. Depende do dono
1. **Resend** — clicar **Verify** (o CNAME `links` foi criado hoje e está correto), depois ligar
   **Open tracking** e **Click tracking** em Domains, e marcar `email.opened`/`email.clicked` em
   Webhooks. Sem isso o nudge dispara e ninguém sabe se foi lido. **É o item nº 1.**
2. **Mercado Pago (opcional)** — tentar um Access Token de produção da conta TITULAR para o
   saldo. Se seguir 403, é limitação da plataforma: parar por aí, não custa nada e não afeta o
   extrato.
3. Legal review dos Termos v3.3 · G2RS · `AUDITORIA_EMAIL_DESTINO`/`GITHUB_ACTIONS_TOKEN`.

### 4. Trabalho técnico na fila
- **Primeiro downgrade real deve ser acompanhado** — o fluxo está correto por leitura e reusa
  chamadas provadas, mas não deu para exercitar MP/Asaas daqui. Hoje há 0 agendamentos, então dá
  para escolher a hora.
- **1 erro de lint PRÉ-EXISTENTE**: `{true &&` em `src/pages/Perfil.jsx:1152` (commit `6760a21`).
  É o único do projeto; enquanto existir, `npm run lint` nunca fecha limpo.
- **`indice-reforco-cron`** segue desligado por decisão de custo (~US$ 300/mês). Não é bug — foi
  REFUTADO hoje. O que se corrigiu foi a ambiguidade das respostas.
- **Achados de 09/08 ainda abertos**: MRR do dashboard contando conta de teste; laços de
  aprendizado (`mercado_aprendizado`, `laudo_aprendizado`, `juridico_aprendizado`) com 0 linhas.

---

## 🏁 FECHAMENTO DE 09/08 — leia este bloco primeiro

> Sessão longa. O fio condutor foi o mesmo do dia inteiro: **coisa construída, configurada e
> ativa, que não funcionava para ninguém, sem erro em lugar nenhum.** Três achados desta
> família num dia só.

### O que quebrou e foi corrigido (tudo em `main`, tudo com o porquê no commit)

| # | achado | por que ninguém viu |
|---|---|---|
| 1 | **Tour de boas-vindas apagado desde 01/07** — a versão era o mês do RELÓGIO e a única cadastrada era `2026-06` | Consulta devolvia zero etapas. `tour_progresso` com 0 linhas: nenhum dos 30 exploradores viu onboarding |
| 2 | **Câmera e geolocalização proibidas pelo nosso próprio header** — `Permissions-Policy: camera=()` nega para a própria origem | O navegador nunca perguntava; a tela dizia "permissão negada" e mandava liberar no cadeado, onde não havia nada |
| 3 | **Quatro cópias da tabela de cotas**, todas divergindo do banco | Ninguém compara tela com `limite_ia` |
| 4 | **`saque.exige_kyc` tinha campo `escopo` que o código NUNCA lia** | `aplicada_por` apontava certo — a função consulta a regra, só ignorava um campo dela |

### ⚠️ Aprendizado que vale mais que os quatro
**`aplicada_por` na `regra_negocio` prova que a função CONSULTA a regra, não que ela respeita
todos os campos dela.** A `auditoria_regras_negocio` dava `saque.exige_kyc` como aplicada, e
estava certa — o `escopo` é que era decorativo. **Ao acrescentar campo numa regra existente,
confira o consumidor.** A auditoria não pega isso.

### Regras de saque — estado FINAL de 09/08 (mudou duas vezes hoje)

| regra | escopo | observação |
|---|---|---|
| Teto R$ 2.500/mês sem NF | **todos** | absoluto |
| Acima do teto: **plano pago** | **todos** | mudou hoje. Alcança a equipe: analista sem plano fica limitado a R$ 2.500/mês de honorário. Dono ciente e quis assim ("penso em cobrar posteriormente um plano deles… por enquanto mantenha") |
| Acima do teto: **NF do valor INTEGRAL do mês** | todos | sacou 3× R$1.000 e pede R$500 → nota de R$3.500 |
| **KYC (selfie + documento)** | **parceiro** | mudou hoje. É validação DO PARCEIRO, **1× na vida**; a equipe saiu. Não afrouxa comissão: só parceiro indica e ganha |
| Destino sempre PJ | todos | CPF conferido no QSA |
| Aceite dos Termos vigentes | parceiro | equipe isenta (recebe por função) |
>
> **Identidade × sociedade são coisas diferentes, de propósito:** a identidade se prova UMA
> vez (`perfis.identidade_validada`, nunca pedida de novo). O que é reconferido todo mês é a
> **sociedade** — `pj-revalidacao-cron` bate o quadro societário e retém o repasse se o CPF
> deixar de constar no CNPJ.
>
> Qualquer um desses escopos volta atrás com **um update, sem deploy**:
> `update regra_negocio set valor = jsonb_set(valor,'{escopo}','"todos"') where chave = '…';`

### 🔵 PARA AMANHÃ — leitura da NF: eficiência e custo × benefício (o dono pediu)

> **O diagnóstico honesto: o custo não está na IA.** A leitura já é barata — PDF com camada de
> texto vai pelo `pdf-parse` (custo zero) e só o escaneado cai no Vision; estimativa de
> **US$ 0,02–0,05 por nota**. O custo real é **HUMANO**: hoje quase toda nota cai em
> `revisao_manual`, e é a fila da equipe que vai doer, não a fatura da Anthropic.
>
> **Por que caem em manual, em ordem de impacto:**
> 1. **`EMPRESA_CNPJ` não está no painel.** Sem o CNPJ da BidPro não dá para afirmar que a nota
>    foi emitida contra nós → *toda* nota vira revisão. **Custo de corrigir: zero.** É o
>    primeiro item, e depende só do dono.
> 2. **Nota sem link de verificação legível.** Muitas NFS-e trazem a URL **só no QR code**, e
>    hoje só lemos a URL como TEXTO. Um decodificador de QR no servidor (`zxing`/`jsQR`) é
>    biblioteca local, **sem custo de API**, e converteria boa parte de "sem link" em
>    "confirmada". **É a maior alavanca por menor esforço.**
>
> **A investigar amanhã (não confirmei, não afirmar antes de checar):**
> - **NFS-e padrão nacional / chave de acesso.** Se a nota for do padrão nacional, a
>   verificação pode ser determinística pela chave, **sem IA nenhuma**. Falta confirmar
>   cobertura real nos municípios dos nossos parceiros e se há consulta pública utilizável.
> - **Pedir o XML em vez do PDF** quando o parceiro tiver. XML é estruturado: leitura
>   determinística, custo zero, sem ambiguidade. Melhor caso possível.
> - **Parser determinístico antes da IA.** NFS-e é altamente padronizada por município;
>   regex de CNPJ/valor/número/chave resolveria os repetidos, com a IA só de fallback.
> - **Haiku para extração, Sonnet só em baixa confiança.** ~10× mais barato, mas é ganho de
>   segunda ordem — o gargalo é a fila humana, não o token.
>
> **Ordem sugerida:** (1) `EMPRESA_CNPJ` → (2) QR code → (3) XML/chave nacional → (4) modelo
> mais barato. Os dois primeiros resolvem a maior parte e custam quase nada.

### Segue dependendo do dono
1. **`EMPRESA_CNPJ`** no painel da Vercel (ver bloco acima — é o item de maior retorno).
2. **Resend**: o CNAME `links` foi criado, domínio ficou **Partially Verified**. Conferir se
   virou *Verified*; sem isso não há abertura/clique e não dá para medir o nudge.
3. **Nudge de ativação**: construído e **desligado**. Ligar é
   `update app_config set value='true' where key='ativacao_nudge_ativo';` — combinado é soltar
   com `?limite=5` primeiro, para o lote pequeno ser o teste da cadência.
4. Legal review dos Termos v3.3 · G2RS · `AUDITORIA_EMAIL_DESTINO`/`GITHUB_ACTIONS_TOKEN`.

### Achados menores, anotados e NÃO corrigidos
- **`indice-reforco-cron` parece não estar semeando.** Roda 6×/dia com IA, mas
  `indice_reforco_estado` está **vazia** e `indice_amostras` não cresce desde 07/08. Ou está
  desligado por env (`INDICE_REFORCO=0`), ou falha. É a proteção contra "relatório vazio"
  quando a busca ao vivo cai — vale destravar. Não mexi por não conseguir ler o env daqui.
- **Laços de aprendizado vazios:** `mercado_aprendizado`, `laudo_aprendizado` e
  `juridico_aprendizado` têm 0 linhas. Alimentam-se das correções que o analista faz nas
  reuniões gravadas (Daily). O código trata o vazio sem quebrar; o laço só não começou.
- **MRR do dashboard conta uma conta chamada "teste teste"** (R$ 49,90) e uma sem pagamento.
  Aritmética certa, rótulo honesto ("estimado por plano"), mas conta de teste não deveria
  entrar em métrica. Marcar contas internas e excluir do cálculo.
- **Custo de IA (30 dias): US$ 85,25** — Claude mensagens 43,91 · busca web 38,55 · Gemini 2,79.
- **`health-check` NÃO usa IA** (só `GET /v1/models`, grátis). Pode continuar 2×/dia sem
  preocupação. Os 5 avisos do e-mail eram **todos procedentes** — conferidos um a um.

### Estado das auditorias no fechamento
`auditoria_seguranca` **0/0** · `auditoria_uso` **0** · `auditoria_regras_negocio` **0 crítico**.

---

## 🔴 ATIVAÇÃO DO EXPLORADOR (09/08) — o onboarding não existia há 5 semanas

> **O maior vazamento do funil, medido.** Diagnóstico pedido pelo dono; a causa-raiz apareceu no
> banco, não em varredura de código.
>
> **O funil real dos 30 exploradores:**
>
> | etapa | pessoas |
> |---|---|
> | cadastro | 30 |
> | qualquer atividade | 18 |
> | abriu algum imóvel | 9 |
> | clicou "Solicitar Análise" | **3** |
> | gerou relatório | **3** |
>
> Duas leituras que mudam a conclusão: **quem clica, converte** (3 cliques → 3 análises, 100%) — o
> funil quebra ANTES do clique, não depois; e **ninguém volta** — 27 dos 30 têm um único dia de
> atividade, sempre o dia do cadastro. Os 5 vindos do Google Ads: nenhum gerou relatório, todos com
> um único dia. Das 90 amostras grátis disponíveis (3 por conta), **3 foram usadas**.
>
> ### Causa-raiz: o tour de boas-vindas estava apagado desde 01/07 (CORRIGIDO, `c2208e9`)
> `TourGuia.jsx` resolvia a versão por `new Date().toISOString().slice(0,7)` — **o mês do relógio**.
> A única versão cadastrada em `tour_etapas` era `'2026-06'`; a partir de 01/07 a consulta passou a
> devolver zero etapas e o tour deixou de aparecer, **sem erro, sem log, sem nada na tela**.
> `tour_progresso` tinha **0 linhas**. Os 30 exploradores são todos de 03/07 em diante: **nenhum
> deles jamais viu o onboarding**. Mesma família do gtag e do KYC — funcionalidade inteira dark, e o
> único rastro estava no banco.
> A versão passou a ser **a mais recente publicada** (sobrevive à virada do mês; publicar versão
> nova a promove sozinha), `roles` nulo não derruba mais o efeito, e há teto de 3 exibições para
> quem fecha sem concluir. Conteúdo novo em `supabase/migrations/tour_versao_2026_08_ativacao.sql`:
> o de 2026-06 dizia "TSN Ativos" (marca antiga), "laudos gerados pela equipe" (quem gera é a IA) e
> **não citava as análises grátis**. Explorador vê 5 etapas; plano pago vê 8. Desligar sem código:
> `update tour_etapas set ativo=false where versao='2026-08';`
>
> ⚠️ **Fato para não errar de novo:** explorador tem **3 amostras VITALÍCIAS**
> (`perfis.amostra_mercado_usadas`), **não** cota mensal — conferido em `consumir_analise_por()`.
>
> ### 🔴 Estamos cegos no único canal de reengajamento (DEPENDE DO DONO — painel Resend)
> `select count(*) filter (where aberto_em is not null) from emails_log;` → **0 em 120 e-mails**,
> desde 24/06. `email.delivered` chega (26 linhas com `entregue_em`), então o webhook, a URL e o
> secret **funcionam** — `api/resend-webhook.js` já trata `email.opened`/`email.clicked` (linhas
> 41–42). O que falta é do lado do Resend: **Domains → bidprobrasil.com.br → ligar Open tracking e
> Click tracking** (vêm desligados) e, em **Webhooks**, marcar os eventos `email.opened` e
> `email.clicked`. Sem isso não dá para saber se e-mail nenhum é lido — nem medir se o tour ou
> qualquer nudge funcionou.
>
> ### CTA do imóvel — FEITO (`e86683c`)
> O botão dizia só "Solicitar Análise": soa a pedido para uma equipe, possivelmente pago. Agora diz
> o que a pessoa tem no bolso, por permissão — explorador **"Analisar grátis (3 de 3)"**, pagante
> **"Analisar (7 de 10 deste mês)"**, admin segue genérico. Falha ao ler a cota volta ao texto
> genérico: rede caída não pode virar "você não tem análise".
> ⚠️ **Achado no caminho:** a tabela de limites estava em TRÊS telas e elas já discordavam —
> `Busca.jsx` anunciava **15/mês** ao Investidor Pro quando o banco (`limite_ia`) entrega **10**
> (15 é só o grandfather de `plano_legado`). A busca prometia cinco relatórios que o servidor não
> daria. Unificado em **`src/utils/cotaAnalise.js`**, espelho ÚNICO no frontend: mexeu no banco,
> mexe lá, e as três telas acompanham. **Não crie uma quarta cópia.**
>
> ### Nudge de ativação — CONSTRUÍDO E DESLIGADO (`7bacc78`)
> `api/ativacao-nudge-cron.js` + `supabase/migrations/ativacao_nudge.sql`. Máx. **2 e-mails na
> vida**: D+2 e D+7, com 3 imóveis reais (cascata cidade → estado → Brasil, para nenhum e-mail
> sair vazio). Sai da fila na primeira análise gerada. Cron diário 12h UTC.
> **Para ligar (uma linha de SQL, sem deploy):**
> `update app_config set value='true' where key='ativacao_nudge_ativo';` — e `'false'` desliga
> na hora, inclusive no meio de um envio. O env `ATIVACAO_NUDGE_ATIVO=0` é freio de mão por
> cima disso. Desligado = dry-run: apura, devolve a prévia, não envia nem grava.
> **`?limite=N` libera em LOTE** — o primeiro envio de uma cadência é o teste dela; mandar
> para 5, olhar entrega/abertura/clique, e só então soltar o resto. O resumo diz
> `adiados_pelo_lote` para o corte não se ler como "acabou a fila".
> **A lista, sem disparar nada:** `select * from public.ativacao_nudge_candidatos();` (passe
> `true` para ver o backlog). Em 09/08: 1 na janela normal, **27 no backlog**.
> **`?backlog=1` é de USO ÚNICO** — alcança quem se cadastrou antes de o cron existir; depois
> disso as janelas diárias bastam.
> Travas: unique `(user_id, etapa)`; grava ANTES de enviar (perder um nudge > mandar dois);
> internas fora por domínio; opt-out one-click + `List-Unsubscribe`, mesmo token e mesmo sinal do
> e-mail de oportunidades; sem imóvel para oferecer, não queima a etapa.
>
> ### O que ainda NÃO foi feito
> 1. **Mandamos o cliente embora.** Na página do imóvel, "Acessar leiloeiro" teve 7 cliques (2
>    pessoas) contra 3 de "Solicitar Análise" (3 pessoas). Nenhuma mudança feita — decisão de produto.
> 2. **Divergência menor, anotada:** o espelho do frontend dá limite **0** a analista/advogado
>    ("equipe não gera relatório próprio"), mas `limite_ia` no banco dá **100** a esses papéis. A
>    tela bloqueia quem o servidor liberaria. Ninguém reclamou porque a equipe gera em nome do
>    cliente (`paraUserId`); decidir qual dos dois lados está certo e alinhar.

---

## 🏁 SESSÃO 30 (08/08 — a regra que não existia, o grátis que passa a ganhar, o extrato pela metade)

**Pedido do dono:** *"é para esse tipo de divergência não voltar a acontecer, pois acaba gerando
uma confusão na hora de montarmos um planejamento."* Este bloco é a resposta — mais a mudança de
comissionamento e a conferência do Financeiro.

### 🔴 A divergência tinha nome: DOIS CÉREBROS

A regra do dono — *"Explorador indica, mas para sacar precisa de assinatura ativa"* — estava
escrita no comentário de `api/saque.js:68` e tinha até função própria (`podeReceber`). **Ela nunca
bloqueou ninguém.** `podeReceber` só alimentava um aviso na tela; quem decidia era
`PLANOS_PAGOS.includes(role)`, e explorador é `false` ali → caía no ramo da equipe operacional e
sacava com PIX pessoal, **sem KYC, sem PJ, sem NF e sem teto**. O gate estava invertido: *assinar*
é que LIGAVA as exigências. Pior, havia rota de fuga — o `AuthContext` rebaixa para explorador após
5 dias de inadimplência, então bastava parar de pagar para o gate de PJ evaporar.

A causa não foi esquecimento: enquanto a tela calcular por um caminho e o banco por outro, os dois
divergem — é questão de tempo. **O conserto tem três partes** (`regras_negocio_saque_teto_nf.sql`):

| Peça | O que faz |
|---|---|
| `regra_negocio` | A regra vira **dado**. Quem planeja lê a MESMA linha que o motor obedece. Não existe "versão do documento" |
| `saque_avaliar()` | **Um avaliador só**, sem efeito colateral. A tela chama para mostrar, a RPC chama para decidir, a auditoria chama para conferir |
| `auditoria_regras_negocio()` | Acusa regra ativa que ninguém aplica **e** função de dinheiro que parou de delegar ao avaliador. Entrou no ritual (passo 2b), custo zero |

**A auditoria foi testada nos dois sentidos:** com o sistema íntegro dá `0 crítico`; injetando uma
regra órfã de propósito, ela acusa e nomeia a função que falta. Sem essa prova negativa, um
auditor que só diz "está tudo bem" não vale nada.

### O grátis passa a ganhar; a trava foi para o saque

Decisão do dono: *"os valores da comissão deles são dele; a trava é para trazer para que ele seja
pagante"*. Então:

- **Ganho:** `distribuir_comissao_rede` troca `eh_pagante` por `pode_ganhar_comissao` — o
  explorador entra na rede em todos os fluxos. Sem teto de ganho. Como ele não tem rank, o
  `max_nivel` cai no coalesce 1: **recebe do nível 1 e só**, conservador de propósito.
- **Saque:** até **R$ 2.500 no mês** ele saca direto. Ao ultrapassar isso no mês, exige **plano
  pago + nota fiscal**. A tela agora informa quanto ainda cabe sem NF, em vez de só dizer "não".
- **KYC virou requisito de QUALQUER saque de parceiro** — antes só o pagante precisava, ou seja, o
  grátis tinha menos controle que o assinante.

> ⚠️ **Janela = MÊS, não vitalícia.** O dono falou em *"o período do mês"*; implementei mensal.
> Trocar é `update regra_negocio set valor = valor || '{"janela":"vitalicio"}' where chave =
> 'saque.teto_sem_nf';` — sem deploy. É para isso que a regra virou dado.

> 🔴 **Regressão que o teste pegou antes de ir ao ar:** a primeira versão jogou a **equipe
> operacional** na regra dos parceiros, e o admin recebia "assine um plano para sacar". Equipe
> recebe por FUNÇÃO — está isenta de teto, NF e KYC. Conferido depois: admin R$ 50 liberado;
> parceiro pagante barrado por NF acima do teto.

### Nota fiscal conferida pela IA (`api/saque-nf.js`)

Três estados, nunca dois — e a distinção é o ponto: **ler** a nota (emitente, tomador, valor, data)
pega o erro honesto, mas não prova emissão; um PDF bem-feito passa. **A única prova real é o
link/QR da prefeitura**, que o servidor abre e confere se cita o número da nota. Nota sem link não
é reprovada (nem todo município publica) — vai para revisão humana com o motivo escrito. Aprovação
automática exige dados batendo **e** confirmação no verificador.

**Falta configurar: `EMPRESA_CNPJ` na Vercel.** Sem ele não dá para afirmar que a nota foi emitida
contra a BidPro, e toda NF cai em revisão manual (o motivo aparece na resposta).

### Financeiro: o extrato estava vindo pela metade

O pedido foi *"não podem haver valores flutuantes, mas sim valores reais cobrados, recebidos e
pagos"*. A causa estava em `api/financeiro-extrato.js`: as três consultas pediam `limit=100` e
**paravam** — sem `offset`, sem olhar `hasMore` nem `paging.total`. Passando de 100 lançamentos no
período, o resto sumia **em silêncio**, e o resumo era somado sobre o pedaço que coube. Dois
períodos não fechavam entre si — e a **conciliação bebe deste mesmo endpoint**, então a DRE herdava
o buraco. Agora pagina até acabar (teto de 3.000 por fonte) e, se o teto for atingido, a resposta
devolve `completo: false` e a tela mostra faixa VERMELHA de total incompleto. Também ficou
explícito que a lista vem cortada em 300 mas os totais somam tudo (`lancamentos_exibidos`).

> ✅ **CORREÇÃO (o dono apontou, e ele está certo).** Eu havia registrado aqui que "não há nenhum
> lançamento do Asaas na conciliação, logo a receita de assinatura está fora da DRE". **Errado.**
> O **Mercado Pago é o gateway PRINCIPAL** e o **Asaas é o BACKUP**: o checkout tenta o MP primeiro
> e só cai no Asaas quando o MP falha ou recusa (`src/pages/Checkout.jsx`, confirmado no código).
> Então extrato só com Mercado Pago é o **funcionamento correto** — Asaas vazio quer dizer que o
> principal não falhou. As 40 linhas de MP (21 entradas / 19 saídas · R$ 3.066,79 × R$ 1.588,33)
> são a operação, não um pedaço dela.
>
> **A raiz do meu erro está registrada:** o `CLAUDE.md` dizia apenas "**Pagamentos:** Asaas". Li a
> documentação e diagnostiquei como falha o que era comportamento correto — a MESMA classe de
> divergência que esta sessão inteira tratou, só que na documentação em vez do código. O
> `CLAUDE.md` foi corrigido e agora diz qual é o principal, qual é o backup e manda **sempre
> verificar o fluxo** antes de concluir. O aviso na API também mudou de tom: "sem lançamentos —
> esperado quando o MP não falhou" em vez de acusar chave errada.

### Termos v3.3 — todo parceiro re-aceita, e o aceite TRAVA o saque

Ordem do dono: *"antes de colocar em produção tem que descer atualiza os termos e todos os que já
são parceiros devem aceitar; não precisa bater foto nenhuma novamente, basta aceitar"*.

O mecanismo de re-aceite já existia (`TermosAtualizadosModal` + `aceites_plano` com IP e hash) —
subir `TERMOS_VERSAO` faz todo usuário logado ver o popup. **Mas popup se fecha.** Por isso o
aceite virou também **regra de servidor** (`saque.exige_termos_vigentes`): sem a versão vigente
gravada em `perfis.termos_uso_versao`, o parceiro não saca. Nenhum documento novo é pedido — o
item de pendência diz isso com todas as letras na tela.

Texto novo em três lugares: a cláusula 8.2–8.4 da página de Termos (quem pode ganhar, teto de
R$ 2.500/mês, NF acima do teto, sexta 12h), o texto do re-aceite (o que o usuário declara ao
clicar) e a regra no banco. **Estado hoje:** 20 perfis sem aceite nenhum, 10 na v3.2 e 6 na v3.0 —
os 36 vão ver o popup.

### NF acima do teto virou ABSOLUTA — inclusive para a equipe

Correção do dono sobre a minha primeira versão: *"essa regra deve ser absoluta para todas as
classes incluindo equipe, visto questões fiscais. Toda classe deveria emitir nota fiscal, mas isso
seria uma trava nessa fase inicial"*. Eu havia isentado a equipe do teto inteiro; agora **o teto e
a NF valem para todo mundo**. O que continua restrito a parceiro é "estar em plano pago" — mandar
um analista assinar plano para receber pelo próprio trabalho não faz sentido, e não é disso que a
regra fiscal trata. Conferido depois da mudança: admin saca R$ 50 direto e é barrado por NF em
R$ 3.000; parceiro é barrado por KYC + aceite dos termos.

> ⏱️ **Nota de sinceridade sobre a ordem dos fatos:** o dono pediu os termos *antes* da produção, e
> a regra de comissão já tinha subido no commit anterior. Exposição real no intervalo: **zero** —
> nenhum explorador tem saldo, não há cadeia de indicação entre pagantes, e o gate de aceite agora
> impede saque sob a regra nova sem o aceite. Mas a ordem certa era esta, e fica registrado.

### Rodada final de correções do dono — e um erro meu que ela desfez

**1. KYC também para a equipe.** *"A equipe coloca pra fazer a mesma verificação, batendo a selfie
e anexando o documento de identidade."* Feito: `saque.exige_kyc` escopo `todos`, e o popup de KYC
passou a aparecer para quem recebe por função (analista, advogado, consultor, afiliado, leiloeiro).
O admin fica fora do POPUP — opera o sistema e o veria o dia inteiro — mas **não** fica fora da
trava: hoje ele está bloqueado para sacar até bater a selfie.

**2. 🔴 NÃO EXISTE pagamento a pessoa física — e o erro era meu.** *"Para realizar o pagamento
exige informar o CNPJ vinculado ao CPF. Já tínhamos vencido essa etapa anteriormente."* Ele está
certo: é a rota do §12.9. Ao abrir o saque para o parceiro grátis, **eu o mandei para o ramo do PIX
pessoal** que existia para a equipe — reintroduzi pagamento PF pela porta dos fundos e ainda
levantei em cima disso uma preocupação tributária que a arquitetura já tinha resolvido. Agora o
destino é a **PJ para toda classe**, com CPF conferido no QSA. Some da lista de pendências o
"parecer do contador sobre pagamento a PF": a premissa era falsa.

**3. A nota cobre o MÊS INTEIRO, não o pedido.** *"Se o pagamento foi feito inferior a R$ 2.500 e
durante o mês alcançou o valor, deve não permitir o saque e exigir nota fiscal referente ao valor
integral do mês."* Eu exigia nota do valor pedido — buraco óbvio: 3 saques de R$ 1.000 sem nota e
um quarto de R$ 500 pediria nota de R$ 500, com R$ 3.500 sacados e R$ 500 documentados. Agora a
nota precisa cobrir `ja_sacado_no_mês + este_pedido`.

**4. Botão da nota na própria tela do saque.** `Comissoes.jsx` mostra "sacado neste mês" e "ainda
pode sacar sem nota" **antes** de o parceiro pedir, e quando o pedido estoura o teto abre o anexo
já com o valor integral exigido, com o veredito da conferência ali mesmo.

> 🧪 **O mecanismo pegou o autor do mecanismo.** Ao criar `saque.destino_sempre_pj`, declarei a
> regra e deixei o comportamento fixo no código, em vez de lê-la. A `auditoria_regras_negocio()`
> acusou **"regra órfã"** na hora, com o nome da função. Corrigi para ler a regra e voltou a 0.
> É o melhor teste que essa auditoria podia ter recebido — e no mesmo dia em que nasceu.

### O que fica para a próxima sessão

| Pendência | O que falta |
|---|---|
| `EMPRESA_CNPJ` | sem ele toda NF cai em revisão manual. **O CNPJ é público** (está no próprio texto dos Termos), então a alternativa recomendada é gravá-lo em `regra_negocio` — dado auditável, sem variável de ambiente e sem deploy |
| Jurídico valida o texto v3.3 | a redação das cláusulas 8.2–8.4 é minha; segue a ressalva de sempre |
| PJ para a equipe | com o destino sempre PJ, cada integrante que recebe pela plataforma precisa de CNPJ cadastrado e validado. Hoje **nenhum** tem — todos estão bloqueados até preencher |
| Tela do parceiro | `Comissoes.jsx`/`MinhaRede.jsx` ainda não mostram o teto do mês nem o upload da NF — a API já devolve `teto_sem_nf`, `disponivel_sem_nf` e `exige_nf`; falta a UI |
| Parecer do contador | pagamento a PF contra recibo, no volume que a nova regra permite, é o único risco que código não conserta depois (§12.9) |
| Herdadas de 08/08 | `CONTABILIDADE_EMAIL` · `AUDITORIA_EMAIL_DESTINO` · `GITHUB_ACTIONS_TOKEN` · Pluggy · 4 fontes com 0% de documento · 3 fontes com lote vencido · Guarulhos `e7bd0637` · 155 `.json()` sem `.ok` |

---

## 🏁 SESSÃO 29 (08/08 — ritual de abertura: o convite de cliente estava morto há 2 dias)

**Ritual completo rodado. O diagnóstico saiu verde em tudo que é automático — e o achado grave veio
de novo do ESTADO, não do código: um erro registrado às 11h26 de hoje.** O padrão do dia anterior se
repetiu e ganhou nome: **embed do PostgREST apontando para uma FK que não existe (ou que existe duas
vezes)**. Cinco telas caíam nisso; a pior derrubava a captação de clientes.

### Diagnóstico de abertura (o que está verde)

| Item | Estado |
|---|---|
| Heartbeat | registrado 11:29 (auditoria semanal paga vai PULAR) |
| Acervo | **30.713** ativos · 21.837 atualizados em 24h · fila de geocode **28** |
| `auditoria_seguranca()` | **0 crítico / 0 atenção** |
| Baseline de captura | **nenhuma fonte abaixo do piso aprendido** |
| Chamados do CLIENTE presos | **0** (o filtro de 07/08 segurou) |
| Deploys Vercel | os 20 últimos **READY** |
| Anomalias de relatório | 5 `cnj_vazio` (05/08) + 1 `mercado_area_incoerente` (28/07) — sem novas |

### 🔴 O convite de cliente estava quebrado para TODO MUNDO

`links_convite.criado_por` referencia **`auth.users`**, não `perfis`. O embed
`perfis:criado_por(nome)` devolvia 400, e em `Convite.jsx` o `if (error)` traduzia isso para
**"Link de convite não encontrado ou expirado"**. Ou seja: os **16 links ativos** que os parceiros
distribuíram mostravam ao convidado que o convite não valia. Não é tela feia — é a porta de entrada
de cliente fechada, em silêncio, com o parceiro achando que divulgou. O nome de quem convida também
não é legível por anônimo (RLS de `perfis`, correto) — a tela já tinha o rótulo neutro
"BidPro Brasil" de reserva.

### As outras quatro da mesma família

| Onde | Causa | O que o usuário via |
|---|---|---|
| `/admin` → convites | FK para `auth.users` | aba vazia |
| `/admin` → links promocionais | **DUAS** FKs em `criado_por` (auth.users + perfis) → PostgREST não escolhe | lista vazia |
| `/admin` → transcrições | **DUAS** FKs em `solicitacoes.user_id` | lista vazia |
| Q&A da lição (`listarPerguntas`) | FK para `auth.users`, e a função dá `throw` | Q&A da lição inteira caindo |

**A regra que fica:** `alias:coluna(...)` só funciona quando existe **exatamente uma** FK naquela
coluna. Zero FKs e duas FKs dão o MESMO erro 400 — e o PostgREST diz "could not find a relationship"
nos dois casos, o que engana. Onde a FK aponta para `auth.users`, buscar o nome em consulta
separada; onde há duas, nomear a constraint (`perfis!links_promo_criado_por_perfis_fkey(nome)`).

### O chat do caso: lia meio certo, escrevia errado

A sessão de 07/08 corrigiu a LEITURA de `chamados_mensagens` e não tocou na ESCRITA. O insert de
`/caso/:id` mandava `user_id` e `mensagem` — colunas que não existem (são `autor_id`/`conteudo`).
Como o supabase-js **não dá throw** no insert, o erro era engolido: `nova` vinha `undefined` e a
tela dizia *"Erro ao enviar: Cannot read properties of undefined"*. **Nenhuma mensagem de caso era
gravada.** Junto com isso, a renderização lia `m.perfis?.nome` (nunca preenchido → todo mundo
aparecia como **"Sistema"**) e `m.created_at` (a coluna é `criado_em` → **data em branco**).
Corrigido o insert (com `autor_tipo` na convenção do ChatSuporte, que é o que o health check usa
para saber se quem falou foi o cliente) e os dois campos do render.

### O `/checkout` "Failed to fetch" NÃO era o pagamento

Era o item nº 1 da fila de investigação deixada ontem. O stack respondeu em 30 segundos: as chamadas
saem de `chrome-extension://hoklmm…`, que substitui o `window.fetch`, e o alvo é um beacon do
**Google Tag Manager**. Bug de extensão do próprio usuário, num beacon de analytics — não temos como
corrigir e não afeta a compra. **Ocupou dois dias no topo da fila por falta de um filtro.** Agora
`reportarErro.js` descarta erro cujo stack é INTEIRAMENTE de terceiro (extensão, GTM, GA, Meta,
Clarity); se qualquer quadro for do nosso bundle, o erro passa normalmente — a regra é conservadora
de propósito.

### O 400 do `/minha-rede` era ruído que nós mesmos gerávamos

`createSignedUrl` no cliente, no bucket `documentos`, **sempre** falha (o cliente não tem permissão
de assinar ali). Depois da correção de ontem — quem assina é o servidor, com a service key — a
chamada virou vestigial: só produzia 400 registrado em `erros_cliente`, escondendo erro de verdade,
para obter algo que já não é usado. Removida de `Perfil.jsx` e `KycParceiroModal.jsx`; o path é
gravado de propósito, e `api/validar-selfie.js` (`assinarPathPrivado`) assina na hora.

> ⚠️ **A consulta `usuario_docs where url not like 'http%'` do ritual (CLAUDE.md, passo 1b) virou
> FALSO POSITIVO.** Os 8 documentos com path cru são agora o formato **correto**. Ela segue útil
> como inventário, mas 8 ≠ problema. Trocar por "path que não casa com `^pj/<uuid>/`" em algum
> momento.

### Fontes cegas: o código já está certo, falta o cron rodar

As 7 fontes (CALIL, GESTAOLEILOES, PECINI, VLANCE, VEGAS, RJLEILOES, TORRES3 — 418 lotes) **ainda
aparecem sem `fonte_saude`**, mas isso é esperado: todas ganharam a chamada ontem e os crons delas
são **semanais**. Próximas gravações: **segunda** (SOLEON → CALIL/VEGAS/TORRES3, PECINI, VLANCE),
**terça** (RJLEILOES), **quinta** (GESTAOLEILOES). Verificado arquivo por arquivo, inclusive o
scraper Python do VLANCE, que grava direto no REST. **Se na terça alguma continuar ausente, aí sim
é bug.**

### O que fica para a próxima sessão

As pendências de 08/08 continuam valendo, MENOS `/checkout` e `/minha-rede` (fechadas acima). Segue
pendente: `CONTABILIDADE_EMAIL` · `AUDITORIA_EMAIL_DESTINO` · `GITHUB_ACTIONS_TOKEN` · Pluggy ·
4 fontes com 0% de documento · 3 fontes publicando lote vencido · lote de Guarulhos `e7bd0637` ·
155 `.json()` sem `.ok`. **Novo:** varrer o resto do app atrás de embed `alias:coluna(...)` — eu
cobri `src/`, mas as rotas `api/` usam PostgREST direto e não passaram por essa lente.

> **Nota de verificação, para não superestimar o que foi provado:** as correções foram conferidas
> contra o catálogo de FKs do banco (`pg_constraint`) e o build passou, mas **não** contra o
> PostgREST em execução — a política de rede deste ambiente só deixa o MCP falar com o Supabase, e
> `curl` volta 403. Para o convite a correção é definitiva (sem FK, o embed é impossível); para as
> duas de constraint ambígua, confirmar na tela depois do deploy.

---

## 🏁 FECHAMENTO DE 08/08 — leia este bloco primeiro

**O dia começou lendo o rastro que o sistema deixou no banco e terminou com um financeiro que se
monta sozinho. A lição do dia: os quatro achados mais graves NÃO estavam no código — estavam no
estado.**

| | |
|---|---|
| Commits em `main` | `67d8603` · `f61db42` · `a96ad6d` · `98bbec2` · `89b5d5f` · `2ffffa1` · `537802a` |
| Deploy | `dpl_GkFgngV6ac7srPUxPgmr68nQmHjT` **READY** em produção |
| `auditoria_seguranca()` | **0 crítico / 0 atenção** — depois de corrigir 1 achado do próprio auditor (ver abaixo) |
| `npm run build` | OK |

### O achado que mais importa: o KYC nunca validou ninguém

**8 de 8** documentos do sistema (5 usuários) estavam gravados com **path cru** em vez de URL
assinada. O `createSignedUrl` de 10 anos falhava e o `signed?.signedUrl || path` engolia o erro.
Como o servidor exige URL do nosso Storage (trava anti-forjaria, correta), **o face match nunca
rodou**: toda identidade caía em revisão manual — e identidade validada é pré-requisito de SAQUE.
O parceiro ficava sem receber esperando alguém olhar na mão.
Corrigido na raiz: o SERVIDOR assina o path na hora, com a service key, aceitando só o formato
dos nossos gravadores. Ele deixou de depender do que o cliente conseguiu gravar.

### Selo verde jurídico dado sem consulta

`gerarParecerRisco([])` devolvia **verde** — "Nenhum processo encontrado nos tribunais
consultados" — em TODOS os caminhos, inclusive quando a consulta nem aconteceu (chave ausente, UF
inválida, tribunal fora do ar). Em lote JUDICIAL o processo existe por definição, e mesmo assim o
cliente lia verde. Não é número errado: é alguém dando lance achando que a diligência processual
passou. A TELA piorava — `cores[nivel] || cores.verde` fazia qualquer nível desconhecido virar
"VIABILIDADE JURÍDICA PRELIMINAR FAVORÁVEL". Agora são três estados, o fallback nunca é verde, o
documental tem teto (sem consulta confirmada não pode ser verde) e os 2 relatórios já entregues
com verde indevido foram corrigidos no banco.

### Três telas com consulta quebrada, falhando em silêncio

`/caso/:id` (tabela `imoveis` que não existe, coluna `link_leilao` idem, `descricao` num insert de
`chamados` — o canal de atendimento do caso **nunca era criado**; e as mensagens liam
`created_at`/`user_id`/`mensagem` em vez dos nomes reais, então o histórico aparecia vazio) e
`/admin` (embed em `plano_assinaturas`, cuja FK aponta para `auth.users` — a lista de assessorados
carregava vazia).

### Os "chamados presos" eram nossos, não do cliente

Os 6 reportados pelo health check eram abordagens **proativas da IA** sem resposta — um deles do
próprio dono. O health check passou a contar só chamado em que o CLIENTE falou. Cobrar resposta do
suporte por abordagem sem retorno treina a equipe a ignorar o alerta.

### Leiloeiros

- **7 fontes saíram do ponto cego** (CALIL, GESTAOLEILOES, PECINI, VLANCE, VEGAS, RJLEILOES,
  TORRES3 — 418 lotes). `registrarSaude` vivia dentro do scraper-puppeteer; virou módulo
  compartilhado e os cinco scrapers passaram a chamá-lo. **Regra nova: leiloeiro sem essa chamada
  nasce invisível ao bug bounty de volume.**
- **Documentos passam a ter cópia nossa.** Medido: só ZUK (265) e GRUPOLANCE (212) tinham; LJUD
  (932), MEGA (538), PESTANA (383) e o resto eram só links para o site do leiloeiro. Novo
  `espelhar-docs-cron` (4/4h) copia matrícula e edital, com a fila ordenada pela **instabilidade
  real** de cada fonte (`fonte_instabilidade()`): TOTALLEILOES e CREPALDI a 100%, VENDASGOV 65%,
  FRAZAO e LEILOFY 30%. 300 documentos enfileirados.
- **Inventário:** 27 fontes ativas, 30.476 lotes, 92,5% com matrícula. Quatro fontes com **0% de
  documento real** — GESTAOLEILOES (143), SBID9 (33), VLANCE (29) e PECINI (50%): nesses ~251
  lotes o documental não tem o que ler.

### Financeiro: de tela de receita a fluxo de caixa com DRE

O `mp-admin?action=transacoes` **descartava de propósito** tudo que não era recebimento — e é ali
que estão as saídas. Sem os dois lados existe faturamento, não fluxo de caixa. Agora o Financeiro
tem 5 abas: Síntese · Fluxo de caixa · **Extrato** · **Conciliação** · **Monitor**.

- **Plano de contas** com 30 contas em estrutura de DRE, desenhado para a operação (IA e dados,
  infraestrutura, coleta/proxy, jurídico, comissões de parceiros, taxas de gateway).
- **Classificação em cascata: credor → regra → 9.9 A CLASSIFICAR.** Classificar pelo CREDOR é mais
  forte que por descrição: "ANTHROPIC PBC", "Anthropic, PBC*Claude" e "ANTHROPIC 4155551212" são o
  mesmo fornecedor. Um clique classifica o credor e todos os lançamentos dele. **A v1 da
  normalização devolvia três chaves diferentes para os três — inútil; a v2 corrige, mantendo a
  segunda palavra quando a primeira é guarda-chuva (senão "Google Ads" e "Google Cloud" viravam o
  mesmo credor).**
- **O extrato é PERSISTIDO.** É o ponto central: a contabilidade fecha competências passadas, e
  número que muda a cada consulta faz a DRE de março mudar depois de entregue.
- **Mesclar credores** (mesmo fornecedor grafado de dois jeitos) e **compor lançamento** (o caso do
  dono: R$ 1.000 pagos com R$ 200 de dedução acordada = uma linha no banco, duas na contabilidade).
  Rateio que não fecha é **recusado com a diferença**.
- **Exportação** PDF + OFX 1.0 (SGML — o que os ERPs brasileiros importam), com a conta contábil no
  MEMO, e envio por e-mail com a resposta do Resend CHECADA.
- **O extrato entra sozinho** (`conciliacao-sync-cron`, 8h25, janela de 45 dias). O botão manual
  virou "Atualizar agora" — quem lembra de apertar um botão de importação todo dia é ninguém.
- **Monitor** com entradas × saídas mês a mês, divisão das saídas, maiores credores e diagnóstico
  no Gemini (achados determinísticos sempre; texto da IA por cima, e a tela diz qual é qual).

### Menu do Admin reorganizado

Eram SETE faixas com as 18 abas visíveis ao mesmo tempo. Agora são quatro famílias por área —
Administrativo, Comercial, Financeiro, Operacional — e só a família aberta mostra suas abas. A
família é DERIVADA da aba atual, não estado paralelo.

### 🔴 O auditor de segurança pegou um erro MEU — e é a lição técnica do dia

`revoke all on function ... from anon, authenticated` **é falsa proteção**. No Postgres toda função
nasce com EXECUTE concedido a **PUBLIC**, e revogar dos dois papéis não tira o grant de PUBLIC —
eles continuam alcançando a função por herança. Resultado: **10 funções SECURITY DEFINER criadas
hoje ficaram executáveis por ANÔNIMO**, entre elas `dre_competencia` (a DRE da empresa),
`fornecedor_definir_conta`, `rateio_definir` e `desativar_leiloes_encerrados` (que poderia tirar
lotes do ar). Corrigido com `revoke ... from public, anon, authenticated`; auditoria voltou a
**0/0**. Em TABELA o padrão antigo funciona (tabela não tem grant implícito a PUBLIC); em FUNÇÃO,
não. **Ao criar função nova, revogue de PUBLIC.**

### O que fica para a próxima sessão

| Pendência | O que falta |
|---|---|
| `CONTABILIDADE_EMAIL` na Vercel | destino padrão do envio à contabilidade (dá para digitar na tela) |
| `AUDITORIA_EMAIL_DESTINO` · `GITHUB_ACTIONS_TOKEN` | pendentes desde 07/08 |
| Pluggy | confirmar com o comercial se **CNPJ cabe no Meu Pluggy gratuito**. Se sim, custo zero para Inter, C6, Bradesco e Caixa; se não, R$ 2.500/mês não se justifica para uso interno — cai para API direta do banco ou OFX |
| 4 fontes com 0% de documento | pipeline de captura para GESTAOLEILOES, SBID9 e VLANCE |
| 3 fontes publicando lote vencido | LEILOTECH (132 de 189), SBID21 (37 de 39), VEGAS (41 de 62) — entra na próxima ofensiva |
| Lote de Guarulhos `e7bd0637` | segue sem data; é o primeiro da nova fila de enriquecimento |
| 155 `.json()` sem `.ok` | triagem pendente para promover o lint de warn a error |
| `/checkout` — "Failed to fetch" | 2 ocorrências, 06/08 08:02 → 07/08 15:27. **NÃO é resíduo de deploy** (ver abaixo): atravessa dois dias e é a tela de PAGAMENTO. Investigar primeiro |
| `/minha-rede` — Supabase 400 em `storage/v1/object/sign` | 3 ocorrências, 06/08 08:25 → 07/08 15:23. Assinatura de URL falhando na tela do parceiro — mesma família do bug do KYC (path que não vira URL assinada), agora do lado do cliente |

### 🧾 Rastreabilidade deste bloco (para não se perder depois)

- **Fuso.** Este bloco está rotulado **08/08** porque a sessão rodou em UTC, mas em horário de
  Brasília ela terminou às **22h14 de 07/08**. Quem for procurar os commits pela data local vai
  encontrá-los carimbados **07/08** — não são de dias diferentes.
- **Commit de fechamento:** `993c918` (este bloco). Os sete anteriores estão na tabela do topo.
- **A correção do achado do auditor** está na migração **`revogar_execute_public_funcoes_novas`**,
  que revoga de `public, anon, authenticated` as 11 funções `SECURITY DEFINER` criadas na sessão:
  `conciliacao_classificar`, `desativar_leiloes_encerrados`, `dre_competencia`,
  `enfileirar_espelho_documentos`, `fornecedor_definir_conta`, `fornecedor_mesclar`,
  `fornecedores_sincronizar`, `limpar_captura_handoff`, `rateio_definir`,
  `recalcular_desconto_praca`, `limpar_analises_orfas`.
- **Por que chegou e-mail de ERRO do health check nesta tarde** (a pergunta do dono): não foi falha
  do sistema — foi a **minha própria sequência de deploys**, mais de 40 em 24 h (duas páginas
  cheias na API da Vercel e ainda havia mais). Cada deploy troca o hash dos bundles; quem estava
  com a página aberta pedia um chunk que já não existia. Daí os "Failed to fetch" concentrados
  entre **14h33 e 16h12** em `/buscar`, `/imovel/:id`, `/login`, `/perfil`, `/minha-rede` e `/`,
  mais um `vite:preloadError PRESO`. **Esses somem sozinhos** (o health check limpa em 24 h se não
  recorrerem). Os DOIS da tabela acima não somem: são anteriores à janela de deploys e ficam.

**A pergunta de rotina que fica deste dia:** antes de confiar numa varredura de código, *o que o
sistema já registrou no banco sobre si mesmo?* Erro de runtime do cliente, anomalia de relatório,
documento sem URL, fonte sem histórico — quatro achados graves, nenhum visível no código. O passo
**1b** do ritual (CLAUDE.md) existe por causa deste dia.

---

## ✅ COMEÇAR AQUI (07/08 — sessão 28: os 3 relatórios de Cotia · "Pronto!" repetido + laudo divergente)

> O dono gerou os 3 relatórios de um imóvel em Cotia e trouxe dois problemas: *"o 2º relatório
> ficava notificando que estava pronto sem estar"* e *"o terceiro relatório apresentando um
> resultado divergente dos outros"*. Ambos confirmados no banco e corrigidos na raiz.
> Imóvel: `060eff88-badc-43ff-b11c-6b482da68b9b` — Casa, Estrada dos Galdinos, Jardim
> Barbacena, Cotia/SP, praça R$ 500.929,04 (avaliação CEF R$ 786.000).

### 1. "Pronto!" avisado com o documental ainda incompleto

**Causa:** `ToastRelatorioPronto.jsx` disparava na transição crua `gerando → concluida`. Mas o
documental grava `status='concluida'` **com** `result.precisaDocumentos = true` enquanto a captura
automática ainda baixa matrícula/edital, e a tela re-tenta a cada 25s (`capturaPollRef`, até 5×).
O `atividade_log` registrou dois `relatorio_documental_faltam_docs` (00:38:08 e 00:38:40) antes do
OK real às 00:45:34 — três notificações "Pronto!" para um relatório só.

**Correção:** o gate deixa de ser o STATUS e passa a ser a ENTREGA. Novo helper `entregue(tipo, a)`
checa `precisaDocumentos` (documental) e `precisaRelatorios` (laudo); o mapa de transição guarda
`'pronto'` vs. o status cru, então "aguardando documento" e "pronto" são estados distintos e a
notificação só sai na virada de verdade.

### 2. O laudo reprovou um imóvel com 44% de desconto — e estava certo

O mercadológico concluiu **R$ 895.000** de valor de mercado contra praça de **R$ 500.929** (44% de
desconto) e o documental deu risco AMARELO — mas o laudo veio **reprovado**, com *"prejuízo
estimado de mais de R$ 629 mil mesmo no lance mínimo"* e *"ROI de menos 371,55%"*. O
`controleQualidade` do próprio laudo apontou a contradição: *"o relatório mercadológico registra
capital total aportado de R$ 169.407,33, valor inferior ao lance de R$ 500.929,04"*.

**Causa-raiz (provada pela coluna `inputs` gravada):** `parecerInputs.d.valorMercado = 0` e
`metricas.valorRef = 0`. As métricas de viabilidade chegam **prontas do cliente** — a tela as
calcula no clique, ANTES de a pesquisa de mercado existir. O servidor corrigia só o campo
`pInp.valorMercado` e passava `parecerInputs.metricas` **intocado** para o `promptParecer`, que
imprime capital/lucro/ROI literalmente. O parecer saiu com os números de um imóvel que valeria
zero; o laudo leu o parecer e reprovou com razão. **O terceiro relatório era o mensageiro, não o
bug.**

**Correção (`api/gerar-analise.js`):** o servidor agora **recalcula** capital, lucro, ROI e teto de
lance com o valor de mercado que ele mesmo descobriu, importando a MESMA função pura da tela
(`calcularMetricasCenario` / `calcularTetoLance` de `src/utils/calculos.js` — o padrão de importar
`src/` de dentro de `api/` já existia em `og-share.js`). Dispara quando o cliente não tinha valor de
mercado, quando o servidor achou outro (>2% de diferença) ou quando as métricas vieram zeradas. O
antes/depois fica em `result.mercado.__diagParecer.metricasRecalculadas`.

Conferido rodando a função com os `inputs` reais gravados deste imóvel:

| | capital | lucro | ROI | teto de lance |
|---|---|---|---|---|
| Antes (vm = 0) | R$ 169.407 | **−R$ 629.427** | **−371,55%** | R$ 0 |
| Depois (vm = 895.000) | R$ 169.407 | **+R$ 107.424** | **+63,41%** | R$ 548.675 |

**Complemento:** quando a pesquisa **não** estima valor de mercado, o parecer deixa de imprimir
lucro/ROI/teto (que seriam a venda por zero, a origem do "prejuízo integral") e passa a informar
com transparência que a referência não foi estimada, apresentando só os custos da operação.

### 3. Varredura pedida pelo dono: "que estes mesmos erros não se repitam em outros relatórios"

Varri as duas classes de defeito no resto do sistema. **Cotia não era caso isolado.**

#### Classe B (número do cliente usado como verdade) — o alcance real

| Medição em `analises_mercado` (55 relatórios com `inputs` gravados) | Quantidade |
|---|---|
| Cliente mandou `valorMercado = 0` | **49** |
| Cliente mandou `valorLocacao = 0` **e** a busca achou aluguel real | **43** |
| Parecer impresso com **ROI abaixo de −100%** (impossível no modelo) | **15** |

Os 15 de ROI absurdo, todos com o mesmo `−371,55%` (é sempre a mesma fórmula sobre mercado
zero), desde **06/07**: Cotia 07/08 · Feira de Santana 01/08 · Resende 29/07 · Goiânia 28/07 ·
Praia Grande 28/07 · Carapicuíba 23/07 · Feira de Santana 15/07 · Salvador 14/07 · **Cotia 14/07
(mercado R$ 770 mil × lance R$ 293 mil — 62% de desconto, reprovado)** · Itapevi 14/07 · Praia
Grande 12/07 · Vila Velha 09/07 · Salvador 07/07 · Carapicuíba 07/07 · Vila Velha 06/07.

**Achado novo, um campo ao lado do de Cotia:** o servidor também nunca aplicava ao parecer o
`aluguelMedio` que ACABARA de descobrir — 43 de 55 relatórios imprimiram **yield 0,00%**, como se
o imóvel não rendesse nada, com o aluguel medido ali no mesmo `result` (Cotia: R$ 4.771/mês).
Corrigido junto: `pInp.valorLocacao` recebe o aluguel do servidor quando o cliente mandou 0, e
isso também dispara o recálculo. Cotia depois das duas correções: **ROI +63,41% · yield 33,80%
a.a. · aluguel R$ 4.771/mês** (antes: −371,55% · 0,00% · R$ 0).

#### Classe A (`concluida` ≠ pronta) — onde mais aparecia

- **Gate do laudo (`gerar-laudo-viabilidade.js`) — o mesmo erro do toast, um relatório adiante.**
  O gate só perguntava `if (!dRow?.result)`. Mas o documental em `precisaDocumentos: true` **TEM**
  um `result` → passava, e o laudo era emitido sobre um documental que não leu documento nenhum
  ("risco não classificado, nenhum risco discriminado"). Somado ao toast anunciando "Pronto!"
  cedo demais, os dois defeitos se reforçavam: o cliente era convidado a pedir o laudo exatamente
  na janela errada. Agora o laudo exige os dois relatórios **entregues** — documental sem
  `precisaDocumentos` e mercadológico com `valorMercado > 0` e sem `mercadoVazio`. A mensagem
  passou a distinguir "ainda não gerado" de "gerado mas incompleto" (mandar "gere primeiro" para
  quem já gerou faz o cliente clicar de novo e queimar cota).
- **`resumoMercado` imprimia "Valor de mercado estimado: R$ 0"** para o laudo. Aconteceu de
  verdade em **31/07** (imóvel `1d117f3c`, sem `valorMercado` mas com preço/m² de R$ 10.049) e o
  laudo concluiu em cima disso. Agora escreve "NÃO ESTIMADO … não trate como zero, aponte como
  lacuna" — segunda barreira, porque relatório antigo reprocessado ainda pode chegar sem o campo.
- **`_arremate-aprendizado.js`** ingeria `valorMercado = 0` como previsão → previsto×realizado
  gravava −100% de desvio e envenenava a calibração que volta ao prompt de **todos** os
  relatórios daquela modalidade. Zero e `mercadoVazio` agora viram `null` (desconhecido, fora da
  média); idem o "veredito" de um laudo que era o aviso `precisaRelatorios`.
- **`Arrematados.jsx`** usava `?? null`, que cobre o campo AUSENTE mas não o ZERO: a tela
  calculava `lucro = 0 − arrematação` e exibia um prejuízo do tamanho do lance. Zero agora é "—".

#### O que auditei e está correto (não mexi)

`agendar-reuniao.js` (já checa `precisaDocumentos`/`precisaRelatorios`) · `MinhasAnalises.jsx`
(status geral, chips e o gate dos "3 prontos") · o painel de viabilidade da própria tela de
Análise (já mostra "Mercado não estimado" e "—" no lugar do ROI) · `score.js` (já trata 0 como
"não medido", com o comentário que virou a regra desta varredura) · cota do documental (os
caminhos de "faltam documentos" **estornam**) · `analise_viavel`/`score_financeiro` do catálogo
(deliberadamente não alimentados por dado do cliente, correção de segurança anterior).

**Deixei de propósito:** o passo "Mercadológico ✓" fica verde mesmo quando a pesquisa não estimou
valor. Bloquear ali faria a auto-sequência (`Analise.jsx:1109`) re-gerar em loop num endereço sem
mercado disponível. O conteúdo da tela já avisa "Mercado não estimado", o cron
`regenerar-relatorios-cron` re-tenta sozinho e o gate do laudo agora segura a consequência.

> ⏭️ **Próxima verificação:** gerar de novo os 3 relatórios deste mesmo imóvel de Cotia e conferir
> (a) que o toast do documental sai **uma vez só**, depois do OK, e (b) que o parecer e o laudo
> falam de ROI positivo e yield real. Checagem pelo banco:
> `select result->'mercado'->'__diagParecer'->'metricasRecalculadas' from analises_mercado where imovel_id='060eff88-badc-43ff-b11c-6b482da68b9b' order by updated_at desc limit 1;`
>
### 4. Remoção dos relatórios inválidos + cota devolvida (decisão do dono, 07/08)

**Removidos:** os 15 mercadológicos com ROI impossível **e** o único laudo derivado deles (Cotia,
`a67bee87`, reprovado indevidamente). Os 4 documentais dos mesmos imóveis **ficaram** — a análise
jurídica não depende do valor de mercado e estava correta.

**Backup antes de apagar:** `public.analises_removidas_roi_invalido_20260807` (16 linhas, `to_jsonb`
da linha inteira, RLS ligada e `revoke` de anon/authenticated). Reversível.

**O aprendizado das amostras é viável e foi 100% preservado** — a pergunta do dono. Motivos
verificados antes de apagar: (a) **não existe FK** de `indice_amostra` para `analises_mercado`, então
não há cascade; (b) `analise_id` é só proveniência — **nada no código faz join por ele** (só aparece
na migração que criou a coluna). Contagens antes → depois: `indice_amostra` **1.549 → 1.549**,
`indice_amostras` **1.380 → 1.380**, `agente_aprendizado` **164** intactos. As 241 amostras que
pendiam dessas análises continuam na base.

**Além de sobreviver, o aprendizado nunca esteve contaminado:** `agente_aprendizado.corpus` guarda
só FATOS DE PESQUISA (preço/m², aluguel médio, FipeZAP, desconto, avaliação) — nenhum ROI, lucro ou
capital. O defeito era do cálculo de viabilidade, que não entra no corpus.

**Cota devolvida.** Dos 15, **13 eram do próprio dono** (admin, cota ilimitada — nada a repor).
Dois eram de usuários reais:

| Usuário | Papel | Imóvel | Reposição |
|---|---|---|---|
| Alessandra de Jesus dos Santos | top2 | Carapicuíba, 23/07 | `bonus_mercado` +1 |
| Igor dos Santos Queiroz | explorador | Vila Velha, 06/07 | `bonus_mercado` +1 |

Por que bônus e não estorno do contador mensal: a consumida da Alessandra foi em **julho** e o mês
já virou (`analises_mes = 2026-08`), então `estornar_analise_por('mensal')` descontaria de análises
de AGOSTO, que são outras. O bônus é aditivo e garante a regeração sem gastar a cota do mês. Igor é
`explorador` e sua `amostra_mercado_usadas` já estava em 0 (alcance intacto) — o bônus vale como
reposição do relatório perdido. Ambos ficaram com `bonus_mercado = 1` e o evento
`cota_reposta_relatorio_invalido` no `atividade_log`.

> ✅ **Achado lateral, RESOLVIDO na conversa (07/08):** eu havia reportado que o banco concedia 15
> contra os 10 da apresentação, sugerindo config desatualizada. **Estava errado e me corrigi antes
> de mexer:** `limite_ia` já é 10 mercado / 10 documental / 3 índice; os 15 vêm de um ramo separado
> de `limite_ia_efetivo`, o `plano_legado = true`, que é *grandfathering* deliberado (15 + 5) e hoje
> atinge **2 assinantes Pro reais**. Ou seja, não havia nada a corrigir no plano vigente — a única
> coisa que a mudança faria era retirar benefício de pagante antigo. Levado ao dono, que decidiu
> **manter o grandfathering**. `plano_legado` não é atribuído a contas novas.

### 5. Varredura dos bugs mapeados nos últimos dias (`docs/VARREDURA_BUGS_2026-08-05.md`)

O dono pediu que os demais achados também não se repetissem. Dos 19 abertos, **14 foram fechados
hoje** (13 corrigidos + 1 falso positivo). Restam 5, listados no fim.

**Segurança (as duas mais graves da lista):**
- **`imovel_anexos_meu_arremate_delete` — policy REVOGADA** (migração
  `imovel_anexos_delete_autodeclarado_revogado.sql`, já aplicada). O arremate é AUTOCONSENTIDO
  (`sinalizar-arremate.js` grava a declaração do usuário sem verificar com o leiloeiro), e a policy
  dava DELETE nos anexos daquele imóvel a quem se declarasse arrematante — matrícula e edital em
  cache, arquivos COMPARTILHADOS que alimentam a documental de todos e os botões "Documentos do
  lote". Perda de dado cross-usuário a um clique, e recapturar PDF de fonte paga custa Bright Data.
  Havia 8 anexos nessa condição. O SELECT continua (o arrematante precisa ler); apagar segue com
  admin/analista, e a limpeza por retenção roda no service_role, que ignora RLS.
- **`verificar-pagamento.js` — IDOR fechado.** A checagem de dono era `if (asaasId && …)`: como todo
  Explorador grátis tem `asaas_id` null, ela era PULADA e bastava iterar `paymentId` para ler status
  e vencimento de cobranças de outros clientes. Agora a titularidade é sempre provada — pelo
  `asaas_id` ou, na sua ausência, pelo e-mail/CPF do customer da própria cobrança (novo
  `getCpfById` em `_auth.js`). Sem igualdade, 403. Vale para avulso e assinatura.

**Falso sucesso / escrita não verificada — a mesma família dos bugs de hoje:**
- `Checkout.jsx`: `?status=approved` na URL deixou de ser prova de pagamento. Antes, qualquer
  usuário logado que abrisse `?plano=clube&status=approved` via "Pagamento aprovado!", tinha um
  ACEITE gravado sem transação e era mandado ao fluxo de contrato. Agora só comemora depois de
  confirmar no servidor que o plano ficou ativo (~30s de tolerância para o webhook); não
  confirmando, cai na tela honesta "Pagamento em análise". (`refreshPerfil` passou a devolver o
  perfil lido — sem isso o Checkout não consegue decidir no mesmo tick.)
- `sinalizar-arremate.js`: devolvia `ok:true` sem checar o INSERT — "Arremate confirmado ✓" sem
  linha em `arrematados`. E é esse registro que PROTEGE os documentos da limpeza por retenção.
- `agendar-ciclo.js`: o PATCH de `ciclo_agendado` era `.catch(() => {})` — depois de já ter
  cancelado a renovação anual nos dois gateways. A falha silenciosa fazia o cliente PERDER o plano
  no vencimento em vez de migrar para a mensal. Agora 502 + auditLog.
- `marcar-posse.js`: seguia para rebaixar o role do cliente sem confirmar que a posse foi gravada.
- `monitor-dados-cron.js`: lia a RPC sem `r.ok` — o alarme de regressão de scraper se auto-silenciava
  justamente quando a medição quebrava.
- `monitor-fontes-cron.js`: marcava o alerta como enviado mesmo com o Resend fora, enterrando o
  aviso para sempre. Agora só grava o estado com HTTP ok; senão devolve `alerta_pendente`.
- `gerar-analise.js`: "Regerar" apagava o `result` no início e não restaurava em falha — o cliente
  ficava sem o relatório novo E sem o antigo. Agora o anterior é guardado e devolvido.

**Outros:**
- `juridico-lembretes-cron.js`: `juridico_escalado_admin` faltava no SELECT, então a escalação ao
  admin repetia todo dia útil, para sempre.
- `Arrematados.jsx`: o parse da revenda removia todo não-dígito — "R$ 320.000,00" virava R$ 32
  milhões. É o gabarito que calibra as estimativas futuras (o próprio texto da tela diz isso).
- `verificar-cpf.js`: roles `_anual` caíam fora da hierarquia e o assinante Pro ANUAL era orientado a
  "entrar e assinar o Pro".
- `leiloeiro-cadastro.js`: o link público (que nunca expira) reativava parceiro desativado pelo admin.
- `mp-webhook.js:365`: **falso positivo** — o guard `!contexto.servico` no ramo `refunded` já existia.

**Ficam em aberto (5):**

| Achado | Por que não fechei |
|---|---|
| 🟠 `juridico-lembretes-cron.js:148` — reatribuição grava antes do e-mail | Já tem plano desenhado (gravar em dois tempos + webhook do Resend). É refatoração de fluxo, não one-liner |
| 🟠 `Painel.jsx:447` — "Arrematei" com id local, fora do `sinalizar-arremate` | Já tem plano (matar o botão legado junto da unificação do arremate) |
| ⏳ `financiamento-alertas-cron.js:55` — lembrete de parcela sem idempotência | Precisa de coluna/tabela de estado por parcela |
| ⏳ `mp-webhook.js:294` — recarga sem entrega server-side | Precisa do caminho resiliente equivalente ao do plano anual |
| ⏳ `Login.jsx:338` — plano escolhido se perde após confirmar e-mail | Depende de decidir onde persistir a intenção entre dispositivos |

### 6. Achados da tarde de 07/08 (trazidos pelo dono, um por vez, com print)

Commits: `0df8282` · `427fc51` · `520355e` · `be0b2c7` (todos em `main`).

| # | Sintoma que o dono viu | Causa-raiz | Correção |
|---|---|---|---|
| a | "Expira em 31/07" num relatório gerado em 07/08 | O lote já tinha leilão encerrado; o relatório nascia com validade contada da data do leilão e a limpeza o apagava em seguida | `api/_leilao-encerrado.js` — gate ANTES da cota, nos dois geradores. Regra do dono: *"não vale pois já passou a data de arrematar"*. Considera `data_leilao` **e** `data_leilao_2` (só 1ª praça vencida é normal) e **falha aberta** sem data confiável |
| b | O filtro de raio se perdia ao reabrir o filtro salvo | O raio vivia em estado separado (`raioAtivo`/`raioKmAtivo`/`centroRaio`) e nunca era salvo junto do filtro — em **três** caminhos, não só ao reabrir | Raio passa a viajar dentro do filtro (`__raio: {km, centro}`), com restauração e persistência em sessão |
| c | "3 de 3 relatórios disponíveis" depois de gerar (Romualdo) | `consumir_analise_por` grava em `amostra_mercado_usadas` para o explorador, mas **os dois leitores** liam `analises_count` (a RPC `minhas_cotas` e o `Busca.jsx`, que consulta `perfis` direto) | Ambos passam a ler a coluna certa por papel; o rótulo deixou de prometer renovação mensal (a amostra é vitalícia) |
| d | *(não relatado — achado ao fechar o item b)* | O cron de alertas **ignorava em silêncio** três filtros salvos: `__raio` (filtro com raio e sem cidade virava busca NACIONAL), `pagamento` (11 dos 14 filtros salvos usam) e `intencao` | `condFiltro` cobre os três + caminho por raio via `buscar_por_raio_v2`; `pagCanon` traduz a chave do checkbox (`aVista`) para o valor do banco (`a_vista`) |

**Medição do item (d), no acervo real:** um filtro salvo de Resende/RJ pedindo só **Financiado**
casava **8 imóveis** no e-mail — e **zero** deles era financiado. O cliente recebia, toda segunda,
uma lista que a própria tela dele não mostraria.

**A classe que se repetiu três vezes no mesmo dia** (Índice · cota do explorador · filtros do
e-mail): **escritor e leitor discordando de onde o dado mora** — ou de que ele existe. Nenhum dos
três deu erro; todos devolveram um resultado plausível e errado. Ao criar campo/coluna nova, a
pergunta de rotina passa a ser: *"quem mais lê isto, e está lendo do mesmo lugar?"*

**Prevenção deixada no código:**
- `condFiltro` (em `enviar-alertas-cron.js`) marcado como ponto **obrigatório** ao criar filtro novo
  na Busca — junto de `aplicarFiltrosImoveis`, da RPC e de `api/busca-raio.js`. Filtro que o cron
  não conhece não dá erro: ele desaparece.
- `sbGet`/`rpc` do cron de alertas **pararam de engolir falha**: 400/500 viram log em vez de `[]`
  indistinguível de "não há imóveis" (mesmo padrão do "relatório vazio" do começo do dia).

**Fica em aberto:** filtros salvos ANTES de 07/08 não têm `__raio` — não dá para recuperar
retroativamente o círculo que o cliente havia desenhado. Quem quiser o raio no e-mail precisa
salvar o filtro de novo.

### 7. Fim do dia 07/08 — QR para o celular · leilão encerrado na TELA

Commits: `3ba1679` · `881281a` (`main`).

**a) "Continuar no celular" (QR code) — pedido do dono.** Quem abre a verificação de identidade
pelo computador agora tem um QR que leva SÓ o passo da foto para o telefone. Motivo: webcam de
desktop fotografa documento mal (quando existe), e era ali que o cliente parava.

O telefone **não recebe sessão**. O código do QR é permissão de **ENTREGA**, não de leitura:
128 bits, gravado só como **hash** (`captura_handoff`), TTL de 15 min, teto de 12 envios,
cancelado ao fechar o modal. A rota do celular apenas grava a foto no bucket privado e registra
em `usuario_docs`; quem pede a conferência é a sessão do desktop, agora com `selfie_do_acervo`.
O QR é desenhado no navegador (`qrcode-generator`) — mandar a URL para uma API externa de QR
seria entregar o código de acesso a um terceiro.
Ligado em: modal de KYC do parceiro e KYC do Perfil. **Fora por ora:** contrato por link e
convite de equipe — são páginas sem sessão (token de convite), não têm quem assine o código.

**b) Leilão encerrado na TELA (achado do dono: lote de Guarulhos).** O gate da manhã vivia só no
servidor; a tela seguia oferecendo os botões e o cliente só tomava o "não" depois de clicar.
Agora a regra é a mesma nos dois lados (`src/utils/leilaoEncerrado.js` espelha
`api/_leilao-encerrado.js`, com teste de paridade rodado).

**E o gate estava errado no outro sentido:** bloqueava **venda direta** por data vencida.
Medido: venda direta da Caixa é venda CONTÍNUA (15.516 ativos sem data; 1.674 com data de até 25
dias atrás, ainda na planilha de hoje). A regra antiga marcava **3.333** lotes como encerrados;
a nova marca **1.659** e **destrava 1.674** que estão à venda agora.

**Causa-raiz do lote sem data** (o que deixava o gate cego): `extrairDatasLeilao` DESCARTAVA
toda data anterior a ontem. Numa página que diz "Leilão encerrado em 22/07", nada era extraído,
o lote ficava sem data **para sempre**, e sem data o gate falha aberto — por decisão. Agora a
mais recente das datas passadas volta em `encerradaEm` (só quando não há NENHUMA data futura) e
os dois enriquecedores a registram. A fila do `enriquecer-datas-cron` passou a priorizar quem
não tem data nenhuma (~1.000 lotes; disputavam vez com 5.600 que só queriam o prazo).

O e-mail de oportunidades também deixou de mandar lote com leilão encerrado.

**Fica em aberto:** o lote exato do print (`e7bd0637`, Jardim Santo Expedito, WEBLEILOES) segue
**sem data nenhuma** no acervo e nunca foi enriquecido (`enriquecido_em` nulo). Ele é o primeiro
da nova fila — confirmar na próxima rodada se a página do leiloeiro entrega a data passada.

---

## ✅ COMEÇAR AQUI (06/08 — sessão 27: a correção de ontem tinha pegado só metade das rotas)

> Branch `claude/bid-pro-brasil-verificacoes-fkigq2` → **JÁ EM `main`** (fast-forward
> `0dbffe7..7e290ab`). Deploy `dpl_7d6LeFT8XWEALxx3KFvEKcWcn936` **READY**, produção,
> `lambdaRuntimeStats {"nodejs":96}`. `npm run build` OK · `auditoria_seguranca()`
> **0 crítico / 0 atenção** · captura: nenhuma fonte abaixo do piso aprendido.

### Diagnóstico de abertura

| Camada | Estado |
|---|---|
| Banco | 32.329 ativos · 19.721 atualizados em 24h · scraper diário rodando no horário |
| Deploy | READY, sem erro de runtime em 24h (só `DeprecationWarning` de `url.parse()` e `Failed to fetch` do gtag bloqueado por extensão do visitante) |
| Captura | Piso aprendido: nenhuma regressão. `CREPALDI` (0/falhou), `TOTALLEILOES` (9) e `VENDASGOV` (2) seguem idênticos há 4+ dias — estáveis, não é regressão nova |
| Segurança | 0 crítico / 0 atenção |

### As 5 validações combinadas para hoje (resultado)

| # | Item | Resultado |
|---|---|---|
| 1 | Re-verificação dos 16 achados | ⏳ **não iniciada** — é o próximo trabalho (ver "Próximo passo") |
| 2 | Lote do Rafael | 🔴 continuava no ponto genérico com `nivel='rua'` → virou o achado do dia; hoje rotulado `cidade` pelo gatilho novo e re-enfileirado |
| 3 | Drenagem do pino genérico | 🔴 fila drenava (3.519 → 2.803), mas **o vazamento estava ativo** — ver abaixo |
| 4 | Aluguel do Índice | ⏳ depende de abrir a tela; não dá para provar por SQL |
| 5 | Cache de documento | ⏳ `doc_extracoes` = 0, mas **nenhum relatório foi gerado desde o deploy** (último mercadológico 05/08 13:08). Inconclusivo — validar no 1º relatório que rodar |

### 🔴 O rótulo ainda mentia — em OUTRAS três rotas

A correção de 05/08 (`nivelNominatim`/`capNivel`) cobriu os retornos do **Nominatim**. A
conta não fechou na abertura: dos 3.415 lotes re-enfileirados, 631 já haviam sido
reprocessados e **399 voltaram rotulados `rua`/`endereco`** (324 deles ainda numa
coordenada compartilhada por logradouros diferentes) contra 232 com rótulo honesto.
Relapso de **51%**, e o cron de geocode roda **de hora em hora** — não era resíduo de
backlog, era vazamento ativo. As rotas que escaparam rotulavam pela INTENÇÃO:

1. **CEP — a origem real** (`_geo.js`, nível 1.5). Nem todo CEP é de logradouro: o "CEP
   geral" do município tem, por definição, a coordenada do município inteiro. Era o maior
   cluster do acervo — **17 logradouros de Altos/PI no mesmo ponto**, todos sem CEP no
   anúncio (o ViaCEP por bairro recupera o CEP geral da cidade). Agora o payload decide o
   teto: `street` → rua, `neighborhood` → bairro, nada → cidade. O mesmo teto vale para a
   rota do `postalcode` no Nominatim, cujo `addresstype: postcode` é neutro e não
   rebaixava sozinho.
2. **Google** (nível 0). `location_type` descreve a QUALIDADE do ponto, não O QUE foi
   casado: município casado como `locality` volta `GEOMETRIC_CENTER` → virava `rua`. Agora
   o `types` é o teto (`nivelGoogle`), e o `nivelReal` (centróide IBGE) passa a valer
   também nas rotas pagas. Hoje só afeta o on-demand (o cron roda `permitirPago:false`),
   mas era o mesmo buraco.
3. **LocationIQ** (nível 0.5, inerte sem `GEOCODER_KEY`). O catch-all `bairro` era otimista
   para o nó do município; passa pelo mesmo `nivelNominatim`.

**Rede de baixo — trava no BANCO** (`geocode_pino_generico_trava_de_escrita.sql`), que vale
para todo escritor (crons, scripts, correção manual, provedor que entrar amanhã): ao gravar
rótulo preciso numa coordenada que **outra via já ocupa**, o gatilho
`trg_zz_geocode_pino_generico` rebaixa para `cidade` **os dois lados** — o que entra e o
incumbente. Sem rebaixar o incumbente, o 1º lote de cada ponto genérico mentiria para
sempre (685 grupos = 685 mentiras remanescentes). O `zz_` no nome é de propósito: gatilho
BEFORE dispara em ordem alfabética e este precisa ver o endereço **depois** do
`trg_preservar_endereco`, que ainda o deriva do título.

**`via_normalizada()` — o que conta como "via diferente".** Tira acento, pontuação, prefixo
(`R.`/`Rua`/`Av`…) **e o número**. O número não sai só cortando na vírgula: metade dos
leiloeiros escreve `AVENIDA Dona Otília N. 606 Apto. 401, BL 07` — sem vírgula antes do
número — e sem tirá-lo dois apartamentos do MESMO prédio virariam "vias diferentes",
rebaixando o pino legítimo do edifício. O corte só vale para número no FIM, então
`Avenida 7 de Setembro` e `Rua 20` sobrevivem inteiros. A **detecção** passou a usar a mesma
normalização: o número do monitor media ruído antes (**324 → 232** só de trocar a régua), e
o limiar de 300 media junto.

**Resultado:** `geocode_pinos_genericos_total()` = **0** · 232 relapsos re-enfileirados
(carimbo `2026-08-06 11:37:18.686046+00`, use-o para medir a próxima rodada) · fila de
refazer 3.037 · gatilho provado no caso real do Rafael (rebaixou o lote E o vizinho
`zuk_36955-230524` que ocupava o mesmo ponto).

### 🔴 6) O Índice: a amostra nunca soube onde ela está

Gatilho: o dono achou no ZAP vários aluguéis em **Alphaville Industrial** (69 m² R$ 4.500 =
R$ 65/m²; 84 m² R$ 7.700 = R$ 92/m²; 165 m² R$ 12.500 = R$ 76/m²) enquanto o Índice do
condomínio Cauaxi mostrava **R$ 28/m²·mês ESTIMADO** e "Localidade 0 · Bairro 0".

**A pesquisa não era o problema.** As duas gerações de hoje (Brasília, do usuário
`valbeni.junior`) trouxeram **60 locações COM metragem** — apto R$ 45–86/m²·mês, por bairro:
Noroeste 18 (média 69), Asa Norte 10 (65), Asa Sul 2 (73), Sudoeste 4 (52). O ajuste do prompt
de 05/08 pegou. E para o endereço do Cauaxi **não houve pesquisa**: só 2 chamadas
`claude/web_search` hoje, as duas de Brasília — a tela leu a base de **julho**.

**O que estava quebrado eram duas metades que se escondiam:**

1. `montarAmostras` carimbava o **lat/lng do endereço CONSULTADO** em toda amostra. Prova:
   1.026 amostras com coordenada em apenas **39 pontos distintos** — as 39 consultas que já
   geraram índice. 85 anúncios de 4 bairros de Brasília no mesmo ponto.
2. A RPC `ingerir_amostras_indice` **recebia** `cep/endereco/condominio` e **não gravava** —
   não estavam na lista de colunas do insert. Por isso 0 das 155 amostras de hoje tinham
   endereço, apesar de o prompt pedir.

Somadas, desligavam o `indice-geocodificar-cron` nas duas pontas (ele seleciona
`lat is null and (cep|endereco|condominio) not null`): **`geocod_em` está NULO em 100% das
1.380 amostras, desde sempre**. O pipeline de triangulação existia inteiro e nunca rodou — o
recorte de 250 m/1 km era ficção.

**Corrigido:** a amostra nasce sem coordenada (quem tem âncora é triangulado pelo cron; quem só
tem bairro casa por texto, que já vale nível 1); a RPC grava a âncora + a coluna nova `url`
(link do anúncio — sem ele nada é auditável, e é por isso que os 129 anúncios de locação sem
área não podem ser recuperados, só recapturados); o prompt exige âncora e link;
`gerar-analise.js` só carimba a coordenada do alvo na amostra que a IA declarou dentro dos
250 m (o teto ali era 2 km — amostra a 1,8 km entrava como se fosse da mesma rua). Limpeza:
1.026 coordenadas falsas na base do índice + 249 na do relatório (9 pontos reivindicados por
bairros diferentes).

**ESCADA DO ALUGUEL.** Era binário: locação com metragem no recorte, ou regra de bolso de
0,4%/mês. O aluguel medido da MESMA cidade existia em outras duas bases e ninguém olhava —
Barueri tinha 5 locações a R$ 41/m² na base geolocalizada e dois bairros já medidos
(`cidade_indicadores`: Cruz Preta R$ 50,40/39 amostras, Jd. Tupanci R$ 39,44/51) enquanto a
tela mostrava R$ 28. Agora: recorte → base geolocalizada → bairros já medidos da cidade →
só então 0,4%, com a procedência escrita e o selo **MEDIDO NA CIDADE**. O Cauaxi passa a
**R$ 40,84** (5 anúncios).

⚠️ **Isso deixa o número honesto, não certo.** R$ 40,84 é Barueri; Alphaville Industrial é
R$ 65–92. O número certo só vem de **recaptura ancorada no bairro/condomínio** — apertar
"Gerar índice" no card do Cauaxi agora, com o coletor corrigido. Vale conferir depois se as
amostras novas trazem `endereco`/`url` preenchidos (era 0/155 antes).

**REGRA NOVA DO DONO (06/08): número inventado não entra.** *"Se não encontra, informa que não
localizou anúncios — fica melhor do que fazer um cálculo infundado."* A regra de bolso de
0,4%/mês sobre a venda foi removida de TODOS os caminhos: os três da consulta, o `indice-gerar`
(que a semeava em `cidade_indicadores` — o inventado virava "base própria" e voltava parecendo
mercado observado) e o `indice-mercado`. Sem anúncio, o campo vem vazio com o motivo e a tela
diz **"Não localizamos anúncios"**. Em **terreno** diz "não se aluga": o 0,4% sobre o preço do
lote produzia "locação de terreno a R$ 3/m²·mês", e a regra de 03/08 (lote não se aluga) agora
vale também na porta de entrada do banco (`semear_indice_relatorio`) — havia 1 linha semeada com
R$ 68,40 que foi zerada.

**BOTÃO DE PESQUISAR — sumia justamente quando era preciso.** Só existia com a região "não
mapeada"; bastava a CIDADE ter índice para ele desaparecer, e não havia como pedir a pesquisa do
endereço específico. O Cauaxi ficava preso na mediana de cidade, de julho, sem saída. Agora a
ação existe sempre e, quando o número na tela vem de um recorte mais largo que o endereço
consultado, o card explica que é por isso que o valor parece baixo e oferece **"Pesquisar este
endereço agora"**. Os cards por tipo passam a mostrar o **nível** de cada número.

Bug pré-existente achado no lint junto: `indice-gerar.js` roda em Edge e usava `res.status()` do
runtime Node no caminho de erro do limite — ReferenceError em vez de 503.

### 🔴 7) Uma pesquisa = um tipo (o "todos de uma vez" saiu)

Sequência do dia, toda medida: o dono apertou "Pesquisar este endereço agora" no Cauaxi em
modo **Todos os tipos** e a função morreu — `504 Vercel Runtime Timeout Error: Task timed out
after 250 seconds`. Como quem respondeu foi a plataforma (página de erro em TEXTO), a tela
quebrou com `Unexpected token 'A', "An error o"... is not valid JSON`.

**Duas causas, uma delas minha:**
1. O `retries: 1` que eu tinha acabado de pôr na tentativa ampla permitia que ela sozinha
   consumisse 150s + backoff + 150s ≈ 300s — acima do teto de 250s. Antes eram 150 + 80 = 230s,
   que cabia apertado. Removido; quem faz o papel de retry é a 2ª tentativa, agora orçada.
2. O modo "4 tipos numa busca" é insustentável por desenho: os quatro dividem o **mesmo** teto
   de saída e as **mesmas** 8 buscas. Contraprova do mesmo dia: tipo único concluiu em **97s e
   131s** trazendo **70 e 85 amostras** — para um tipo cada.

**Tempo de execução (medido, não estimado):** pesquisa de tipo único = **1min40 a 2min10**.
Teto da função = 250s. O log agora registra a duração real de toda pesquisa, sucesso e falha —
antes a única duração observável era a das que estouravam.

**Correções:** orçamento de tempo explícito (225s, com a 1ª tentativa limitada a 120s e proibida
de invadir os 90s reservados para a 2ª, que só começa se sobrar tempo real); o servidor
**recusa** `tipo: 'todos'` (400 com instrução — recusado no servidor, não só escondido na tela);
a tela mantém "Todos os tipos" como CONSULTA mas a geração vira **um botão por tipo**; e o
`r.json()` às cegas da tela virou parse defensivo (resposta não-JSON deixa de virar mensagem de
motor). Ganho de lado: falha em um tipo não derruba mais os outros três.

⚠️ **O cron de reforço (`indice-reforco-cron`) está DESLIGADO de propósito** —
`INDICE_REFORCO !== '1'`, decisão de custo (~US$300/mês proativo). `indice_reforco_estado` vazio
é o esperado. Se um dia for ligado, precisa da mesma quebra por tipo: hoje ele pede os 4 numa
tacada, com 3 cidades em paralelo na mesma invocação.

### 🔴 8) Mercadológico: documento ANTES da busca, e uma busca por tipo

Mesmo raciocínio do item 7, aplicado ao relatório. Duas mudanças de **ordem** e de **foco**:

1. **Metragem antes da busca.** A matrícula era colhida DEPOIS da pesquisa e só corrigia o R$/m²
   no fim — mas a busca já tinha ido atrás de comparáveis do **tamanho errado**, o do anúncio.
   Agora a leitura determinística (regex sobre o PDF, cache-first, sem IA) é colhida ANTES e a
   área confirmada entra no prompt. Área de terreno idem. Documento que não abre a tempo: segue
   com a área do anúncio e o bloco de correção posterior continua valendo como rede.
   ⚠️ Detalhe que quase virou bug: a divergência anúncio×matrícula passou a ser medida contra a
   área **anunciada**, capturada antes da sobrescrita — senão viraria matrícula×matrícula e o
   aviso ao cliente nunca mais dispararia.
2. **Uma busca = um tipo.** Saiu do prompt a "colheita de outras tipologias" (pedia à IA para
   listar de quebra ~12 comparáveis de cada um dos outros 3 segmentos). Era grátis, mas dividia
   atenção e espaço de resposta com o tipo que o cliente contratou. A colheita do MESMO tipo em
   outros bairros (`outrosBairros`) fica — amplia a geografia sem diluir o tipo.

O que **ainda não** é lido do documento: o **tipo** do imóvel. Os extratores determinísticos dão
área privativa/total/terreno e número da matrícula, não a natureza do bem. Classificar o tipo pelo
documento exigiria leitura por IA (o doc-scan por visão do documental já faz isso e poderia
publicar o campo) — próximo passo se o dono quiser.

### 🔴 9) O que o edital diz de CUSTO passa a entrar na projeção (e o condomínio, na busca)

Continuação direta do item 8, pedida pelo dono no mesmo dia: *"caso a comissão mude, que pode
acontecer, e caso haja alguma taxa administrativa, caso haja um informe de quanto é o IPTU, o
condomínio, tudo isso dá pra incluir no relatório e auxiliar nas projeções. Também permite pegar
o nome do condomínio, ou do imóvel de rua, e consultar o bairro para classificar o tipo e
padrão."*

**Estado antes.** Da leitura do edital só a **comissão** já saía estruturada (`comissaoPct`, em
`extrairPagamentoTexto`) — e ficava parada: nada dela chegava aos campos da viabilidade. Taxa
administrativa, IPTU e condomínio **não eram lidos em lugar nenhum** do mercadológico; os campos
existiam na conta (`calculos.js` já tem `taxaAdministrativaPercentual`, `despesasAdministrativas`,
`iptuMensal`, `condominioMensal`) mas só eram preenchidos **à mão** ou pelo relatório
**documental**, que roda DEPOIS. Ou seja: o ROI do mercadológico era calculado sobre a premissa
da tela (leiloeiro 5%, taxa adm. 0, carrego 0) mesmo quando o documento dizia outra coisa.

**O que passou a ser lido** (`extrairCustosTexto`, determinístico, custo zero, no mesmo texto que
já era baixado — sem chamada de IA e sem custo novo):

| Campo | Vai para |
|---|---|
| `taxaAdmPct` · `despesasAdm` | Taxa administrativa (%) e despesas fixas da viabilidade |
| `iptuMensal` / `iptuAnual` | Carrego mensal (o anual entra dividido por 12) |
| `condominioMensal` | Carrego mensal |
| `iptuDebito` · `condominioDebito` | **Não entram sozinhos** — quem assume depende de cláusula do edital; a tela mostra e manda confirmar |
| `comissaoPct` (já existia) | Taxa do leiloeiro — o edital **sobrescreve** o padrão de 5% |

A separação **carrego × débito em aberto** é a parte que não podia sair errada: um débito de IPTU
de R$ 12 mil lido como "IPTU mensal" destruiria o fluxo de caixa. A classificação lê as duas
janelas (antes e depois da âncora), cada uma parando na fronteira da frase — sem isso,
`"...exercícios anteriores. O IPTU anual é de R$ 4.200"` contaminava a frase seguinte e o IPTU
corrente virava débito. E o trecho entre a âncora e o `R$` é filtrado por ruído: `"Casa no
Condomínio Village, avaliada em R$ 80.000"` **não** vira cota condominial de R$ 80 mil.

**Identidade → busca** (`extrairIdentidadeTexto`): nome do condomínio/empreendimento, logradouro
e bairro. O nome do condomínio é a **âncora Nível 1** da pesquisa (comparável do mesmo prédio vale
mais que qualquer média de bairro) e é o que sustenta a classificação de **tipo e padrão**, que o
prompt já pedia (`consolidado.padraoImovel`) sem ter o nome na mão — a maioria dos leiloeiros não
publica `nomecondominio`. Logradouro/bairro só entram quando o endereço ainda está genérico: a
página do leiloeiro continua sendo a fonte de verdade quando ela diz alguma coisa.

**Ordem e orçamento.** As duas leituras (matrícula e edital) já disparavam em paralelo no início;
agora são colhidas juntas dentro de **um** limite comum de ~16s antes da busca — esperar uma
depois da outra dobraria a espera. O que não chegar a tempo continua sendo colhido depois, como
antes, e o relatório nunca fica bloqueado por documento que não abre.

**Onde o cliente vê.** (a) aviso verde *"Projeção ajustada pelo edital"* listando o que foi
aplicado; (b) o card "Condições lidas no edital" ganhou os custos declarados, o bloco laranja de
débitos em aberto e o empreendimento usado como âncora; (c) o parecer recebe os números do
documento com instrução explícita de **avisar quando divergirem** do que sustentou as projeções e
estimar o impacto. Campo já preenchido pelo usuário é respeitado; o único que o edital sobrescreve
é a comissão, porque ali o documento é a fonte de verdade e os 5% são só o padrão do sistema.

⚠️ **Ainda não provado em produção:** `doc_extracoes` seguia em 0 linhas — nenhum relatório rodou
desde o deploy de ontem. O 1º mercadológico de lote com edital em PDF valida de uma vez o cache de
documento (validação 5 da abertura), a metragem pré-busca (item 8) e estes custos. Conferir no
log: `[metragem-doc]`, `[identidade-doc]` e `condicoesEdital.custos` no `result`.

### 🔴 10) O que o documento diz passa a aparecer na FICHA, não só no relatório

Pedido do dono, na sequência do item 9: *"caso encontre nome de condomínio, despesas mensais, que
também apareça na tela do imóvel. Ao extrair a documentação, poder informar esses detalhes, pois
isso gera mais credibilidade ao visualizar a ficha de um imóvel."*

**O buraco.** Tudo do item 9 vivia DENTRO do relatório: quem abria a ficha do lote não via nada do
que o documento diz. E a coluna `nomecondominio` existe desde sempre, preenchida em **0 dos 33.484
lotes ativos** — nenhum leiloeiro publica esse campo; quem tem o nome do empreendimento é o
documento.

**Coluna nova `imoveis_leilao.doc_fatos`** (+ `doc_fatos_em`), gravada pela RPC
`registrar_doc_fatos` — MERGE atômico e **por campo**: edital e matrícula se COMPLETAM (o edital
costuma dar os custos, a matrícula dá o nome do empreendimento e o logradouro registral) e quem
roda por último não zera o que o outro achou; duas gerações simultâneas do mesmo lote não se
atropelam. Preenche `nomecondominio` quando está vazio, nunca por cima da fonte. Só service_role
grava; o cliente lê pela política pública que já existia.

**Dois pontos de gravação, e o segundo é o que escala:**
1. `_edital-extrato.js` — todo caminho que lê documento (mercadológico, laudo, o que vier) publica
   só de rodar. Edital que **não pertence ao lote** não publica: dado errado com selo de
   "confirmado no documento" é pior que ausente.
2. `scripts/captura-documentos.mjs` — o PDF já está em memória na captura; ler o texto e aplicar
   os mesmos extratores custa milissegundos e **zero em API**. Sem isso, só o lote de quem gerou
   relatório teria ficha enriquecida; com isso, todo lote que passa pela captura ganha sozinho.

**Na ficha:** card *"Confirmado na documentação"* com o imóvel na documentação (condomínio,
endereço registral, área privativa/terreno da matrícula, nº da matrícula), **despesas mensais**
(condomínio, IPTU), custos e condições da arrematação (comissão, taxa administrativa,
parcelamento, sinal, prazo) e — em bloco laranja separado — **débitos em aberto**, com o aviso de
que não são despesa mensal e que quem os assume depende de cláusula do edital. Ficha sem leitura
continua exatamente como era.

**Dois defeitos que só apareceram em PDF de verdade** (dois editais LJUD baixados e parseados no
teste — o resto do acervo respondeu 403 ao ambiente da sessão):
- **Comissão não saía em edital JUDICIAL.** A forma padrão deles é *"comissão do(a) leiloeiro(a) a
  título de 5%"* e *"Arbitro a comissão da Leiloeira em 6%"* — o vão entre a palavra e o
  percentual não casava com o padrão fechado anterior. Agora o vão é tolerante (≤70 chars) com
  teto de 20%, senão um "100% da avaliação" na mesma frase entraria como comissão.
- **Logradouro colhia lixo.** `Praça` + `[^.;,]{4,70}` produziu o logradouro
  `"Praça no (https://comunica"` a partir de *"Edital de Praça no (https://comunica.pje.jus.br/)"*.
  Agora nome de via e nome de condomínio usam a MESMA régua de nome próprio (token capitalizado,
  ligação só no meio, URL/parêntese cortam).
  ⚠️ Detalhe que quase passou: a lista de "não é nome" casava por PREFIXO, então `do` derrubava
  **"Dona Otília"**. Separada em duas listas — prefixo para flexão (`edilíci`, `localizad`),
  exata para palavra curta (`do`, `da`, `de`).

Resultado nos dois editais reais: `Edifício Evazo` · `Rua Gonçalves Maia` · `Boa Vista` · área
privativa 72,85 m² · matrícula 3757 · comissão 5%; e `Rua Otávio Francisco Caruso da Rocha` ·
comissão 6% · sinal 25% · caução 20%. Cobertura a acompanhar: `select * from doc_fatos_cobertura();`

### 💰 11) Quanto custa cada relatório — e o 3º nunca funcionou

Pergunta do dono: *"veja quanto custa em média cada relatório e índice. Também veja a
eficiência e necessidade do terceiro relatório de parecer final ou se é desnecessário."*

**Custo (medido, isolando dias de mix conhecido — câmbio R$ 5,40):**

| Produto | Motor | Custo | Base da medição |
|---|---|---|---|
| **Mercadológico** | Gemini grounding (2×) + parecer Claude | **US$ 0,12–0,16 · R$ 0,65–0,87** | 03/08: 5 gerações, zero documental, US$ 0,804 · 01/08: 2 gerações, US$ 0,237 |
| **Documental** | Claude com leitura de PDF por visão | **US$ 0,63–1,10 · R$ 3,40–5,95** | 04 e 05/08 (3 merc + 3 doc cada), descontando o mercadológico |
| **Laudo (3º)** | 1 passada Claude, sem busca | **≈ US$ 0,09 · R$ 0,50** | tokens do prompt; nunca isolado em dia limpo |
| **Índice (1 pesquisa, 1 tipo)** | **Claude web_search** | **US$ 0,54 · R$ 2,94** | 06/08 isolado: 2 pesquisas (85 e 70 amostras), US$ 1,088, nenhum relatório no dia |

**Pacote completo (3 relatórios) ≈ US$ 1,10 · R$ 5,95.**

⚠️ **O maior desalinhamento de custo do sistema:** o Índice custa **4× o mercadológico**
fazendo o MESMO tipo de trabalho. O mercadológico migrou para Gemini grounding
(US$ 0,035/busca, token barato); o Índice continua no Claude web_search (US$ 0,01/busca +
114 mil tokens de entrada por chamada, porque o resultado da busca volta para o contexto).
Migrar o Índice para o mesmo motor levaria US$ 0,54 → ~US$ 0,15. **Não fiz sozinho:** o dono
acabou de validar a qualidade das amostras do motor atual (60 locações reais em Brasília), e
trocar o motor de algo recém-aprovado é decisão dele, não minha.

**🔴 O 3º relatório não é desnecessário — ele NUNCA funcionou.** Os 4 laudos já emitidos
(21, 23, 30 e 31/07) são cascas **idênticas e vazias**: `veredito` = 'condicional' (o default
do código), `resumoExecutivo` vazio, 0 pontos fortes, 0 pontos de atenção, `controleQualidade`
null e `parecer` com **exatamente 358 caracteres** nos quatro — o tamanho do aviso de rodapé
sozinho. Nenhum deles tem uma linha de conteúdo.

**Causa:** `max_tokens: 4000` para um JSON com 8 campos, entre eles três listas de 3 a 6
tópicos e um parecer de SEIS seções. Não cabe. A resposta era cortada, o JSON ficava inválido,
`parseJSON` devolvia null e o `|| {}` transformava a falha em relatório em branco — gravado
como **'concluida'**, sem erro, sem rastro, e o self-heal nem olhava (status errado). O laudo
era o único dos três SEM a recuperação de JSON truncado que o documental tem desde sempre.

**Corrigido:** `max_tokens` 4000 → 12000 · recuperação de JSON truncado portada do documental ·
diagnóstico persistido (`stop`, `out_tokens`, `camposLidos`, `parecerLen`) · e a regra que já
valia no mercadológico agora vale aqui: **laudo vazio não é "concluída"** — vira erro, o cliente
recebe mensagem acionável e a regeração automática pega.

**Sobre manter ou não o 3º relatório: a decisão é do dono, agora com dados.** Ele é o mais
BARATO dos três (R$ 0,50, ~4% do pacote) e é o único que faz o que os outros dois não fazem:
cruzar mercado × jurídico, emitir veredito único e rodar controle de qualidade entre os dois
relatórios (confiança de cada um, contradições, lacunas). Também é o gate do agendamento com o
analista. Recomendação: manter e validar a correção com um laudo real — se depois disso ele
ainda não agregar, aí sim a discussão é de produto, não de bug.

**Instrumentação (o que faltava para nem precisar dessa arqueologia):** `geracao_custos` +
`registrar_geracao_custo()` gravam o custo REAL de CADA geração, com `ok=false` quando gastou
sem entregar. `uso_integracoes` agrega por provedor/DIA e mistura os produtos; o único ponto que
gravava custo por geração era `debitar_credito`, que só roda com a cota esgotada — e por isso
tem 0 linhas. Daqui pra frente: `select * from custo_por_geracao(30);`

**Bug tirado junto:** o painel de sustentabilidade aprendia o "custo por análise" de
`claude/web_search`, premissa que valia quando o mercadológico usava esse motor. Depois da
migração para o Gemini, o único consumidor de `claude/web_search` é o ÍNDICE — o painel media o
índice e chamava de análise, subestimando em ~4× o teto de "análises grátis que um Pro banca".
Agora aprende de `geracao_custos` filtrado por `funcao='mercadologico'`.

### 📉 12) A métrica de custo virou painel — e a cota cheia não fecha no preço

Três pedidos do dono, na mesma mensagem. Os três verificados:

**(a) Acompanhamento no tempo.** A tese do dono: *"à medida que reduz o esforço da busca na
internet, o custo cai, sendo basicamente leitura da documentação e comparativo com o que já
temos na base."* A tese é **testável** e agora tem régua: bloco **"📉 Custo por geração"** no
painel Custos & Uso (Admin), com média por produto nos últimos 30 dias e a **série mensal** dos
últimos 6 meses. O **desperdício** (gerações que gastaram e não entregaram) vem na mesma tabela
de propósito: sem ele, uma queda na média pode ser só falha barata disfarçada de eficiência.

**(b) 10 relatórios + 3 índices, quanto custa** — com os números medidos em 06/08:

| Item | Qtd | Unitário | Total |
|---|---|---|---|
| Mercadológico | 10 | R$ 0,76 | R$ 7,60 |
| Documental | 10 | R$ 4,65 | R$ 46,50 |
| Laudo (o 3º, se usado) | 10 | R$ 0,50 | R$ 5,00 |
| Índice | 3 | R$ 2,94 | R$ 8,82 |
| **Cota cheia** | | | **R$ 67,92** (faixa R$ 55–82) |

🔴 **A mensalidade é R$ 49,90.** Um assinante que use **tudo** a que tem direito custa
**R$ 62–82** de IA. O preço só fecha porque a utilização média é baixa — hoje 54 mercadológicos
e 16 documentais no total, entre 7 usuários. Quem carrega a conta é o **documental**: 68% do
custo da cota cheia, porque lê PDF por visão. É lá que mora a economia, não no mercadológico
(que já está em R$ 0,76). O painel mostra essa conta e fica **vermelho** quando a margem é
negativa — não é um número que se descobre depois.

**(c) A trava do documental EXISTE e está no servidor** (`api/gerar-documental.js`): documental
NOVO sem mercadológico concluído do mesmo (usuário, imóvel) recebe **409** com
`precisaMercado: true`. À prova de burla por API, não só escondida na tela. Isenta cron
(self-heal) e admin/analista gerando pelo cliente; não bloqueia REGERAÇÃO. Auditoria confirma:
**0 documentais órfãos** hoje (eram ~20 antes do gate).

**🔴 Achado colateral: 5 telas anunciavam 15 relatórios/mês, o plano entrega 10.** O 15 era o
limite ANTIGO, hoje preservado só para os **2 assinantes legados** (grandfather). `planos_config`
e a página de Planos já diziam 10; `App.jsx`, `HomeCliente.jsx`, `ProdutoLanding.jsx`,
`Calculadora.jsx` e `cursos.js` ficaram para trás — anunciando 15 e entregando 10. Corrigido nas
cinco. Fonte da verdade continua sendo `limite_ia` no banco: **10 mercadológicos · 10
documentais · 10 laudos · 3 índices** para top2/assessorado/clube.

### ✅ 13) Decisão do dono: cota fica em 10 + 3. E a economia estava ligada no motor errado

Decisão do dono, registrada: **não reduzir cota** — *"nem todo mundo gera todos os relatórios.
O ideal é manter em dez e três índices. Com as travas que fizemos vai facilitar o consumo, e à
medida que vai armazenando as informações mercadológicas captadas em cada busca, vai baratear
relatórios futuros."* Mantido: 10 mercadológicos · 10 documentais · 10 laudos · 3 índices.

**A premissa foi verificada. Vale para uma metade, não para as duas:**

✅ **Mercadológico — o mecanismo existe e já está acumulando.** `amostrasRegiaoCache` procura na
base própria amostras de venda da praça (bairro → grid → cidade) dos últimos 120 dias; com ≥8, o
relatório ancora na base e corta o orçamento de busca de 6 para 2. Hoje **13 das 36 praças (36%)
já têm densidade suficiente**, com 1.549 amostras em `indice_amostra` + 1.380 em
`indice_amostras`. Cada relatório e cada índice alimentam essa base — a tese está correta.

🔴 **Mas a economia estava LIGADA NO MOTOR ERRADO.** O `webUses` calculado pelo cache era passado
como `max_uses` da ferramenta do **Claude**. O motor primário é o **Gemini grounding** desde
30/07, e ele nunca via esse número: por mais densa que a base ficasse, o custo não caía. O
`google_search` do Gemini não tem parâmetro de teto, então o limite agora vai por **instrução no
prompt** ("faça no máximo N buscas; a base própria já cobre esta praça, use-a como fonte
principal e busque só para confirmar/atualizar"). É onde ele funciona nesse motor.

❌ **Documental NÃO barateia com a base** — e é 68% da cota cheia (R$ 46,50 de R$ 67,92). Ele não
consulta mercado: lê edital e matrícula. Nenhuma quantidade de amostras acumuladas muda o custo
dele. A tese do dono não se aplica aqui, e é aqui que está o dinheiro.

**Onde está a economia do documental (medindo antes de mexer).** Hoje **todo** PDF vai como bloco
`document` — leitura por VISÃO — mesmo quando o PDF tem camada de texto. Os dois editais reais que
parseei hoje tinham camada de texto (7.830 e 18.002 caracteres): como texto puro custariam ordens
de grandeza menos. Mas mexer na base de evidência de um relatório **jurídico** sem saber quanto do
acervo é convertível seria chute. Então: cada PDF lido pelo documental passa a ter a **camada de
texto medida** (pdf-parse local, custo zero) e o resultado vai no `meta` de `geracao_custos`
(`pdfs: [{tipo, chars}]`). Em poucos dias isso vira um número:
`select meta->'pdfs' from geracao_custos where funcao='documental';` — `chars` null = escaneado
(só visão resolve); `chars` alto = convertível. **Nada foi mudado na leitura ainda.**

### 💡 14) MODO BASE: o mercadológico que não pesquisa

Pedido do dono, fechando o raciocínio de custo: *"a leitura de documentos sempre vai consumir
IA, mas a parte mercadológica conseguiremos ter economia bastando pegar apenas os valores e
referências para apresentar no relatório, e fazer o cálculo para a unidade de acordo com a forma
de pagamento, mostrando a viabilidade."*

**Como funciona.** Quando a base própria já cobre a praça com **densidade** (≥12 amostras de
venda) e em **nível fino** (bairro ou grid), os comparáveis saem dela — anúncios REAIS já
capturados, com fonte e mês — e a **Etapa A (a busca cara) não roda**. As locações da mesma
praça vêm junto (mediana com ≥3 amostras; menos que isso fica sem número, pela regra de 06/08).
O que decide o relatório segue determinístico: R$/m² da base × área da **matrícula**, e a
viabilidade pela **forma de pagamento lida no edital**.

**Guardas, porque o barato não pode custar a credibilidade:**
- **Nível fino obrigatório.** Base de CIDADE é grossa demais para avaliar um imóvel específico —
  nesses casos a busca continua valendo.
- **Densidade maior que a de encurtar a busca** (12 contra 8): substituir a pesquisa exige mais
  evidência do que complementá-la.
- **Frescor de 120 dias** (já era regra do cache).
- **Não se auto-alimenta.** Em modo base o relatório NÃO regrava as amostras: reinserir o que
  veio da base faria a densidade crescer de si mesma, e a praça nunca mais sairia do modo base —
  congelando um retrato antigo como se fosse evidência nova.
- **Ciclo, não caminho sem volta.** Como não gera amostra, a praça envelhece, sai dos 120 dias e
  volta a pesquisar sozinha. A base se renova por construção.
- **O relatório DIZ de onde vem.** `fonteEstimativa: 'base_propria'`, comentário explícito e
  instrução ao parecer: comparável real de 2 meses atrás é honesto; apresentá-lo como anúncio
  ativo de hoje não seria.

**Terreno em modo base tinha um buraco que fechei junto:** sem a IA não há
`valorEstimadoImovel`, e o fallback existente só cobre bases por m² construído — um terreno
sairia SEM valor de mercado. Agora a conta é a do tipo: R$/m² de terreno da base × área de
terreno, com a margem conservadora de 10%.

**Prova com dado real** (Barueri / Jardim Tupanci / apartamento, 28 amostras de mai–jul/2026):
mediana **R$ 6.986/m²**, nível 1 com 12 amostras (R$ 6.164–7.500) e nível 2 com 16
(R$ 5.190–11.471); valor estimado para 70 m² = **R$ 440.118**. Coerente com a praça.

**Praças que já entram em modo base hoje:** Barueri/Jd. Tupanci (apartamento, 28) e Sorocaba/Vila
Haro (terreno, 16). Vai crescer a cada relatório e a cada índice.

**Referência citável:** `indice_amostra` ganhou `url`, `endereco` e `condominio`, e os prompts
passam a pedir o link em cada comparável. As 1.549 amostras antigas ficam com fonte + mês (a
coluna não existia quando foram capturadas); as novas nascem completas.

Desligar, se precisar: `MERCADO_MODO_BASE=0`. Ajustar a exigência: `MERCADO_BASE_MIN` (padrão 12).
A economia real aparece sozinha no painel **Custo por geração** — que é exatamente para isso.

### 📎 15) Nota metodológica no rodapé de tudo (o referenciamento de apresentação)

Pedido do dono: *"assim como funciona em apresentações fazendo o referenciamento, ter as letras
pequenas no rodapé dizendo a metodologia de pesquisa e de análise realizada, para resguardo das
informações em cima de um parecer. Isso vale para todos os relatórios e índices."*

Componente único (`src/components/NotaMetodologica.jsx`), na TELA e no PDF dos três relatórios e
do Índice. **A regra que faz isso valer alguma coisa: o rodapé é montado dos FATOS daquela
geração, não é texto fixo.** Rodapé que repete a mesma frase em todo relatório não resguarda
nada; resguarda o que BATE com o relatório acima dele. Então ele diz, conforme o caso:

- comparáveis de **pesquisa** (com a data) × da **base própria** (com o período) × do **Índice**
  (declarando que não é comparativo ao vivo) × **reaproveitados**;
- qual **área prevaleceu** (matrícula × anúncio) e a divergência quando houve;
- se o **edital foi lido** ou se as condições vieram do consenso aprendido do leiloeiro;
- mediana × média, descarte de anúncio de leilão, locação sem metragem fora da amostra;
- no documental: peças lidas, CNJ/DJEN/certidões que responderam, e o que **não** é automático
  (CNDT, CNIB, protesto);
- no laudo: é **síntese sem fonte nova**, e de que versão dos dois relatórios;
- no Índice: percentis das faixas, valor projetado quando é o caso, e por que o aluguel não sai.

Fecha com a ressalva fixa: **não é laudo NBR 14653 nem parecer jurídico**, não substitui vistoria,
leitura integral do edital/matrícula nem profissional habilitado.

Para os três relatórios e o Índice, os geradores passaram a publicar `metodologia` no result —
fatos estruturados, não frase pronta. Relatório emitido ANTES de 06/08 não tem esses fatos: o
rodapé mostra só a ressalva, nunca uma metodologia que não podemos comprovar.

**🔴 Bug encontrado ao fazer isso: a divergência de área nunca chegava ao cliente.** O
mercadológico calculava `divergenciaArea` (anúncio × matrícula), registrava a anomalia interna e
**a variável morria ali** — apesar de o comentário do bloco prometer "aviso EXPLÍCITO no
relatório". O cliente via a área da matrícula sem saber que o anúncio dizia outra coisa. Agora vai
no `result`, aparece no rodapé e no PDF.

### 🔴 16) O Índice falhou num endereço real — e a instrumentação de hoje entregou a causa

Teste do dono em 06/08: `Estrada de Ipanema, 2900 · Jardim Paula · Santana de Parnaíba/SP`, tipo
CASA. A tela mostrou **"A pesquisa de mercado falhou"**, caiu para a referência de CIDADE
(R$ 7.033/m² PROJETADO, 24 amostras) e o aluguel saiu como "não localizamos anúncios" — numa
região onde o dono sabe que **há oferta de locação**.

**A causa saiu no primeiro lugar em que olhei**, porque a medição de custo por geração entrou
hoje: `geracao_custos` já tinha a linha com `ok:false` e
`motivo: "rede/timeout: AbortError"`. O log confirmou: **200 segundos, as duas tentativas
abortadas**. Não foi falta de anúncio na região — foi a busca não voltar.

**Causa-raiz: o Índice era o único que ainda rodava no Claude web_search.** O mercadológico
migrou para o Gemini grounding em 30/07 e conclui em 60–90s; o Índice ficou para trás e paga por
isso duas vezes — **4× mais caro** (US$ 0,54 contra US$ 0,14, porque o resultado da busca volta
ao contexto: ~114 mil tokens de ENTRADA por chamada) e, agora, **sem concluir**.

**Corrigido:** o motor de grounding saiu de dentro do `gerar-analise.js` para `api/_grounding.js`
e passou a ser compartilhado. O Índice usa **Gemini primeiro** (80s) e mantém o **Claude como
fallback** — quem já funcionava não muda; o Índice ganha o caminho rápido. A cascata cabe no
orçamento: Gemini 80s → Claude 85s → Gemini compacto → Claude compacto, tudo dentro dos 225s.

**🔴 Bug encontrado junto — aluguel sumindo em silêncio.** O coletor só aceitava `aluguelM2`
entre 0 e 500. É comum o modelo devolver nesse campo o **aluguel CHEIO** (ex.: 4.500 em vez de
18/m²) — e a amostra caía fora **sem deixar rastro**, produzindo exatamente o "não localizamos
anúncios" numa região com oferta. Agora o prompt pede também `valorMensal`, e o R$/m² é
**recalculado por nós** quando o declarado é implausível ou falta. Teste com 4 amostras: antes
sobrava **1**, agora sobram **3** (a 4ª, sem área, segue descartada — sem área não há R$/m²).

**Precisão da métrica de custo:** `medirGemini` passou a DEVOLVER o custo, e os geradores o
somam em `geracao_custos`. Antes o acumulador só contava o Claude — com o mercadológico rodando
no Gemini, a maior parte do custo dele ficava de fora da própria métrica de custo.

### Próximo passo desta sessão

Re-verificação adversarial dos 16 achados de `docs/VARREDURA_BUGS_2026-08-05.md` marcados
**⏳ A VERIFICAR** — em lotes pequenos, persistindo o resultado a cada lote (o workflow de
ontem travou em 8/24 e levou o trabalho junto).

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

### 🟢 7) Marketing e usuários — a foto de 05/08 (o dono pediu no fim do dia)

**33 cadastros** no total (desde 16/06) · **10 nos últimos 7 dias** · 4 pagantes · 28
gratuitos. Conversão gratuito→pagante **12%**. **MRR real: ~R$100/mês** (2 assinantes Pro).
⚠️ **O `mp_pagamentos` engana**: dos R$3.963 "aprovados", R$3.813 são **SAÍDAS da conta MP
do dono** (17 cobranças da Anthropic, PIX) que o backfill puxou do extrato — receita de
assinatura é só **R$149,70**. Não leia esse total como faturamento.

**Google Ads** — campanha "Pesquisa — Leilão de Imóveis (BR)", 29/07 a 04/08: R$171,19
investidos, 1.698 impressões, 116 cliques, **CTR 6,8%** e **CPC R$1,48** (ambos bons),
**R$57 por cadastro**. 🔴 **Mas 0 conversões registradas em TODOS os dias** — e isso não é
falta de resultado, é **falta de sinal**: o código só envia conversão ao Google quando
alguém **paga** (`_webhook-core.js:176`); nenhum dos 5 usuários vindos do Ads assinou ainda.
O Google está otimizando às cegas. **O que resolve:** criar uma 2ª *conversion action* no
painel do Ads para o **cadastro** e passar o ID — a máquina já existe
(`enviarConversaoOffline`, `gclid` capturado e guardado por 90 dias). **Depende do dono.**
Segundo ponto: a ingestão de métricas **não tem cron** (só `meta-insights-cron` está
agendado) — por isso os dados param em 04/08. Agendar (é leitura, não gasta).

**Atribuição:** 85% dos cadastros (28 de 33) chegam **sem UTM** — ponto cego que impede
responder "de onde vem quem converte". Zero Meta/Facebook em toda a base. A **(-4) Search
Console** segue sendo a maior alavanca: as 33 mil páginas estão no ar e o orgânico nem
começou. ⚠️ **O "indicado por" está enganando:** quase toda a base aparece indicada pelo
admin (é o padrão quando não há código). As **únicas 2 indicações reais entre usuários**
são Jaqueline → Julio Garcia e Kaique → Arnaldo — conferir isso antes de calcular
comissionamento de rede.

**Gargalo é ATIVAÇÃO, não aquisição:** 60 relatórios gerados, mas por apenas **7 pessoas**
(21% da base). Metade não respondeu a triagem. Perfil de quem responde: 9 revenda, 4 uso
próprio, 3 locação; capital majoritariamente até R$150k.

### 🔴 6) CRÍTICO da varredura: serviço avulso suspendia plano de quem está em dia

`mp-webhook` monta `contexto.servico` para pagamento avulso (`metadata.tipo='servico'`:
recarga, assessoria, PIX de anuidade abandonado), mas **`processarRecusado` nem recebia o
campo**. O guard cobria só PRODUTO (`ehProdutoMp`). Assinante EM DIA que desistisse de um PIX
avulso era rebaixado a `explorador`, ganhava `inadimplente_desde`, `role_anterior`
sobrescrito e documentos agendados para expurgo LGPD. Corrigido na raiz + mesma lacuna
gêmea no ramo de REEMBOLSO. **Verificado no banco: nenhum cliente real atingido** — era
latente. `.claude/settings.json` (04/08) permitiu agendar sem atrito: heartbeat 06/08 13:30
UTC (`trig_0131…`) e Search Console 18/08 (`trig_013A…`).

### 🔴 8) Os 4 achados que o dono mandou resolver no fim do dia (deploy `4957768`)

- **"Se o cliente pagou, deve ter acesso"** (regra dele, textual). O Pro ANUAL via PIX
  gravava DUAS marcas de idempotência; falhando a ativação, só a específica caía e o
  reenvio do MP morria no guard da OUTRA — R$449,90 pagos e plano nunca ativado. Agora as
  duas caem. E, porque a regra não pode depender do webhook, o `reconciliar-assinaturas-cron`
  (horário) — que cobria só PREAPPROVAL — passa a varrer os pagamentos **avulsos** com
  `proposito='plano_anual'`. Verificado: nenhum cliente preso hoje.
- **E-mail é único por cadastro.** Com "Confirm email" ligado o Supabase NÃO dá erro para
  e-mail repetido (anti-enumeração: 200 + usuário fantasma + `identities: []` + nenhum
  e-mail enviado). O Checkout só checava `error` → dizia "Cadastro criado!" e o cliente
  esperava para sempre. Agora detecta `identities` vazio e manda para o login.
- **Convite de equipe com validade e uso único.** Uso único já existia; validade não —
  `expira_em is null` passava, então convite sem data **nunca expirava** (link de acesso
  privilegiado eterno). Agora NOT NULL default 7 dias, resgate atômico, e o RPC devolve o
  MOTIVO (inexistente/usado/expirado). O front só descarta o token com DESFECHO: falha
  transitória preserva, em vez de apagar o convite sem rastro. O `ConviteEquipe` deixou de
  chamar o RPC sem sessão (onde ele SEMPRE respondia "não autorizado" e a tela dava sucesso).
  ⚠️ **Não testável agora — ainda não há ninguém na equipe** (o dono avisou); validar no
  primeiro convite real.

### 🎓 As lições da sessão 26 (valem além dela)

1. **Bug de RÓTULO não aparece como erro — aparece como número plausível.** Cinco achados
   do dia são o mesmo padrão: nível `rua` num ponto de cidade, `órfão` num objeto ainda
   linkado, `explorador` em quem assinou assessoria, `mercado` numa regra de bolso,
   `Cadastro criado!` num cadastro que não houve. Onde houver **fallback silencioso**,
   procure o rótulo.
2. **Rotule a estimativa na origem, não na tela.** O aluguel do Índice era `venda × 0,4%`
   desde sempre; o fallback existia e estava até comentado — só não se anunciava. Fallback
   mudo vira dado falso no minuto em que alguém confia nele.
3. **Guard que cobre um caso irmão e esquece o outro é meio guard.** `ehProdutoMp` protegia
   produto e deixava serviço passar; `nivelReal` cobria 3 dos 8 retornos da cascata. Ao
   corrigir, varra TODOS os ramos equivalentes — os dois casos gêmeos apareceram assim.
4. **Idempotência precisa desfazer TUDO que marcou.** Marcar em dois lugares e limpar um só
   transforma retentativa em silêncio permanente — foi exatamente o que travou o Pro anual.
5. **Regra de negócio escrita em UM lugar não é regra.** "Terreno não se aluga" valia no
   `gerar-analise` e não no `_indice-core`; por lá entrou locação de terreno a R$3,50/m².
   Regra do dono tem que valer em todos os coletores.
6. **Número agregado sem procedência engana o dono.** O "faturamento" de R$3.963 era
   majoritariamente conta da Anthropic paga pela conta MP. Antes de reportar dinheiro,
   pergunte de onde cada linha veio.

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

---

## 🏠 RECON BACKLOG LEILOEIROS — consolidado 20/08 (SP Sindicato + BA JUCEB)

Varredura de recon (plataforma × imóvel-vs-veículo) sobre 69 domínios das duas listas
(Sindicato-SP + JUCEB-BA), via `recon-leiloeiros-backlog.yml` (Bright Data Web Unlocker),
16 levas de 4–5 domínios. **Atuamos SOMENTE com imóveis** — cada casa classificada por
veredito de conteúdo (imóvel/veículo/misto/indefinido) e por ALAVANCA de scraper.

### Placar
- **55 casas de imóveis integráveis** ao todo.
- **39 já cobertas por scraper que JÁ EXISTE** (só adicionar domínio/config — esforço ~zero).
- **16 exigem scraper novo** (independentes) — mas leffa+oscar compartilham plataforma, então ~14 famílias.
- **3 em recon profundo** (SPA "Carregando…", exigem puppeteer): cunhaleiloeiro, albertomacedo, gaialeiloes.
- **19 descartadas**: 5 veículo-predominante + 14 vazias/estacionadas/404/indefinido-final.

### INTEGRAR via scraper EXISTENTE (39 casas — prioridade 1, ganho barato)
- **Vlance** (`scripts/scraper_vlance.py` — multi-tenant, só add domínio em `TENANTS_PADRAO`) — **14 casas**:
  crisleiloes, franklinleiloes, impactoleiloes, zallileiloes, fernandoleiloeiro, teza, destakleiloes,
  agsleiloes, emiliomatosleiloes (⭐ acervo enorme), falleirosleiloes, jonasleiloeiro, lucasleiloeiro,
  positivoleiloes, silvaleiloes.
- **SOLEON** (`soleon.s3`, trilha `/lotes/search?tipo=imovel`) — **15 casas**:
  lanceja, ricoleiloes, leiloesgold, tmleiloes, wspleiloes, lanceleiloes, centraldosleiloes,
  clicleiloes (SCHMITZ), cravoleiloes, danielgarcialeiloes, hastaleiloes, isabelleiloes,
  kcleiloes (58 imóveis), patiorochaleiloes, rafaelaribeiroleiloes.
- **SUPORTE white-label** (já raspamos) — **3 casas, ~2.322 imóveis**:
  leilaobrasil (1.786!), vecchileiloes (463, fazendas GO), saraivaleiloes (73). ⭐⭐ maior ganho isolado.
- **SODRÉ/SUPERBID rede** (já raspamos) — **4 casas**: alexandridis, rmoyses, bezerraleiloes, hoppeleiloes.
- **Cluster GESTAO** (`d335luupugsy2.cloudfront`, a CONFIRMAR no recon profundo) — **3 casas**:
  vipleiloes, milanleiloes, centraljudicial.

### INTEGRAR via scraper NOVO (independentes — 16 casas)
Ordenar por volume: **leffaleiloes (124)** + **oscarleiloes (28)** = plataforma **"LeilãoPro Core"**
(`/leilaoprocore/js/`, `/leilao/lotes/imoveis`) → **1 scraper cobre os dois** (nova alavanca);
**nordesteleiloes (115, Next.js SPA — precisa recon runtime)**; **jussiaraleiloes (91, TRT5-BA)**;
**hastaleilao / Flávio Costa (83, TJPE)**; **alfaleiloes (34, 100% imóvel)**; lancecertoleiloes (24, ASP.NET);
leilaoonline.net; hatoryleiloes; leiloeiroeduardo (socket.io); damasioleiloes; bastonleiloes;
sumareleiloes (Laravel); kronbergleiloes (WordPress+wpcasa); palaciodosleiloes (8); aguialeiloes (baixa prio).

### DESCARTAR (19)
- **Veículo-predominante**: conceitoleiloes, ccjleiloes, celsocunhaleiloes, focoleiloes, guariglialeiloes.
- **Vazio / estacionado / 404 / indefinido-final**: arremateleilao, 3rleiloes, carrollruralleiloes (agro),
  dgleiloes, franciscofreitasleiloes, hleiloes, jocaleiloesagro (agro), lamurleiloes, leiloescostaesilva,
  lopesleiloes, lubreleiloes, marcoantonioleiloeiro (parking), mikedutraleiloeiro, msoleiloes (404).

### Próximos passos sugeridos (não executados — decisão do dono)
1. **Barato primeiro**: adicionar os 14 domínios Vlance + confirmar SOLEON/SUPORTE/SODRÉ já cobrem as 39.
2. **Confirmar cluster GESTAO** (vip/milan/centraljudicial) no recon profundo do scraper-gestao.
3. **Scraper novo** por ordem de acervo: LeilãoPro Core (leffa+oscar), Nordeste (SPA), Jussiara, Flávio Costa, Alfa.
4. **Recon profundo puppeteer** nos 3 "Carregando…": cunha, albertomacedo, gaia.

### ⚠️ CORREÇÃO 20/08 (validação) — Vlance por fingerprint NÃO é ganho barato
Testei somar os 13 tenants "Vlance" ao `scraper_vlance.py` e rodei coleta (dryrun, run
32354774514). **Todos os 13 voltaram 0 lote.** O fingerprint de HTML batia
(`/Core/V1/js/Ajax/Ajax_Leiloes*.js`), mas os endpoints `/core/api/get-leiloes` e
`/core/api/get-lotes` respondem NÃO-JSON ("Expecting value: line 1 column 1") — outra
versão da API Vlance e/ou o desafio Cloudflare (vários marcados "(challenge)"/cloudflare:true)
devolvendo HTML. Pior: os 13 gastaram ~16 dos 20 min do job em Bright Data falhando em loop.
**Revertido** (commit 1b15ae7); voltou aos 7 tenants que funcionam (38 imóveis). Lição: os
"14 Vlance" do placar acima NÃO são plug-and-play — cada um precisa do endpoint mapeado no
navegador (grampo fetch/XHR, ver RECON_LEILOEIROS_PLAYBOOK.md) antes de reintegrar. Reclassificar
esses 13 de "scraper existente" para "recon runtime pendente".

### 🔎 emiliomatos NÃO é Vlance — é Superbid/MBV (recon runtime 20/08)
Recon dos bundles Vite (run 32357329191, `scripts/recon-emiliomatos.mjs`) mostrou que
emiliomatosleiloes.com.br é **plataforma Superbid/MBV**, não Vlance — o fingerprint "Vlance"
do recon de backlog foi FALSO POSITIVO (a string estava no HTML, mas a API é outra; por isso
`/core/api/get-lotes` deu 0). Assinaturas Superbid/MBV: `mbv-live-default-rtdb.firebaseio.com`
(lances ao vivo), rotas `/busca/segmento/<seg>`, `/busca/redeColaborativa/<rede>`,
`/busca/categoriaEvento/<cat>`, slugs de lote `/imoveis/<tipo>/<slug>-<ID>`. Site é **SSR**
(home = 2,5 MB de HTML com os lotes embutidos), então dá para raspar por HTML sem engenharia
reversa de JSON.
- **Endpoint de listagem (imóveis só):** `https://emiliomatosleiloes.com.br/busca/segmento/imoveis`
- Config: `/api/config`. Favoritos: `/busca-favoritos`.
- Já temos tooling da família: `scripts/recon-sodre-*.mjs`, `captura-docs-sodre.mjs` (Sodré é rede Superbid).
- **LIÇÃO:** fingerprint de HTML ≠ contrato de API. Antes de somar tenant "Vlance" por HTML,
  validar o endpoint runtime (o recon-emiliomatos*.mjs é o modelo).

---

## ✅ EMILIOMATOS integrado + lições da integração (20/08)

### Evolução
- **emiliomatos** (recon dizia "Vlance" no backlog) era **Superbid/MBV (SSR)**. Integrado do zero:
  `scripts/scraper-emiliomatos.mjs` + `scripts/lib/emiliomatos-parse.mjs` (parser puro, compartilhado
  entre validação e produção) + `.github/workflows/scraper-emiliomatos.yml` (cron quarta 10h40 UTC +
  dispatch, freio residencial 7d) + migração `brightdata_reserva_emiliomatos.sql` (proposito registrado).
- **37 imóveis vivos** gravados (`fonte=EMILIOMATOS`): 100% cidade/UF/valor/foto, praça 2026, 10 estados.
  Enumeração `/busca/segmento/imoveis?page=N` (30/pág), lote `/imoveis/<tipo>/<slug>-<ID>`.
- `leiloeiro_conhecimento` (EMILIOMATOS) atualizado. Cota Bright Data: bump temporário 550→620 p/ o
  grava (gastou 68 req), **restaurado a 550** (freio de volta).

### ⚠️ Erros que ocorreram nesta integração — REVISAR p/ não repetir
Todos foram pegos ANTES de sujar o acervo, pela regra "validar cada campo num lote real antes de gravar":
1. **Fingerprint de HTML ≠ contrato de API.** 13 "Vlance" somados por fingerprint (`Ajax_Leiloes.js`)
   voltaram **0 lote** — os endpoints `/core/api/get-lotes` não respondiam. Revertidos. **Antes de somar
   tenant por HTML, validar o endpoint runtime** (dryrun conta > 0).
2. **Preço por RÓTULO, não por max/min.** O detalhe Superbid/MBV lista `OFERTA INICIAL` (lance/praça) +
   `Entrada`/`Parcela` (plano de pagamento). O parser genérico pegaria uma **parcela** como valor_minimo
   → desconto falso de ~98%. Fix: valor só de `OFERTA INICIAL` (avaliação=maior, mínimo=menor).
3. **Cidade do IMÓVEL ≠ foro.** `cidadeUF` pegava "Comarca de Brasília/DF" (foro) no corpo. Fix: título
   primeiro, depois descrição, depois **âncora no lote** (`Cidade/UF` seguida de "Lote/Leilão"), ignorando
   o endereço do leiloeiro. (1 linha já gravada corrigida na mão: emiliomatos_98857 → Três Corações/MG.)
4. **Status por DATA, não por rótulo.** `estaEncerrado` marcava lote com 2ª praça em 08/09/2026 como
   morto porque a 1ª dizia "Praça Encerrada". Fix: se há praça FUTURA, está vivo; só morto se todas as
   datas são passadas (ou arrematado/deserto). Sem isso, ingeriria zero (ou leilão morto).

### Erros de runtime abertos (não desta sessão — vigiar)
- `/checkout` "Failed to fetch" · 4 ocorrências · última 17/08 (nenhuma desde). Investigar se é rede do
  cliente ou chamada MP/Asaas client-side falhando.
- `/imovel/:id` "Cannot read properties of null (reading 'id')" · 1 · última 13/08. Null-deref na ficha.

### Recon BA+SP — DIGERIDO
69 domínios (23 SP Sindicato + 46 BA JUCEB), 16 levas, fila zerada, consolidado no bloco "RECON BACKLOG
LEILOEIROS" acima: 55 imóveis integráveis (39 por scraper existente + 16 scraper novo), 19 descartes.

### 💰 Pendência COMERCIAL — 1 venda Top2 presa no bloqueador (20/08)
1 cliente (Explorador desde 05/08, com código de indicação) tentou assinar o **Top2 4×**
entre 06 e 17/08 e tomou "Failed to fetch" toda vez — bloqueador de anúncios/extensão
barrando o Mercado Pago. **Causa de código já corrigida** (18/08 + commit 20/08: mensagem
amigável + plano B por link). Falta o **contato comercial**: mandar o link de pagamento
Asaas direto (não depende de SDK/cartão no browser) para fechar a venda. Dados do cliente
(nome/e-mail/tel) e texto de abordagem estão no chat da sessão / no banco (user_id em
`erros_cliente`/`perfis`) — NÃO reproduzidos aqui porque o repo é PÚBLICO (PII). Ação do dono.

### 🔁 Troca de gateway agora é PARTE DO FLUXO no visitante (20/08, pedido do dono)
O fluxo logado já caía MP→Asaas sozinho (`gerarLink`→`pagarAsaas`). Faltava no fluxo VISITANTE
(`assinarComCadastro`, cria conta + paga por cartão): quando o SDK/cartão do MP é barrado por
bloqueador, agora **recupera automático** — cria a conta (explorador) e gera o link Asaas
(bancário, não depende de SDK), abrindo em nova aba. Só dispara quando a falha é ANTES da
cobrança (SDK/fetch bloqueado) → sem risco de duplo-mandato. Se a recuperação falhar, mensagem
amigável (desativar bloqueador / responder o e-mail p/ link direto). `src/pages/Checkout.jsx`
`recuperarVisitanteComAsaas`. ⚠️ Testar no navegador com um pagamento real antes de confiar 100%.

---

## ✅ Follow-ups de código revisados sequencialmente (20/08, tarde)
Pedido do dono: "pegue o edital PDF da ZUK, resolva os outros sequencialmente e dê feedback".
Ao investigar, dois dos quatro itens já estavam FEITOS (a nota estava velha) e um tinha premissa
errada — a disciplina do "isto está feito de verdade?" evitou trabalho inerte:

1. **ZUK edital PDF — JÁ FEITO e rodando (não era pendência).** A captura vive em
   `enriquecerDatasZuk` (`scripts/scraper-puppeteer.mjs:1133`) desde o recon de 18/07: na
   re-visita da página do lote (que já roda p/ pegar a DATA, custo zero), o `<a>` "Edital de
   venda" → PDF em `documentacaoleilao.portalzuk.com.br` é gravado em `anexos` (tipo=edital),
   sem tocar em `link_edital`. **Verificado no acervo:** de 1.020 ZUK ativos, **827 têm o PDF
   real** (81%) e 878 têm anexo de edital. Coberto.
2. **ZUK metragem útil/privativa — JÁ FEITO (mesma visita).** `scraper-puppeteer.mjs:1128`
   lê "Metragem útil" (privativa) e cai p/ "Metragem total" só na falta — 705/1.020 com área.
   Era a correção que impedia o mercado de SUPERESTIMAR (área total infla, subestima R$/m²).
3. **Mercado gravar `regen_motivo` — NÃO plugado de propósito; resolvido pelo lado certo.**
   A premissa da nota era errada: o mercado **não** usa `regen_motivo`. Sua regeneração roda
   por loops DEDICADOS e mais específicos no `regenerar-relatorios-cron` (`mercadoVazio`,
   `parecer` vazio, timeout), e o mercado **não está** no laço genérico `AGENTES`. Plugar
   `vicioRegen` no upsert seria **inerte** (nenhum loop leria) e ainda **enganoso**:
   `vicioRegen` inclui `avaliacao_ausente`/`minimo_ausente`, que no mercado não têm
   backfill→regeneração — apareceriam como "pendente" para sempre, um número que nunca drena
   (o anti-padrão "contar não é validar"). **O que o dono queria de fato** — o moderador
   supervisionar o mercado também — foi feito lendo o sinal REAL da auto-cura:
   migração `moderador_supervisao_mercado.sql` adiciona `aprendizado:regen:mercado` contando
   `mercadoVazio`/`parecer vazio`/timeout sob o teto de tentativas. Como lê o sinal que dispara
   a cura, **drena sozinho** quando a fonte volta. Hoje: 0 em auto-cura (pipeline saudável).
4. **16 leiloeiros "scraper novo" — é PROGRAMA, não follow-up.** Cada família exige recon
   runtime (Bright Data no Actions) + parser + validação campo-a-campo antes de gravar (o
   processo do emiliomatos). **Não dá p/ avançar do sandbox** (o proxy do agente bloqueia os
   hosts de leiloeiro — 403; recon de produção roda no Actions/BD). Melhor próxima alavanca,
   pela ordem de acervo: **LeilãoPro Core = leffaleiloes (124) + oscarleiloes (28) = 152
   imóveis, 1 scraper cobre os dois** (`/leilaoprocore/js/`, `/leilao/lotes/imoveis`). Fica
   como próximo trabalho focado, com o aval do dono para o gasto de BD (emiliomatos custou ~68 req).

---

## ✅ Sessão 20/08 (tarde) — 3 ajustes de UX + LEILAOPRO integrado (item 4)

### UX (deploy em produção)
1. **Índice sem "Todos os tipos"** (`IndiceConsulta.jsx`): consultar os 4 tipos de uma vez
   misturava preço/m² e amostragem distintos e confundia a triagem. Agora uma consulta = um
   tipo (a geração já era 1-por-vez desde 06/08). Default: apartamento.
2. **Área de Membros sem flash de zeros** (`Membros.jsx`): o Hero mostrava "0 Aulas · 0 Cursos
   · 0 eBooks" por um instante até o fetch resolver (parecia bug). Novo estado `carregando`
   pinta "—" no lugar dos zeros e neutraliza o subtítulo até os dados chegarem.
3. **Acervo público no padrão da Busca** (`api/publico.js`, SSR): o cartão do acervo aberto
   (sem login) agora espelha o cartão da tela de Busca logada — selo de desconto graduado na
   foto, chips de tipo/modalidade, R$/m², selos de Edital/Matrícula, data da praça e o par
   Lance mínimo/Avaliação. Só colunas que a linha JÁ traz (custo zero, página edge-cached).
   **Fora de propósito (produto pago + custo):** Score/análise/mapa/raio ficam atrás do cadastro.

### LEILAOPRO — nova família de scraper integrada (item 4, "como sugerido")
Plataforma **"LeilãoPro Core"** (artisticweb/leilaodetran, SSR) — serve leffa e oscar.
Seguiu o modelo emiliomatos (recon runtime → parser → validação campo-a-campo → grava):
- **Recon** (workflow `recon-leilaopro`, Bright Data): SSR, categoria `/leilao/lotes/imoveis`
  (página única), lote `/leilao/<slug>/lote_id/<ID>`. **Preço POR RÓTULO** (não adivinhar):
  `LANCE INICIAL` = avaliação (1º leilão) · `LANCE INICIAL 2º LEILÃO` = mínimo (≈50%) ·
  incremento/caução IGNORADOS. Cidade/UF do título ("…CIDADE DE <x>/<UF>"), área do m² do
  título, docs em `/uploads/media/documentos_leilao` (edital) e `/documentos_bem` (matrícula).
- **Parser** `scripts/lib/leilaopro-parse.mjs` (puro, compartilhado validação↔produção),
  multi-tenant (fonte por leiloeiro: LEFFA, OSCAR). **Scraper** `scripts/scraper-leilaopro.mjs`
  + workflow `scraper-leilaopro.yml` (cron quinta 10:50 UTC grava · dispatch dry-run · freio
  residencial 7d). Migração `brightdata_reserva_leilaopro.sql` (proposito, teto 120).
- **Resultado: 8 imóveis LEFFA vivos** (`fonte=LEFFA`), 100% com cidade/UF/valor/foto, praças
  set-nov/2026, RS+SC. **Custo Bright Data: ZERO** — o fetch direto do runner funciona para o
  LeilãoPro (a via grátis do scraper resolve; BD é só fallback). O teto semanal (550, saturado
  em 618) não foi tocado.
- **Bugs pegos ANTES/na validação** (disciplina "validar cada campo num lote real"):
  (a) cidade hifenizada "Xangri-Lá" vinha "Lá" — hífen fora da classe de palavra e do titleCase;
  (b) **apartamento inteiro descartado como "fração ideal"** — a descrição vinha do CORPO (a
  matrícula inteira, que em todo apto cita "fração ideal de terreno" = parte comum do condomínio);
  passou a vir do `og:description` (endereço+área), alinhado à calibração das outras fontes —
  recuperou os 2 aptos de Torres/RS (área privativa 103m²/275m²).
- **oscar NÃO coletado**: o domínio migrou para `oscar.leilao.br` e a listagem de imóveis
  voltou VAZIA no recon (0 lotes). Fica fora do default (`LEILAOPRO_TENANTS=leffa`); quando o
  dono quiser, precisa de recon próprio do novo domínio.
- **Saúde**: `fonte_saude` registra o count DO RUN (padrão dos scrapers incrementais); em runs
  só-de-novos o número fica baixo ("degradado") — o monitor auto-onboarda e calibra o baseline
  pelo histórico. Um run completo (sem novos) grava o count cheio (8).

**Próximas alavancas LeilãoPro** (mesma plataforma, quando o dono quiser): confirmar oscar no
novo domínio; e as demais famílias do backlog de 16 (Nordeste SPA, Jussiara, Flávio Costa, Alfa).
