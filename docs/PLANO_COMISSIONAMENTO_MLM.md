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

### 11.2 Plano de carreira / ranks (PROPOSTA — não implementado)
Estrutura estilo Hinode/Forever: além da comissão por nível, o parceiro sobe de **rank** conforme
constrói a rede, ganhando **reconhecimento + bônus de rank** (pago de um POOL limitado — nunca
estoura a margem).

| Rank | Qualificação (sugestão) | Benefício (sugestão) |
|---|---|---|
| **Parceiro** | assinatura ativa | comissão de rede padrão |
| **Bronze** | 3 diretos pagantes | +1% no N1 + selo |
| **Prata** | 10 na rede (≥5 diretos pagantes) | bônus mensal fixo (ex.: R$ 100) |
| **Ouro** | 30 na rede (≥3 Bronze diretos) | bônus + fatia de um pool de reconhecimento |
| **Diamante** | 100 na rede (≥3 Ouro diretos) | bônus maior + reconhecimento/eventos |

**Como manter saudável:** o bônus de rank sai de um **pool fechado** (ex.: 2–3% da receita de
assinaturas reservada a bônus), rateado entre os qualificados — assim o custo total de rank é
**limitado por definição**, independentemente de quantos batem o rank. Ranks são recalculados
mensalmente (subir é fácil, cair exige perder qualificação por 2 meses, p/ não punir oscilação).

**Decisões do dono p/ eu implementar os ranks:** (a) as qualificações e benefícios acima; (b) o
tamanho do pool de bônus (% da receita); (c) recálculo mensal e regra de manutenção de rank.
