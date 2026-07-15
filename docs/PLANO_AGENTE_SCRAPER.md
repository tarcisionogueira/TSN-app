# Plano COMPLETO — Agente Scraper com Conhecimento

> Planejamento a pedido do dono (15/07), na versão **executável** ("fazer já com
> eficiência"). O agente deve: **aprender com as integrações que já temos**;
> **detectar mudanças de estrutura e se autocorrigir**; **garantir o resultado por
> todos os meios — grátis primeiro, pago por último**; **revalidar periodicamente**
> se surgiu um caminho mais fácil/grátis para documentos e fotos.
>
> **Regra de ouro do custo (definição do dono):** o agente **se corrige sozinho no
> grátis**. Quando precisar **escalar para um meio PAGO** (Bright Data), ele mantém o
> resultado, mas **emite um alerta CRÍTICO informando o custo estimado da operação**,
> para você avaliar. Nunca gasta em silêncio.

---

## 1. O que JÁ existe (o motor está ~80% pronto — vamos fechar o loop)

| Peça | Onde | Papel |
|---|---|---|
| `leiloeiros_fontes` | `add_leiloeiros_fontes.sql` | registro por leiloeiro: url_base, paginação, `perfil_parser`, **`canal_preferido` (api→scraper c/ fallback)**, prioridade, qualidade |
| `fonte_saude` | `add_fonte_saude.sql` | telemetria por run: **`estrategia` vencedora**, %uf/valor/link/foto, status ok/degradado/falhou |
| `monitor-fontes-cron.js` | `api/` | detecção de regressão (alerta quando fonte que funcionava cai/degrada) |
| `proxy_uso` + `_brightdata.js` | migração + `api/` | custo: teto semanal, sub-cotas por propósito, alertas 80/100%, `PROXY_CUSTO_POR_MIL` |
| `recon-novos-leiloeiros.mjs` / `recon-docs-leiloeiro.mjs` / `recon-login-leiloeiro.mjs` | `scripts/` | mapeamento de listagem, documentos e login |
| `scraper-core.mjs` (`extrairGenerico`+`extrairComIA`+`checarQualidade`) | `scripts/lib/` | extração heurística + fallback de IA + validação |
| Cascata de documentos (`0181f0e`) | `captura-documentos.mjs` | acesso grátis→pago **já implementado** para documentos |
| `solicitacoes` tipo `leiloeiro_sugerido` + `Admin.jsx` | migração + `src/` | gancho de intake self-service |
| `add_scraper_retry.sql` | migração | infra de retentativa |

**O que falta = 4 blocos:** dar **memória** ao agente, um **executor em cascata
universal**, **auto-correção** sobre o monitor e **re-otimização** periódica.

---

## 2. Bloco A — Base de conhecimento (o "conhecimento sobre todos")

Nova tabela `leiloeiro_estrategia` (companheira de `leiloeiros_fontes`), 1 linha por
**fonte × estágio**. Estágios: `listagem`, `detalhe`, `documento`, `foto`.

```sql
create table public.leiloeiro_estrategia (
  id             bigint generated always as identity primary key,
  fonte          text not null,            -- ex.: 'PECINI' (casa com imoveis_leilao.fonte)
  estagio        text not null,            -- listagem | detalhe | documento | foto
  -- ESCADA de acesso ordenada por custo (grátis→pago). Cada degrau:
  --   { metodo, custo_unit_usd, ativo, params:{endpoint|seletores|regex|headers} }
  escada         jsonb not null default '[]',
  estrategia_atual text,                   -- metodo que está vencendo agora
  anti_bot       text default 'nenhum',    -- nenhum | cloudflare | login | rate_limit
  qualidade      numeric(4,3) default 0,   -- última medição 0..1 (checarQualidade)
  custo_medio_usd numeric(10,5) default 0, -- custo/ítem na estratégia atual
  validado_em    timestamptz,              -- última revalidação (re-otimização)
  versao_anterior jsonb,                   -- snapshot p/ rollback do auto-heal
  observacao     text,
  unique (fonte, estagio)
);
```

**Escada padrão (custo crescente):**

```
GRÁTIS   1. api_json     (dados estruturados oficiais — custo 0)
         2. fetch_direto (HTTP simples — custo 0)
         3. puppeteer    (navegador no GitHub Actions — custo 0)
PAGO     4. brightdata   (Web Unlocker — ÚLTIMO recurso, custo > 0)
```

**Aprender com o que já temos (seed):** um script de seed lê o histórico
`fonte_saude.estrategia` (que já grava quem venceu por fonte) + a config atual dos
scrapers e **pré-preenche** `estrategia_atual`/`escada` de cada fonte existente (CEF,
SUPERBID, MEGA, ZUK, LJUD, PECINI, LEILOFY…). Zero descoberta do zero — o
conhecimento já existe, só não estava consolidado.

---

## 3. Bloco B — Executor em cascata universal (garantir resultado, grátis→pago)

Generalizar a cascata (pronta p/ documentos) para **todos os estágios**, dirigida pela
base. Núcleo em `scripts/lib/agente-scraper.mjs`:

```
executarEstagio(fonte, estagio, alvo):
  escada = leiloeiro_estrategia[fonte][estagio].escada            # ordenada por custo
  para cada degrau ATIVO na escada (do mais barato ao mais caro):
     resultado = tentar(degrau.metodo, alvo)
     se resultado passa em checarQualidade:
        registrar vencedor em fonte_saude + custo em proxy_uso
        se degrau é PAGO → emitirAlertaCritico(custo estimado)     # regra de ouro
        return resultado
  return FALHA → aciona Bloco C (auto-heal)
```

Já feito para `documento`. Passos seguintes aplicam o mesmo a `foto` e `detalhe`.

---

## 4. Bloco C — Auto-correção (self-heal sobre o monitor)

Hoje `monitor-fontes-cron` **só alerta**. Passa a agir quando `status ∈
{degradado, falhou}` (novo `api/autoheal-fontes-cron.js`, disparado após o monitor):

```
autoHeal(fonte, estagio):
  1. RE-MAPEAR (grátis): roda recon (recon-novos-leiloeiros/recon-docs) +
     extrairComIA → re-deriva seletores/endpoints (o site mudou → aprende o novo).
  2. Guardar versao_anterior (rollback) e atualizar a escada com o aprendido.
  3. RE-EXECUTAR a cascata (Bloco B), do mais barato ao mais caro.
  4. VALIDAR com checarQualidade.
     ├─ recuperou num degrau GRÁTIS  → reativa SOZINHO, registra, sem alerta crítico.
     ├─ só recuperou no PAGO (brightdata):
     │     • mantém o resultado (não deixa quebrar), MAS
     │     • ALERTA CRÍTICO ao dono com o CUSTO ESTIMADO (ver Bloco E), e
     │     • se o custo projetado > teto configurável → NÃO auto-gasta: segura em
     │       'aguardando_aprovacao' e pede seu OK.
     └─ não recuperou em nenhum meio → alerta CRÍTICO "fonte fora do ar" + diagnóstico.
```

Princípios de segurança: **sempre** valida com `checarQualidade` antes de reativar;
**sempre** guarda `versao_anterior` para rollback; reusa `add_scraper_retry`.

---

## 5. Bloco D — Re-otimização periódica (voltar ao mais barato)

Novo `api/reotimizar-fontes-cron.js` (**semanal**):

```
para cada fonte cujo estrategia_atual é PAGO (brightdata):
   reteste os degraus GRÁTIS da escada (api_json/fetch_direto/puppeteer)
   se um deles agora passa em checarQualidade → REBAIXA a estratégia (economia real)
para documento/foto:
   revalida se surgiu caminho grátis (ex.: Caixa voltou a aceitar o IP? lote passou a
   expor og:image? PDF ficou público?) → rebaixa e registra o ganho
sempre: grava validado_em e o delta de custo economizado.
```

Isso é o que faz o custo **cair com o tempo** em vez de só crescer.

---

## 6. Bloco E — Modelo de custo e sinalização (a "regra de ouro")

- **Custo por método:** `api_json`/`fetch_direto`/`puppeteer` = **US$ 0** (compute no
  GitHub Actions, grátis). `brightdata` = `nº_requests × PROXY_CUSTO_POR_MIL / 1000`
  (já parametrizado em `scraper-core.mjs`; contabilizado em `proxy_uso`).
- **Estimativa da operação:** ao escalar uma fonte para pago, custo estimado =
  `itens_do_ciclo × requests_por_item × custo_unit`. Ex.: 1.500 lotes × 1 req ×
  US$0,0015 = **~US$ 2,25/ciclo**.
- **Alerta CRÍTICO (novo template):** assunto `🔴 CRÍTICO — fonte X caiu para meio
  PAGO`, corpo com: motivo (o grátis quebrou / anti-bot novo), **custo estimado por
  ciclo e por semana**, uso atual vs. teto semanal (`proxy_uso`), e ação sugerida
  (aprovar / manter grátis degradado / desativar fonte). Reusa `enviarAlerta` do
  `scraper-core.mjs`, mas com prioridade crítica.
- **Teto de auto-gasto:** env `AUTOHEAL_TETO_USD_SEMANA`. Abaixo do teto, auto-gasta e
  só avisa; acima, **segura e pede aprovação**.

---

## 7. Intake — como um leiloeiro novo entra (faseado)

- **FASE 1 (agora): acionado por aqui.** Você passa a URL; o agente roda
  recon → escolhe a escada mais barata → escreve o perfil em `leiloeiro_estrategia`
  → valida → ativa (`leiloeiros_fontes.ativo=true`). Cada integração alimenta a base.
- **FASE 2 (depois): campo no Admin.** Colar a URL cria `solicitacoes`
  (`leiloeiro_sugerido`) e chama `api/integrar-leiloeiro.js`, que dispara o **mesmo
  motor**. Plataforma reconhecida (`perfil_parser` conhecido) → auto-integra; nova/
  difícil → cai para revisão por aqui. Casca fina sobre motor provado.

---

## 8. Roadmap executável (cada passo entrega e valida sozinho)

| # | Passo | Arquivos | Entrega | Validação |
|---|---|---|---|---|
| 1 | **Base de conhecimento + seed** | migração `leiloeiro_estrategia.sql`; `scripts/seed-estrategias.mjs` | conhecimento consolidado das fontes atuais | SELECT mostra escada/estratégia de cada fonte |
| 2 | **Cascata universal** | `scripts/lib/agente-scraper.mjs`; estender `captura-*` p/ foto/detalhe | resultado garantido grátis→pago em todos os estágios | run de captura registra o degrau vencedor em `fonte_saude` |
| 3 | **Auto-heal** | `api/autoheal-fontes-cron.js`; hook no `monitor-fontes-cron` | fonte quebrada se recupera sozinha; pago vira alerta crítico c/ custo | simular quebra (mudar seletor) → agente re-mapeia e reativa |
| 4 | **Re-otimização** | `api/reotimizar-fontes-cron.js`; `vercel.json` (semanal) | fontes caras voltam ao grátis; docs/fotos revalidados | log de rebaixamentos + custo economizado |
| 5 | **Campo no Admin (FASE 2)** | `api/integrar-leiloeiro.js`; `src/pages/Admin.jsx` | integração self-service por URL | colar URL de teste → integra ou cai p/ revisão |

**Eficiência:** passos 1–2 são a fundação; 3–4 são o diferencial (autocorreção +
economia contínua); 5 é a conveniência. Cada um vai para produção sozinho.

---

## 9. Decisões já tomadas (dono, 15/07)
- **Auto-heal:** corrige-se sozinho no grátis; ao escalar para pago, **alerta CRÍTICO
  com o custo estimado** e, acima do teto, pede aprovação. ✅
- **Intake:** faseado — por aqui agora, campo no Admin depois. ✅

## 10. Decisões em aberto
- **Storage da escada:** tabela `leiloeiro_estrategia` (recomendado) vs. jsonb em
  `leiloeiros_fontes`. *(recomendo a tabela — mais limpo e versionável)*
- **`AUTOHEAL_TETO_USD_SEMANA`:** qual valor? (sugestão inicial: alinhar ao teto atual
  do Bright Data — `BRIGHTDATA_MAX_REQ_SEMANA` × custo unit).
- **Bright Data:** manter só Web Unlocker grátis (com teto) ou avaliar plano pago se o
  volume crescer (a re-otimização deve segurar o custo).
