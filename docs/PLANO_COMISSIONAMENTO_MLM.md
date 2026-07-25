# Plano de Comissionamento Multinível — BidPro (INTERNO, não divulgar)

> Documento de PLANEJAMENTO. A estrutura fica **pronta no sistema, porém desligada**
> (`comissao_regras.ativo=false`) e **sem nada na UI** até o dono decidir lançar.
> Repasses: **toda sexta** (já configurado no ledger `saldo_lancamentos` + fluxo de saque).

## 1. Objetivo
Transformar cada usuário (mesmo o gratuito) em um canal de indicação, com uma rede de até
**5 níveis** — inspirado em Hinode/Forever, mas com **matemática sustentável** (o total pago
nunca ultrapassa a margem) e **mecanismos anti-abuso**.

## 2. Como a rede se forma
- Todo cadastro pelo link `?ref=<id>` grava o **upline** (quem indicou) → nível 1 daquele upline.
- Quem o indicado indicar entra no **nível 2** do primeiro, e assim por diante **até o nível 5**.
- Um usuário só tem **um** upline (o primeiro que o trouxe) — árvore, não grafo.

## 3. Evento gerador de comissão
Comissão nasce quando um membro da rede faz um **pagamento elegível**:
| Produto | Tipo | Base de cálculo |
|---|---|---|
| Assinatura Investidor Pro (R$ 89,90/mês) | Recorrente | valor líquido/mês |
| Recarga de créditos (25/50/100/250/500) | Único (por recarga) | valor da recarga |
| Curso / eBook (produtos digitais) | Único | valor do produto |
| Assessoria / Leilão Club (alta renda) | Único | mantém os **10%** atuais (N1) |
| Venda direta de imóvel | Único | mantém os **10%** atuais |

## 4. Percentuais por nível (matemática saudável)
Dois trilhos, porque recorrente e pagamento-único têm margens diferentes:

### A) Assinatura (recorrente — paga todo mês enquanto o indicado paga)
| Nível | % | Sobre R$ 89,90 |
|---|---|---|
| 1 (direto) | **8%** | R$ 7,19 |
| 2 | 4% | R$ 3,60 |
| 3 | 2% | R$ 1,80 |
| 4 | 1% | R$ 0,90 |
| 5 | 1% | R$ 0,90 |
| **Total (rede cheia)** | **16%** | **R$ 14,39** |

### B) Produtos digitais e créditos (pagamento único, margem alta)
| Nível | % |
|---|---|
| 1 | **20%** |
| 2 | 5% |
| 3 | 3% |
| 4 | 1% |
| 5 | 1% |
| **Total** | **30%** |

### C) Alta renda e venda direta
- Mantém o **N1 = 10%** que já existe. Níveis 2–5 opcionais e pequenos (2/1/1/1%),
  a decidir — esses tickets são altos, então mesmo 1% é relevante.

## 5. Sustentabilidade (o "saudável")
- **Assinatura:** margem bruta do Investidor Pro é ~70–80% (COGS ~R$ 9–29 sobre R$ 89,90).
  Pagar até **16%** em rede cheia deixa ~55–65% de margem. Folgado.
- **Na prática paga muito menos:** redes raramente ficam cheias nos 5 níveis, e a
  **compressão dinâmica** (abaixo) só paga a quem está ativo.
- **Teto de segurança no cálculo:** a função nunca distribui mais que o % total do trilho
  (guard) — mesmo com dado inconsistente, não estoura a margem.

## 6. Qualificação e compressão (anti-"dono de topo preguiçoso")
- Para receber dos níveis 2–5, o membro precisa estar **ativo** no mês: assinatura em dia
  **ou** ao menos 1 recarga de crédito no período.
- **Compressão dinâmica:** se um upline está inativo, a fatia dele **sobe** para o próximo
  ativo acima (padrão Forever/Hinode). Ninguém "senta" na rede sem usar o sistema.
- **N1 (direto)** paga para qualquer usuário ativo — inclusive o gratuito (Explorador),
  para maximizar a boca do funil.

## 7. Repasse e recorrência
- A comissão entra como **crédito no ledger** (`saldo_lancamentos`, origem `comissao_rede`).
- **Saque toda sexta**, no fluxo que já existe.
- Assinatura = comissão **residual** (todo mês enquanto o indicado paga). Produtos/créditos =
  comissão **única** no pagamento.

