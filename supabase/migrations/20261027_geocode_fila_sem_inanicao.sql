-- 27/10: a fila de geocodificação ordenava só por atualizado_em DESC. Com ~800 lotes novos por dia
-- (leiloeiros conectados em 26/10) e vazão de 100–250 por hora, o lote que NÃO é recoletado nunca chega
-- à frente: havia pendente desde 09/09, e o de Feira de Santana (bb0c2247, marcado 'refazer' em 26/10)
-- ficou para trás a noite inteira. Agora metade da fatia vem dos mais novos (o que o cliente acabou de
-- ver aparecer) e metade dos mais antigos (o que está esperando há mais tempo).
create or replace function public.geocode_fila(p_lote integer default 50, p_estados text[] default null::text[])
 returns table(id uuid, titulo text, cidade text, estado text, endereco text, bairro text, cep text, condominio text)
 language sql
 stable
 set search_path to 'public'
as $function$
  with lim as (select greatest(1, least(p_lote, 500)) n),
  novos as (
    select i.id, i.titulo, i.cidade, i.estado, i.endereco, i.bairro, i.cep::text, i.nomecondominio, i.atualizado_em
      from public.imoveis_leilao i
     where i.ativo = true
       and (i.latitude is null or (i.latitude = 0 and i.geocod_nivel is null) or i.geocod_nivel = 'refazer')
       and (p_estados is null or i.estado = any(p_estados))
     order by i.atualizado_em desc
     limit (select (n + 1) / 2 from lim)
  ),
  antigos as (
    select i.id, i.titulo, i.cidade, i.estado, i.endereco, i.bairro, i.cep::text, i.nomecondominio, i.atualizado_em
      from public.imoveis_leilao i
     where i.ativo = true
       and (i.latitude is null or (i.latitude = 0 and i.geocod_nivel is null) or i.geocod_nivel = 'refazer')
       and (p_estados is null or i.estado = any(p_estados))
     order by i.atualizado_em asc
     limit (select n / 2 from lim)
  )
  select id, titulo, cidade, estado, endereco, bairro, cep, nomecondominio
    from (select * from novos union select * from antigos) u
   order by atualizado_em desc
$function$;
