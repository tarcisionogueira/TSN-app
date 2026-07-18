# 🗺️ HANDOFF — BidPro Brasil (continuação em nova sessão)

> Cole este documento no início de uma nova sessão do Claude Code (com o **conector Supabase ativo**) para continuar com acesso total ao banco. Peça primeiro uma **auditoria completa dos fluxos** e depois siga pelos "Próximos passos".

> 📋 **Pendências que dependem do DONO** (painéis/planos): ver `docs/PENDENCIAS_DONO.md`. Ao iniciar sessão, se o dono perguntar "o que falta que depende de mim?", liste de lá. Hoje: Asaas (reativar webhook), Upstash (provisionar, grátis), e — quando crescerem os pagos — Resend/compute Supabase/senha-vazada.

> ⏰ **VALIDAR NO PRÓXIMO CICLO (fontes corrigidas em 18/07):**
> 1. **PECINI** — o cron gravava em DRY-RUN (fallback `|| '1'` no workflow); corrigido p/ `'0'`. Próximo cron **seg 07-20 09h UTC** deve GRAVAR. Conferir: `select count(*) from imoveis_leilao where fonte='PECINI' and atualizado_em > now()-interval '1 day';` (esperado > 23) **e o gasto Bright Data** (é pago).
> 2. **BIASI** — paginação estava presa na 1ª página (dependia do atributo `total`); tornei robusta. Conferir se o scrape volta a ~370 (não 173): `select total, status from fonte_saude where fonte='BIASI' order by executado_em desc limit 3;`. Se seguir ~173, é acervo real do site.
> 3. Ambas as fontes agora entram no **monitor-fontes-cron** (expandido para todas as fontes + falha silenciosa dos scrapers pagos) — o e-mail avisa se regredir.
> 4. **LINHA DE BASE por leiloeiro (novo):** `docs/BASELINE_CAPTURA_LEILOEIROS.md` + `BASELINE_FONTES` no monitor + RPC `fonte_cobertura()`. O monitor agora alerta **regressão silenciosa** (acervo abaixo do piso OU campo que vinha alto sumindo). Calibrado para **0 falso-positivo** no acervo atual. Ao evoluir um parser (área/data/edital), **re-medir e atualizar** os dois + `leiloeiro_conhecimento`.
> 5. **Recon edital ZUK: EXECUTADO (não precisa do dono p/ rodar).** Padrão do PDF descoberto — ver bloco 18/07. Próximo passo é **código** (plugar a captura), não uma ação manual do dono.

> 🩺 **Segurança — automação em 2 camadas (não depende de sessão manual):**
> 1. **DB/RLS/grants (determinística):** cron `seguranca-auditoria-cron` (semanal, servidor) roda `auditoria_seguranca()` e **e-mail só se regredir**. Cobre AUTOMATICAMENTE objetos novos de banco.
> 2. **Código (ofensiva):** Rotina agendada `Auditoria de segurança BidPro (mensal)` acorda uma sessão sozinha, roda os 3 agentes ofensivos sobre o repo e **notifica o dono** (sem MCP → não faz a parte de banco, coberta pela camada 1; não faz push automático).
> Checagem rápida a qualquer momento: `select public.auditoria_seguranca();` → `0 crítico / 0 atenção` = íntegro.
> **Auditorias ofensivas completas: 15/07/2026 (×2).** Total de correções: 15 (1ª rodada) + escalonamento por convite (CRÍTICO) + IDOR do MP (ALTO) + escala. Refazer a ofensiva quando entrarem rotas/pagamento/RLS novos (a Rotina mensal já faz isso sozinha).

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

**➡️ FOLLOW-UPS de código pendentes (não dependem do dono):**
- **Replicar o padrão anchor-por-texto** (edital PDF) para outras fontes cujo `link_edital` hoje é a URL do lote (o `vasculharDocumentos` genérico já classifica, mas só roda no cap de docs; ZUK ganhou a captura na própria visita de datas).
- **(Comercial, opcional)** priorizar fontes/cobertura para Santana de Parnaíba, Barueri e Arujá (alta demanda, baixo estoque); avaliar sugerir alerta automático nas buscas de zero-resultado.

**Pendências do dono (inalteradas):** validar **PECINI** (cron seg 07-20, +Bright Data; hoje 23 ativos, última 14/07) e conferir **BIASI** (segue 173 após o fix de paginação → **é o acervo real do site**, não regressão). Ambíguos de UF acima. Merge desta branch → `main` quando quiser (o fix do bug só vale em produção após o deploy).

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
