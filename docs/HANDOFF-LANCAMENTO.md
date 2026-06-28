# 🗺️ HANDOFF — BidPro Brasil (mapa de lançamento)

> Cole este documento no início da nova sessão (com os conectores **Supabase + Vercel + GitHub** ativos). Ele mostra **de onde viemos e para onde vamos**. **Amanhã é o dia de concluir o que falta para rodar em produção.**

---

## 1. Projeto & infraestrutura
- **App:** BidPro Brasil — plataforma de leilões de imóveis (React + Vite → Vercel).
- **Repo GitHub:** `tarcisionogueira/tsn-app`
- **Supabase:** projeto `zuwfiwokkdytvjixiwac` (sa-east-1, Postgres 17).
- **Vercel:** projeto `tsn-app` (`prj_E0tUYhPJN9IteuNI8spS0CEgZuxo`). Produção: `tsn-app-two.vercel.app` e `bidprobrasil.com.br`.
- **Serviços:** Asaas + Mercado Pago (pagamento), Resend (e-mail), Daily.co (vídeo).

### Branches (IMPORTANTE)
- **`main`** → produção (deploy automático Vercel).
- **`claude/tsn-supabase-connection-check-mp1urt`** → branch de desenvolvimento de hoje. **A MAIORIA do trabalho de hoje está AQUI, NÃO em produção.**
- ⚠️ Existe um `main` local "lixo" (`Initial commit`) no ambiente — sempre operar via `origin/main`. O merge dev→main foi feito por **fast-forward / cherry-pick** (ver seção 4).

---

## 2. ✅ JÁ EM PRODUÇÃO (main) — testado/observado por nós
1. **Conectores** Supabase/Vercel/GitHub validados.
2. **Convite de equipe:** validade 7 dias (default no banco) + uso único.
3. **E-mails do app:** remetente padronizado para `bidprobrasil` (fallbacks `tsnativos` corrigidos).
4. **Crash da tela de detalhe do imóvel** (MODAL_LABEL/fmtBRL indefinidos) — **corrigido** (helpers em `src/utils/format.js`).
5. **Mapa "falhado":** CSS do Leaflet no bundle **+ tiles via CARTO** (OSM bloqueava apps). Em produção.
6. **Clustering** de marcadores na busca (evita travar com milhares de pins).
7. **Calculadora:** honorários 10% só no judicial (não no extrajudicial); "Meta inatingível" em vez de "R$ 0".
8. **Caixa:** botões de matrícula/edital quebrados escondidos; **parâmetro `hdnimovel`** corrigido (era `hdniip`, dava 404) em **31.829** imóveis + scraper.
9. **Auth:** "e-mail não confirmado" tratado + reenvio; erros traduzidos para PT; redirect do Google preservando plano/checkout.
10. **`email_existe()`** (checagem de e-mail duplicado no cadastro).
11. **Busca por raio** abre o detalhe buscando documentos no banco.

### Migrações/DB já aplicadas (live)
- `convites_equipe.expira_em` default 7 dias.
- Função `email_existe(text)`.
- Função `consultar_sancoes(text)` (CEIS/CNEP por CPF/CNPJ).
- Correção `hdniip → hdnimovel` em `url_lote`/`link_edital`.

---

## 3. 🟡 NA DEV (NÃO está em produção) — precisa testar e mergear
> Tudo abaixo está na branch `claude/tsn-supabase-connection-check-mp1urt`.

### Telas do cliente
- **Planos:** preços agora vêm do `planos_config` (refletem o Admin); Assessoria/Leilão Club somem se `ativo=false`; corrigido mensal do Leilão Club (`preco` no banco é o total/12m). **Preços reais:** Investidor Pro (top2) = **R$ 49,90/mês · R$ 449,90/ano**; Assessoria = R$ 6.000; Clube = R$ 60.000 total.
- **Busca:** card mostra **descrição**; rótulo de **modalidade** correto (usava "Extrajudicial" para tudo); foto do popup do mapa corrigida; título com fallback.
- **Acesso:** logo não usa mais `nav(-1)` (quebrava deep-link/reset de senha); **convite de equipe funciona no login Google**; redirect pós-Google cobre `INITIAL_SESSION`.
- **Recuperação de senha:** após salvar nova senha **redireciona para /login** automaticamente; erro em PT.
- **🆕 Complemento pós-Google** (`/completar-cadastro`): quem entra por Google sem CPF/telefone/LGPD é levado a completar antes de usar o app (compliance). Gating no `PrivateRoute` via `cadastroIncompleto` no AuthContext.

### Item 4 — Chargeback (concluído na dev)
- **Termo versionado** (`src/utils/termos.js`, `TERMOS_VERSAO = 2.0`) + `montarTermo()` por produto.
- **`api/registrar-aceite.js`**: grava o aceite com **IP do servidor** + user_agent + versão. Checkout religado.
- **Admin:** dossiê de chargeback com **IP + dispositivo** + termo + valor + ID Asaas por transação.

