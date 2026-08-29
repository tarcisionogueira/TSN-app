-- ─────────────────────────────────────────────────────────────────────────────────────────
-- A REGRESSÃO COMPARAVA "QUANTO ESTE RUN PROCESSOU" CONTRA "QUANTO A FONTE TEM" — 29/08
--
-- RECON DA HASTA, pedido do dono. O alarme dizia `regressao`, faltando 144. **O parser está
-- intacto e a coleta está melhor do que antes do conserto de hoje.** Medido:
--
--     run de 29/08 20:17 →  enumerados: 592   ·   total: 5
--     acervo HASTA ativo →  584 lotes, 579 com 2ª praça em 03/09
--
-- 592 enumerados é MAIS que os 579 conhecidos: o nível 2 (`/leilao/<id>/lotes`) que entrou
-- hoje recuperou a listagem inteira. Os 5 são o DEDUP funcionando — `runner.mjs` processa
-- `novos.length ? novos : urls`, e com 579 já no banco sobraram ~13 novos, dos quais 5
-- passaram na qualidade. `total` = quantos lotes ESTE RUN processou. Não é o tamanho da fonte.
--
-- E era `total` que os dois lados da checagem usavam:
--   · `fonte_baseline_aprendida()` aprendia o piso a partir de `total`;
--   · `fonte_regressao_suspeita()` comparava `total` contra esse piso.
-- Eles só coincidem na PRIMEIRA coleta cheia. Depois dela, todo run saudável de fonte grande
-- parece regressão — o alarme cresce junto com o sucesso da coleta.
--
-- É a QUARTA vez nesta base com a mesma assinatura (17/08, 18/08, 27/08 e agora): algo que
-- NÃO é medição do tamanho da fonte comparado contra o piso da fonte. E o pior detalhe: o
-- lado JS já sabia. `scripts/_saude-fonte.mjs` tem, desde 17/08, um cabeçalho chamado
-- *"`enumerados` — POR QUE A REGRESSÃO NÃO PODE OLHAR PARA `total`"*, e usa `enumerados` na
-- comparação dele. A lição estava escrita e não atravessou para o SQL.
--
-- A CORREÇÃO é uma expressão, aplicada nos DOIS lados para que continuem comparáveis:
--     coalesce(nullif(enumerados, 0), total)
-- `enumerados` = quantos lotes a fonte LISTA, que não depende de quanto já temos. É nulo nas
-- fontes com scraper próprio (não reportam), e ali o `coalesce` cai em `total` — comportamento
-- inalterado para 24 das 34 fontes. Mudar só um dos lados seria trocar um erro por outro:
-- comparar `enumerados` contra um piso aprendido de `total` deixaria a checagem CEGA em toda
-- fonte cujo enumerado é várias vezes o processado (hoje: CALIL 81/11, EMILIOMATOS 240/37,
-- PECINI 48/4, TORRES3 180/37, LEFFA 13/5, HASTA 592/5).
--
-- ENSAIO EM SECO ANTES DE APLICAR (derivando o corpo do `prosrc` de produção, não redigitando
-- — réplica mediria a réplica):
--     antes:  ALFA · EMILIOMATOS · NORDESTE (medicao_velha) · HASTA (regressao) · VENDASGOV (zerou)
--     depois: ALFA · EMILIOMATOS · NORDESTE (medicao_velha) ·                     VENDASGOV (zerou)
-- Some exatamente a linha falsa e nenhuma verdadeira. ⚠️ O primeiro ensaio acusou LEILOFY
-- também — e era MEU erro: usei `p_dias_expiracao = 3` quando o default é 7, e o desconto de
-- expiração é justamente o que protege o LEILOFY desde 27/08. Parâmetro errado fabrica achado.
-- ─────────────────────────────────────────────────────────────────────────────────────────
-- Os dois patches derivam de `pg_get_functiondef` e trocam SÓ a expressão da medida. Redigitar
-- a assinatura foi a minha primeira tentativa e ela já tinha dois erros: eu escrevi `stable`
-- para uma função que é VOLATILE, e `executado_em` para uma coluna que se chama `medido_em`.
-- Reconstruir a declaração à mão é reescrever o que não se pretende mudar.
do $do$
declare def text; antes text;
begin
  select pg_get_functiondef(oid) into def from pg_proc where oid = 'public.fonte_baseline_aprendida(integer,integer)'::regprocedure;
  antes := def;
  def := replace(def, 'select fonte, total::numeric as ativos',
                      'select fonte, coalesce(nullif(enumerados,0), total)::numeric as ativos');
  def := replace(def, 'and status = ''ok'' and total is not null and total > 0',
                      'and status = ''ok'' and coalesce(nullif(enumerados,0), total) > 0');
  if def = antes then raise exception 'ancoras da baseline nao encontradas'; end if;
  execute def;
end $do$;

do $do$
declare def text; antes text;
begin
  select pg_get_functiondef(oid) into def from pg_proc where oid = 'public.fonte_regressao_suspeita(integer,integer)'::regprocedure;
  antes := def;
  def := replace(def, 'select s.total, s.status, s.executado_em from public.fonte_saude s',
                      'select coalesce(nullif(s.enumerados,0), s.total) as total, s.status, s.executado_em from public.fonte_saude s');
  if def = antes then raise exception 'ancora da regressao nao encontrada'; end if;
  execute def;
end $do$;
