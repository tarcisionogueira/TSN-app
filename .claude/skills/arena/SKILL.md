---
name: arena
description: Debate multi-agente para decisões caras de errar. Vários agentes (padrão 10, até 100) propõem soluções independentes, criticam e pontuam as propostas uns dos outros, as melhores são refinadas e um juiz entrega SÓ a alternativa vencedora. Acima de 16 agentes roda em modo torneio (grupos + painéis de juízes) para o custo não explodir. Use quando o dono digitar /arena <pergunta> (opcional: /arena n=<N> <pergunta>).
---

# /arena — debate de agentes até sobrar a melhor solução

Invocar esta skill **é a autorização explícita do dono** para orquestração multi-agente:
chame a ferramenta `Workflow`, mesmo acima do guia de tamanho padrão da sessão.

## Entrada
- `/arena <pergunta>` → 10 debatedores, **modo completo**.
- `/arena n=<N> <pergunta>` → N de 4 a 100.
  - **4–16 → modo completo** (todos criticam todos).
  - **17–100 → modo torneio** (abaixo). Acima de 100, use 100 e avise.
- Pergunta vaga demais para gerar propostas comparáveis (ex.: "melhore o app")? Faça UMA
  pergunta de esclarecimento antes de gastar. Senão, siga direto.

## Custo (diga em uma linha ANTES de rodar, com o número de agentes)
| Modo | Agentes | Exemplo |
|---|---|---|
| Completo (N ≤ 16) | 2N + 4 | N=10 → 24 |
| Torneio (N > 16) | ≈ 1,4N + 10 | N=50 → ~80 · N=100 → ~150 |

Mais agentes só ajudam se trouxerem **ideias diferentes**: passado de ~30, as propostas começam a
se repetir. Se a pergunta tem poucas saídas possíveis (ex.: "A ou B?"), diga isso ao dono e
sugira n=10–20. Pergunta factual ou ajuste pequeno → responda sem arena e diga por quê.

## Passo 0 — Briefing (você, sem agente) — o que mais economiza
Antes do workflow, junte UMA vez o contexto que todos precisam: trechos de arquivo relevantes
(com `caminho:linha`), números do banco (consulta de leitura via Supabase), restrições do
CLAUDE.md que se aplicam (custo zero/franquias, repo público = nada de segredo, travas
`verificar:*`, as formas de "vazio que é falha"). Máx. ~2 mil palavras.
Escreva em `<scratchpad>/arena/briefing.md` e passe o texto no prompt dos agentes.
**No modo torneio os agentes de proposta NÃO usam ferramenta** (só o briefing): 100 agentes
relendo arquivo custa mais do que o debate inteiro. Faltou contexto? Melhore o briefing.

## Passo 1 — Montar o workflow
Carregue a skill `workflow-authoring` e escreva o script conforme o modo.

### Modo completo (N ≤ 16)
1. **Propostas** — N agentes em paralelo, cada um com uma persona (lista abaixo, em ordem).
   Devolvem em schema: `{ titulo, solucao, passos[], custo_estimado, riscos[],
   o_que_pode_dar_errado_em_silencio }`. Não veem as propostas dos outros.
2. **Crítica cruzada** — N agentes, mesmas personas. Recebem TODAS as propostas anonimizadas
   (P1..PN) e devolvem, para cada uma exceto a sua: `{ id, nota_correcao, nota_custo,
   nota_risco, nota_retrabalho (0–10), falha_principal }`. O script soma as notas em código
   (sem agente) e descarta o próprio voto de cada autor.
3. **Refino** — as 3 mais bem pontuadas vão para 3 agentes; cada um recebe a sua proposta +
   as críticas que ela tomou e a corrige (pode incorporar ideias das eliminadas).
4. **Juiz** — 1 agente (ver critérios) devolve `{ vencedora, por_que_venceu,
   riscos_restantes, primeiro_passo, combinou_ideias_de[] }`. Pode fundir finalistas.

### Modo torneio (N > 16) — por que é diferente
No modo completo cada crítico lê todas as propostas: o custo cresce com **N²** (100 agentes
lendo 100 propostas = 10 mil leituras). O torneio troca isso por grupos, e cresce com **N**:

1. **Propostas com diversidade forçada** — N agentes, persona × restrição (tabela abaixo:
   16 personas × 7 restrições = 112 combinações distintas). Resposta curta: máx. ~250 palavras
   no schema. É a diversidade, não o número, que faz o torneio valer.
