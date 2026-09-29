-- 29/09 — CIDADE DO PÁTIO NORMALIZADA (pedido do dono: filtro de estado/cidade de múltipla escolha).
--
-- `cidade`/`estado` do veículo JÁ SÃO o local do pátio (Superbid = onde o lote está; Sodré grava o
-- nome do pátio: "Guarulhos I/sp" = Pátio Guarulhos I, Rod. Dutra km 223,5). O problema era a
-- sujeira, que partia a mesma cidade em várias opções do filtro: sufixo "/sp", numeral do pátio
-- ("Curitiba I", "Curitiba Ii"), "Sem Informação/SI", UF errada ("Barretos/MG", "Monte Mor/KA") e
-- nome truncado ("Janeiro/RJ").
--
-- Referência: os 5.570 nomes OFICIAIS do IBGE (area_urbana_municipio). Medido em 29/09: 99,4% casam.
-- Ordem: nome na UF → nome único no Brasil (corrige a UF) → nome único na UF que TERMINA com o
-- texto (corrige truncamento). Sem casar, fica o texto limpo e `local_ibge = false` — o
-- invariante veiculo_cidade_fora_do_ibge aponta, para a regra melhorar com as fontes novas.
create or replace function public.chave_nome(t text) returns text language sql immutable as $f$
  select btrim(regexp_replace(translate(lower(coalesce(t,'')),
    'áàâãäéèêëíìîïóòôõöúùûüçñ''`´', 'aaaaaeeeeiiiiooooouuuucn   '), '[^a-z0-9]+', ' ', 'g'))
$f$;

create index if not exists area_urbana_municipio_chave on public.area_urbana_municipio (public.chave_nome(nome), uf);

alter table public.veiculos_leilao add column if not exists patio text;
alter table public.veiculos_leilao add column if not exists cidade_origem text;
alter table public.veiculos_leilao add column if not exists local_ibge boolean;

create or replace function public.trg_veiculo_local() returns trigger
language plpgsql set search_path = public as $f$
declare bruto text; limpa text; k text; v_uf text; m_nome text; m_uf text; n int;
begin
  bruto := nullif(btrim(coalesce(new.cidade, '')), '');
  if bruto is null then new.local_ibge := null; return new; end if;
  new.cidade_origem := bruto;
  if public.chave_nome(bruto) in ('sem informacao', 'nao informado', 'sem cidade') then
    new.cidade := null; new.patio := null; new.local_ibge := false; return new;
  end if;
  limpa := btrim(regexp_replace(bruto, '\s*/\s*[A-Za-z]{2}\s*$', ''));           -- "Bauru/sp"
  -- Numeral do pátio ("Guarulhos I", "Curitiba Ii") — é o nome do PÁTIO, não da cidade.
  if limpa ~* '\s+(i{1,3}|iv|vi{0,3})$' then
    new.patio := limpa;
    limpa := btrim(regexp_replace(limpa, '\s+(i{1,3}|iv|vi{0,3})$', '', 'i'));
  end if;
  k := public.chave_nome(limpa);
  v_uf := upper(nullif(btrim(coalesce(new.estado, '')), ''));

  select a.nome, a.uf into m_nome, m_uf from area_urbana_municipio a
   where public.chave_nome(a.nome) = k and a.uf = v_uf limit 1;
  if m_nome is null then                                                            -- UF errada
    select count(*) into n from area_urbana_municipio a where public.chave_nome(a.nome) = k;
    if n = 1 then
      select a.nome, a.uf into m_nome, m_uf from area_urbana_municipio a where public.chave_nome(a.nome) = k;
    end if;
  end if;
  if m_nome is null and v_uf is not null and length(k) >= 5 then                    -- truncado
    select count(*) into n from area_urbana_municipio a where a.uf = v_uf and public.chave_nome(a.nome) like '% ' || k;
    if n = 1 then
      select a.nome, a.uf into m_nome, m_uf from area_urbana_municipio a where a.uf = v_uf and public.chave_nome(a.nome) like '% ' || k;
    end if;
  end if;
  if m_nome is not null then
    new.cidade := m_nome; new.estado := m_uf; new.local_ibge := true;
  else
    new.cidade := initcap(limpa); new.local_ibge := false;
  end if;
  return new;
end $f$;

-- 'trg_zz_' roda depois de trg_veiculo_ano_uf_preenche (que pode preencher a UF).
drop trigger if exists trg_zz_veiculo_local on public.veiculos_leilao;
create trigger trg_zz_veiculo_local before insert or update of cidade, estado
  on public.veiculos_leilao for each row execute function public.trg_veiculo_local();

create index if not exists veiculos_leilao_estado_cidade on public.veiculos_leilao (estado, cidade) where ativo;

-- Opções do filtro: cidades COM veículo ativo, com contagem (a lista acompanha a coleta sozinha).
create or replace function public.veiculos_cidades(p_ufs text[] default null)
returns table (cidade text, estado text, n bigint)
language sql stable set search_path = public as $f$
  select cidade, estado, count(*) from veiculos_leilao
   where ativo and status_patio = 'confirmado' and cidade is not null and estado is not null
     and (p_ufs is null or cardinality(p_ufs) = 0 or estado = any(p_ufs))
   group by 1, 2 order by 2, 1
$f$;
grant execute on function public.veiculos_cidades(text[]) to anon, authenticated;

-- Acervo: reescreve cidade/estado com o próprio valor para o trigger normalizar.
update public.veiculos_leilao set cidade = coalesce(cidade_origem, cidade), estado = estado
 where ativo and cidade is not null;

-- Invariante: cidade do pátio fora do IBGE (fonte nova com formato novo). 29/09: 21 — "Campo
-- Grande" sem UF (ambíguo entre MS/RJ/PB...), "Porto Trombetas" (distrito) e "Sem Informação".
do $mig$
declare d text; ancora text := E'  )\n  select chave, titulo, categoria, gravidade, valor::bigint, limite::bigint,';
begin
  d := pg_get_functiondef('public.qa_invariantes'::regproc);
  if position('veiculo_cidade_fora_do_ibge' in d) > 0 then return; end if;
  if position(ancora in d) = 0 then raise exception 'qa_invariantes: âncora não encontrada'; end if;
  execute replace(d, ancora, $ins$,
     ('veiculo_cidade_fora_do_ibge','Captura: veículo ativo com cidade do pátio que não casa com município do IBGE — some do filtro de cidade (fonte nova com formato novo?)','Captura','gap',
       (select count(*) from veiculos_leilao where ativo and local_ibge = false), 30)
$ins$ || ancora);
end $mig$;