## 8. Anti-fraude
- **Autoindicação bloqueada** (mesmo CPF / dispositivo / e-mail).
- **Estorno/chargeback** do indicado → estorna a comissão de toda a cadeia (idempotente).
- **Sem comissão sobre a própria recarga** usada só para "ativar" e sacar (piso mínimo de
  permanência antes de liberar saque de comissão, ex.: recarga precisa ter sido consumida).

## 9. O que já deixo pronto no sistema (desligado, sem UI)
1. **`rede_indicacao`** (upline por usuário) — o cadastro passa a gravar o `?ref=`.
2. **`comissao_regras`** (níveis × % × trilho, com flag `ativo=false`) — configurável sem deploy.
3. **`distribuir_comissao_rede(pagamento)`** — sobe a cadeia até 5 níveis, aplica qualificação +
   compressão + teto, credita o ledger. Chamada pelos webhooks de pagamento; **no-op enquanto
   `ativo=false`**.
4. **Nada aparece ao usuário** sobre níveis/percentuais enquanto desligado — só o link de
   convite genérico (já publicado na Home).

## 10. Decisões que dependem do dono (antes de eu implementar o backend dormente)
- Confirmar os **percentuais** dos 3 trilhos (seções 4A/4B/4C).
- Definir **quem qualifica** para níveis 2–5 (só assinante? assinante ou quem recarrega?).
- **Recorrência da assinatura:** residual vitalício (enquanto paga) ou limitado a N meses?
- **Piso de saque** de comissão (ex.: R$ 50) para reduzir taxa de transferência.

---

## 11. ATUALIZAÇÃO 24/07 — 10 níveis (no ar) + plano de carreira (a planejar)

### 11.1 Profundidade estendida para 10 níveis (JÁ ATIVO)
A pedido do dono. Cauda pequena mantém saudável (total muito abaixo da margem):
| Tipo | N1 | N2 | N3 | N4 | N5 | N6–N10 (cada) | **Total** |
|---|---|---|---|---|---|---|---|
| Assinatura | 8 | 4 | 2 | 1 | 1 | 0,5 | **18,5%** |
| Produto | 20 | 5 | 3 | 1 | 1 | 0,5 | **32,5%** |
| Venda direta | 10 | 3 | 2 | 1 | 1 | 0,5 | **19,5%** |

`distribuir_comissao_rede` já respeita o maior nível ativo → paga até o 10 automaticamente.
Ainda dá para ir além (constraint até 10; se quiser mais, é ampliar a constraint + inserir linhas).

### 11.1.1 SAQUE ÚNICO — "toda venda, mesma regra" (JÁ ATIVO, 24/07)
A base do saldo (`saldo_usuarios`) passou a incluir o **cliente pagante** (top2/assessorado/clube),
não só a equipe. Assim TODA origem de ganho — comissão de rede, bônus de rank, venda direta,
honorário de êxito — cai na mesma razão (`saldo_lancamentos`) e saca pela **mesma regra**:
solicitação avulsa na semana, **pagamento sexta 12h (fuso Bahia)**, mesmos pré-requisitos
(nome + CPF + telefone + chave PIX). A aba **Parceiros** de Meu Perfil já mostra saldo/saque.

### 11.1.2 Percentuais consolidados — ESTRUTURA PARA VALIDAR (dono)
Exposição MÁXIMA por venda (pior caso: cadeia de 10 pagantes cheia) vs. o teto saudável:
| Origem | Rede (10 níveis) | Pool de rank | **Exposição máx.** | Observação |
|---|--:|--:|--:|---|
| **Assinatura** | 18,5% | +2% da receita | **~20,5%** | recorrente; margem de assinatura comporta com folga |
| **Produto/curso** | 32,5% | — | **32,5%** | 1× por venda; produto digital tem margem alta |
| **Venda direta** | 19,5% | — | **19,5%** | comissão sobre a venda fechada |
| **Honorário de êxito / recarga de crédito** | 0% | 0% | **0%** | **NÃO comissiona** (regra do dono) |

