-- 28/09 — dois invariantes nascidos dos relatórios mercadológicos errados de Embu-Guaçu e Araraquara.
--
-- tipo_casa_titulo_lote: lote cujo título começa por "Lote"/"Terreno" e NADA no texto indica
-- edificação, classificado como casa. Causa de 28/09: "Residencial" (nome de loteamento) virava
-- casa — 76 lotes. O mercadológico comparava terreno com casa e o preço saía várias vezes maior.
--
-- matricula_area_de_outro_lote: a MESMA área de matrícula em 3+ lotes da mesma fonte e 2+ cidades.
-- É fato lido do edital de VÁRIOS lotes sem isolar o bloco do nosso (27 lotes em 28/09, GRUPOLANCE
-- e TORRES3, todos sem número de matrícula). Corrigido na raiz em _edital-extrato.js /
-- captura-documentos.mjs (ehDocMultiLote); os 27 foram limpos. Mesma cidade não conta: loteamento
-- com lotes do mesmo tamanho é normal (ZUK, Carangola, 7 × 774,5 m²).
--
-- Patch por replace no corpo vigente: a função tem ~32 kB e é editada por várias migrações.
do $mig$
declare d text; ancora text := E'  )\n  select chave, titulo, categoria, gravidade, valor::bigint, limite::bigint,';
begin
  d := pg_get_functiondef('public.qa_invariantes'::regproc);
  -- 1ª versão aplicada sem benfeitoria/prédio/barracão acusou 6 casas legítimas ("Terreno contendo
  -- benfeitoria residencial"): reaplicar só troca a regex.
  if position('tipo_casa_titulo_lote' in d) > 0 then
    if position('edifica[cç][aã]o|edificad)''' in d) > 0 then
      execute replace(d, 'edifica[cç][aã]o|edificad)''', 'edifica[cç][aã]o|edificad|benfeitoria|pr[eé]dios?|barrac[aã]o|galp[aã]o)''');
    end if;
    return;
  end if;
  if position(ancora in d) = 0 then raise exception 'qa_invariantes: âncora não encontrada'; end if;
  d := replace(d, ancora, $ins$,
     ('tipo_casa_titulo_lote','Captura: lote/terreno sem nenhuma edificação no texto classificado como casa — mercadológico compara com casa','Captura','bug',
       (select count(*) from imoveis_leilao where ativo and tipo = 'casa' and titulo ~* '^\s*(lote|terreno)\M'
          and coalesce(titulo,'') || ' ' || coalesce(descricao,'') !~* '(casa|sobrado|\mresid[eê]ncias?\M|[aá]rea constru[ií]da|edifica[cç][aã]o|edificad|benfeitoria|pr[eé]dios?|barrac[aã]o|galp[aã]o)'), 0),
     ('matricula_area_de_outro_lote','Documental: mesma área de matrícula em 3+ lotes da mesma fonte e 2+ cidades — fato de outro lote do edital','Documental','bug',
       (select coalesce(sum(n),0) from (select count(*) n from imoveis_leilao
          where ativo and (doc_fatos->'matricula'->>'areaTerrenoM2') is not null
          group by fonte, doc_fatos->'matricula'->>'areaTerrenoM2'
          having count(*) >= 3 and count(distinct lower(cidade)) >= 2) g), 0)
$ins$ || ancora);
  execute d;
end $mig$;
