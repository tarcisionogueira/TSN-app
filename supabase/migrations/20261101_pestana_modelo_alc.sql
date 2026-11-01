-- 01/11 — PESTANA (veículos): 912 de 1.334 ativos com modelo "Alc". O título "Nissan March 10S FLEX 2012 2013 Gas/Alc"
-- tem a barra do combustível, e o leitor comum (marcaModeloAno) a lia como "MARCA/MODELO". Coletor corrigido em
-- scripts/lib/veiculo-do-lote.mjs (teste em scripts/testes/veiculo-do-lote.mjs). Aqui, o acervo já gravado: só onde a
-- 1ª palavra do título É a marca já reconhecida (marca_busca) — 907 de 912, medido em seco; os 5 restantes ficam.
with x as (
  select id, marca_busca,
         btrim(regexp_replace(regexp_replace(titulo,
           '\y(gas(olina)?|alc(ool)?|álcool|etanol|diesel|flex|gnv)\s*/\s*(gas(olina)?|alc(ool)?|álcool|etanol|diesel|flex|gnv)\y', ' ', 'gi'),
           '(\s+(gasolina|diesel|flex|álcool|alcool|etanol|gnv|elétrico|eletrico|híbrido|hibrido|(19|20)\d\d))+\s*$', '', 'i')) limpo
    from public.veiculos_leilao
   where ativo and fonte = 'PESTANA' and modelo ~* '^(alc|gas|gasolina|flex|diesel|el[eé]trico|h[ií]brido)$'
)
update public.veiculos_leilao v
   set marca = coalesce(v.marca, upper(split_part(x.limpo, ' ', 1))),
       modelo = nullif(btrim(substr(x.limpo, length(split_part(x.limpo, ' ', 1)) + 1)), '')
  from x
 where v.id = x.id and split_part(x.limpo, ' ', 1) ilike x.marca_busca;