Racional de saúde: a "cauda" (N4–N10 = 1+1+0,5×5 = **4,5%**) é pequena e só é paga quando a rede
é realmente profunda E paga (compressão dinâmica pula quem não paga). O **pool de rank é FECHADO**
(2% da receita, rateado por peso) → custo limitado por definição, independentemente de quantos
batem rank. **A validar pelo dono:** (a) confirmar/ajustar esses %; (b) o % do pool (2%); (c) se
o N1 de produto (20%) fica assim ou menor. É só editar `comissao_regras` / `rank_config` — sem código.

### 11.1.3 NOMES DOS RANKS — decisão pendente (COMEÇAR POR AQUI na próxima sessão)
O dono gostou da linha **história + liderança** (rede de vendas/indicação) e vai **amadurecer** o
nome. Manter **Pioneiro · Fundador · Mestre · Lenda** e completar o topo com títulos de **LÍDER**.
Candidatos levantados (o dono escolhe/combina — é só `update comissao_ranks.nome`):
- **Mestres & Guardiões:** Pioneiro · Fundador · Mestre · **Guardião** · **Embaixador** · Lenda
- **História + liderança:** Pioneiro · Fundador · Mestre · **Mentor** · **Embaixador** · Lenda
- **Conselho & Patronos:** Pioneiro · Fundador · **Mentor** · **Conselheiro** · **Patrono** · Lenda
- **Desbravadores (mais épico):** **Desbravador** · Fundador · Mestre · Mentor · Embaixador · **Imortal**
Enquanto isso, os ranks rodam com nome genérico "Nível 1..6".

### 11.2 Plano de carreira / ranks — FUNDAÇÃO IMPLEMENTADA (nome GENÉRICO, a renomear) — 24/07
Estrutura estilo Hinode/Forever: além da comissão por nível, o parceiro sobe de **rank** conforme
constrói a rede, ganhando **reconhecimento + bônus de rank** (pago de um POOL FECHADO — nunca
estoura a margem). Migração `comissao_ranks_fundacao` — cálculos e regras **no ar**, só o NOME dos
ranks é provisório (o dono ainda vai amadurecer — ver "naming" abaixo). Trocar o nome é um
`update comissao_ranks set nome=…` (nenhuma lógica depende do texto).

**Config `comissao_ranks` (editável):** 6 faixas com nome genérico, qualificação por rede paga:

| rank_key | nome (genérico) | Qualificação | pool_peso |
|---|---|---|--:|
| r1 | Nível 1 | assinatura ativa | 0 (base, sem pool) |
| r2 | Nível 2 | 3 diretos pagantes · 3 na rede | 1 |
| r3 | Nível 3 | 5 diretos · 10 na rede | 2 |
| r4 | Nível 4 | 10 diretos · 30 na rede | 4 |
| r5 | Nível 5 | 20 diretos · 100 na rede | 8 |
| r6 | Nível 6 | 40 diretos · 300 na rede | 16 |

**Saúde (pool fechado):** `distribuir_pool_rank(competência, receita_assinaturas)` reparte
`rank_config.pool_pct`% (default **2%**) da receita entre os qualificados, **rateado por pool_peso**
— custo total limitado por definição, idempotente por competência, credita em `saldo_lancamentos`
(mesmo padrão de `distribuir_comissao_rede`). **Recálculo** `recalcular_ranks()` (rodar mensal):
sobe na hora; só **cai** após `meses_carencia_queda` (default **2**) meses abaixo — não pune oscilação.
Funções `rank_do_parceiro(uid)` / `rede_metricas_parceiro(uid)` calculam a qualificação a partir da
árvore `perfis.indicado_por` + `eh_pagante`. Tudo SECURITY DEFINER, **service-only** (RLS nas tabelas
de config, EXECUTE revogado de anon/authenticated) — estrutura **não divulgada** ao cliente.

**A DEFINIR pelo dono (não bloqueia a fundação):**
- **Naming dos ranks** (linha *história + liderança* que o dono curtiu): manter Pioneiro·Fundador·Mestre·Lenda
  e completar o topo com **títulos de LÍDER** (rede de vendas/indicação). Candidatos discutidos:
  *Pioneiro·Fundador·Mestre·**Mentor·Embaixador**·Lenda* · *…·**Guardião·Embaixador**·Lenda* ·
  *…·**Conselheiro·Patrono**·Lenda* · *Desbravador·…·**Imortal***. → só um `update comissao_ranks.nome`.
