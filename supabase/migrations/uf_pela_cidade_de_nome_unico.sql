-- ─────────────────────────────────────────────────────────────────────────────────────────
-- UF VAZIA RECUPERADA PELA CIDADE QUANDO O NOME É ÚNICO NO PAÍS — 24/09/2026 (item 12)
--
-- `estado_fora_do_padrao` = 37 ativos: lote sem sigla de UF some de /leiloes. 21 eram SUPERBID
-- com `cidade = 'São Paulo'` e o próprio título dizendo "São Paulo-SP"; o helper `inferirUF`
-- (23/09) só age na COLETA, e esses não foram regravados. Regra no banco, na escrita: UF vazia +
-- cidade cujo nome normalizado existe em UMA ÚNICA UF no IBGE (`cidade_socio`, nível cidade) →
-- essa UF. Cidade homônima em 2+ UFs (Palmas TO/PR, Bom Jesus…) fica vazia — não se adivinha.
-- Dry-run: 76 linhas (SUPERBID São Paulo 71, SOLD São Paulo 4, SUPERBID Manaus 1).
-- ⚠️ `cidade_norm` é coluna GERADA: em gatilho BEFORE ela ainda não existe, por isso a
-- normalização é recalculada aqui com a MESMA expressão da coluna.
-- O restante (ALBERTOMACEDO 12, LEILOTECH 3, GESTAO 2, SUPERBID sem cidade…) não tem cidade
-- nenhuma — é captura, não se resolve no banco.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.uf_da_cidade_unica(p_cidade text)
returns text language sql stable set search_path to 'public' as $$
  select min(c.uf) from public.cidade_socio c
   where c.nivel = 'cidade'
     and c.cidade_norm = regexp_replace(translate(lower(coalesce(p_cidade, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'), '[^a-z0-9]', '', 'g')
     and coalesce(p_cidade, '') <> ''
  having count(distinct c.uf) = 1
$$;

create or replace function public.trg_uf_pela_cidade_unica()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if (new.estado is null or new.estado !~ '^[A-Za-z]{2}$') and coalesce(new.cidade, '') <> '' then
    new.estado := coalesce(public.uf_da_cidade_unica(new.cidade), new.estado);
  end if;
  return new;
end $$;

drop trigger if exists trg_zy_uf_pela_cidade_unica on public.imoveis_leilao;
create trigger trg_zy_uf_pela_cidade_unica
  before insert or update of estado, cidade on public.imoveis_leilao
  for each row execute function public.trg_uf_pela_cidade_unica();

update public.imoveis_leilao set estado = public.uf_da_cidade_unica(cidade)
 where (estado is null or estado !~ '^[A-Za-z]{2}$')
   and public.uf_da_cidade_unica(cidade) is not null;
