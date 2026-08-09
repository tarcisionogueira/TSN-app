-- Busca pública de CIDADE para as páginas de leilão (08/08, pedido do dono: "uma tela de
-- busca para a pessoa digitar a cidade de interesse e encontrar o imóvel").
--
-- Sem acento e sem caixa: "sao paulo", "São Paulo" e "SAO PAULO" chegam no mesmo lugar.
-- Ordena por acervo — quem digita "campinas" quer a Campinas com 99 lotes, não a homônima
-- com 1. E agrupa por (cidade_norm, uf), não pelo nome escrito: o acervo tem "Goiania" e
-- "Goiânia" como grafias da MESMA cidade, e a primeira versão mostrava dois links idênticos
-- com as contagens partidas (164 e 31).
create or replace function public.unaccent_simples(p text)
returns text language sql immutable as $$
  select translate(coalesce(p, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')
$$;

create or replace function public.acervo_busca_cidade(p_q text)
returns table (cidade text, cidade_norm text, uf text, total bigint)
language sql stable security definer set search_path to 'public' as $$
  with q as (
    select lower(public.unaccent_simples(btrim(coalesce(p_q, '')))) as t
  ),
  achados as (
    select i.cidade_norm, i.estado as uf, i.cidade, count(*) as n
      from public.imoveis_leilao i, q
     where i.ativo
       and length(q.t) >= 2
       and (i.cidade_norm like '%' || replace(q.t, ' ', '') || '%'
            or lower(public.unaccent_simples(i.cidade)) like '%' || q.t || '%')
     group by i.cidade_norm, i.estado, i.cidade
  )
  select (array_agg(a.cidade order by a.n desc))[1] as cidade,
         a.cidade_norm, a.uf, sum(a.n) as total
    from achados a
   group by a.cidade_norm, a.uf
   order by sum(a.n) desc
   limit 40
$$;

revoke all on function public.acervo_busca_cidade(text) from public;
grant execute on function public.acervo_busca_cidade(text) to anon, authenticated, service_role;
revoke all on function public.unaccent_simples(text) from public;
grant execute on function public.unaccent_simples(text) to anon, authenticated, service_role;