- **Go-live do pool:** confirmar `pool_pct` (2% sugerido) e **agendar** `recalcular_ranks()` +
  `distribuir_pool_rank()` mensais (ainda **não** há cron — o pool só paga quando o dono ligar).
- **Saque do cliente-parceiro:** a view `saldo_usuarios` (base do saque) hoje cobre só a equipe
  operacional; pagar comissão/pool a clientes pagantes exige estender esse caminho (pendência do
  MLM inteiro, não só dos ranks).

---

## 12. ATUALIZAÇÃO 25/07 — HIERARQUIA + QUALIFICAÇÃO (modelagem do Clube Conselheiro)
> Pedido do dono: modelar a **hierarquia/classificação** com base no **plano de negócios do Clube
> Conselheiro** (Drive: *4-Plano-de-negcios-Clube-Conselheiro* + *Manual de Procedimentos*) e validar
> a **saúde financeira**. Problema levantado pelo dono: *"do jeito que está, qualquer um ganha só
> assinando — não é assim que funciona o multinível."* **CORRETO** — hoje `distribuir_comissao_rede`
> paga os 10 níveis a qualquer upline pagante **em dia**, sem exigir rede própria ativa. Falta a
> **qualificação por construção de rede** (o que o Conselheiro chama de graduação).

### 12.1 O que o Clube Conselheiro ensina (mapeado p/ o BidPro)
| Conselheiro | Papel/mecânica | Equivalente no BidPro |
|---|---|---|
| **Associado** (compra carteirinha, usa descontos) | consumidor | **Explorador** (grátis) / **Investidor Pro** (assinante) |
| **CACC** (aceita, indica, ganha 20–25% direto) | vendedor direto | **Parceiro** (aceitou o programa + link) |
| **LiFE** (comprou Kit, forma equipe, ganha multinível) | líder de equipe | **Parceiro pagante em dia** (destrava profundidade) |
| **Graduações** Bronze→Prata→Ouro→Esmeralda→Rubi→Diamante | rank por rede DIRETA ativa | **6 faixas** (`comissao_ranks`) renomeadas |
| **Regra-chave:** só ganha (direto OU multinível) quem tem **≥1 indicado válido pagante ativo** | qualificação mínima | **Piso de entrada** (r1 exige ≥1 direto pagante) |
| **Bônus multinível por graduação** (Bronze paga 1 nível, Prata 2, … Rubi 5–6) | profundidade por rank | **`max_nivel` por rank** (novo) |
| Bônus Diamante infinito · prêmios não-dinheiro (PIN/carro/viagem) | reconhecimento | Pool 2% + reconhecimento (fase 2) |

**A lição central do Conselheiro (e a defesa jurídica dele):** *"a base que sustenta a formação de
equipes é a comercialização de produtos/serviços… e não a simples comercialização de Kits, que leva
a pirâmides fraudulentas e ilegais."* → **paga-se sobre PRODUÇÃO da rede, e só destrava profundidade
quem construiu rede ativa.** É isso que falta hoje.

### 12.2 A organização proposta — RANK GOVERNA A PROFUNDIDADE (o "conserto")
Hoje: assina + fica em dia → recebe os 10 níveis. **Proposto:** assina → recebe **N1** (o direto);
para receber **fundo** (N3…N10, a cauda) é preciso **subir de rank construindo rede DIRETA ativa**.
O rank de cada parceiro define **até que nível ele PESSOALMENTE recebe** (`max_nivel`).

| Ordem | rank_key | **Nome** (linha história+liderança) | Diretos pagantes ativos | Rede paga total | **Recebe até** | Pool peso |
|---|---|---|--:|--:|:--:|--:|
| 1 | r1 | **Pioneiro** | 1 | 1 | **N1–N2** | 0 |
| 2 | r2 | **Fundador** | 3 | 5 | **N1–N4** | 1 |
| 3 | r3 | **Mestre** | 5 | 15 | **N1–N6** | 2 |
| 4 | r4 | **Mentor** | 8 | 40 | **N1–N8** | 4 |
| 5 | r5 | **Embaixador** | 15 | 120 | **N1–N10** | 8 |
| 6 | r6 | **Lenda** | 30 | 350 | **N1–N10** (+ destaque no pool) | 16 |