### Pipeline de Análise (backend, DEV — incompleto/dormente)
- `consultar_sancoes()` (DB já live) + parser de `scraper-transparencia` corrigido (sanções CEIS/CNEP vinham sem CPF/nome — **precisa o scraper rodar p/ validar**).
- **`api/processar-analise.js`** (orquestrador): lê matrícula/edital anexados → IA extrai averbações + CPF/CNPJ do executado + processo → CEIS/CNEP → score jurídico/financeiro → grava `analise_relatorios`. **Dormente** (nenhuma UI chama ainda).

---

## 4. 🚀 COMO CONCLUIR O LANÇAMENTO (amanhã)
**Ordem recomendada:**
1. **Testar a dev no Preview** (link: `tsn-app-git-claude-tsn-supa-0221c4-tarcisio-nogueira-s-projects.vercel.app`): mapa, clustering, planos (valores), busca (descrição), cadastro/login (incl. Google + complemento), calculadora, recuperação de senha.
2. **Merge dev → main** (leva as telas do cliente para produção). O backend de análise vai junto, mas **dormente** (sem UI), então é seguro.
   - Atenção ao `main` local lixo: usar `git push origin claude/tsn-supabase-connection-check-mp1urt:main` (fast-forward) ou cherry-pick.
3. **Validar configs que dependem de você** (seção 5).
4. **Smoke test final** em `bidprobrasil.com.br`.

---

## 5. ⚙️ DEPENDE DE VOCÊ (config — validar amanhã)
- **SMTP do Resend no Supabase:** foi configurado mas **NUNCA testado**. Fazer 1 cadastro/"esqueci a senha" com e-mail real → confirmar nos logs de Auth que `mail.send` sai de `noreply@bidprobrasil.com.br` (e não `supabase.io`). *(Lembrete diário ativo.)*
- **Google OAuth:** ✅ já funciona (confirmado nos logs — vários logins Google).
- **Redirect URLs (Supabase Auth):** ✅ ok (callbacks Google voltam; reset usa a mesma origem).
- **`APP_FROM_EMAIL` no Vercel:** já existe (e-mails do app já saem de bidprobrasil).
- **Rate limit de e-mail:** já em 100/h.

---

## 6. ⏳ A FAZER (próxima sessão)
### Item 4 (faltam, fazer SEQUENCIAL, validando cada um)
- **4A — Landing por produto:** já existem `ProdutoLanding` (`/p/:tipo/:id`, funil SDR) e `ProdutoPublico` (`/p/curso/:id`, `/p/ebook/:id`). Falta: mapear "a loja"/membros, garantir landing para **planos** (hoje vão direto ao checkout) e Explorador, e mostrar o **termo** na landing.
- **4C — Indicação comissionada de TODO produto:** `_webhook-core` + `comissoes` + `Consultor` já fazem comissão por indicação. Falta verificar/estender para **todo produto** (plano/curso/ebook). **Regra do dono:** a comissão é de **quem vende**, independente do papel (cada um no seu foco, mas se vende recebe a sua comissão).

### Pipeline de Análise (continuar)
- **Peça 4 (UI no Caso):** botão "Gerar análise" + **upload de matrícula/edital** no caso + exibição do relatório/score. *(Decisão tomada: obtenção dos docs é **upload manual** — cobre leiloeiros não listados; a Caixa bloqueia robô. Bright Data fica para Fase 2.)*
- **Peça 5:** notificação ao concluir.
- **Validar** o scraper de sanções (rodar e checar se `cpf_cnpj` foi populado).

### Polimentos
- **A5:** `handleGoogle` com try/catch/loading (botão Google sem feedback se falhar).
- **D2:** limitar campo de entrada da calculadora a 0–100%.
- **B3:** campo "preço anual" editável no Admin (hoje só o mensal é editável; anual fica estático).

---

## 7. Regras de negócio confirmadas (para não esquecer)
- **Honorário de êxito:** 10% da arrematação (só judicial tem sucumbência; extrajudicial não).
- **Análise = 3 módulos:** Mercadológica (descrição+endereço) · Documental/Jurídica (matrícula+edital → averbações) · Judicial (CPF/CNPJ do executado → DataJud + CEIS/CNEP).
- **Matrícula da Caixa:** sem URL direta (removida) — acessível pela página do imóvel ("Ver no portal da Caixa", agora com `hdnimovel`).
- **Termo de compra:** versionado; aceite grava IP/UA/versão (chargeback).
- **Comissão:** de quem vende.
- **E-mail admin** `tarcisioaraujo@reimob.com.br`: só notificações de sistema, nunca mensagem de cliente.

---

## 8. Notas técnicas
- Conectores oscilam às vezes (stream closed) — re-tentar.
- `npm run build` valida o front; arquivos `api/` não entram no build (usar `node --check`).
- Migrações: `supabase/migrations/`. Hoje adicionadas: `add_validade_convite_equipe`, `add_email_existe`, `add_consultar_sancoes`, `fix_caixa_hdnimovel`.
