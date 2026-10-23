---
name: arena
description: Debate multi-agente para decisões caras de errar. Vários agentes (padrão 10) propõem soluções independentes, criticam e pontuam as propostas uns dos outros, as melhores são refinadas e um juiz entrega SÓ a alternativa vencedora. Use quando o dono digitar /arena <pergunta> (opcional: /arena n=14 <pergunta>).
---

# /arena — debate de agentes até sobrar a melhor solução

Invocar esta skill **é a autorização explícita do dono** para orquestração multi-agente:
chame a ferramenta `Workflow`, mesmo acima do guia de tamanho padrão da sessão.

## Entrada
- `/arena <pergunta>` → 10 debatedores.
- `/arena n=<N> <pergunta>` → N debatedores (mínimo 4, teto 16). Acima de 16, use 16 e avise.
- Pergunta vaga demais para gerar propostas comparáveis (ex.: "melhore o app")? Faça UMA
  pergunta de esclarecimento antes de gastar. Senão, siga direto.

## Custo (diga em uma linha ANTES de rodar)
Total de agentes = **2N + 4** (N=10 → 24 agentes; ~20–25× uma resposta normal).
Só vale para decisão cara de errar: arquitetura, segurança, regra de negócio/dinheiro,
fornecedor, desenho de dado. Pergunta factual ou ajuste pequeno → responda sem arena e diga por quê.

## Passo 0 — Briefing (você, sem agente) — o que mais economiza
Antes do workflow, junte UMA vez o contexto que todos precisam, para 2N agentes não relerem a
mesma coisa: trechos de arquivo relevantes (com `caminho:linha`), números do banco (consulta de
leitura via Supabase), restrições do CLAUDE.md que se aplicam (custo zero/franquias, repo
público = nada de segredo, travas `verificar:*`, as formas de "vazio que é falha").
Escreva o briefing em `<scratchpad>/arena/briefing.md` e passe o texto no prompt dos agentes.

## Passo 1 — Montar o workflow
Carregue a skill `workflow-authoring` e escreva o script com estas fases:

1. **Propostas** — N agentes em paralelo, cada um com uma persona diferente (lista abaixo, em
   ordem). Cada um recebe briefing + pergunta e devolve, em schema:
   `{ titulo, solucao, passos[], custo_estimado, riscos[], o_que_pode_dar_errado_em_silencio }`.
   Não veem as propostas dos outros.
2. **Crítica cruzada** — N agentes em paralelo, cada um com a mesma persona da fase 1. Recebe
   TODAS as propostas (anonimizadas como P1..PN) e devolve, para cada uma exceto a sua:
   `{ id, nota_correcao, nota_custo, nota_risco, nota_retrabalho (0–10), falha_principal }`.
   O script soma as notas em código (sem agente) e descarta o próprio voto de cada autor.
3. **Refino** — as 3 mais bem pontuadas vão para 3 agentes, cada um recebe a sua proposta + todas
   as críticas que ela tomou, e a corrige (pode incorporar ideias das eliminadas).
4. **Juiz** — 1 agente compara as 3 finalistas pelos critérios abaixo e devolve
   `{ vencedora, por_que_venceu, riscos_restantes, primeiro_passo, combinou_ideias_de[] }`.
   Pode fundir finalistas se a fusão for claramente melhor.

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

## Personas (use as N primeiras)
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

## Saída para o dono — SÓ a vencedora
Responda curto, em português:
- **Solução vencedora** (o que fazer, em passos)
- **Por que venceu** (2–3 linhas)
- **Riscos que sobram** e **custo**
- **Primeiro passo** concreto
- Uma linha final: placar (`N propostas → 3 finalistas → 1`) e o caminho do registro completo
  em `<scratchpad>/arena/debate.md` (todas as propostas, notas e críticas — só se pedir).

**Não implemente** a solução dentro da arena. Pergunte se o dono quer executar.
