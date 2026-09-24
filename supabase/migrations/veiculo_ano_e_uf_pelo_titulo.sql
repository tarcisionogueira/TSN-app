-- ─────────────────────────────────────────────────────────────────────────────────────────
-- FILTROS DE VEÍCULO QUE ESCONDIAM O ACERVO — 24/09/2026 (mesma causa do "Tipo: Carro")
--
-- O dono achou o filtro de tipo vazio; a causa (coluna quase toda nula + filtro por igualdade)
-- se repetia em outras colunas do /veiculos. Medido nos 7.580 visíveis (ativo + pátio confirmado):
--   ano_fabricacao  2.049 (27%) → "Ano de 2015 em diante" escondia 73% do acervo. A SUPERBID
--                   (5.502 sem ano) traz o ano NO TÍTULO: "HONDA CG 160 2020 2020 BRANCA",
--                   "RENAULT/LOGAN EXP 2011/", "Ano Fabricação: 2015 / Ano modelo: 2016".
--   estado          6.861 (90%) → SODRE grava "Guarulhos I/sp" em `cidade` e deixa `estado` nulo
--                   (492 lotes fora de qualquer filtro por UF); SUPERBID manda só "São Paulo".
-- Os dois são preenchidos aqui, por gatilho (qualquer fonte, atual ou futura) + backfill.
-- Só preenche o que está NULO — o dado vindo da coleta sempre vence.
--
-- Ano: só com `tipo_veiculo` reconhecido (bomba/motor avulso trazem "(Ref.: 2037)", que
-- parece ano) e só no intervalo 1950..ano atual+1. Par "2014/2015" ou "2020 2020" = fab/modelo
-- apenas se modelo - fab ∈ {0,1}; ano solto só quando há UM ano no título.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.anos_do_titulo_veiculo(p_titulo text, out fab int, out modelo int)
language plpgsql stable set search_path to 'public' as $$
declare
  t text := lower(coalesce(p_titulo, ''));
  lim int := extract(year from now())::int + 1;
  m text[];
begin
  m := regexp_match(t, 'ano (?:de )?fabrica[çc][ãa]o:? ?(\d{4})');
  if m is not null then
    fab := m[1]::int;
    modelo := (regexp_match(t, 'ano (?:de )?modelo:? ?(\d{4})'))[1]::int;
  end if;
  if fab is null then
    m := regexp_match(t, '\yano (\d{4}) e modelo (\d{4})\y');
    if m is not null then fab := m[1]::int; modelo := m[2]::int; end if;
  end if;
  if fab is null then
    m := regexp_match(t, '\y(19[5-9]\d|20[0-3]\d) ?[/ ] ?(19[5-9]\d|20[0-3]\d)\y');
    if m is not null and m[2]::int - m[1]::int in (0, 1) then fab := m[1]::int; modelo := m[2]::int; end if;
  end if;
  -- VLANCE: "VW/SANTANA 2000 MI – 96/97 – Franca/SP" (par de 2 dígitos entre travessões)
  if fab is null then
    m := regexp_match(t, '[-–] (\d{2})/(\d{2}) [-–]');
    if m is not null and (m[2]::int - m[1]::int) in (0, 1, -99) then
      fab := case when m[1]::int > 40 then 1900 else 2000 end + m[1]::int;
      modelo := case when m[2]::int > 40 then 1900 else 2000 end + m[2]::int;
    end if;
  end if;
  -- ano solto: 2000 e 2008 ficam de fora — são NOME de modelo (Santana/Quantum 2000,
  -- Peugeot 2008) e a validação contra os 1.234 que já tinham ano pegou exatamente esses.
  if fab is null and t !~ 'ref\.?:? ?\d{4}'
     and (select count(*) from regexp_matches(t, '\y(19[5-9]\d|20[0-3]\d)\y', 'g')) = 1 then
    fab := nullif(nullif((regexp_match(t, '\y(19[5-9]\d|20[0-3]\d)\y'))[1]::int, 2000), 2008);
  end if;
  if fab is not null and (fab < 1950 or fab > lim) then fab := null; modelo := null; end if;
  if modelo is not null and (modelo < fab or modelo > lim) then modelo := null; end if;
