-- #196 (11/10): o extrator do scraper-soleon pegava o 1º número depois de "matrícula" na página —
-- o rótulo do documento ("Matrícula atualizada em 22/10/2020"). 51 lotes CALIL gravaram DATA como
-- matrícula, com "Matrícula nº 15603" na descrição. Código: scripts/lib/matricula-texto.mjs.
-- Data (dd/mm/aaaa) → nº real da descrição ou nulo.
update public.imoveis_leilao i
   set numero_matricula = (regexp_match(coalesce(i.descricao,''), 'matr[íi]cula\s*(?:imobili[áa]ria\s*)?(?:n[º°o.]*|sob\s+o\s+n[º°o.]*)\s*(\d[\d.]*\d|\d)', 'i'))[1]
 where i.numero_matricula ~ '^\s*\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}\s*$';
-- DANIELGARCIA: "2026" em 13 lotes de cidades diferentes, sem "matrícula 2026" no texto = ano.
update public.imoveis_leilao i
   set numero_matricula = null
 where i.fonte = 'DANIELGARCIA' and i.numero_matricula ~ '^\s*(19|20)\d\d\s*$'
   and coalesce(i.descricao,'') !~* ('matr[íi]cula\s*(n[º°o.]*)?\s*' || trim(i.numero_matricula));
