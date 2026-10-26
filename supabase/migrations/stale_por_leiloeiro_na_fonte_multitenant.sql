-- 26/10 — desativar_imoveis_leiloeiro_stale por (fonte, leiloeiro), e nunca sobre coleta parcial.
--
-- O QUÊ: o "último visto" (max(atualizado_em)) passa a ser medido POR LEILOEIRO dentro da fonte, não pela fonte
-- inteira; e a fonte cuja última saúde diz "coleta parcial" (de tenant ou da lista) é pulada.
--
-- POR QUÊ: GESTAOLEILOES (7 domínios), VLANCE (7), LEILOTECH (17 tenants), HASTAPUBLICA, MARCOANTONIO, LJUD e
-- SUPERBID gravam vários leiloeiros na MESMA fonte. Com o máximo da FONTE, um tenant que falhava 36 h seguidas
-- tinha o acervo inteiro desligado como `sumiu_da_fonte`, porque os OUTROS tenants mantinham a fonte "fresca" —
-- exatamente o defeito que o sweep do coletor tinha (LEILOTECH, 13 lotes vivos em 26/10), só que 36 h depois e
-- sem nenhuma trava de tenant. Com o máximo por leiloeiro, só sai o lote que a rodada BOA daquele leiloeiro não
-- tocou. E a saúde `degradado` por "coleta parcial" não era motivo de pular (só "queda") — agora é.
create or replace function public.desativar_imoveis_leiloeiro_stale(margem interval default '36:00:00'::interval, teto_pct numeric default 0.40)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_desativados int := 0;
  v_puladas jsonb := '[]'::jsonb;
  r record;
  n int;
begin
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
      select b.ativos_piso, b.tem_baseline into v_piso, v_tem
        from public.fonte_baseline_aprendida() b where b.fonte = r.fonte;

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

      -- "Último visto" por LEILOEIRO da fonte (26/10): tenant parado não é varrido pelo frescor dos outros.
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
