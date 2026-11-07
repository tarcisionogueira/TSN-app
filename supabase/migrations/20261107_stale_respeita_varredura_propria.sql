-- 07/11 — A limpeza diária (desativar_imoveis_leiloeiro_stale_lote, chamada pelo limpar-imoveis-stale-cron)
-- desligava como `sumiu_da_fonte` todo lote cujo `atualizado_em` ficou 36 h atrás do mais novo da mesma fonte.
-- Para os coletores do MOTOR (scripts/lib/motor) e do SOLEON, `atualizado_em` antigo NÃO quer dizer "saiu do
-- site": eles releem só `maxRefresh` lotes por rodada (40 por padrão). Medido hoje com a fórmula da função:
-- D1LANCE 19/78, CALIL 20/72, LEILOPAR 47/126 elegíveis — todos abaixo do teto de 40%, então desligáveis.
-- E o motor não reativa lote inativo (ele fica no `meta` e a releitura filtra `ativo`): a perda era permanente.
--
-- Esses coletores já têm varredura EXATA por presença na lista (runner.mjs, scraper-soleon.mjs,
-- scraper-globo.mjs). Aqui eles saem da limpeza por data; o resto do corpo é o de produção em 07/11.
create or replace function public._fonte_tem_varredura_propria(p_estrategia text)
 returns boolean language sql immutable set search_path to 'public'
as $$
  select coalesce(regexp_replace(lower(p_estrategia), '-escopo-reduzido$', '') = any (array[
    'soleon','inertia-json',
    'albertomacedo','alfa','alliance','ares','arnaldo','baston','benedetto','botelho','campolina','cassiano',
    'cristianoescola','d1lance','dian','eleiloes','emiliomatos','externo','flaviogarcia','francoleiloes','freitas',
    'globo','hasta','jeleiloes','jorgebrasil','kwara','labasoft','lancevip','leilaobrasil','leilaoeletronico',
    'leilaoindex','leilaopro','leilo','leiloar','leiloesbr','leiloesbrasilto','leilovia','leje','lucian',
    'marcusvinicius','mgl','msis','mvleiloes','nakakogue','nordeste','nortedeminas','parquedosleiloes',
    'portaldosleiloes','rocha','roisoft','sbidloja','simon','softgt','suporteclassico','suporteoferta',
    'suportev2','triacca','turani','vixleiloes','wrleiloes']), false);
$$;

create or replace function public.desativar_imoveis_leiloeiro_stale_lote(margem interval default '36:00:00'::interval, teto_pct numeric default 0.40, lote integer default 200)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
      v_piso int; v_tem boolean; v_ultima int; v_status text; v_motivo text; v_alvo int; v_estr text;
    begin
      v_piso := (v_base -> r.fonte ->> 'piso')::int;
      v_tem  := (v_base -> r.fonte ->> 'tem')::boolean;

      select s.status, s.total, s.motivo, s.estrategia into v_status, v_ultima, v_motivo, v_estr
        from public.fonte_saude s
       where s.fonte = r.fonte and coalesce(s.estrategia, '') not ilike '%escopo-reduzido%'
       order by s.executado_em desc limit 1;

      if public._fonte_tem_varredura_propria(v_estr) then
        v_puladas := v_puladas || jsonb_build_object('fonte', r.fonte, 'motivo', 'varredura_propria_por_lista', 'estrategia', v_estr);
        continue;
      end if;
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
