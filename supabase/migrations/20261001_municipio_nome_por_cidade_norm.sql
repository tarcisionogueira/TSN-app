-- NOME LEGÍVEL DO MUNICÍPIO A PARTIR DO cidade_norm (01/10).
-- Desde `cidade_norm_convencao_unica.sql` o cidade_norm é gravado SEM ESPAÇO ("santanadeparnaiba").
-- O `indice-geocodificar-cron` passava esse valor como CIDADE ao Nominatim, que não reconhece a
-- forma colada: as amostras do índice pararam de ganhar coordenada (69–100% até 11/09 → 0 de 12
-- em 01/10), e com geocod_em gravado na falha elas saíam da fila para sempre. O nome oficial vem de
-- area_urbana_municipio (5.570 municípios do IBGE); a chave casa 22/22 cidades do índice, 0 ambíguas.
create or replace function public.municipio_nome(p_cidade_norm text, p_uf text)
returns text
language sql
stable
set search_path to 'public'
as $$
  select m.nome
    from public.area_urbana_municipio m
   where m.uf = upper(btrim(p_uf))
     and regexp_replace(translate(lower(m.nome),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc'),'[^a-z0-9]+','','g')
       = regexp_replace(lower(coalesce(p_cidade_norm,'')),'[^a-z0-9]+','','g')
   limit 1;
$$;

revoke all on function public.municipio_nome(text, text) from public, anon, authenticated;
grant execute on function public.municipio_nome(text, text) to service_role;

-- Devolve à fila as amostras que falharam por causa do nome colado (desde 11/09, sem coordenada).
update public.indice_amostras
   set geocod_em = null
 where lat is null and geocod_em >= '2026-09-11';
