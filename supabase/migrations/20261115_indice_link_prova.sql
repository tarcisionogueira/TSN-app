-- 15/11 — CONFERÊNCIA AO VIVO DOS LINKS DO ÍNDICE (arena 15/11, P1; #484).
--
-- Piloto de 15/11 (20 links "de anúncio próprio", via pg_net): NENHUM confirmou. VivaReal 3/3, Zap 3/3, Lopes,
-- CasaMineira e 1 QuintoAndar em 404; OLX 3, Imovelweb 3, Wimoveis e Proprietário Direto devolvem 200 numa página
-- GENÉRICA ("6.040.898 Imóveis no Brasil", "OLX - O Maior Site…") — o anúncio não existe mais; 2 QuintoAndar com
-- "indisponível"; Mercado Livre monta a página por JS (não conferível daqui). Lição: "200" não é prova — no Imovelweb o
-- preço "300.000" aparecia por acaso numa listagem de 1 MB. Regra:
--   conferido      — 200, título ESPECÍFICO (não genérico), sem aviso de indisponível, e o PREÇO da amostra na página;
--   morto          — 404/410, página genérica no lugar do anúncio, ou aviso de indisponível/removido;
--   nao_conferivel — bloqueio (403/429/5xx), sem resposta, ou página que não mostra o preço (JS). Não condena.
-- Lotes de até 50 por hora (CLAUDE.md: ≤100 páginas por chamada no Micro); comparação por position(), sem regex
-- sobre a página inteira — só o título e um trecho passam por regex.

create table if not exists public.indice_link_prova (
  url_hash text primary key,
  url text not null,
  host text,
  estado text not null check (estado in ('conferido', 'morto', 'nao_conferivel')),
  http integer,
  titulo text,
  motivo text,
  verificado_em timestamptz not null default now()
);
alter table public.indice_link_prova enable row level security;   -- sem política: só service_role
revoke all on public.indice_link_prova from anon, authenticated;

-- Pede o próximo lote (links de anúncio próprio nunca conferidos ou conferidos há mais de 30 dias, e não pendentes).
create or replace function public.indice_prova_pedir(p_lim integer default 50)
returns integer language plpgsql security definer set search_path = public, bastidor as $$
declare v_n integer := 0;
begin
  with alvo as (
    select distinct on (v.url) v.url, v.id, split_part(v.url, '/', 3) host
      from public.indice_amostra_indep v
      left join public.indice_link_prova p on p.url_hash = md5(v.url)
     where v.prova in ('link_proprio', 'conferido', 'nao_conferivel') and v.url ~ '^https://'
       and (p.url_hash is null or p.verificado_em < now() - interval '30 days')
       and not exists (select 1 from bastidor.req b where b.tarefa = 'indice_prova' and b.extra = v.url)
     order by v.url
     limit greatest(1, least(p_lim, 100))
  ), ins as (
    insert into bastidor.req (req, lote_id, fonte, tarefa, extra)
    select public.pagina_pedir(a.url), a.id, a.host, 'indice_prova', a.url from alvo a
    returning 1
  )
  select count(*) into v_n from ins;
  return v_n;
end $$;

-- Lê as respostas que já chegaram, classifica, grava a prova e tira o pedido da fila.
create or replace function public.indice_prova_ler()
returns jsonb language plpgsql security definer set search_path = public, bastidor, net as $$
declare v_res jsonb;
begin
  with resp as (
    select b.req, b.extra url, b.fonte host, r.status_code st, r.error_msg erro, a.valor_total,
           left(coalesce(r.content, ''), 600000) c,
           btrim(regexp_replace(coalesce(substring(left(r.content, 200000) from '<title[^>]*>([^<]{0,200})'), ''), '\s+', ' ', 'g')) titulo
      from bastidor.req b
      join net._http_response r on r.id = b.req
      left join public.indice_amostra a on a.id = b.lote_id
     where b.tarefa = 'indice_prova'
  ), cls as (
    select resp.*,
      replace(to_char(round(valor_total), 'FM999,999,999'), ',', '.') p1,
      replace(to_char(round(valor_total / 1000) * 1000, 'FM999,999,999'), ',', '.') p2,
      (titulo ~* '^\s*[\d.]+\s+(im[óo]veis|apartamentos|casas|terrenos)|o maior site|compre e alugue|im[óo]veis direto com o propriet|n[ãa]o encontramos|p[áa]gina n[ãa]o encontrada|error 404|^\s*$') generico,
      (substring(c from 1 for 150000) ~* '(an[uú]ncio|im[óo]vel|oferta)\s+(n[ãa]o\s+(est[áa]\s+mais\s+)?dispon|indispon|removid|expirad|encerrad|n[ãa]o\s+encontrad|foi\s+vendid)') fim
      from resp
  ), clas as (
    select cls.*,
      case
        when st in (404, 410) then 'morto'
        -- Domínio que não existe (DNS): link inventado. No 1º lote, 12 de 50 — com o pg_net resolvendo os demais na
        -- mesma rodada (não é instabilidade de rede).
        when st is null and erro ~* 'resolve host' then 'morto'
        when st between 200 and 299 and (fim or (generico and titulo <> '')) then 'morto'
        when st between 200 and 299 and not generico and valor_total > 0
             and (position(p1 in c) > 0 or position(p2 in c) > 0) then 'conferido'
        else 'nao_conferivel' end estado,
      case
        when st in (404, 410) then 'HTTP ' || st
        when st is null and erro ~* 'resolve host' then 'domínio não existe'
        when st between 200 and 299 and fim then 'página diz que o anúncio não está mais disponível'
        when st between 200 and 299 and generico and titulo <> '' then 'caiu em página genérica do portal: ' || left(titulo, 80)
        when st between 200 and 299 and not generico and valor_total > 0 and (position(p1 in c) > 0 or position(p2 in c) > 0) then 'preço ' || p1 || ' na página do anúncio'
        when st is null then 'sem resposta: ' || coalesce(left(erro, 80), '?')
        when st in (403, 429) or st >= 500 then 'portal bloqueou (HTTP ' || st || ')'
        else 'página sem o preço visível (montada por JavaScript ou preço diferente)' end motivo
      from cls
  ), up as (
    insert into public.indice_link_prova (url_hash, url, host, estado, http, titulo, motivo, verificado_em)
    select distinct on (md5(url)) md5(url), url, host, estado, st, left(titulo, 200), motivo, now() from clas
    on conflict (url_hash) do update set estado = excluded.estado, http = excluded.http, titulo = excluded.titulo,
      motivo = excluded.motivo, verificado_em = excluded.verificado_em
    returning estado
  ), fila as (
    delete from bastidor.req b using clas where b.req = clas.req and b.tarefa = 'indice_prova' returning 1
  )
  select jsonb_build_object(
    'lidas', (select count(*) from clas),
    'conferido', (select count(*) from up where estado = 'conferido'),
    'morto', (select count(*) from up where estado = 'morto'),
    'nao_conferivel', (select count(*) from up where estado = 'nao_conferivel'),
    'fila_limpa', (select count(*) from fila)) into v_res;
  return v_res;
end $$;

revoke all on function public.indice_prova_pedir(integer) from public, anon, authenticated;
revoke all on function public.indice_prova_ler() from public, anon, authenticated;
grant execute on function public.indice_prova_pedir(integer) to service_role;
grant execute on function public.indice_prova_ler() to service_role;

-- A view passa a refletir a conferência: link próprio conferido → 'conferido'; morto → 'morto' (sai do cálculo na API);
-- o resto segue como estava. `prova_em` = data da última conferência (vai ao selo).
create or replace view public.indice_amostra_indep with (security_invoker = true) as
select distinct on (k.grupo) k.id, k.cidade_norm, k.uf, k.bairro_norm, k.geo_grid, k.tipo, k.especie, k.valor_m2, k.valor_total,
  k.area_m2, k.data_ref, k.fonte, k.origem, k.imovel_id, k.analise_id, k.criado_em, k.lat, k.lng, k.url, k.endereco, k.condominio,
  k.cep, k.geocod_em, k.geo_nivel, k.coord_origem, k.grupo,
  count(*) over (partition by k.grupo) as n_copias,
  case when k.url is null then 'sem_link'
       when lp.estado = 'morto' then 'morto'
       when k.n_url > 1 then 'listagem'
       when substring(k.url from '^https?://[^/]+(/[^?#]*)') ~* '\d{5,}|[-_/]id[-_]?\d+|ID_?\d{4,}|MV-\d{4}|/(imovel|listings|anuncio|propriedades)/|-cod-'
         then coalesce(case lp.estado when 'conferido' then 'conferido' when 'nao_conferivel' then 'nao_conferivel' end, 'link_proprio')
       else 'listagem' end as prova,
  lp.verificado_em as prova_em
from (
  select a.*,
    count(*) over (partition by a.url) as n_url,
    coalesce(
      case when a.valor_total > 0 and a.area_m2 > 0 then
        a.cidade_norm||'|'||a.uf||'|'||coalesce(a.tipo,'')||'|'||a.especie||'|'||coalesce(a.bairro_norm,'')||'|'||round(a.valor_total)::text||'|'||round(a.area_m2)::text
      end, 'id:'||a.id::text) as grupo
  from public.indice_amostra a
) k
left join public.indice_link_prova lp on lp.url_hash = md5(k.url)
order by k.grupo, (k.url is not null) desc, (k.coord_origem = 'geocodificada') desc nulls last, k.data_ref desc nulls last, k.criado_em desc;
revoke all on public.indice_amostra_indep from public, anon, authenticated;
grant select on public.indice_amostra_indep to service_role;

-- 1º lote (15/11): os 12 de domínio inexistente gravados como não conferíveis antes da regra acima.
update public.indice_link_prova set estado = 'morto', motivo = 'domínio não existe'
 where estado = 'nao_conferivel' and motivo like 'sem resposta: Couldn''t resolve host name%';
