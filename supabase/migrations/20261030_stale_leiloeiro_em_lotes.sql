-- 30/10 — STALE DE LEILOEIRO EM LOTES. O conserto de 29/10 (baseline uma vez só) não bastou: às 05h UTC
-- (02h) de 30/10 o passo "leiloeiro" do limpar-imoveis-stale caiu de novo no 57014. Medido às 07h30 com a
-- mesma lógica, só leitura: baseline 19 ms · agrupamento 162 ms · alvos por fonte 374 ms (2.025 lotes
-- candidatos antes das guardas). A seleção cabe folgada; o que estoura os 8 s do authenticator é o UPDATE
-- ÚNICO sobre todos os sumidos, cada linha atravessando ~30 gatilhos, no horário em que o runner residencial
-- e a onda de crons disputam o banco — a mesma causa que o CEF resolveu em 17/10
-- (20261017_limpeza_diaria_em_lotes.sql).
--
-- Agora `_lote` desliga no máx. `lote` linhas por chamada e diz se terminou (`completo`); o cron chama até
-- `completo` ou acabar o orçamento. Regras, guardas e teto: iguais à versão de 29/10. Fatiar não afrouxa o
-- teto: a guarda de 40% roda ANTES de desligar qualquer lote da fonte, e cada chamada a recalcula sobre o
-- que sobrou ativo — (alvo−k)/(total−k) só diminui. A função de 2 argumentos vira invólucro (lote nulo =
-- sem limite), para quem ainda a chama.
create or replace function public.desativar_imoveis_leiloeiro_stale_lote(margem interval default '36:00:00'::interval, teto_pct numeric default 0.40, lote integer default 200)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_desativados int := 0;
  v_puladas jsonb := '[]'::jsonb;
  v_base jsonb;
  v_cheio boolean := false;
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
      if v_alvo = 0 then continue; end if;

      -- Já chegou ao teto da chamada: as guardas acima seguem valendo para o relatório de puladas,
      -- mas nada mais é desligado agora — a próxima chamada continua daqui.
      if lote is not null and v_desativados >= lote then
        v_cheio := true;
        continue;
      end if;

      update public.imoveis_leilao i set ativo = false, suprimido_motivo = 'sumiu_da_fonte'
       where i.id in (
         select i2.id
           from public.imoveis_leilao i2
           join (select coalesce(leiloeiro, '') lei, max(atualizado_em) ult
                   from public.imoveis_leilao where ativo and fonte = r.fonte group by 1) g
             on g.lei = coalesce(i2.leiloeiro, '')
          where i2.ativo and i2.fonte = r.fonte and i2.atualizado_em < (g.ult - margem)
          limit case when lote is null then null else lote - v_desativados end);
      get diagnostics n = row_count;
      v_desativados := v_desativados + n;
      if lote is not null and n < v_alvo then v_cheio := true; end if;
    end;
  end loop;

  return jsonb_build_object('desativados', v_desativados, 'completo', not v_cheio,
                            'fontes_puladas', v_puladas, 'em', now());
end $function$;

create or replace function public.desativar_imoveis_leiloeiro_stale(margem interval default '36:00:00'::interval, teto_pct numeric default 0.40)
returns jsonb language sql security definer set search_path to 'public' as $function$
  select public.desativar_imoveis_leiloeiro_stale_lote(margem, teto_pct, null);
$function$;

revoke all on function public.desativar_imoveis_leiloeiro_stale_lote(interval, numeric, integer) from public, anon, authenticated;
grant execute on function public.desativar_imoveis_leiloeiro_stale_lote(interval, numeric, integer) to service_role;
