-- 27/10 (pendência 305): reconciliar_relistados() seguia estourando o statement timeout de 8 s.
--
-- O conserto de 23/10 (UPDATE pela PK, índices parciais (fonte, fotos->>0)) não segurou:
-- pg_stat_statements em 27/10 = 63 chamadas, média 3,0 s, pico 7,9 s; 8 falhas 57014 no cron
-- desativar-encerrados entre 22/10 e 27/10.
--
-- Medido em 27/10 com EXPLAIN (ANALYZE, BUFFERS), passo a passo:
--   veículo relistado ........ 1,06 s (4.263 páginas lidas do DISCO — o heap inteiro, 46 MB)
--   imóvel 2ª praça fundida .. 0,09 s (cache quente)
--   imóvel relistado ......... 4,89 s frio · 0,08 s quente (mesmas 23 mil páginas)
-- O custo é o agrupamento por (fonte, fotos->>0): ele percorre os 35 mil ativos pelo índice de
-- `ativo` e descarta 27 mil sem foto, lendo o heap inteiro (190 MB). Com cache frio (256 MB de
-- shared_buffers para ~1 GB de dados) isso é disco, e o disco é lento.
--
-- Por que o planejador não usa o índice parcial que JÁ existe (idx_imoveis_ativo_fonte_foto0):
-- ele estima 35.231 linhas com foto (a nulidade de `fotos->>0` não tem estatística — índice
-- PARCIAL não coleta estatística de expressão). São 7.957. Forçado a usar o parcial, o mesmo
-- agrupamento toca 10,4 mil páginas em vez de 23 mil (35 ms quente).
--
-- Duas mudanças, nenhuma toca linha de dado:
--   1. Estatística de expressão em fotos->>0 → estimativa certa → planejador escolhe o parcial.
--   2. A função vira duas (veículos / imóveis), chamadas separadas pelo cron: cada uma ganha os
--      seus 8 s em vez de somar os dois heaps frios num orçamento só. A antiga fica como
--      embrulho (mesmo retorno) para quem ainda a chama.
--
-- Descartado (registrado para não reavaliar): coluna foto0 + índice coberto (index-only scan,
-- ~0,05 s frio) — o backfill por UPDATE dispararia ~17 gatilhos BEFORE UPDATE sem filtro de
-- coluna em 8 mil lotes e a sessão não pode usar session_replication_role; INCLUDE (fotos) no
-- índice é inviável (fotos chega a 9 KB, acima do teto de tupla de índice — quebraria o upsert).

create statistics if not exists public.st_imoveis_foto0 on ((fotos->>0)) from public.imoveis_leilao;
create statistics if not exists public.st_veiculos_foto0 on ((fotos->>0)) from public.veiculos_leilao;
analyze public.imoveis_leilao;
analyze public.veiculos_leilao;

CREATE OR REPLACE FUNCTION public.reconciliar_relistados_veiculos()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_r integer; v_ids uuid[];
begin
  with grupo as (
    select fonte, fotos->>0 as foto
      from public.veiculos_leilao
     where ativo and fotos->>0 is not null
     group by 1, 2
    having count(*) between 2 and 3
  )
  select array_agg(v.id) into v_ids
    from public.veiculos_leilao v
    join grupo g on v.fonte = g.fonte and v.fotos->>0 = g.foto
   where v.ativo and v.data_leilao < now()
     and exists (select 1 from public.veiculos_leilao o
                  where o.ativo and o.id <> v.id and o.fonte = v.fonte and o.fotos->>0 = g.foto
                    and lower(o.titulo) = lower(v.titulo) and o.data_leilao > v.data_leilao);
  update public.veiculos_leilao set ativo = false
   where id = any(coalesce(v_ids, '{}')) and ativo;
  get diagnostics v_r = row_count;

  return jsonb_build_object('veiculo_relistado', v_r);
end;
$function$;

