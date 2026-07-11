# Handoff — Documentos dos leiloeiros + pesos do laudo jurídico

_Última atualização: 2026-07-11. Branch de trabalho: `claude/bidprobrasil-system-audit-dikyyk`._

Contexto: expandir o acervo de imóveis e garantir que **matrícula + edital + demais
documentos** cheguem para as IAs lerem e gerarem os laudos, com geolocalização exata.

---

## 1. O que já foi feito hoje (mergeado em `main`)

- **Correção do laudo (contradição matrícula)**: quando o edital vem num PDF único
  (edital + matrícula transcrita), a IA lia a matrícula mas dizia "não consegui ler".
  Regra de coerência no prompt de `api/gerar-documental.js`. Caso Santana de Parnaíba.
- **Captura de docs ligada** em PortalZuk, Sodré e Pestana no scraper
  (`scripts/scraper-puppeteer.mjs`): enrich na página do lote + Pestana montando
  `anexos` a partir do JSON (matrícula/edital/laudo). Resultado do scrape:
  - **PESTANA**: 95% matrícula, 100% anexos ✅ (melhor fonte)
  - **ZUK**: 100% edital, 0% matrícula (login-gated — ver §2)
  - **SODRE**: 0% docs (página SPA, monta PDFs via JS — precisa captura própria)
- **QA reutilizável**: `scripts/testar-analise-amostras.mjs` +
  `.github/workflows/testar-analise-amostras.yml` — gera o laudo de uma lista de
  `imovelIds` via o caminho cron do `gerar-documental` (sem cota). Uso:
  workflow_dispatch com `ids` (vírgula) e `para_user` (id de perfil admin
  `92c713f3-1f1a-4758-bab2-32e6c83da433`).
- **Zuk login on-demand (parcial)**: `api/_zuk-auth.js` — faz login Laravel
  (`ZUK_EMAIL`/`ZUK_SENHA` do Vercel) e é chamado no `gerar-documental` quando falta
  matrícula do Zuk. **O login funciona (`logado=true`), mas ver §2.**

---

## 2. Zuk — bloqueio confirmado (AÇÃO PENDENTE)

Log do Vercel: `[zuk-auth] logado=true cards=2 matricula=sem-assinatura`.

- O **edital** do Zuk vem com URL **assinada** (CloudFront) no HTML → funciona.
- A **matrícula**, mesmo logado, só expõe no HTML a URL **sem assinatura**; a URL
  assinada é gerada por **JavaScript no clique** (endpoint que o navegador chama).
- Um fetch de servidor (Vercel) **não executa esse JS** → não consegue a matrícula.

**Solução**: capturar com **navegador real logado** (Puppeteer no scraper) — logar,
clicar no card `property-documents-item` da matrícula e capturar o PDF assinado.
Roda no **GitHub Actions**, então exige as credenciais também como **secrets do
GitHub** (o usuário vai cadastrar `ZUK_EMAIL`/`ZUK_SENHA` no GitHub e Vercel, e o
mesmo para os demais leiloeiros com login).

Próximo passo de código: no `scripts/scraper-puppeteer.mjs`, um `loginZuk(browser)`
(uma vez por run) + no enrich do Zuk, para lotes sem matrícula, clicar o card e
interceptar a request do PDF → `link_matricula`. Reaproveitar a sonda já escrita em
`scripts/debug-leiloeiros.mjs` (`scanZukDocs`, que já clica e intercepta).

O padrão "edital público / matrícula sob login" deve valer para outros leiloeiros —
generalizar o `loginX(browser)` por fonte conforme forem cadastradas as credenciais.

---

## 3. Cobertura de matrícula/edital por fonte (acervo atual)

| Fonte | Matrícula | Edital | Motivo do gargalo da matrícula |
|---|---|---|---|
| PESTANA | 95% | 100% | — (ok, via JSON) |
| VIP | 96% | 100% | — (ok) |
| LEILOTECH | 81% | 100% | — (ok) |
| CEF | 100%* | 36% | *link Caixa; download às vezes falha (Bright Data) |
| MEGA | 25% | 100% | parcial na página do lote |
| GRUPOLANCE | 0% | 100% | matrícula vem DENTRO do edital combinado (on-demand ok) |
| ZUK | 0% | 100% | login-gated + assinatura via JS (§2) |
| BIASI | 2% | 100% | a investigar (provável login/JS) |
| SUPERBID/SOLD | ~2% | 100% | doc em seção própria / possível login |
| FRAZAO | 0% | 100% | a investigar |
| LJUD | 0% | 100% | matrícula fica nos autos do processo (CNJ) |
| SODRE | 0% | 100% | página SPA (docs via JS) — precisa captura própria |

