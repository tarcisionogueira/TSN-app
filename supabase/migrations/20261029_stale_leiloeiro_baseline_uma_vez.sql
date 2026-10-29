-- 29/10 — STALE DE LEILOEIRO: BASELINE CALCULADA UMA VEZ SÓ. O passo "leiloeiro" do
-- limpar-imoveis-stale caiu no 57014 às 05h UTC (02h) de 29/10. Medido com o cache quente: a função
-- levava 5,5 s dos 8 s do statement_timeout, e 4,5 s eram `fonte_baseline_aprendida()` — que
-- devolve TODAS as fontes (~390 linhas, ~170 ms) e era chamada de novo para CADA uma das 310 fontes
-- do laço. Com a fila de fontes crescendo e o banco disputado às 02h, passou dos 8 s.
--
-- Agora a baseline vira um mapa jsonb antes do laço. Regras, guardas e teto: iguais à versão de
-- stale_so_com_coleta_completa.sql.
create or replace function public.desativar_imoveis_leiloeiro_stale(margem interval default '36:00:00'::interval, teto_pct numeric default 0.40)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_desativados int := 0;
  v_puladas jsonb := '[]'::jsonb;
  v_base jsonb;
  r record;
  n int;
begin
  select coalesce(jsonb_object_agg(b.fonte, jsonb_build_object('piso', b.ativos_piso, 'tem', b.tem_baseline)), '{}'::jsonb)
    into v_base
    from public.fonte_baseline_aprendida() b;

  for r in
    select i.fonte, max(i.atualizado_em) as ultimo, count(*) as total
      from public.imoveis_leilao i
     where i.ativo and i.fonte is not null
       and i.fonte not in ('CEF','SUPORTE','atribuido_manual','VENDASGOV','TORRES3','HASTA')
     group by i.fonte
    having max(i.atualizado_em) < now() - interval '2 hours'
       and max(i.atualizado_em) > now() - interval '10 days'
  loop
    declare
      v_piso int; v_tem boolean; v_ultima int; v_status text; v_motivo text; v_alvo int;
    begin
      v_piso := (v_base -> r.fonte ->> 'piso')::int;
      v_tem  := (v_base -> r.fonte ->> 'tem')::boolean;

      select s.status, s.total, s.motivo into v_status, v_ultima, v_motivo
        from public.fonte_saude s
       where s.fonte = r.fonte and coalesce(s.estrategia, '') not ilike '%escopo-reduzido%'
       order by s.executado_em desc limit 1;

      if not coalesce(v_tem, false) then
        v_puladas := v_puladas || jsonb_build_object('fonte', r.fonte, 'motivo', 'sem_baseline_aprendida');
        continue;
      end if;
      if v_status is null or v_status in ('parcial_cota','sem_cota','falhou','vazio')
         or (v_status = 'degradado' and (coalesce(v_motivo, '') ilike '%queda%' or coalesce(v_motivo, '') ilike '%parcial%')) then
        v_puladas := v_puladas || jsonb_build_object('fonte', r.fonte, 'motivo', 'coleta_incompleta', 'status', v_status);
        continue;
      end if;
      if coalesce(v_ultima, 0) < coalesce(v_piso, 0) then
        v_puladas := v_puladas || jsonb_build_object('fonte', r.fonte, 'motivo', 'coleta_abaixo_do_piso',
                                                    'ultima', v_ultima, 'piso', v_piso);
        continue;
      end if;

      select count(*) into v_alvo
        from public.imoveis_leilao i
        join (select coalesce(leiloeiro, '') lei, max(atualizado_em) ult
                from public.imoveis_leilao where ativo and fonte = r.fonte group by 1) g
          on g.lei = coalesce(i.leiloeiro, '')
       where i.ativo and i.fonte = r.fonte and i.atualizado_em < (g.ult - margem);
      if v_alvo > teto_pct * r.total then
        v_puladas := v_puladas || jsonb_build_object('fonte', r.fonte, 'motivo', 'teto_desativacao',
                                                    'desligaria', v_alvo, 'ativos', r.total);
        continue;
      end if;

      update public.imoveis_leilao i set ativo = false, suprimido_motivo = 'sumiu_da_fonte'
        from (select coalesce(leiloeiro, '') lei, max(atualizado_em) ult
                from public.imoveis_leilao where ativo and fonte = r.fonte group by 1) g
       where i.ativo and i.fonte = r.fonte and g.lei = coalesce(i.leiloeiro, '')
         and i.atualizado_em < (g.ult - margem);
      get diagnostics n = row_count;
      v_desativados := v_desativados + n;
    end;
  end loop;

  return jsonb_build_object('desativados', v_desativados, 'fontes_puladas', v_puladas, 'em', now());
end $function$;
