-- ─────────────────────────────────────────────────────────────────────────────────────────
-- O PREÇO DO LOTE É `valor_minimo_ref`, E O ALERTA NUNCA SOUBE — 28/08
--
-- A migração de 17/08 (`valor_minimo_ref_menor_praca.sql`) criou a coluna gerada com o menor
-- valor entre as praças e deixou a regra escrita: *"Use esta, não valor_minimo, em qualquer
-- lugar que apresente preço ao cliente"*. Foi aplicada na Busca e NÃO se propagou para dois
-- lugares que decidem o que o cliente recebe:
--
--   1. `buscar_por_raio_v2` filtrava valor_min/valor_max sobre `i.valor_minimo`.
--      `Busca.jsx:252` afirma em comentário que *"os dois caminhos precisam concordar"* — e
--      eles já NÃO concordavam: a lista filtra por _ref, o raio filtrava pela praça cara.
--      A mesma busca mostrava o lote na lista e o escondia no mapa.
--   2. O invariante `alerta_acima_do_capital` comparava `i.valor_minimo` contra o teto da
--      faixa de capital. Dos 3 acusados, o de Barueri tem valor_minimo R$ 542.551 e preço
--      REAL R$ 325.530 (2ª praça) — dentro do teto de R$ 520 mil. O alerta acusava um envio
--      correto: o invariante repetia o defeito que existe para vigiar.
--
-- O EFEITO NO FILTRO É O CONTRÁRIO DO QUE PARECE. Comparar a praça CARA contra o teto é mais
-- restritivo, então nunca deixou passar lote caro — ele ESCONDIA lote barato. Medido no
-- acervo ativo com 20%+ de desconto, o que volta a aparecer:
--     ate_150k   → 672 lotes (praça cara R$ 244k em média, preço real R$ 154k)
--     150_400k   →  33 lotes (R$ 653k → R$ 382k)
--     400k_1mi   →  20 lotes (R$ 1,47 mi → R$ 894k)
-- E nada caro passa a entrar: `valor_minimo_ref` é `least(...)`, então é sempre <= 
-- `valor_minimo` — conferido, 0 lotes com _ref maior. O conjunto só cresce, e cresce com
-- exatamente o que o cliente consegue pagar.
-- ─────────────────────────────────────────────────────────────────────────────────────────
do $do$
declare def text; antes text;
begin
  select pg_get_functiondef(oid) into def from pg_proc where oid = 'public.buscar_por_raio_v2'::regproc;
  antes := def;

  def := replace(def,
    '(valor_min <= 0 OR (i.valor_minimo IS NOT NULL AND i.valor_minimo >= valor_min))',
    '(valor_min <= 0 OR (i.valor_minimo_ref IS NOT NULL AND i.valor_minimo_ref >= valor_min))');
  def := replace(def,
    '(valor_max >= 9999999999 OR (i.valor_minimo IS NOT NULL AND i.valor_minimo <= valor_max))',
    '(valor_max >= 9999999999 OR (i.valor_minimo_ref IS NOT NULL AND i.valor_minimo_ref <= valor_max))');

  if def = antes then raise exception 'nenhum dos dois filtros de valor foi encontrado em buscar_por_raio_v2'; end if;
  execute def;
end $do$;

-- O invariante passa a comparar o preço que o cliente de fato pagaria.
do $do$
declare src text; novo text; ancora text;
begin
  select prosrc into src from pg_proc where oid = 'public.qa_invariantes'::regproc;
  ancora := $q$           and i.valor_minimo > t.v), 0),$q$;
  if position(ancora in src) = 0 then raise exception 'ancora do alerta_acima_do_capital nao encontrada'; end if;
  novo := replace(src, ancora, $q$           and coalesce(i.valor_minimo_ref, i.valor_minimo) > t.v), 0),$q$);
  execute 'create or replace function public.qa_invariantes() returns table('
        || 'chave text, titulo text, categoria text, gravidade text, valor bigint, limite bigint, status text) '
        || 'language sql stable set search_path to ''public'' as $f$' || novo || '$f$';
end $do$;