Edital chega em ~todas; **matrícula é o gargalo sistêmico**, com motivo distinto por
fonte. Teste empírico (1 amostra/fonte) rodou em 2026-07-11 via
`testar-analise-amostras.yml` — resultados ficam em `analises_documental` (user
`92c713f3-...`); o gate pediu matrícula onde ela não veio, como esperado.

---

## 4. PENDENTE — Rever pesos dos documentos no laudo (pedido do usuário)

Problema relatado: hoje **ler a matrícula e não ter certidão pesa demais** no
resultado. Precisa refletir a realidade. Recomendação de classificação:

- **ESSENCIAL (bloqueia o laudo se faltar — gate já existe):**
  - **Matrícula** — base de tudo: cadeia dominial, ônus/gravames, CPF do executado.
  - **Edital** — condições da venda: praças, pagamento, comissão, responsabilidade
    por débitos.
- **COMPLEMENTAR com peso de APONTAMENTO (ausência = diligência pendente, NÃO
  rebaixa o nível de risco):**
  - **Certidões** (CNDT, CNIB, CENPROT, fiscais/PGFN, distribuidores cível/federal/
    trabalhista) — confirmam/afastam risco (fraude à execução, indisponibilidade).
    Ausência = "a confirmar" (informativo), **nunca vermelho por si só**.
  - **Laudo de avaliação** — impacta o **mercadológico** (valor), não o jurídico.

**Regra alvo**: o `nivelRisco` deve ser governado pelo que **matrícula + edital
REVELAM** (ônus concretos, vícios). Certidão não consultada é diligência pendente,
não risco. Onde mexer:
- `api/gerar-documental.js` — regras de `nivelRisco`/`riscos` (o prompt já diz
  "ausência não é bloqueante", mas o efeito líquido no nível ainda penaliza).
  Separar "risco concreto" de "diligência pendente".
- `src/pages/Analise.jsx` — `bidscoreDoc` (~linha 972): `baseJur` (verde 85 /
  amarelo 55 / vermelho 30) menos `pontosAtencao.altos*10 + medios*4`. Hoje um
  ponto de atenção de "certidão ausente" derruba o score como se fosse risco real.
  Distinguir apontamento-por-falta-de-certidão de apontamento-por-vício-encontrado.

Definição a fechar com o usuário: exatamente quais certidões entram como
"apontamento" e o peso relativo de cada uma.

---

## 5. PENDENTE — CNJ do executado: listar processos (pedido do usuário)

Hoje a consulta CNJ/DataJud é limitada. Pedido: para o executado (CPF/CNPJ), **listar
os processos em que ele figura**, separando:
- **Polo ativo (acionante/autor)** vs **polo passivo (réu/executado)**.
- Para cada processo: **nº CNJ**, **data de distribuição/ajuizamento**, **classe/
  natureza** (execução, cumprimento de sentença, busca e apreensão, falência,
  trabalhista, etc.), vara/comarca e status.

Objetivo: perfil de litigiosidade — muitas execuções contra ele sinaliza risco de
fraude à execução / insolvência; ações como autor podem indicar créditos a receber.

Onde mexer:
- `api/gerar-documental.js` — bloco CNJ/DataJud: extrair `polo`, `classe`/`assunto`,
  `dataAjuizamento` por processo e montar a lista.
- `api/gerar-analise.js` / front (`src/pages/Analise.jsx`) — renderizar a lista numa
  seção do laudo (ou dentro do `raioX`).

---

## 6. Como retomar

1. Confirmar credenciais cadastradas (GitHub **e** Vercel) para Zuk e demais.
2. Implementar `loginZuk` + captura da matrícula no scraper (§2) e generalizar.
3. Reformular pesos (§4) e a listagem CNJ do executado (§5).
4. Investigar captura própria do SODRE (SPA) e das demais fontes 0% matrícula.
5. Ferramenta de QA para validar cada mudança: `testar-analise-amostras.yml`.

Regras do repo: build antes de push; commits em português; branch de trabalho
`claude/bidprobrasil-system-audit-dikyyk`; merges para `main` só quando validado.
