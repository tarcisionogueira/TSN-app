# Triagem de leiloeiros por junta comercial

Receita para transformar a lista oficial de uma junta comercial em decisão de integração.
Custo: **2 minutos de execução e R$ 0** — a triagem usa só acesso grátis, de propósito.

## Por que existe

Em 29/08 o dono trouxe o PDF da JUCEMG (236 leiloeiros). Cruzado com o acervo, **6 estavam no
sistema**. Dos 141 sites restantes, a triagem classificou tudo em 2 minutos e mostrou que
**19 rodavam uma plataforma que já parseávamos** — 17 entraram no mesmo dia, por configuração,
e 7 trouxeram 45 lotes (23 em MG) sem uma linha de parser novo.

O mesmo caminho serve JUCESP, JUCERJA, JUCEES e qualquer outra. Em vez de descobrir leiloeiro
por acaso, vira varredura por junta.

## Passo 1 — extrair a lista do PDF

Juntas publicam a lista em PDF gerado pelo navegador, com **fontes de subconjunto e CMap
próprio**: extrair texto direto devolve vazio. É preciso decodificar o `ToUnicode` de cada
fonte e remapear os códigos de glifo.

O registro é sempre `Nome` seguido da linha `Matrícula: N de DD/MM/AAAA`. **Essa é a única
âncora confiável**: tentar reconhecer nome por maiúscula inicial quebra em linhas de cidade
("Iguatama - MG" vira um registro fantasma e rouba o e-mail do leiloeiro anterior — aconteceu).

Saída: `scripts/dados/<junta>-dominios.json`

```json
[{ "dominio": "exemplo.com.br", "leiloeiros": ["Fulano de Tal"] }]
```

Agrupe **por site**, não por leiloeiro: vários leiloeiros dividem o mesmo site (na JUCEMG,
`palaciodosleiloes.com.br` tem 4), e o custo de integrar é por plataforma.

## Passo 2 — cruzar com o acervo

⚠️ **Compare os TENANTS, não a chave da fonte.** Várias fontes nossas são multi-tenant: o
primeiro cruzamento da JUCEMG comparou nomes de fonte e escondeu 7 leiloeiros que já coletavam
como tenants de SUPORTE e outras. Os domínios dos tenants estão nos próprios scrapers
(`SUPORTE_TENANTS`, `TODOS_TENANTS` do SOLEON, `tenants` das fontes do motor).

## Passo 3 — rodar a triagem

Workflow **"Triagem de junta comercial"** → `lista: ./dados/<junta>-dominios.json`.

Grava em `leiloeiro_triagem`: plataforma, `parser_existente`, `status_http` (o da HOME),
`bloqueado`, `titulo` e `pistas` (hosts de script/CSS + meta generator).

**Só acesso grátis, e isso é decisão:** gastar cota paga para *descobrir* o que existe é gastar
antes de saber se vale. Site que bloqueia o grátis é o resultado que interessa — cai sozinho na
lista do que custa dinheiro.

**Bloqueio não é ausência:** `status_http` e `bloqueado` são colunas separadas de `plataforma`.
Fundir "não consegui ler" com "não achei nada" faria descartar dezenas de leiloeiros bons.

## Passo 4 — ler o resultado

```sql
-- o que dá para integrar de graça, com parser pronto
select plataforma, parser_existente, count(*), array_agg(dominio order by dominio)
  from leiloeiro_triagem where parser_existente is not null and not bloqueado group by 1,2;

-- famílias NOVAS: um `cdn.plataformaX` repetido em N sites é UM parser para N leiloeiros
with h as (select dominio, unnest(string_to_array(pistas,' ')) pista
             from leiloeiro_triagem where plataforma='DESCONHECIDA' and not bloqueado and status_http=200)
select pista, count(*) sites, array_agg(dominio) from h
 where pista not like 'gen:%' group by 1 having count(*) >= 2 order by 2 desc;

-- o que custa dinheiro
select count(*) from leiloeiro_triagem where bloqueado;
```

Foi a segunda consulta que achou `static.suporteleiloes.com.br` em 19 sites — e **três deles já
eram tenants nossos em produção**, o que transformou uma suposição em prova.

## Passo 5 — projetar o custo dos bloqueados

Consumo medido por fonte paga: `soleon` 112 req/semana para 3 tenants (~37 cada), `rj` 60,
`pecini` 63, `gestao` 60 → **~45 requisições por semana por fonte**. Multiplique pelo número de
bloqueados e compare com o teto semanal (`brightdata_uso`), que em 29/08 estava em **550/550**.
