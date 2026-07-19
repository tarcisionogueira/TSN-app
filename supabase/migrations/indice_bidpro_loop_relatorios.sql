-- Fecha o LOOP do Índice BidPro (cidade_indicadores): o índice de VENDA foi criado (#146) a
-- partir do acervo, mas (a) nunca foi LIDO pelos relatórios e (b) o aluguel_m2, que a migração
-- previa "semeado pelos relatórios", ficou 100% vazio. Aqui:
--   • semear_indice_relatorio(): cada relatório mercadológico ALIMENTA a microrregião com
--     venda R$/m² e aluguel R$/m² reais (de anúncios), nos 3 níveis (cidade/bairro/grid).
--     A fonte 'relatorio' (anúncios de mercado) prevalece sobre 'acervo' (avaliação de leilão);
--     re-semeaduras suavizam por média exponencial (0.5/0.5) p/ estabilidade.
--   • indice_bidpro_regiao(): LÊ o nível mais específico disponível (bairro > grid > cidade),
--     preferindo 'relatorio', para o relatório exibir o Índice BidPro de VENDA e LOCAÇÃO.
-- Ambas SECURITY DEFINER search_path '' e SÓ service_role (o relatório roda server-side) — não
-- ficam expostas a anon/authenticated, então NÃO aparecem no auditoria_seguranca.

-- normalização de bairro idêntica ao bootstrap de recalcular_cidade_indicadores()
create or replace function public._bairro_norm(p text)
returns text language sql immutable set search_path to '' as $$
  select trim(regexp_replace(lower(translate(coalesce(p,''),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc')), '[^a-z0-9]+', ' ', 'g'));
$$;

-- upsert de UM nível (relatorio prevalece; se já era relatorio, EMA 0.5 p/ não oscilar)
create or replace function public._upsert_indice_relatorio(
  p_nivel text, p_cidade_norm text, p_uf text, p_bairro_norm text, p_grid text,
  p_tipo text, p_venda numeric, p_aluguel numeric, p_n integer
) returns void
language plpgsql security definer set search_path to '' as $fn$
begin
  insert into public.cidade_indicadores(
    nivel, cidade_norm, uf, bairro_norm, geo_grid, tipo,
    venda_m2, venda_m2_mercado, aluguel_m2, n_amostras, fonte, fator_calibracao, atualizado_em)
  values (p_nivel, p_cidade_norm, p_uf, coalesce(p_bairro_norm,''), coalesce(p_grid,''), p_tipo,
    p_venda, p_venda, p_aluguel, coalesce(p_n,0), 'relatorio', 1.0, now())
  on conflict (nivel, cidade_norm, uf, bairro_norm, geo_grid, tipo) do update set
    venda_m2_mercado = case
      when excluded.venda_m2_mercado is null then public.cidade_indicadores.venda_m2_mercado
      when public.cidade_indicadores.fonte='relatorio' and public.cidade_indicadores.venda_m2_mercado is not null
        then round((public.cidade_indicadores.venda_m2_mercado*0.5 + excluded.venda_m2_mercado*0.5),0)
      else excluded.venda_m2_mercado end,
    venda_m2 = case
      when excluded.venda_m2 is null then public.cidade_indicadores.venda_m2
      when public.cidade_indicadores.fonte='relatorio' and public.cidade_indicadores.venda_m2 is not null
        then round((public.cidade_indicadores.venda_m2*0.5 + excluded.venda_m2*0.5),0)
      else excluded.venda_m2 end,
    aluguel_m2 = case
      when excluded.aluguel_m2 is null then public.cidade_indicadores.aluguel_m2
      when public.cidade_indicadores.fonte='relatorio' and public.cidade_indicadores.aluguel_m2 is not null
        then round((public.cidade_indicadores.aluguel_m2*0.5 + excluded.aluguel_m2*0.5),2)
      else excluded.aluguel_m2 end,
    n_amostras = greatest(public.cidade_indicadores.n_amostras, excluded.n_amostras),
    fonte = 'relatorio',
    atualizado_em = now();
end;
$fn$;

-- SEMEIA a microrregião (cidade sempre; bairro e grid quando houver). Recebe cidade_norm JÁ
-- normalizado (coluna gerada do imóvel) + bairro/lat/lng crus. Guarda de sanidade nas faixas.
create or replace function public.semear_indice_relatorio(
  p_cidade_norm text, p_uf text, p_bairro text, p_lat numeric, p_lng numeric,
  p_tipo text, p_venda_m2 numeric, p_aluguel_m2 numeric, p_n integer
) returns jsonb
language plpgsql security definer set search_path to '' as $fn$
declare
  v_bairro_norm text;
  v_grid text;
  v_tipo text := coalesce(nullif(p_tipo,''),'residencial');
  v_venda numeric := case when p_venda_m2 between 200 and 50000 then round(p_venda_m2,0) else null end;
  v_aluguel numeric := case when p_aluguel_m2 between 1 and 1000 then round(p_aluguel_m2,2) else null end;
begin
  if coalesce(p_cidade_norm,'')='' or coalesce(p_uf,'')='' then return null; end if;
  if v_venda is null and v_aluguel is null then return null; end if;
  v_bairro_norm := public._bairro_norm(p_bairro);
  v_grid := case when p_lat is not null and p_lat<>0 and p_lng is not null and p_lng<>0
                 then round(p_lat,2)::text||','||round(p_lng,2)::text else null end;

  -- Semeia APENAS os níveis ESPECÍFICOS (bairro/grid), onde o preço do relatório é válido para
  -- aquele ponto. O nível CIDADE fica ancorado na mediana ampla do acervo — assim um imóvel
  -- premium (ex.: um flat de R$10.980/m²) NÃO infla a cidade inteira. Sem bairro nem geo, não
  -- semeia (o relatório lê o piso da cidade, se houver).
  if v_bairro_norm <> '' then
    perform public._upsert_indice_relatorio('bairro', p_cidade_norm, upper(p_uf), v_bairro_norm, '', v_tipo, v_venda, v_aluguel, p_n);
  end if;
  if v_grid is not null then
    perform public._upsert_indice_relatorio('grid', p_cidade_norm, upper(p_uf), '', v_grid, v_tipo, v_venda, v_aluguel, p_n);
  end if;
  return jsonb_build_object('cidade_norm',p_cidade_norm,'uf',upper(p_uf),
    'bairro_norm',nullif(v_bairro_norm,''),'grid',v_grid,'venda_m2',v_venda,'aluguel_m2',v_aluguel);
end;
$fn$;

-- LÊ o índice da microrregião (mais específico vence; 'relatorio' vence 'acervo' no mesmo nível).
create or replace function public.indice_bidpro_regiao(
  p_cidade_norm text, p_uf text, p_bairro text, p_lat numeric, p_lng numeric, p_tipo text
) returns jsonb
language plpgsql security definer set search_path to '' as $fn$
declare
  v_bairro_norm text;
  v_grid text;
  v_tipo text := coalesce(nullif(p_tipo,''),'residencial');
  r record;
begin
  if coalesce(p_cidade_norm,'')='' or coalesce(p_uf,'')='' then return null; end if;
  v_bairro_norm := public._bairro_norm(p_bairro);
  v_grid := case when p_lat is not null and p_lat<>0 and p_lng is not null and p_lng<>0
                 then round(p_lat,2)::text||','||round(p_lng,2)::text else null end;

  select * into r from public.cidade_indicadores
  where cidade_norm=p_cidade_norm and uf=upper(p_uf) and tipo=v_tipo
    and (
      (nivel='bairro' and v_bairro_norm<>'' and bairro_norm=v_bairro_norm)
      or (nivel='grid' and v_grid is not null and geo_grid=v_grid)
      or (nivel='cidade')
    )
  order by case nivel when 'bairro' then 1 when 'grid' then 2 else 3 end,
           case fonte when 'relatorio' then 0 else 1 end
  limit 1;
  if not found then return null; end if;

  return jsonb_build_object(
    'nivel', r.nivel, 'fonte', r.fonte,
    'venda_m2', r.venda_m2_mercado, 'aluguel_m2', r.aluguel_m2,
    'n_amostras', r.n_amostras, 'atualizado_em', r.atualizado_em,
    'bairro_norm', nullif(r.bairro_norm,''), 'uf', r.uf);
end;
$fn$;

-- Não expor as definers a anon/authenticated (mantém o auditor limpo); só o servidor usa (service_role).
revoke execute on function public._bairro_norm(text) from public, anon, authenticated;
revoke execute on function public._upsert_indice_relatorio(text,text,text,text,text,text,numeric,numeric,integer) from public, anon, authenticated;
revoke execute on function public.semear_indice_relatorio(text,text,text,numeric,numeric,text,numeric,numeric,integer) from public, anon, authenticated;
revoke execute on function public.indice_bidpro_regiao(text,text,text,numeric,numeric,text) from public, anon, authenticated;
grant execute on function public._bairro_norm(text) to service_role;
grant execute on function public._upsert_indice_relatorio(text,text,text,text,text,text,numeric,numeric,integer) to service_role;
grant execute on function public.semear_indice_relatorio(text,text,text,numeric,numeric,text,numeric,numeric,integer) to service_role;
grant execute on function public.indice_bidpro_regiao(text,text,text,numeric,numeric,text) to service_role;
