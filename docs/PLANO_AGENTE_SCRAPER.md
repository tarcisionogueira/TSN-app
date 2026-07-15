# Plano — Agente Scraper com Conhecimento (auto-aprendiz, auto-corretivo, custo-mínimo)

> Planejamento a pedido do dono (15/07). O agente deve: **aprender com as integrações
> que já temos**; **detectar mudanças de estrutura e se autocorrigir** para evitar
> quebras; **garantir o resultado por todos os meios — grátis primeiro, pago por
> último**; e **revalidar periodicamente** se surgiu um caminho mais fácil/grátis
> para documentos e fotos.

## 1. O que JÁ existe (aproveitar, não reinventar)

O motor está ~80% montado. As peças:

| Peça | Onde | Papel no agente |
|---|---|---|
| `leiloeiros_fontes` | migração `add_leiloeiros_fontes.sql` | **registro** por leiloeiro: url_base, paginação, `perfil_parser` (generico/json_api/custom), **`canal_preferido` (api→scraper com fallback)**, prioridade, qualidade |
| `fonte_saude` | `add_fonte_saude.sql` | **telemetria por run**: `estrategia` que venceu (fetch-credentials/listener/brightdata), %uf/valor/link/foto, status ok/degradado/falhou |
| `monitor-fontes-cron.js` | `api/` | **detecção de regressão**: alerta quando fonte que funcionava cai/degrada (>36h, 0 imóveis, queda de qualidade) |
| `proxy_uso` + `_brightdata.js` | migração + `api/` | **controle de custo**: teto semanal, sub-cotas por propósito, alertas 80/100% |
| `recon-novos-leiloeiros.mjs` / `recon-docs-leiloeiro.mjs` / `recon-login-leiloeiro.mjs` | `scripts/` | **mapeamento** de listagem, documentos e login de um site novo |
| `scraper-core.mjs` → `extrairGenerico` + `extrairComIA` (Claude) + `checarQualidade` | `scripts/lib/` | **extração heurística com fallback de IA** + validação de qualidade |
| Cascata de documentos (commit `0181f0e`) | `captura-documentos.mjs` | **acesso grátis→pago** já implementado para documentos (direto→Puppeteer→Bright Data) |
| `solicitacoes` tipo `leiloeiro_sugerido` + `Admin.jsx` | migração + `src/pages/` | **gancho de intake** para o campo self-service na plataforma |
| `add_scraper_retry.sql` | migração | **infra de retentativa** |

**Conclusão:** não falta um motor; falta **fechar o loop** — dar memória ao agente,
transformar o monitor (que só alerta) em **auto-corretivo**, e adicionar a
**re-otimização** que devolve fontes ao caminho grátis.

## 2. Arquitetura — 4 blocos

### Bloco A — Base de conhecimento (o "conhecimento sobre todos")
Enriquecer o registro com a **escada de acesso por estágio**. Cada leiloeiro passa a
ter, para cada estágio (`listagem`, `detalhe`, `documento`, `foto`), uma lista de
estratégias **ordenada por custo**:

```
GRÁTIS   1. csv / api_json      (mais barato: dados estruturados oficiais)
         2. fetch_direto        (HTTP simples)
         3. puppeteer           (navegador real; JS/anti-bot leve)
PAGO     4. brightdata          (Web Unlocker — ÚLTIMO recurso)
```

Por estágio guardamos: **estratégia vencedora atual**, seletores/endpoints
aprendidos, sinal de anti-bot, custo médio, qualidade e **data da última validação**.
Implementação: tabela companheira `leiloeiro_estrategia` (fonte, estagio, escada
jsonb, estrategia_atual, aprendido_em) — ou colunas jsonb em `leiloeiros_fontes`.
**Semear** a partir do que já roda hoje + do histórico `fonte_saude.estrategia`
(o dado de "quem venceu" já está gravado).

