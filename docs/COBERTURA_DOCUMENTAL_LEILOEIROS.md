# Cobertura documental por leiloeiro — mapa e plano

Snapshot: **2026-07-11**. Base: `imoveis_leilao` (ativos). Objetivo: saber, por
leiloeiro, quem tem **matrícula**, **edital**, **laudo** e **regras de venda**, e
planejar a mesma correção do Grupo Lance/ZUK para resolver todos.

## Como ler
- **Matrícula/Edital/Laudo/Regras** = nº de lotes com aquele documento (via `anexos`
  jsonb, `tipo`; matrícula também conta `link_matricula`).
- ⚠️ `link_edital` está preenchido em quase todos, **mas quase sempre é a URL da página
  do lote** (botão "Acessar leiloeiro"), **não** um edital real. O sinal confiável é o
  `anexos`/`link_matricula`.
- **CEF** guarda documentos nas colunas `link_*` (não em `anexos`): matrícula 100%,
  regras 64%, edital 36%.

## Matriz de cobertura (ativos)

| Fonte | Total | Com anexos | Edital | Matrícula | Laudo | Regras | url_lote |
|---|---:|---:|---:|---:|---:|---:|---:|
| CEF | 28.133 | (via link_*) | 10.219 | **28.133** | – | **17.914** | 100% |
| SUPERBID | 1.530 | 152 | 0 | 36 | 103 | 0 | 10% |
| LJUD | 1.046 | 0 | 0 | 0 | 0 | 0 | 0% |
| MEGA | 635 | 159 | 159 | 158 | 32 | 0 | 25% |
| ZUK | 600 | 120 | 120 | **6** | 1 | 0 | 20% |
| PESTANA | 418 | 418 | 418 | 396 | 0 | 0 | 100% |
| **GRUPOLANCE** | 399 | **393** | 390 | **348** | 199 | 0 | 100% |
| BIASI | 260 | 47 | 47 | 5 | 0 | 0 | 100% |
| FRAZAO | 144 | 0 | 0 | 0 | 0 | 0 | 0%¹ |
| LEILOTECH | 96 | 90 | 73 | 78 | 64 | 0 | ~ |
| SOLD | 93 | 93² | 0 | 0 | 0 | 0 | 100% |
| SBID9 | 72 | 0 | 0 | 0 | 0 | 0 | 0%¹ |
| VIP | 53 | 53 | 53 | 51 | 18 | 0 | 100% |
| SBID21 | 39 | 0 | 0 | 0 | 0 | 0 | 0%¹ |
| SODRE | 35 | 0 | 0 | 0 | 0 | 0 | 0%¹ |
| VENDASGOV | 4 | 0 | 0 | 0 | 0 | 0 | 100% |

¹ `url_lote` vazio, mas `link_edital` guarda a URL da página do lote (dá para navegar).
² SOLD tem 93 anexos, **todos tipo genérico `anexo`** (não classificados) — ver recon.

## Recon (11/07, Puppeteer, SEM credencial — `recon-docs-leiloeiro.yml`)
Sondadas 6 páginas por fonte. **Nenhuma bateu em parede de login.**

| Fonte | Veredito | Detalhe |
|---|---|---|
| **MEGA** | 🟢 **PÚBLICO** | PDFs diretos em `cdn1.megaleiloes.com.br` (matrícula, edital, laudo). Só falta **cobertura** (enrich rodou em 25%). |
| **BIASI** | 🟢 **PÚBLICO** | PDFs diretos em `cdn-biasi.blueintra.com` (edital, matrícula, minutas). Só falta **cobertura** (18%). |
| **FRAZAO** | 🟡 **PÚBLICO, seletor** | 1 anexo por lote em CloudFront **sem extensão `.pdf`** (`d335luupugsy2.cloudfront.net/cms/files/…`). O vasculhador precisa capturar/─classificar docs sem extensão. Sem login. |
| **SOLD** | 🟡 **PÚBLICO, seletor** | Plataforma Superbid (`s.superbid.net/attachment/…`). O seletor pega um **anexo genérico repetido** (mesmo UUID em todos os lotes) em vez do doc do lote. Sem login. |
| **SODRE** | 🔴 **URLs 404** | As 6 URLs (`sodresantoro.com.br/imoveis/lote/{id}`) retornam **404** — lotes expirados/URL errada. Não é login; é captura de URL no scraper. |

## Plano por leiloeiro (ordenado por impacto)

### ✅ Já resolvidos / bem cobertos — nada a fazer
- **CEF** (matrícula 100%, regras 64%), **PESTANA** (95%), **VIP** (96%),
  **GRUPOLANCE** (87%, resolvido hoje), **LEILOTECH** (~80%).

### 🟢 Público — só COBERTURA (sem credencial) — **maior ganho rápido**
- **MEGA (635, hoje 25%)** e **BIASI (260, hoje 18%)**: docs públicos, `url_lote` presente.
  O enrich diário (cap 150 + deadline) não cobre tudo. **Ação:** um backfill dedicado
  (molde do `captura-docs-grupolance.mjs` **sem login** — lê a página, pega os PDFs
  públicos, preenche `anexos`+`link_matricula`), rodando em lote até drenar. Não precisa
  de credencial.

### 🟡 Público — precisa INTERAÇÃO/seletor por site (sem credencial, build mais profundo)
- **FRAZAO (144)**: site **WordPress + Bricks Builder**. Sonda (`debug-frazao-docs.yml`)
  confirmou: em `networkidle2 + 2s` **não há âncoras** para os docs — a seção "Documentos"
  (CloudFront `d335luupugsy2.cloudfront.net/cms/files/…`, sem `.pdf`) é montada **depois**,
  por interação/XHR. **Ação:** captura com Puppeteer que clica na aba "Documentos" e/ou
  intercepta `page.on('response')` para URLs `cloudfront`/`cms/files`, classificando pelo
  texto do link revelado. Não é backfill de uma passada.
