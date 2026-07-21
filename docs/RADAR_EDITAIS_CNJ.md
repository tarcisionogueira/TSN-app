# 📜 Radar de Editais (CNJ) — plano de monitoramento

> Pedido do dono: saber, o quanto antes, quando um **edital de leilão** é publicado e a qual **leiloeiro** foi designado — para (a) ampliar o acervo e (b) manter controle. Foco: TJSP + TRT-15 (SP). Prioridade: **grátis, seguro, eficiente**.

## ✅ É viável (e de graça)
**Fonte primária — DJEN / API "Comunica" do CNJ** (`GET https://comunicaapi.pje.jus.br/api/v1/comunicacao`, pública, sem token, diária). Desde 05/2025 os prazos do TJSP correm pelo DJEN → **editais de leilão de TJSP e TRT-15 passam por lá**. Retorna o **texto integral do edital**, com o que precisamos para ligar tudo:
- `siglaTribunal` (TJSP/TRT15), `numeroProcesso`, `nomeOrgao` (vara/comarca), `data_disponibilizacao`, `tipoDocumento` (Edital), `texto`/`inteiroTeor`.
- Do CORPO do edital (regex + IA): **leiloeiro** (nome + JUCESP), plataforma do leilão, datas de 1ª/2ª praça, avaliação, lance mínimo, e o imóvel (endereço/cidade/UF/matrícula).
- Filtro de busca: `texto` ("edital de leilão", "hasta pública", "praça"), `dataDisponibilizacaoInicio/Fim`, `itensPorPagina` até 100, `pagina`.

**Cross-check — DataJud** (`https://api-publica.datajud.cnj.jus.br/api_publica_tjsp/_search`, grátis, APIKey pública): só METADADOS (sem texto/leiloeiro) → serve para achar processos com movimento de leilão que a busca textual não pegou, e então buscar o edital no DJEN por `numeroProcesso`.

**Complemento SP (se preciso) — DEJESP/e-SAJ:** o TJSP lançou o DEJESP (23/07/2025); parte dos editais de SP pode sair no diário estadual e não no DJEN. **Validar empiricamente 2–4 semanas** (DJEN × e-SAJ "Consulta de Editais"); se houver lacuna, add scraper leve do e-SAJ. **Fallback pago** (só se o público limitar): Escavador/Digesto (monitoramento por palavra + callbacks, barato).

## 🔧 Plano de monitoramento (Supabase + Vercel cron)
- **Cron 2×/dia útil** (~11h e ~17h BRT), janela deslizante de 3 dias (pega itens carregados com atraso; dedup resolve repetição).
- 1 request por `tribunal × termo` (TJSP/TRT15 × termos de leilão), paginando até esgotar `count`. Filtra por `tipoDocumento=Edital` + regex no corpo (corta falso-positivo). UA de browser + backoff.
- **Dedup:** `djen_id` (UNIQUE) + hash defensivo `(tribunal+processo+tipoDoc+data+sha1(texto))`; nível-evento `(processo + data_praca_1 + leiloeiro_norm)` p/ não reprocessar reagendamento.
- **Parse:** regex-âncora ("Leiloeiro Oficial", "JUCESP", "matrícula nº", "1ª praça", "lance mínimo") + IA nos difíceis; normaliza o leiloeiro e valida contra o cadastro TJSP (Auxiliares da Justiça).
- **Novidade real = `djen_id` inédito** OU processo conhecido cujo leiloeiro mudou (redesignação).
- **Custo de API: R$ 0** (DJEN + DataJud). Só compute Vercel + storage.

### Tabelas
- `editais_leilao` (djen_id UNIQUE, fonte, tribunal, numero_processo, orgao/comarca, data_disponibilizacao, data_praca_1/2, leiloeiro_nome[_normalizado], leiloeiro_jucesp, plataforma_url, valor_avaliacao, lance_minimo, imovel_endereco/cidade/uf/matricula, texto_integral, hash_dedup UNIQUE, payload jsonb, status, timestamps).
- `leiloeiros` (dimensão do cadastro TJSP: nome_normalizado, jucesp, uf, site, ativo) — normaliza/valida.
- `monitor_runs` (observabilidade: janela, itens_vistos/novos, duração, erro).

## 🖥️ Onde fica no sistema + o que aparece
**Nova aba no Admin: "📜 Radar de Editais"** (dentro de "Operação de Coleta").
- **KPIs:** editais novos hoje/semana · leiloeiros distintos · **% já no nosso acervo** · imóveis potenciais novos · editais de leiloeiro **NÃO integrado** (prioridade!).
- **Tabela** (por data desc): data · tribunal/comarca · **leiloeiro** (badge: integrado ✓ / não integrado ⚠) · nº processo · 1ª/2ª praça · imóvel (cidade/UF/endereço) · avaliação/lance mínimo · plataforma · **status** (novo · já no acervo · leiloeiro a integrar) · link do edital.
- **Filtros:** leiloeiro · comarca/cidade · data · **"só leiloeiros não integrados"** (alimenta o backlog TRT-15) · tipo de imóvel.
- **Ação:** botão "adicionar leiloeiro ao backlog" → liga ao `LEILOEIROS_TRT15_BACKLOG.md`. Assim o Radar VIRA a esteira que zera o backlog e antecipa novos leilões.

## ⚠️ Riscos
- DJEN público funciona hoje sem token, mas o CNJ pode impor rate-limit/auth sem aviso → rate educado, cache, `monitor_runs` p/ detectar quebra, fallback comercial pronto.
- Cobertura SP DJEN×DEJESP a validar (2–4 semanas).
- Parse do leiloeiro varia por comarca → regex+IA + fila `status='erro_parse'` p/ revisão.
- LGPD/ToS: dados públicos, mas armazenar o mínimo, respeitar rate/robots.
- **Deste ambiente o proxy bloqueia `*.pje.jus.br` (403)** — validar o endpoint 1× em produção (Vercel) antes de construir (passo 0).
