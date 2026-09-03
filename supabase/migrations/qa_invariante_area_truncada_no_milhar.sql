-- BLINDAGEM DO BLOCO 3 (03/09). Achado no WEBLEILOES (área de 22.677,54 m² gravada como
-- 677,54 — 33x menor) e confirmado em MAIS CINCO fontes (CALIL, VEGAS, FERREIRALEIL, PURCENA,
-- RJLEILOES, TMLEILOES, GESTAOLEILOES, EMILIOMATOS) com a MESMA causa: regex de área que exige
-- decimal colado ao "m²" e cai num fallback sem ponto de milhar quando o número não tem
-- decimal — "1.813m²" vira "813". Os 6 scrapers já foram corrigidos no código; este invariante
-- é o que impede a MESMA classe de defeito (aqui ou num scraper novo) de voltar a passar
-- despercebida: compara o número gravado contra o número que o próprio título/descrição cita,
-- e só acusa quando a "área gravada" é EXATAMENTE o resto de milhar de um número maior no
-- texto — o padrão descarta de propósito os casos legítimos de "casa X m² com terreno Y m²"
-- (dois números DIFERENTES por desenho, não por corte), medidos e confirmados antes de entrar.
do $do$
declare src text; novo text; ancora text;
begin
  select prosrc into src from pg_proc where oid = 'public.qa_invariantes'::regproc;
  ancora := $q$     ('lote_sem_area_nem_matricula','Lote sem metragem E sem matricula para recupera-la','Captura','gap',
       (select count(*) from imoveis_leilao where ativo and coalesce(area_m2,0)=0
          and link_matricula is null and anexos::text !~* 'matricula'), 400),$q$;
  if position(ancora in src) = 0 then raise exception 'ancora do lote_sem_area_nem_matricula nao encontrada'; end if;
  novo := replace(src, ancora, ancora || $q$
     ('area_truncada_no_milhar','Área gravada é o resto de milhar de um número maior no título/descrição (regex sem grupo de milhar)','Captura','bug',
       (select count(*) from imoveis_leilao
          where ativo and coalesce(area_m2,0) > 0 and area_m2 < 1000
            and (coalesce(titulo,'') || ' ' || coalesce(descricao,'')) ~ ('\d{1,2}\.' || to_char(floor(area_m2)::int, 'FM000') || '([,.]\d{1,2})?\s*m[²2]')
       ), 0),$q$);
  execute 'create or replace function public.qa_invariantes() returns table('
        || 'chave text, titulo text, categoria text, gravidade text, valor bigint, limite bigint, status text) '
        || 'language sql stable set search_path to ''public'' as $f$' || novo || '$f$';
end $do$;
