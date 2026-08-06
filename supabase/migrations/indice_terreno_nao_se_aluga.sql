-- ─────────────────────────────────────────────────────────────────────────────
-- ÍNDICE — TERRENO NÃO SE ALUGA, NEM NA SEMEADURA (06/08/2026)
--
-- A regra é do dono, de 03/08: lote não tem mercado de locação — o que os portais devolvem
-- como "terreno para alugar" é outro produto (pátio, área de evento, chácara). Ela já valia
-- nos dois COLETORES (gerar-analise e _indice-core), mas não na porta de entrada do
-- cidade_indicadores: `semear_indice_relatorio` aceitava qualquer aluguel entre 1 e 1000 sem
-- olhar o tipo, e sobrou uma linha de terreno com R$ 68,40/m²·mês semeada na base.
--
-- Junto com o commit que tira a regra de bolso de 0,4% da tela e das rotas de geração: o
-- aluguel só existe MEDIDO, e em terreno não existe.
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.semear_indice_relatorio(p_cidade_norm text, p_uf text, p_bairro text, p_lat numeric, p_lng numeric, p_tipo text, p_venda_m2 numeric, p_aluguel_m2 numeric, p_n integer)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_bairro_norm text;
  v_grid text;
  v_tipo text := coalesce(nullif(p_tipo,''),'residencial');
  v_venda numeric := case when p_venda_m2 between 200 and 50000 then round(p_venda_m2,0) else null end;
  -- TERRENO: aluguel sempre nulo, seja qual for o valor que chegue.
  v_aluguel numeric := case when v_tipo = 'terreno' then null
                            when p_aluguel_m2 between 1 and 1000 then round(p_aluguel_m2,2)
                            else null end;
begin
  if coalesce(p_cidade_norm,'')='' or coalesce(p_uf,'')='' then return null; end if;
  if v_venda is null and v_aluguel is null then return null; end if;
  v_bairro_norm := public._bairro_norm(p_bairro);
  v_grid := case when p_lat is not null and p_lat<>0 and p_lng is not null and p_lng<>0
                 then round(p_lat,2)::text||','||round(p_lng,2)::text else null end;
  if v_bairro_norm <> '' then
    perform public._upsert_indice_relatorio('bairro', p_cidade_norm, upper(p_uf), v_bairro_norm, '', v_tipo, v_venda, v_aluguel, p_n);
  end if;
  if v_grid is not null then
    perform public._upsert_indice_relatorio('grid', p_cidade_norm, upper(p_uf), '', v_grid, v_tipo, v_venda, v_aluguel, p_n);
  end if;
  return jsonb_build_object('cidade_norm',p_cidade_norm,'uf',upper(p_uf),
    'bairro_norm',nullif(v_bairro_norm,''),'grid',v_grid,'venda_m2',v_venda,'aluguel_m2',v_aluguel);
end;
$function$;

-- Limpa o que já foi semeado (1 linha em 06/08).
update public.cidade_indicadores set aluguel_m2 = null
where tipo = 'terreno' and aluguel_m2 is not null;

-- E as amostras de locação de terreno que tenham escapado para a base do índice.
delete from public.indice_amostras where tipo = 'terreno' and natureza = 'locacao';
delete from public.indice_amostra  where tipo = 'terreno' and especie  = 'locacao';
