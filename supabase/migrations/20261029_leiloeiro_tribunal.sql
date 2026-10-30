-- LEILOEIROS CREDENCIADOS NOS TRIBUNAIS (29/10, pedido do dono: "se estão listados pelos tribunais pode haver algum
-- leiloeiro que falta para nós").
--
-- Não há cadastro nacional. Cada tribunal publica quem pode ser nomeado: TJSP (API JSON, 278), EXE-PJe dos TRTs (API
-- JSON por TRT — 15, 6, 20, 9…), TRT4 e TRT18 (planilha Google publicada). O 1º cruzamento à mão (29/10, 356 pessoas)
-- achou 14 fora da junta, da triagem e do acervo — a junta não é o universo inteiro.
--
-- Uma linha por (tribunal, chave): `chave` é o id do próprio tribunal (TJSP Codigo, EXE leiloeiro.id) ou, nas
-- planilhas sem id, o nome normalizado. `situacao_cadastro` é o cruzamento com o que já temos, recalculado a cada
-- importação: 'junta_ativo' | 'junta_outra' (suspenso/cancelado na junta) | 'site_conhecido' (fora da junta, mas o
-- domínio está na junta/triagem/acervo) | 'fora' (não temos nada — é a lista a integrar).
--
-- SEM CPF, e-mail ou telefone de propósito: o EXE-PJe publica o CPF, mas para cruzar bastam nome e site. RLS ligada e
-- sem política (só service_role), como `leiloeiro_junta`.
create table if not exists public.leiloeiro_tribunal (
  id                 bigint generated always as identity primary key,
  tribunal           text not null,
  chave              text not null,
  nome               text not null,
  nome_norm          text not null,
  matricula          text,
  site               text,
  dominio            text,
  uf                 text,
  cidade             text,
  situacao_cadastro  text,
  ativo              boolean not null default true,   -- false = sumiu da lista do tribunal na última importação
  primeiro_visto_em  timestamptz not null default now(),
  visto_em           timestamptz not null default now(),
  unique (tribunal, chave)
);

create index if not exists leiloeiro_tribunal_nome_norm_idx on public.leiloeiro_tribunal (nome_norm);
create index if not exists leiloeiro_tribunal_situacao_idx on public.leiloeiro_tribunal (situacao_cadastro) where ativo;

comment on table public.leiloeiro_tribunal is
  'Leiloeiros credenciados nos tribunais (TJSP, EXE-PJe/TRTs, planilhas TRT4/TRT18), cruzados com junta/triagem/acervo. Sem CPF. Só service_role.';

alter table public.leiloeiro_tribunal enable row level security;

-- O cruzamento roda no banco (uma chamada): junta, triagem e hosts do acervo ativo. Mesma normalização de nome da
-- `landing_leiloeiros_oficiais()` (sem acento, minúsculo, sem parêntese, só letras/dígitos).
create or replace function public.leiloeiro_tribunal_cruzar()
returns table (situacao text, n bigint) language sql security definer set search_path to 'public' as $function$
  with j as (
    select trim(regexp_replace(lower(public.sem_acento(regexp_replace(nome, '\s*\(.*$', ''))), '[^a-z0-9]+', ' ', 'g')) nn,
           situacao, lower(regexp_replace(dominio, '^www\.', '')) dom
    from leiloeiro_junta),
  doms as (
    select dom from j where dom is not null
    union select lower(regexp_replace(dominio, '^www\.', '')) from leiloeiro_triagem
    union select lower(substring(url_lote from '://(?:www\.)?([^/:]+)')) from imoveis_leilao where ativo
    union select lower(substring(link_lote from '://(?:www\.)?([^/:]+)')) from veiculos_leilao where ativo),
  calc as (
    select t.id,
      case when exists (select 1 from j where j.nn = t.nome_norm and j.situacao = 'ATIVO') then 'junta_ativo'
           when exists (select 1 from j where j.nn = t.nome_norm) then 'junta_outra'
           when t.dominio is not null and t.dominio in (select dom from doms) then 'site_conhecido'
           else 'fora' end s
    from leiloeiro_tribunal t),
  upd as (
    update leiloeiro_tribunal t set situacao_cadastro = calc.s from calc
     where calc.id = t.id and t.situacao_cadastro is distinct from calc.s returning 1)
  select s, count(*) from calc join leiloeiro_tribunal t using (id) where t.ativo group by s;
$function$;

revoke all on function public.leiloeiro_tribunal_cruzar() from public, anon, authenticated;
