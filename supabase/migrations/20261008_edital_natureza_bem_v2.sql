-- ─────────────────────────────────────────────────────────────────────────────────────────
-- EDITAL DE BEM MÓVEL: o classificador de 28/09 nunca achava a seção "Bem:" — 08/10/2026 (#174)
--
-- 26 lotes EDITAL_DJEN ativos com título "Imóvel em leilão judicial" eram carro, moto, caminhão,
-- trator, torno, sofá/TVs, 2.500 potes de plástico, 2.272 litros de gasolina. Três defeitos em
-- `edital_natureza_bem` / chamadores, todos medidos sobre o acervo ativo:
--   1. `\mbens?\s*:` casa "ben"/"bens" — NUNCA "bem". A seção "Bem:" / "Bem (lote único):" (o
--      formato da Kron e da maioria dos editais do TJPR) não era encontrada desde 28/09, e o
--      lote caía no ramo "identificadores" — onde o texto padrão do edital ("matrícula", "m²",
--      "imóveis e veículos…") dava imóvel.
--   2. A seção começando por "LOTE 01 caminhão…" casava `\mlote \d` como IMÓVEL antes do veículo.
--   3. `texto_integral` é cortado em 20.000 caracteres na ingestão, e nos editais da Kron o bem
--      vem no FIM — fora do corte. `payload->>'texto'` guarda o texto inteiro.
-- Ainda: a seção do bem agora decide ANTES da matrícula extraída pela IA — o edital da Kron traz
-- "matrícula" de outros lotes/ônus, e a seção que diz "veículo" é a prova mais direta.
-- Conferido em seco antes de aplicar (forma nº 10): 29 lotes mudam de imóvel/indefinido para
-- móvel, a seção do bem de cada um lida — todos móveis; nenhum imóvel atingido.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.edital_natureza_bem(p_texto text, p_matricula text, p_area numeric)
returns text language sql immutable set search_path = public as $$
  with t as (select lower(regexp_replace(coalesce(p_texto,''), '<[^>]+>|\s+', ' ', 'g')) t),
  b0 as (select t, substring(t from '(?:descri[çc][ãa]o d[oe]s? bens?|\mbem\(ns\)|\mbe(?:m|ns)\s*\(\s*lote[^)]{0,20}\)\s*:?|\mbe(?:m|ns)\s*:)(.{0,255})') s0 from t),
  b as (select t, left(regexp_replace(s0, '^\s*[(:]?\s*(lote\s*(n[ºo°.]?\s*)?0?\d{1,3}\s*[:\-–)]?|\(?lote [úu]nico\)?\s*:?)\s*', ''), 120) s from b0),
  pos as (
    select t, s,
      nullif(regexp_instr(s, '(im[óo]vel|terreno|\mlote n|\mlote \d|\mcasa\M|apartamento|fazenda|matr[íi]cula|gleba|s[íi]tio|ch[áa]cara|pr[ée]dio|galp[ãa]o|sala comercial|m²|\mm2\M|hectare|alqueire|[áa]rea de terras?|lote urbano)'), 0) pi,
      nullif(regexp_instr(s, '(ve[íi]culo|placa|chassi|renavam|motocicl|\mmoto\M|autom[óo]vel|caminh[ãa]o|[ôo]nibus|trator|compressor|m[áa]quina|\mtorno\M|\mmesa\M|cadeira|equipamento|\mm[óo]veis\M|eletro|sucata|semovente|gado|bovino|embarca[çc][ãa]o|aparelho|celular|computador|notebook|j[óo]ia|estoque|mercadoria|carretinha|reboque|fotovoltaic|\msof[áa]\M|\mtvs?\M|televis|\mlitros\M|\mpotes?\M|marca/modelo)'), 0) pm,
      t ~ '(\mplacas? [a-z]{3}[- ]?\d|chassi|renavam)' ident_movel,
      t ~ '(matr[íi]cula|m²|\mm2\M|\mquadra\M|\mlote n|[áa]rea (total|constru[íi]da|privativa|de \d)|hectare|alqueire|im[óo]vel (industrial|residencial|comercial|rural|urbano|situado|localizado))' ident_imovel
    from b)
  select case
    when s is not null and pm is not null and (pi is null or pm < pi) then 'movel'
    when p_matricula is not null or coalesce(p_area, 0) > 0 then 'imovel'
    when s is not null and pi is not null then 'imovel'
    when ident_movel and not ident_imovel then 'movel'
    when ident_imovel then 'imovel'
    else 'indefinido' end
  from pos
$$;

-- Chamadores passam o texto INTEIRO (payload) e a seção do veículo usa o mesmo marcador corrigido.
do $$
declare d text; n int;
begin
  select pg_get_functiondef('public.editais_promover_pendentes'::regproc) into d;
  if position('edital_natureza_bem(coalesce(nullif(e.payload' in d) = 0 then
    n := length(d);
    d := replace(d, 'public.edital_natureza_bem(e.texto_integral,', 'public.edital_natureza_bem(coalesce(nullif(e.payload->>''texto'', ''''), e.texto_integral),');
    if length(d) = n then raise exception 'editais_promover_pendentes: âncora não encontrada'; end if;
    execute d;
  end if;

  select pg_get_functiondef('public.edital_para_veiculo'::regproc) into d;
  if position('edital_natureza_bem(coalesce(nullif(e.payload' in d) = 0 then
    n := length(d);
    d := replace(d, 'public.edital_natureza_bem(e.texto_integral,', 'public.edital_natureza_bem(coalesce(nullif(e.payload->>''texto'', ''''), e.texto_integral),');
    d := replace(d, 'coalesce(e.texto_integral, '''')', 'coalesce(nullif(e.payload->>''texto'', ''''), e.texto_integral, '''')');
    d := replace(d, '(?:descri[çc][ãa]o d[oe]s? bens?|bem\(ns\)|\mbens?\s*:)(.{0,255})',
                    '(?:descri[çc][ãa]o d[oe]s? bens?|\mbem\(ns\)|\mbe(?:m|ns)\s*\(\s*lote[^)]{0,20}\)\s*:?|\mbe(?:m|ns)\s*:)(.{0,255})');
    if position('payload->>''texto''' in d) = 0 or position('be(?:m|ns)' in d) = 0 then raise exception 'edital_para_veiculo: âncoras não encontradas'; end if;
    execute d;
  end if;
end $$;
