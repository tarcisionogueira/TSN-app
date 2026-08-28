-- O ÍNDICE BIDPRO PERDIA O LOTE INTEIRO QUANDO UMA AMOSTRA JÁ EXISTIA (28/08)
--
-- MEDIDO, e é o que fecha o diagnóstico: em 28/08 o dono gerou três relatórios da MESMA cidade
-- (Campo Grande) às 17:21, 17:58 e 18:01. Só o primeiro gravou amostras — 17 linhas. Os outros
-- dois gravaram ZERO. Não por falta de amostra nova: por terem amostra REPETIDA, e uma repetida
-- derrubava o INSERT inteiro.
--
-- POR QUÊ: `indice_amostra` deduplica por um índice de EXPRESSÃO (`uq_indice_amostra_deduce`:
-- cidade, uf, espécie, COALESCE(valor_m2,-1), COALESCE(valor_total,-1), data_ref,
-- COALESCE(fonte,'')). O PostgREST, com `resolution=ignore-duplicates` e sem `on_conflict`,
-- resolve pela PRIMARY KEY — aqui um `id` gerado, que nunca conflita. O lote seguia até bater no
-- índice real e voltava 409, levando junto as amostras novas.
--
-- E NÃO DÁ PARA CONSERTAR COM `on_conflict=` NA URL, que foi o remédio de `gerar-slots`: o
-- parâmetro do PostgREST aceita NOMES DE COLUNA, e este índice é sobre EXPRESSÕES. Daí a RPC —
-- `on conflict do nothing` SEM ALVO cobre qualquer índice único, expressão inclusive.
--
-- Devolve QUANTAS linhas entraram, e não um "ok": os chamadores engoliam o resultado num
-- try/catch, então nem sabiam que perdiam. Contagem é o que permite notar a perda.
--
-- DUAS COISAS QUE OS TESTES DELA PEGARAM, e que valem mais que a função:
--  1. `jsonb_to_recordset` devolve NULL para campo ausente, enquanto o PostgREST OMITE a coluna
--     e deixa o DEFAULT agir. Trocar o mecanismo de escrita sem reproduzir os defaults
--     transformaria "campo ausente" em "NULL explícito", e o que era gravado passaria a falhar.
--     O comportamento que importava não estava no chamador: estava no DDL da tabela.
--  2. Uma linha inválida (sem âncora de localização, ou sem NOT NULL obrigatório) derrubava o
--     lote pelo CHECK — o mesmo defeito, com outra causa. Os chamadores filtram antes, mas se a
--     validação vive só no chamador, basta um caminho novo esquecê-la para o silêncio voltar.
--     A regra fica AQUI, ao lado do INSERT, onde nenhum chamador escapa dela.

create or replace function public.indice_amostra_inserir(p_linhas jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_inseridas integer;
begin
  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) = 0 then
    return 0;
  end if;

  with novas as (
    insert into public.indice_amostra
      (cidade_norm, uf, bairro_norm, geo_grid, tipo, especie, valor_m2, valor_total, area_m2,
       data_ref, fonte, origem, imovel_id, analise_id, lat, lng, url, endereco, condominio)
    select
      x.cidade_norm, x.uf,
      coalesce(x.bairro_norm, ''),            -- default da coluna
      coalesce(x.geo_grid, ''),               -- default da coluna
      coalesce(x.tipo, 'residencial'),        -- default da coluna
      x.especie, x.valor_m2, x.valor_total, x.area_m2, x.data_ref, x.fonte,
      coalesce(x.origem, 'relatorio'),        -- default da coluna
      x.imovel_id, x.analise_id, x.lat, x.lng, x.url, x.endereco, x.condominio
      from jsonb_to_recordset(p_linhas) as x(
        cidade_norm text, uf text, bairro_norm text, geo_grid text, tipo text, especie text,
        valor_m2 numeric, valor_total numeric, area_m2 numeric, data_ref date, fonte text,
        origem text, imovel_id text, analise_id uuid, lat double precision, lng double precision,
        url text, endereco text, condominio text)
     -- NOT NULL sem default: linha incompleta é PULADA, não derruba o lote.
     where x.cidade_norm is not null and x.uf is not null
       and x.especie is not null and x.data_ref is not null
     -- Âncora de localização (espelha `indice_amostra_ancora_check`).
       and (coalesce(btrim(x.bairro_norm), '') <> '' or x.endereco is not null or x.condominio is not null)
    on conflict do nothing
    returning 1
  )
  select count(*) into v_inseridas from novas;

  return coalesce(v_inseridas, 0);
end;
$function$;

revoke all on function public.indice_amostra_inserir(jsonb) from public, anon, authenticated;