- **SOLD/SUPERBID/SBID9/SBID21 (plataforma Superbid, ~1.734)**: o seletor pega um anexo
  genérico repetido (mesmo UUID em todos). **Ação:** extrator específico da plataforma
  Superbid (achar o doc por lote no JSON/estado da página em vez do primeiro `attachment`).

### 🔴 Captura de URL / fonte quebrada
- **SODRE (35)**: `url_lote` 404. **Ação:** rever no scraper como o link do lote é montado
  (formato mudou?), ou tratar como fonte inativa. Sem isso, não há página para ler.

### 🔑 Login-gated confirmado — precisa credencial + molde ZUK/GL
- **ZUK (600)**: edital 100%, mas **matrícula só 6**. O molde já existe
  (`matricula-zuk.yml`, `_zuk-auth.js`), só **rodou pouco**. **Ação:** rodar o workflow
  em lote (e resolver o gap de `url_lote`, só 120/600 têm — o scraper precisa gravar a
  URL do lote para a matrícula ser buscável).
- **LJUD (1.046)**: agregador aberto, **sem lote próprio** — integração oficial em
  negociação (dono). Não dá para scraping login.
- **VENDASGOV (4)**: site do governo (SERPRO); volume irrisório, baixa prioridade.

### 📄 Regras de venda ("regra de venda online")
- **Só a CEF** expõe por lote (`link_regras_venda`, 17.914). Nos demais, "regras/condições
  de venda" normalmente estão **dentro do edital** ou numa **página estática do leiloeiro**
  (não por lote). **Ação:** quando o edital for capturado, as regras já vão junto; capturar
  regras como doc separado só onde o leiloeiro publica um arquivo próprio (avaliar caso a caso).

## Convenção de credenciais (para os que precisarem de login)
Mesmo padrão do ZUK/GL — cadastrar no **GitHub** (Actions) **e Vercel**:
`<FONTE>_EMAIL` / `<FONTE>_SENHA` (ex.: `ZUK_EMAIL`/`ZUK_SENHA`, `GL_EMAIL`/`GL_SENHA`).
Pelo recon de hoje, **MEGA, BIASI, FRAZAO e SOLD NÃO precisam de credencial** (são públicos).

## Progresso da execução (11/07, noite) — backfills rodados
- **MEGA**: ✅ **635/635 com anexos, matrícula 633 (99,7%)** — era 25%. `captura-docs-publico.yml`.
- **BIASI**: ✅ **260/260 com anexos, edital 100%** (matrícula 44 — o site só publica em parte). Era 18%.
- **ZUK**: matrícula 6 → **156** (`matricula-zuk.yml`, molde login já existente). Teto prático =
  lotes com `url_lote` (o scraper só gravou ~120/600 — corrigir no scraper para subir mais).
- **GRUPOLANCE**: 87% matrícula (resolvido de manhã).
- Novos artefatos: `scripts/captura-docs-publico.mjs` + `captura-docs-publico.yml` (backfill
  público genérico, `PUB_FONTE`, concurrency por fonte), `recon-docs-leiloeiro.yml` (recon
  genérico), `debug-frazao-docs.*` (sonda estrutura FRAZAO).

### Restam (nenhum precisa de credencial, exceto LJUD comercial)
- **FRAZAO (144)**: build com interação/XHR (docs dinâmicos Bricks).
- **SOLD/SUPERBID/SBID (~1.734)**: extrator da plataforma Superbid (hoje pega anexo genérico).
- **SODRE (35)**: `url_lote` 404 → corrigir montagem da URL no scraper.
- **ZUK `url_lote`**: scraper só gravou ~120/600 → corrigir para destravar mais matrículas.
- **LJUD (1.046)**: agregador — integração oficial (comercial, dono).

## Registro de credenciais (convenção) — etapa de fechamento de hoje
Cadastrar **os mesmos nomes no GitHub (Actions) e no Vercel** (Production+Preview+Development).
Prefixo por leiloeiro + `_EMAIL` / `_SENHA`:
`ZUK_*` (existe) · `GL_*` (Grupo Lance, mesmo login do ZUK) · `MEGA_*` · `BIASI_*` ·
`FRAZAO_*` · `SODRE_*` · `SUPERBID_*` (cobre SOLD/SBID9/SBID21 — mesma plataforma) ·
opcionais `LEILOTECH_*`/`PESTANA_*`/`VIP_*`.
- **Fluxo combinado (dono):** o dono cadastra todos os e-mails/senhas de uma vez;
  ao sinalizar, o Claude (a) valida cada secret, (b) liga o molde de login de cada
  leiloeiro (batch no GitHub + fallback on-demand na Vercel), (c) roda as capturas.
- Pré-cadastrar deixa **plug-and-play**: o molde acha a credencial e funciona sem
  depender do dono naquele momento (é o fallback on-demand desejado).
- **Pendente:** aguardando o dono terminar o cadastro para executar tudo de uma vez.

## Próximos passos sugeridos
1. **MEGA + BIASI**: backfill público (sem credencial) — ganho imediato de ~700 lotes.
2. **FRAZAO**: patch no `_doc-scan` (docs sem extensão) → backfill.
3. **SOLD/SUPERBID**: extrator da plataforma Superbid.
4. **ZUK**: rodar `matricula-zuk.yml` em lote + corrigir captura de `url_lote`.
5. **SODRE**: corrigir montagem da URL do lote no scraper.
6. Método sempre **recon-first** (`recon-docs-leiloeiro.yml FONTE=<X>`) antes de assumir login.
