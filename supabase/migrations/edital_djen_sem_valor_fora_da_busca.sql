-- EDITAL_DJEN sem valor mínimo fica FORA da busca pública (decisão delegada pelo dono, 24/09).
-- A fonte alimenta o Radar de Editais a partir do DJEN: o título é só o endereço do processo e,
-- dos 464 ativos, 342 não têm valor nenhum (e 458 não têm foto) — um card que promete "preço,
-- foto, localização" e não entrega nada. Os 122 com valor continuam aparecendo; os demais voltam
-- sozinhos assim que o enriquecimento achar o valor (nada é desativado — o Radar segue igual).
-- Mesma regra em Busca.jsx (aplicarFiltrosImoveis, lista e mapa) — aqui é o caminho COM raio.
do $$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p
   where p.proname = 'buscar_por_raio_v2' and p.pronamespace = 'public'::regnamespace;
  if position('EDITAL_DJEN' in d) > 0 then return; end if;  -- idempotente
  d := replace(d, E'      i.ativo = true\n',
                  E'      i.ativo = true\n      and (i.fonte is distinct from ''EDITAL_DJEN'' or coalesce(i.valor_minimo, 0) > 0)\n');
  if position('EDITAL_DJEN' in d) = 0 then raise exception 'buscar_por_raio_v2: âncora "i.ativo = true" não encontrada'; end if;
  execute d;
end $$;
