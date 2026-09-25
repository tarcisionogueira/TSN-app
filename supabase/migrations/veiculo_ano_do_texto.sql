-- ANO DO VEÍCULO LIDO DO TEXTO DO LEILOEIRO (25/09, dono: "não faz sentido leiloeiro anunciar
-- veículo sem ano"). Os 890 ativos "sem ano" quase sempre TINHAM o ano no texto, em formatos que o
-- coletor não lia (ele só entendia "2019/2020"): "ANO/MODELO 2016", "Ano Fabric.:2008",
-- "ano 2019, modelo 2020", "ANO: 2001 MODELO : 2002", "ano/mod.: 18/19", título "2008/" ou
-- "2007 2007". A PLACA não resolve: o leiloeiro a publica mascarada ("PLACA FINAL 88",
-- "J*****2") — 13 dos 890 tinham placa gravada.
-- Validação em seco contra os ~8.100 que já tinham ano: 6.875 de 6.885 iguais (99,9%).
-- Sem ano → sem FIPE (`sem_dados`); com o ano preenchido o status volta a nulo e a tela do veículo
-- consulta a FIPE ao abrir.

create or replace function public.extrair_ano_veiculo(p_titulo text, p_descricao text)
returns int[] language plpgsql immutable set search_path to 'public' as $$
declare
  tit text := regexp_replace(coalesce(p_titulo,''), '&nbsp;|\s+', ' ', 'g');
  t text := tit || ' | ' || regexp_replace(coalesce(p_descricao,''), '&nbsp;|\s+', ' ', 'g');
  a text := '(19[5-9][0-9]|20[0-4][0-9])';
  m text[];
  lim int := extract(year from now())::int + 1;
  r int[];
begin
  -- Lote com vários itens: o ano é de um deles — não chuta.
  if t ~* 'lote com [0-9]+|\m[0-9]+ ve[ií]culos\M' then return null; end if;
  m := regexp_match(t, a || '\s*/\s*' || a);                                                         -- 2019/2020
  if m is not null then r := array[m[1]::int, m[2]::int]; end if;
  if r is null then
    m := regexp_match(t, 'ano\s*/?\s*mod[a-z.]*\s*[:\-]?\s*([0-9]{2})\s*/\s*([0-9]{2})\M', 'i');       -- ano/mod.: 18/19
    if m is not null then r := array[(case when m[1]::int <= 30 then 2000 else 1900 end) + m[1]::int, (case when m[2]::int <= 30 then 2000 else 1900 end) + m[2]::int]; end if;
  end if;
  if r is null then
    m := regexp_match(t, 'ano\s*(?:de\s*)?fab[a-zç.ãõ]*\s*[:\-]?\s*' || a || '[^0-9]{1,25}?mod[a-z.]*\s*[:\-]?\s*' || a, 'i');
    if m is not null then r := array[m[1]::int, m[2]::int]; end if;                                   -- ano fab 2019 ... modelo 2020
  end if;
  if r is null then
    m := regexp_match(t, '\mano\s*[:\-]?\s*' || a || '[\s,;/]*modelo\s*[:\-]?\s*' || a, 'i');
    if m is not null then r := array[m[1]::int, m[2]::int]; end if;                                   -- ano 2019, modelo 2020
  end if;
  if r is null then
    m := regexp_match(t, 'ano\s*(?:de\s*)?(?:fabrica[çc][ãa]o\s*)?/\s*modelo\s*[:\-]?\s*' || a, 'i');
    if m is not null then r := array[m[1]::int, m[1]::int]; end if;                                   -- ANO/MODELO 2016
  end if;
  if r is null then
    m := regexp_match(tit, '\m' || a || '\s+' || a || '\M');                                           -- título "2007 2007"
    if m is not null and m[2]::int - m[1]::int between 0 and 1 then r := array[m[1]::int, m[2]::int]; end if;
  end if;
  if r is null then
    m := regexp_match(t, 'ano\s*(?:de\s*)?fab[a-zç.ãõ]*\s*[:\-]?\s*' || a, 'i');
    if m is not null then r := array[m[1]::int, null]; end if;                                        -- Ano (de) Fabricação: 2005
  end if;
  if r is null then
    m := regexp_match(t, '\mano\s*[:\-]?\s*' || a || '\M', 'i');
    if m is not null then r := array[m[1]::int, null]; end if;                                        -- ano 2015
  end if;
  if r is null then
    m := regexp_match(tit, '(?:^|[\s\-–])' || a || '\s*(?:/\s*)?(?:$|[\s,|]|id\M)', 'i');
    if m is not null then r := array[m[1]::int, null]; end if;                                        -- ano solto NO TÍTULO
  end if;
  if r is null then return null; end if;
  if r[1] > lim or coalesce(r[2], r[1]) > lim or (r[2] is not null and (r[2] < r[1] or r[2] - r[1] > 1)) then return null; end if;
  return r;
end $$;

-- Gatilho: só PREENCHE quando o coletor não trouxe ano nenhum — nunca sobrescreve o que ele leu.
create or replace function public.trg_veiculo_ano_do_texto() returns trigger
language plpgsql set search_path to 'public' as $$
declare a int[];
begin
  if new.ano_fabricacao is null and new.ano_modelo is null then
    a := public.extrair_ano_veiculo(new.titulo, new.descricao);
    if a is not null then
      new.ano_fabricacao := a[1];
      new.ano_modelo := a[2];
      if new.fipe_status = 'sem_dados' then new.fipe_status := null; end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists veiculo_ano_do_texto on public.veiculos_leilao;
create trigger veiculo_ano_do_texto before insert or update of titulo, descricao, ano_fabricacao, ano_modelo
  on public.veiculos_leilao for each row execute function public.trg_veiculo_ano_do_texto();

-- Backfill do acervo (ativos e inativos).
update public.veiculos_leilao v
   set ano_fabricacao = x.a[1], ano_modelo = x.a[2],
       fipe_status = case when v.fipe_status = 'sem_dados' then null else v.fipe_status end
  from (select id, public.extrair_ano_veiculo(titulo, descricao) a from public.veiculos_leilao
         where ano_fabricacao is null and ano_modelo is null) x
 where v.id = x.id and x.a is not null;