- **Piso de entrada (anti-"só assinei"):** sem **≥1 indicado direto pagante ativo**, o parceiro **não
  atinge nem o r1** → não recebe comissão de rede (fiel ao Conselheiro). *Alternativa mais suave a
  decidir: 1 direto mesmo grátis destrava N1.*
- **Compressão dinâmica preservada:** quem está fora de dia é pulado (já existe). **Novo:** quem está
  em dia mas **sem rank para aquela profundidade não recebe aquele nível** — a fatia **fica com a
  empresa** (mais seguro) — ou, se o dono preferir, **sobe** para o próximo upline qualificado (roll-up).
- **Sobe na hora, cai só após carência** (2 meses) — já implementado em `recalcular_ranks()`.

### 12.3 Como distribui (multinível, com qualificação)
A cada pagamento elegível, `distribuir_comissao_rede` sobe a árvore `indicado_por`:
1. upline **pagante + aceitou + em dia na data** (já hoje) **E** `nivel <= max_nivel(rank(upline))` (novo);
2. paga `comissao_regras.pct` daquele nível; senão, **pula** (empresa retém — ou roll-up, se ligado);
3. teto por trilho preservado (nunca paga mais que o total do trilho).
Pool de 2% (`distribuir_pool_rank`) mensal por `pool_peso` — **inalterado**, FECHADO.

### 12.4 VALIDAÇÃO DE SAÚDE FINANCEIRA
Margens: assinatura Investidor Pro (R$ 49,90 hoje → **R$ 89,90** em 01/10) tem **~70–80% de margem
bruta** (COGS ~R$ 9–29); produto digital ~90%; honorário/recarga **NÃO comissionam**.

**(a) Exposição máxima por trilho (pior caso — rede cheia, todos qualificados):**
| Trilho | Rede (N1–N10) | Pool | **Máx.** | Margem sobra (R$ 89,90) |
|---|--:|--:|--:|---|
| Assinatura | 18,5% | +2% | **20,5%** | 89,90 − 16,63 − 1,80 − COGS(~20) ≈ **R$ 51 (57%)** ✅ |
| Produto | 32,5% | — | **32,5%** | margem ~90% → sobra **~57%** ✅ |
| Venda direta | 19,5% | — | **19,5%** | % sobre a **receita do BidPro** na venda (não sobre o imóvel) ✅ |

**(b) Por que o rank-gate torna TUDO mais seguro que hoje:** a cauda N3–N10 da assinatura
(2+1+1+0,5×5 = **6,5%**) só é paga quando existem **construtores qualificados** na cadeia. Um
assinante que não constrói recebe **só N1 (8%)**. Logo o pagamento **esperado < 18,5% sempre**, e a
profundidade cara só "liga" com produção real de rede. **É estritamente MENOS custo que o modelo atual.**

**(c) Anti-recursão / anti-pirâmide:** a soma dos níveis por trilho é **fixa e limitada** (guard
`v_max`); o pool é **2% fechado**. Nenhum pagamento excede ~20,5% (assin.) / 32,5% (prod.). E, por
pagar só sobre produção da rede + exigir rede ativa própria, o modelo segue **venda direta legítima**
(a defesa do próprio Conselheiro), não captação por recrutamento.

**Veredito:** modelo **saudável e sustentável**; o rank-gate **reduz** o custo esperado vs. hoje e
alinha pagamento a mérito de construção. ✅

### 12.5 Implementação (a fazer, quando o dono aprovar nome + piso)
1. Migração: `alter table comissao_ranks add column max_nivel int`; `update` nas 6 faixas com
   nome + `min_diretos_pagantes` (r1: 0→1) + `max_nivel` (2/4/6/8/10/10).
2. `distribuir_comissao_rede`: gate `v_nivel <= max_nivel(rank(v_cur))` (rank calculado on-the-fly ou
   lido de `perfis.rank_key`, atualizado por `recalcular_ranks` mensal). Base **vazia hoje**
   (0 uplines) → migração de risco ~zero.
3. Front (fase 2): mostrar rank + progresso ("faltam X diretos para Fundador") na aba Parceiros/Minha Rede.
4. Cron mensal: `recalcular_ranks()` + `distribuir_pool_rank()` (go-live do pool).