end $$;

-- UF: sufixo "/sp" que a SODRE cola na cidade; senão, cidade de nome único no país
-- (mesma função que já preenche o imóvel — `uf_da_cidade_unica`).
create or replace function public.uf_do_veiculo(p_cidade text)
returns text language sql stable set search_path to 'public' as $$
  select coalesce(
    upper((regexp_match(coalesce(p_cidade, ''), '/\s*([A-Za-z]{2})\s*$'))[1]),
    public.uf_da_cidade_unica(regexp_replace(coalesce(p_cidade, ''), '\s+I{1,3}\s*(/.*)?$|/.*$', ''))
  )
$$;

-- nome começa depois de "trg_tipo_veiculo_preenche": gatilhos BEFORE rodam em ordem alfabética,
-- então o `tipo_veiculo` já vem preenchido quando este decide se o título é de veículo.
create or replace function public.trg_veiculo_ano_uf_preenche()
returns trigger language plpgsql set search_path to 'public' as $$
declare a record;
begin
  if new.ano_fabricacao is null and new.tipo_veiculo is not null then
    a := public.anos_do_titulo_veiculo(new.titulo);
    new.ano_fabricacao := a.fab;
    new.ano_modelo := coalesce(new.ano_modelo, a.modelo);
  end if;
  if (new.estado is null or new.estado !~ '^[A-Za-z]{2}$') and coalesce(new.cidade, '') <> '' then
    new.estado := coalesce(public.uf_do_veiculo(new.cidade), new.estado);
  end if;
  return new;
end $$;

drop trigger if exists trg_veiculo_ano_uf_preenche on public.veiculos_leilao;
create trigger trg_veiculo_ano_uf_preenche
  before insert or update of titulo, cidade, estado, ano_fabricacao, tipo_veiculo on public.veiculos_leilao
  for each row execute function public.trg_veiculo_ano_uf_preenche();

update public.veiculos_leilao
   set ano_fabricacao = (public.anos_do_titulo_veiculo(titulo)).fab,
       ano_modelo = coalesce(ano_modelo, (public.anos_do_titulo_veiculo(titulo)).modelo)
 where ano_fabricacao is null and tipo_veiculo is not null
   and (public.anos_do_titulo_veiculo(titulo)).fab is not null;

update public.veiculos_leilao
   set estado = public.uf_do_veiculo(cidade)
 where (estado is null or estado !~ '^[A-Za-z]{2}$')
   and public.uf_do_veiculo(cidade) is not null;

-- DESCONTO: 37 de 7.580 tinham `desconto_percentual`, e 100 lotes com avaliação E lance mínimo
-- ficavam fora do filtro "Desconto mín." sem motivo. Calcula quando falta, SÓ contra a avaliação
-- do leiloeiro (a FIPE é outra régua — chamá-la de "desconto" mediria outra coisa, forma nº 10).
create or replace function public.trg_veiculo_desconto_preenche()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.desconto_percentual is null and coalesce(new.valor_avaliacao, 0) > 0
     and coalesce(new.valor_minimo, 0) > 0 and new.valor_minimo <= new.valor_avaliacao then
    new.desconto_percentual := round((1 - new.valor_minimo / new.valor_avaliacao) * 100);
  end if;
  return new;
end $$;

drop trigger if exists trg_veiculo_desconto_preenche on public.veiculos_leilao;
create trigger trg_veiculo_desconto_preenche
  before insert or update of valor_minimo, valor_avaliacao, desconto_percentual on public.veiculos_leilao
  for each row execute function public.trg_veiculo_desconto_preenche();

update public.veiculos_leilao
   set desconto_percentual = round((1 - valor_minimo / valor_avaliacao) * 100)
 where desconto_percentual is null and valor_avaliacao > 0 and valor_minimo > 0
   and valor_minimo <= valor_avaliacao;
