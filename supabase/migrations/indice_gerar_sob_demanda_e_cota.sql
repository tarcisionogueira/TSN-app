-- Geração do Índice BidPro SOB DEMANDA + cota por plano (admin ∞ · pago 5/mês · explorador 0).
-- Semeia cidade_indicadores (mesma tabela lida pelo relatório mercadológico via indice_bidpro_regiao).
alter table public.perfis add column if not exists indice_count int not null default 0;
alter table public.perfis add column if not exists indice_mes text;

create or replace function public.limite_ia(p_role text, p_tipo text)
returns int language sql immutable as $$
  select case
    when p_role = 'admin' then null::int
    when p_tipo = 'indice' then case p_role
      when 'top2' then 5 when 'top2_anual' then 5
      when 'assessorado' then 5 when 'assessorado_anual' then 5
      when 'clube' then 5 when 'clube_anual' then 5
      when 'analista' then 100 when 'advogado' then 100
      else 0 end
    when p_tipo = 'documental' then case p_role
      when 'top2' then 15 when 'top2_anual' then 15
      when 'assessorado' then 15 when 'assessorado_anual' then 15
      when 'clube' then 15 when 'clube_anual' then 15
      when 'analista' then 100 when 'advogado' then 100
      else 0 end
    else case p_role
      when 'explorador' then 3 when 'consultor' then 5
      when 'top2' then 15 when 'top2_anual' then 15
      when 'assessorado' then 15 when 'assessorado_anual' then 15
      when 'clube' then 15 when 'clube_anual' then 15
      when 'analista' then 100 when 'advogado' then 100
      else 3 end
  end
$$;

create or replace function public.consumir_indice_por(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_role text; v_limite int; v_count int; v_mes text; v_mes_atual text := to_char(now(),'YYYY-MM');
begin
  if p_user_id is null then return jsonb_build_object('ok',false,'erro','nao_autenticado'); end if;
  select role, coalesce(indice_count,0), indice_mes into v_role, v_count, v_mes from perfis where id = p_user_id;
  v_limite := limite_ia(v_role, 'indice');
  if v_limite is null then return jsonb_build_object('ok',true,'ilimitado',true); end if;
  if v_mes is distinct from v_mes_atual then v_count := 0; end if;
  if v_count < v_limite then
    update perfis set indice_count = v_count + 1, indice_mes = v_mes_atual where id = p_user_id;
    return jsonb_build_object('ok',true,'tipo','mensal','usadas',v_count+1,'limite',v_limite);
  end if;
  return jsonb_build_object('ok',false,'erro', case when v_limite = 0 then 'sem_indice' else 'limite_mensal' end,'usadas',v_count,'limite',v_limite);
end; $$;

create or replace function public.gerar_indice_regiao(
  p_cidade_norm text, p_uf text, p_bairro text default '',
  p_lat float8 default null, p_lng float8 default null, p_tipo text default 'residencial'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_bairro_norm text := public._bairro_norm(coalesce(p_bairro,''));
  v_grid text := case when p_lat is not null and p_lng is not null
                      then round(p_lat::numeric,2)::text||','||round(p_lng::numeric,2)::text else '' end;
  v_nivel text; v_venda numeric; v_n int; v_aluguel numeric;
begin
  if v_bairro_norm <> '' then
    select percentile_cont(0.5) within group (order by i.valor_avaliacao/nullif(i.area_m2,0)), count(*)
      into v_venda, v_n from public.imoveis_leilao i
      where i.cidade_norm = p_cidade_norm and i.estado = p_uf
        and public._bairro_norm(coalesce(i.bairro,'')) = v_bairro_norm
        and i.area_m2 between 20 and 500 and i.valor_avaliacao > 0;
    if coalesce(v_n,0) >= 5 then v_nivel := 'bairro'; end if;
  end if;
  if v_nivel is null and v_grid <> '' then
    select percentile_cont(0.5) within group (order by i.valor_avaliacao/nullif(i.area_m2,0)), count(*)
      into v_venda, v_n from public.imoveis_leilao i
      where i.cidade_norm = p_cidade_norm and i.estado = p_uf and i.latitude is not null and i.longitude is not null
        and round(i.latitude::numeric,2)::text||','||round(i.longitude::numeric,2)::text = v_grid
        and i.area_m2 between 20 and 500 and i.valor_avaliacao > 0;
    if coalesce(v_n,0) >= 5 then v_nivel := 'grid'; end if;
  end if;
  if v_nivel is null then
    select percentile_cont(0.5) within group (order by i.valor_avaliacao/nullif(i.area_m2,0)), count(*)
      into v_venda, v_n from public.imoveis_leilao i
      where i.cidade_norm = p_cidade_norm and i.estado = p_uf
        and i.area_m2 between 20 and 500 and i.valor_avaliacao > 0;
    if coalesce(v_n,0) >= 5 then v_nivel := 'cidade'; v_bairro_norm := ''; v_grid := ''; end if;
  end if;
  if v_nivel is null or v_venda is null or v_venda <= 0 then
    return jsonb_build_object('gerado', false, 'motivo', 'sem_amostras', 'n', coalesce(v_n,0));
  end if;
  v_venda := round(v_venda, 0);
  v_aluguel := round(v_venda * 0.004, 2);
  insert into public.cidade_indicadores (nivel, cidade_norm, uf, bairro_norm, geo_grid, tipo,
      venda_m2, venda_m2_mercado, aluguel_m2, n_amostras, fonte, atualizado_em)
  values (v_nivel, p_cidade_norm, p_uf, v_bairro_norm, v_grid, p_tipo, v_venda, v_venda, v_aluguel, v_n, 'gerado', now())
  on conflict (nivel, cidade_norm, uf, bairro_norm, geo_grid, tipo) do update
    set venda_m2 = excluded.venda_m2, venda_m2_mercado = excluded.venda_m2_mercado,
        aluguel_m2 = coalesce(public.cidade_indicadores.aluguel_m2, excluded.aluguel_m2),
        n_amostras = excluded.n_amostras, atualizado_em = now()
    where public.cidade_indicadores.fonte not in ('relatorio','amostras');
  return jsonb_build_object('gerado', true, 'nivel', v_nivel, 'venda_m2', v_venda, 'aluguel_m2', v_aluguel, 'n_amostras', v_n);
end; $$;

revoke all on function public.consumir_indice_por(uuid) from public, anon, authenticated;
revoke all on function public.gerar_indice_regiao(text,text,text,float8,float8,text) from public, anon, authenticated;
grant execute on function public.consumir_indice_por(uuid) to service_role;
grant execute on function public.gerar_indice_regiao(text,text,text,float8,float8,text) to service_role;