CREATE OR REPLACE FUNCTION public.reconciliar_relistados_imoveis()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_p integer; v_ri integer; v_ids uuid[];
        v_a uuid[]; v_b uuid[]; v_d2 timestamptz[]; v_v2 numeric[];
begin
  with cand as (
    select id, fonte, fotos->>0 as foto, lower(titulo) as tit, numero_matricula as mat, valor_minimo, data_leilao_2,
           case when data_leilao ~ '^\d{4}-\d{2}-\d{2}' then data_leilao::timestamptz end as d1
      from public.imoveis_leilao
     where ativo and fotos->>0 is not null
       and (fonte, fotos->>0) in (select fonte, fotos->>0 from public.imoveis_leilao
                                   where ativo and fotos->>0 is not null group by 1, 2 having count(*) = 2)
  )
  select array_agg(a.id), array_agg(b.id), array_agg(b.d1), array_agg(b.valor_minimo)
    into v_a, v_b, v_d2, v_v2
    from cand a
    join cand b
      on b.fonte = a.fonte and b.id <> a.id and b.foto = a.foto and b.tit = a.tit
     and b.d1 > a.d1 and b.d1 <= a.d1 + interval '60 days'
     and b.valor_minimo between a.valor_minimo * 0.3 and a.valor_minimo * 0.9
     and not (coalesce(a.mat, '') <> '' and coalesce(b.mat, '') <> '' and a.mat <> b.mat)
   where a.data_leilao_2 is null and b.data_leilao_2 is null and a.valor_minimo > 0;

  update public.imoveis_leilao a
     set data_leilao_2 = p.d2, valor_minimo_2 = p.v2
    from unnest(v_a, v_d2, v_v2) as p(id_a, d2, v2) where a.id = p.id_a;
  update public.imoveis_leilao b
     set ativo = false, suprimido_motivo = 'segunda_praca_em_outro_anuncio'
   where b.id = any(coalesce(v_b, '{}'));
  get diagnostics v_p = row_count;

  with grupo as (
    select fonte, fotos->>0 as foto from public.imoveis_leilao
     where ativo and fotos->>0 is not null group by 1, 2 having count(*) between 2 and 3
  )
  select array_agg(a.id) into v_ids
    from public.imoveis_leilao a
    join grupo g on a.fonte = g.fonte and a.fotos->>0 = g.foto
   where a.ativo
     and public.leilao_ja_encerrado(a.data_leilao, a.data_leilao_2, a.data_fim, a.modalidade)
     and exists (select 1 from public.imoveis_leilao b
                  where b.ativo and b.id <> a.id and b.fonte = a.fonte and b.fotos->>0 = g.foto
                    and lower(b.titulo) = lower(a.titulo)
                    and not public.leilao_ja_encerrado(b.data_leilao, b.data_leilao_2, b.data_fim, b.modalidade)
                    and not (coalesce(a.numero_matricula, '') <> '' and coalesce(b.numero_matricula, '') <> ''
                             and a.numero_matricula <> b.numero_matricula));
  update public.imoveis_leilao set ativo = false, suprimido_motivo = 'relistado'
   where id = any(coalesce(v_ids, '{}')) and ativo;
  get diagnostics v_ri = row_count;

  return jsonb_build_object('imovel_2a_praca_fundida', v_p, 'imovel_relistado', v_ri);
end;
$function$;

-- Embrulho: mesmo contrato de antes (as três chaves), para quem ainda chama a função única.
CREATE OR REPLACE FUNCTION public.reconciliar_relistados()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return public.reconciliar_relistados_veiculos() || public.reconciliar_relistados_imoveis();
end;
$function$;

revoke all on function public.reconciliar_relistados_veiculos() from public, anon, authenticated;
revoke all on function public.reconciliar_relistados_imoveis() from public, anon, authenticated;
revoke all on function public.reconciliar_relistados() from public, anon, authenticated;
grant execute on function public.reconciliar_relistados_veiculos() to service_role;
grant execute on function public.reconciliar_relistados_imoveis() to service_role;
grant execute on function public.reconciliar_relistados() to service_role;
