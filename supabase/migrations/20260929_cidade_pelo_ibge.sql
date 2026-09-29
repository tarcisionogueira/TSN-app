-- ─────────────────────────────────────────────────────────────────────────────────────────
-- CIDADE CONFERIDA NO IBGE NA GRAVAÇÃO — 29/09/2026
--
-- Achado pelo geocodificador: 148 terrenos/rurais em `geocod_nivel='falhou'`, 129 da KLEILOES com
-- cidade = "Twittar Imóvel Em Maceio" (texto do botão de compartilhar, lido quando o slug do lote é
-- só "/lote"). No acervo inteiro, 280 lotes ativos com (cidade, UF) que não é município: "E Imóveis
-- E Anexos Da Comarca De Itapira", "Trabalho de Governador Valadares", "Em Feira de Santana"… Cidade
-- errada = pino errado, comparável da cidade errada e lote fora do filtro de cidade.
-- 163 foram corrigidos no mesmo dia pela regra abaixo (seco conferido: 25 de 25 amostras certas).
--
-- Regra (a mesma do conserto): se (cidade, UF) não é município do IBGE, procura o MAIOR nome de
-- município daquela UF que seja o FINAL do texto, precedido de espaço ("… Em Maceio" → Maceió).
-- Nome ≥ 4 letras. Sem candidato, não mexe — grafia variante (Poxoréo, Assu) e região do DF
-- (Ceilândia) ficam como vieram; ninguém inventa cidade. Vale para TODO coletor, presente e futuro.
-- ─────────────────────────────────────────────────────────────────────────────────────────

create or replace function public.sem_acento(t text) returns text
language sql immutable parallel safe as $$
  select lower(translate(coalesce(t, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
    'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn'))
$$;

create index if not exists area_urbana_municipio_uf_nome_idx
  on public.area_urbana_municipio (uf, public.sem_acento(nome));

create or replace function public.cidade_pelo_ibge() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_nome text; v_c text;
begin
  if new.estado is null or coalesce(new.cidade, '') = '' then return new; end if;
  v_c := public.sem_acento(new.cidade);
  if exists (select 1 from public.area_urbana_municipio m where m.uf = new.estado and public.sem_acento(m.nome) = v_c) then
    return new;
  end if;
  select m.nome into v_nome from public.area_urbana_municipio m
   where m.uf = new.estado and length(m.nome) >= 4 and v_c like '% ' || public.sem_acento(m.nome)
   order by length(m.nome) desc limit 1;
  if v_nome is not null then new.cidade := v_nome; end if;
  return new;
end $$;

drop trigger if exists trg_cidade_pelo_ibge_ins on public.imoveis_leilao;
create trigger trg_cidade_pelo_ibge_ins before insert on public.imoveis_leilao
  for each row execute function public.cidade_pelo_ibge();

drop trigger if exists trg_cidade_pelo_ibge_upd on public.imoveis_leilao;
create trigger trg_cidade_pelo_ibge_upd before update of cidade, estado on public.imoveis_leilao
  for each row when (new.cidade is distinct from old.cidade or new.estado is distinct from old.estado)
  execute function public.cidade_pelo_ibge();

revoke all on function public.cidade_pelo_ibge() from public, anon, authenticated;
