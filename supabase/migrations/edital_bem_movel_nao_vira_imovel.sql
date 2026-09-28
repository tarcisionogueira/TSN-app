-- ─────────────────────────────────────────────────────────────────────────────────────────
-- EDITAL DE BEM MÓVEL NÃO VIRA "IMÓVEL EM LEILÃO JUDICIAL" — 28/09/2026 (pedido do dono)
--
-- O Radar de Editais promovia a lote de IMÓVEL todo edital com cidade/UF — inclusive penhora de
-- veículo, compressor, mesa de escritório, máquina de tear, placas solares, mobiliário. Medido
-- hoje sobre os 553 lotes ativos da fonte: 56 são bem móvel, 25 deles VISÍVEIS na busca com o
-- título "Imóvel em leilão judicial" (ex.: Fiat Uno por R$ 9.500, mesa de escritório listada a
-- R$ 255.200). Começou pelos editais de Vara Criminal (bens apreendidos), mas o problema é geral.
--
-- CLASSIFICADOR (edital_natureza_bem), em ordem de confiança:
--   1. matrícula ou área extraída do edital → imóvel (imóvel se prova pelo registro);
--   2. a SEÇÃO DO BEM ("descrição do bem", "bem(ns):", "bens:") — primeiros 120 caracteres: o
--      termo que aparece PRIMEIRO decide (veículo/máquina/mesa… × imóvel/terreno/lote…);
--   3. sem seção: identificador de veículo (placa AAA9…, chassi, renavam) e NENHUM de imóvel
--      (matrícula, m², quadra, lote nº, "imóvel residencial/industrial/…") → móvel;
--   4. senão → indefinido, e INDEFINIDO NÃO SE ESCONDE (não saber não autoriza tirar da vitrine).
-- Conferido item a item antes de aplicar: os 56 "móvel" são todos bens móveis. Dois ajustes
-- saíram da conferência: "renajud" sozinho é nome de sistema de busca (não prova veículo) e o
-- "imóvel industrial de Osasco" caía como móvel pela palavra "cadeira" 150 caracteres adiante.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.edital_natureza_bem(p_texto text, p_matricula text, p_area numeric)
returns text language sql immutable set search_path = public as $$
  with t as (select lower(regexp_replace(coalesce(p_texto,''), '<[^>]+>|\s+', ' ', 'g')) t),
  b as (select t, left(substring(t from '(?:descri[çc][ãa]o d[oe]s? bens?|bem\(ns\)|\mbens?\s*:)(.{0,255})'), 120) s from t),
  pos as (
    select t, s,
      nullif(regexp_instr(s, '(im[óo]vel|terreno|\mlote n|\mlote \d|\mcasa\M|apartamento|fazenda|matr[íi]cula|gleba|s[íi]tio|ch[áa]cara|pr[ée]dio|galp[ãa]o|sala comercial|m²|\mm2\M|hectare|alqueire)'), 0) pi,
      nullif(regexp_instr(s, '(ve[íi]culo|placa|chassi|renavam|motocicl|\mmoto\M|autom[óo]vel|caminh[ãa]o|[ôo]nibus|trator|compressor|m[áa]quina|\mtorno\M|\mmesa\M|cadeira|equipamento|\mm[óo]veis\M|eletro|sucata|semovente|gado|bovino|embarca[çc][ãa]o|aparelho|celular|computador|notebook|j[óo]ia|estoque|mercadoria|carretinha|reboque|fotovoltaic)'), 0) pm,
      t ~ '(\mplacas? [a-z]{3}[- ]?\d|chassi|renavam)' ident_movel,
      t ~ '(matr[íi]cula|m²|\mm2\M|\mquadra\M|\mlote n|[áa]rea (total|constru[íi]da|privativa|de \d)|hectare|alqueire|im[óo]vel (industrial|residencial|comercial|rural|urbano|situado|localizado))' ident_imovel
    from b
  )
  select case
    when p_matricula is not null or coalesce(p_area, 0) > 0 then 'imovel'
    when s is not null and pm is not null and (pi is null or pm < pi) then 'movel'
    when s is not null and pi is not null then 'imovel'
    when ident_movel and not ident_imovel then 'movel'
    when ident_imovel then 'imovel'
    else 'indefinido' end
  from pos
$$;

-- Promoção: edital de bem móvel é marcado como processado (sai da fila) e NÃO vira lote.
do $$
declare d text;
begin
  select pg_get_functiondef('public.editais_promover_pendentes'::regproc) into d;
  if position('edital_natureza_bem' in d) > 0 then return; end if;
  d := replace(d, 'v_sem_id int := 0;', 'v_sem_id int := 0; v_moveis int := 0;');
  d := replace(d, 'v_dedup := public.editais_dedup_candidato(e.id);',
    'if public.edital_natureza_bem(e.texto_integral, e.imovel_matricula, e.imovel_area_m2) = ''movel'' then
      update editais_leilao set promovido_em = now() where id = e.id;
      v_moveis := v_moveis + 1;
      continue;
    end if;
    v_dedup := public.editais_dedup_candidato(e.id);');
  d := replace(d, '''sem_identificacao_minima'', v_sem_id', '''sem_identificacao_minima'', v_sem_id, ''bens_moveis_ignorados'', v_moveis');
  if position('v_moveis := v_moveis + 1' in d) = 0 or position('bens_moveis_ignorados' in d) = 0 then
    raise exception 'editais_promover_pendentes: âncoras não encontradas';
  end if;
  execute d;
end $$;

-- Acervo atual: bem móvel sai com motivo (o gatilho de gêmeos impede reativação por engano).
update public.imoveis_leilao i set ativo = false, suprimido_motivo = 'edital_bem_movel'
  from (select distinct on (e.imovel_id) e.imovel_id, e.texto_integral, e.imovel_matricula, e.imovel_area_m2
          from public.editais_leilao e where e.imovel_id is not null order by e.imovel_id, e.criado_em) e
 where e.imovel_id = i.id and i.ativo and i.fonte = 'EDITAL_DJEN'
   and public.edital_natureza_bem(e.texto_integral, coalesce(e.imovel_matricula, i.numero_matricula),
                                  greatest(coalesce(e.imovel_area_m2, 0), coalesce(i.area_m2, 0))) = 'movel';