2. **Fase de grupos** — o script embaralha e divide em grupos de 10. Cada grupo é avaliado
   por um **painel de 3 juízes** (personas diferentes entre si, sorteadas), cada um lê só as 10
   do grupo e dá notas. Notas somadas em código; os **2 melhores de cada grupo** avançam.
   (Painel de 3 em vez de todos-criticam-todos: 3 agentes por grupo em vez de 10.)
3. **Repescagem de ideias** — 1 agente lê só os campos `titulo` + `falha_principal` das
   eliminadas e lista até 3 ideias boas que nenhuma classificada tem. Elas vão junto para o refino.
4. **Repetir a fase de grupos** até sobrarem ≤ 10. **Parada antecipada:** se um juiz marcar que
   os classificados de um grupo são a mesma ideia (`duplicada_de`), funde-os no código e pule
   rodada — convergência é sinal de que já se achou a resposta.
5. **Final** — as ≤ 10 entram no modo completo de crítica (N ≤ 10), depois refino das 3 e juiz.

### Modelos por fase (se o workflow permitir escolher modelo por agente — confira no
`workflow-authoring`)
- Propostas e fase de grupos: modelo rápido/barato (haiku ou sonnet).
- Crítica final, refino e juiz: o modelo mais forte (opus).
Isso corta a maior parte do custo do modo torneio sem tocar na qualidade da decisão final.

**Regras para TODOS os agentes (ponha no prompt):** somente leitura — não editar arquivo, não
commitar, não escrever no banco, não chamar ferramenta paga (Firecrawl, Bright Data etc.).
Proposta que gasta franquia/dinheiro novo tem que dizer quanto.

## Critérios do juiz (nesta ordem de peso)
1. **Correção** — resolve o que foi perguntado; aplica a pergunta de revisão do CLAUDE.md:
   *"este vazio é resposta, ou é falha que não sabe que falhou?"*
2. **Segurança** — RLS, auth, dado de cliente, nada de segredo em repo público.
3. **Custo** — prefere custo zero; respeita franquias e o teto do Bright Data.
4. **Sem retrabalho** — reaproveita o que já existe, cabe nas travas `verificar:*`, migração
   escrita junto com a mudança no banco.
5. **Simplicidade** — menos peças móveis vence em empate.

## Personas (modo completo: as N primeiras)
1. Pragmático — menor mudança que resolve
2. Segurança ofensiva — como isso é atacado
3. Custo — o que gasta e onde frear
4. Dado/banco — schema, RLS, índices, migração
5. Cético — por que isso vai falhar em silêncio
6. Cliente — o que o pagante vê e sente
7. Escala — aguenta 10 mil usuários?
8. Operação — quem percebe quando quebra, e como
9. Negócio — impacto em receita/regra de negócio
10. Simplificador — o que dá para NÃO fazer
11. Front-end/UX — tela, estados vazios, erro visível
12. Integrações — fornecedores externos, limites, erros dentro de HTTP 200
13. Manutenção — quem mexe daqui a 6 meses entende?
14. Jurídico/LGPD — dado pessoal, consentimento, documento
15. Testes — como provar em seco, sobre dado real, antes de gravar
16. Advogado do diabo — defende a alternativa oposta à maioria

## Restrições (só no modo torneio; combine com as personas em rodízio)
A. Custo zero — nada de gasto novo
B. Entregar hoje — o mínimo que resolve em poucas horas
C. Robustez máxima — como se fosse dinheiro de cliente
D. Sem código novo — só configuração, dado ou processo
E. Reescrever do zero — se pudesse começar de novo
F. Pensar em 10 mil usuários
G. Do jeito que um concorrente grande faria

## Saída para o dono — SÓ a vencedora
Responda curto, em português:
- **Solução vencedora** (o que fazer, em passos)
- **Por que venceu** (2–3 linhas)
- **Riscos que sobram** e **custo**
- **Primeiro passo** concreto
- Uma linha final: placar (`N propostas → … → 1`), agentes usados, e o caminho do registro
  completo em `<scratchpad>/arena/debate.md` (todas as propostas, notas e críticas — só se pedir).

**Não implemente** a solução dentro da arena. Pergunte se o dono quer executar.
