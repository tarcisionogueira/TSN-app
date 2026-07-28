-- REFORÇO PROATIVO do Índice (anti "relatório vazio"): infra de seleção/rotação de cidades.
-- Usado por api/indice-reforco-cron.js — semeia o índice das cidades que importam ANTES de
-- alguém pedir o relatório, para a busca ao vivo sempre ter almofada (o caso BH de 28/07).

-- Normalização de texto no banco (espelha a norm() do JS: minúsculas, sem acento, alfanumérico).
create or replace function public.txt_norm(s text) returns text language sql immutable as $function$
  select trim(regexp_replace(
    translate(lower(coalesce(s,'')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
    '[^a-z0-9]+', ' ', 'g'));
$function$;

-- Estado do reforço (rotação): qual cidade foi reforçada e quando (evita repetir dentro de N dias).
create table if not exists public.indice_reforco_estado (
  cidade_norm text not null,
  uf text not null,
  ultimo_em timestamptz,
  amostras_ultimo int default 0,
  inseridas_ultimo int default 0,
  tentativas int default 0,
  ultimo_erro text,
  primary key (cidade_norm, uf)
);
alter table public.indice_reforco_estado enable row level security;  -- sem policy: só service_role acessa

-- Seletor: próximas cidades a reforçar. Prioriza cidades com RELATÓRIO ou muitos imóveis ATIVOS,
-- com índice MAGRO (< p_min_amostras) e não reforçadas nos últimos p_dias. Bounded (cap 20).
create or replace function public.indice_reforco_proximas(p_n int default 3, p_dias int default 14, p_min_amostras int default 60)
returns table (cidade_norm text, uf text, cidade text, n_imoveis bigint, n_relatorios bigint, n_amostras bigint)
language sql stable security definer set search_path to 'public' as $function$
  with imov as (
    select cidade_norm cn, upper(estado) uf, max(cidade) cidade, count(*) n
    from imoveis_leilao
    where coalesce(ativo,true)=true and cidade_norm is not null and cidade_norm<>'' and estado is not null
    group by cidade_norm, upper(estado)
  ),
  rel as (
    select txt_norm(cidade) cn, upper(estado) uf, max(cidade) cidade, count(*) n
    from analises_mercado
    where cidade is not null and estado is not null and txt_norm(cidade) <> ''
    group by txt_norm(cidade), upper(estado)
  ),
  cand as (
    select coalesce(i.cn, r.cn) cn, coalesce(i.uf, r.uf) uf,
           coalesce(i.cidade, r.cidade) cidade,
           coalesce(i.n,0) n_imoveis, coalesce(r.n,0) n_relatorios
    from imov i full outer join rel r on r.cn=i.cn and r.uf=i.uf
  ),
  amostras as (
    select cidade_norm cn, upper(uf) uf, count(*) n from indice_amostra group by cidade_norm, upper(uf)
  )
  select c.cn, c.uf, c.cidade, c.n_imoveis, c.n_relatorios, coalesce(a.n,0) n_amostras
  from cand c
  left join amostras a on a.cn=c.cn and a.uf=c.uf
  left join indice_reforco_estado e on e.cidade_norm=c.cn and e.uf=c.uf
  where coalesce(a.n,0) < p_min_amostras
    and (c.n_relatorios > 0 or c.n_imoveis >= 20)
    and (e.ultimo_em is null or e.ultimo_em < now() - (p_dias||' days')::interval)
  order by c.n_relatorios desc, c.n_imoveis desc, coalesce(a.n,0) asc
  limit greatest(1, least(p_n, 20));
$function$;

revoke all on function public.indice_reforco_proximas(int,int,int) from public, anon, authenticated;
grant execute on function public.indice_reforco_proximas(int,int,int) to service_role;