### Bloco B — Executor em cascata (garantir o resultado, grátis→pago)
Generalizar a cascata (já pronta para documentos) para **todos os estágios**: tenta a
estratégia que a base indica como mais barata que funciona; se falhar, **desce a
escada** até o Bright Data; grava a vencedora em `fonte_saude`. Assim o resultado é
garantido "por todos os meios" sem gastar proxy quando o grátis resolve.

### Bloco C — Auto-correção (self-heal sobre o monitor)
Hoje `monitor-fontes-cron` **só alerta o humano**. Passa a, quando
`status = degradado/falhou`:
1. **Re-mapear**: roda o recon (`recon-novos-leiloeiros`/`recon-docs`) + `extrairComIA`
   para **re-derivar** seletores/endpoints e atualizar a base (o site mudou → aprende
   a nova estrutura).
2. **Escalar a escada** de acesso (grátis→pago) até restabelecer o resultado.
3. **Validar** com `checarQualidade` antes de reativar; **guarda a versão anterior do
   perfil** para rollback.
4. **Só alerta o dono** se o auto-heal falhar — com o diagnóstico do que tentou.

### Bloco D — Re-otimização periódica (voltar ao mais barato)
Novo job **semanal**: para fontes hoje em estratégia **cara** (ex.: `brightdata`),
**retesta os degraus grátis**; se um voltou a funcionar, **rebaixa** o perfil
(economia real e contínua). Idem para **documentos/fotos**: revalida se há caminho
grátis novo (ex.: a Caixa voltou a aceitar o IP? o lote passou a expor `og:image`?).
Registra a mudança e o ganho de custo.

## 3. Intake — como um leiloeiro novo entra (faseado)

- **FASE 1 (agora): acionado por aqui.** Você passa a URL; o agente roda
  recon → escolhe a escada mais barata → escreve o perfil na base → valida → ativa
  (`ativo=true`). Cada integração **alimenta o conhecimento**.
- **FASE 2 (depois): campo no Admin.** Colar a URL cria uma `solicitacoes`
  (`leiloeiro_sugerido`) e dispara o **mesmo motor**. Se a plataforma for reconhecida
  (`perfil_parser` já conhecido — ex.: outro WordPress-leilão, outro Superbid-like),
  **auto-integra**; se for nova/difícil, **cai para revisão por aqui**. O campo é uma
  casca fina sobre um motor já provado.

## 4. Custo & Segurança
- **Grátis-primeiro** minimiza Bright Data; sub-cotas + teto semanal + `proxy_uso` (já
  existem). A **re-otimização** derruba o custo ao longo do tempo.
- Todo acesso é **service-role**; recon roda no **GitHub Actions** (egress liberado).
- Auto-remap por IA **sempre** passa por `checarQualidade` antes de ativar, com
  **rollback** para o perfil anterior — evita "aprender errado" e quebrar em silêncio.

## 5. Roadmap incremental (cada passo entrega sozinho e valida antes do próximo)
1. **Base de conhecimento**: migração `leiloeiro_estrategia` + seed a partir de
   `fonte_saude`/scrapers atuais. *(aprender com o que já temos)*
2. **Cascata universal**: estender a cascata (feita p/ docs) a foto/detalhe/listagem.
   *(garantir resultado grátis→pago)*
3. **Self-heal**: `monitor-fontes-cron` re-mapeia (recon+IA) e escala a escada;
   alerta só se falhar. *(autocorreção)*
4. **Re-otimização semanal**: rebaixa fontes caras p/ grátis; revalida docs/fotos.
   *(menor custo contínuo)*
5. **Campo no Admin** (FASE 2): intake self-service reusando o motor.

## 6. Decisões em aberto (do dono)
- **Onde guardar a escada**: tabela nova `leiloeiro_estrategia` (recomendado, mais
  limpo) vs. colunas jsonb em `leiloeiros_fontes`.
- **Agressividade do self-heal**: reativar automático após auto-remap validado, ou
  exigir 1 confirmação sua na primeira vez de cada fonte?
- **Bright Data**: manter só Web Unlocker grátis (com teto) ou avaliar plano pago se o
  volume de fontes crescer (a re-otimização deve segurar o custo).
