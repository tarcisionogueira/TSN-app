-- 13/10 (tarde): as três regras de cópia (relistado / 2ª praça em outro anúncio) SAEM de
-- desativar_leiloes_encerrados() para uma função própria. Motivo medido: o cron horário que chama
-- aquela função já estourava o statement timeout de 8 s do PostgREST em 1 de cada 2 horas ANTES
-- delas (04h, 08h, 10h, 12h UTC de 13/10), e cada falha abortava o resto da varredura (desconto
-- anunciado e números da vitrine). Somar ~2 s ali piorava. Separadas, cada RPC tem o próprio teto.
CREATE OR REPLACE FUNCTION public.desativar_leiloes_encerrados()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_n integer; v_v integer;
begin
  update public.imoveis_leilao
     set ativo = false, suprimido_motivo = 'praca_vencida'
   where ativo
     and public.leilao_ja_encerrado(data_leilao, data_leilao_2, data_fim, modalidade)
     and not coalesce(resultado_leilao in ('sem_lance', 'indeterminado')
                      and resultado_apurado_em > now() - interval '15 days', false);
  get diagnostics v_n = row_count;

  update public.veiculos_leilao
     set ativo = false
   where ativo
     and data_leilao is not null
     and ( (resultado_leilao in ('vendido', 'cancelado') and data_leilao < now() - interval '2 days')
        or (data_leilao < now() - interval '10 days'
            and not coalesce(resultado_leilao in ('sem_lance', 'indeterminado')
                             and resultado_apurado_em > now() - interval '15 days', false)) );
  get diagnostics v_v = row_count;

  return v_n + v_v;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reconciliar_relistados()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_r integer; v_p integer; v_ri integer;
begin
  -- (1) veículo relistado: sai a oferta antiga (já realizada) quando há outra mais nova do mesmo bem.
  with grupo as (
    select fonte, fotos->>0 as foto
      from public.veiculos_leilao
     where ativo and fotos->>0 is not null
     group by 1, 2
    having count(*) between 2 and 3
  )
  update public.veiculos_leilao v
     set ativo = false
    from grupo g
   where v.ativo and v.fonte = g.fonte and v.fotos->>0 = g.foto
     and v.data_leilao < now()
     and exists (select 1 from public.veiculos_leilao o
                  where o.ativo and o.id <> v.id and o.fonte = v.fonte and o.fotos->>0 = g.foto
                    and lower(o.titulo) = lower(v.titulo) and o.data_leilao > v.data_leilao);
  get diagnostics v_r = row_count;

  -- (2) imóvel: 2ª praça publicada como outro anúncio → funde na 1ª.
  -- `data_leilao` é TEXTO nesta tabela (data_leilao_2 é timestamptz): converte com a mesma leitura
  -- de leilao_ja_encerrado(), só para o que tem cara de data ISO — um cast falho derrubaria a
  -- limpeza horária inteira.
  with cand as (
    select id, fonte, fotos->>0 as foto, lower(titulo) as tit, numero_matricula as mat, valor_minimo, data_leilao_2,
           case when data_leilao ~ '^\d{4}-\d{2}-\d{2}' then data_leilao::timestamptz end as d1
      from public.imoveis_leilao
     where ativo and fotos->>0 is not null
       and (fonte, fotos->>0) in (select fonte, fotos->>0 from public.imoveis_leilao
                                   where ativo and fotos->>0 is not null group by 1, 2 having count(*) = 2)
  ), par as (
    select a.id as id_a, b.id as id_b, b.d1 as d2, b.valor_minimo as v2
      from cand a
      join cand b
        on b.fonte = a.fonte and b.id <> a.id and b.foto = a.foto and b.tit = a.tit
       and b.d1 > a.d1 and b.d1 <= a.d1 + interval '60 days'
       and b.valor_minimo between a.valor_minimo * 0.3 and a.valor_minimo * 0.9
       and not (coalesce(a.mat, '') <> '' and coalesce(b.mat, '') <> '' and a.mat <> b.mat)
     where a.data_leilao_2 is null and b.data_leilao_2 is null and a.valor_minimo > 0
  ), funde as (
    update public.imoveis_leilao a
       set data_leilao_2 = p.d2, valor_minimo_2 = p.v2
      from par p where a.id = p.id_a
    returning p.id_b
  )
  update public.imoveis_leilao b
     set ativo = false, suprimido_motivo = 'segunda_praca_em_outro_anuncio'
    from funde f where b.id = f.id_b;
  get diagnostics v_p = row_count;

  -- (3) imóvel relistado: a oferta antiga já encerrou e há uma nova, do mesmo bem, ainda por vir.
  with grupo as (
    select fonte, fotos->>0 as foto from public.imoveis_leilao
     where ativo and fotos->>0 is not null group by 1, 2 having count(*) between 2 and 3
  )
  update public.imoveis_leilao a
     set ativo = false, suprimido_motivo = 'relistado'
    from grupo g
   where a.ativo and a.fonte = g.fonte and a.fotos->>0 = g.foto
     and public.leilao_ja_encerrado(a.data_leilao, a.data_leilao_2, a.data_fim, a.modalidade)
     and exists (select 1 from public.imoveis_leilao b
                  where b.ativo and b.id <> a.id and b.fonte = a.fonte and b.fotos->>0 = g.foto
                    and lower(b.titulo) = lower(a.titulo)
                    and not public.leilao_ja_encerrado(b.data_leilao, b.data_leilao_2, b.data_fim, b.modalidade)
                    and not (coalesce(a.numero_matricula, '') <> '' and coalesce(b.numero_matricula, '') <> ''
                             and a.numero_matricula <> b.numero_matricula));
  get diagnostics v_ri = row_count;

  return jsonb_build_object('veiculo_relistado', v_r, 'imovel_2a_praca_fundida', v_p, 'imovel_relistado', v_ri);
end;
$function$;
revoke all on function public.reconciliar_relistados() from public, anon, authenticated;
grant execute on function public.reconciliar_relistados() to service_role;
