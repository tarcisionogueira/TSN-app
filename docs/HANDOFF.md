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

## ⏭️ COMEÇAR AQUI (21/07 — sessão 2) — tipologia na raiz + BIASI + BUG BOUNTY auto-aprendido
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
