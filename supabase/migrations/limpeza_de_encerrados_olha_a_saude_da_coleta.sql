-- ─────────────────────────────────────────────────────────────────────────────────────────
-- A LIMPEZA DE ENCERRADOS OLHAVA O NÚMERO ERRADO — 18/08/2026
--
-- `desativar_imoveis_leiloeiro_stale` desativava "o que não veio na última coleta", mas pulava
-- a fonte quando os candidatos passavam de 40% do acervo — guarda contra scrape degradado.
--
-- O DEFEITO: esse teto se alimenta do próprio erro. Fonte que fica para trás acumula lotes não
-- vistos, o reap cresce, o teto trava com mais força, e ela NUNCA se recupera. Medido em 18/08:
-- VIP travada em 61% e PECINI em 77% — nenhuma das duas jamais teve um lote encerrado removido.
--
-- A PROVA de que era a guarda, e não a coleta: a VIP coletou 42–63 lotes TODO DIA nos últimos
-- 17 dias (histórico em `fonte_saude`), com o acervo parado em 99. A coleta estava saudável o
-- tempo todo; o acervo é que estava inflado por lotes que saíram do site entre 13 e 14/08 e
-- nunca foram removidos. Todos com `data_leilao` nulo, então a varredura de leilão encerrado
-- também não os alcançava.
--
-- CONSERTO: o gate deixa de perguntar "quanto eu removeria?" (relativo ao acervo, logo
-- contaminado) e passa a perguntar **"a última coleta veio saudável?"**, medida contra o piso
-- APRENDIDO do histórico da própria fonte (`fonte_baseline_aprendida`). Sem baseline — fonte
-- nova, poucas amostras — não desativa nada: silêncio não autoriza.
--
-- SIMULADO EM TODAS AS FONTES ANTES DE APLICAR:
--   VIP ............ 60 desativados   (os que sumiram do site)
--   CALIL .......... 34 desativados   (já era limpa antes: 26% < 40%)
--   outras 20 ...... 0                (nada muda)
--   RJLEILOES, TOTALLEILOES ... pulados por não terem baseline ainda
-- Executado: 94 desativados, 2 fontes puladas com o motivo registrado no retorno.
--
-- FICA UM CASO ABERTO, e é estrutural: a PECINI. O coletor dela visita 4–6 lotes por rodada de
-- propósito (cota do Bright Data), então o total COLETADO nunca descreve o que o site tem, e
-- nenhum piso aprendido sobre esse número faria sentido. Para ela a resposta vem da ENUMERAÇÃO
-- do sitemap (52 lotes em 1 requisição, sem visitar nada) — implementada em
-- `scripts/scraper-pecini.mjs` no mesmo commit.
-- ─────────────────────────────────────────────────────────────────────────────────────────

create or replace function public.desativar_imoveis_leiloeiro_stale(margem interval default '36:00:00'::interval, teto_pct numeric default 0.40)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
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
       and i.fonte not in ('CEF','SUPORTE','atribuido_manual')
     group by i.fonte
    having max(i.atualizado_em) < now() - interval '2 hours'
       and max(i.atualizado_em) > now() - interval '10 days'
  loop
    declare
      v_piso int; v_tem boolean; v_ultima int;
    begin
      select b.ativos_piso, b.tem_baseline into v_piso, v_tem
        from public.fonte_baseline_aprendida() b where b.fonte = r.fonte;

      select s.total into v_ultima
        from public.fonte_saude s
       where s.fonte = r.fonte and s.status = 'ok'
       order by s.executado_em desc limit 1;

      if not coalesce(v_tem, false) then
        v_puladas := v_puladas || jsonb_build_object('fonte', r.fonte, 'motivo', 'sem_baseline_aprendida');
        continue;
      end if;
      if coalesce(v_ultima, 0) < coalesce(v_piso, 0) then
        v_puladas := v_puladas || jsonb_build_object('fonte', r.fonte, 'motivo', 'coleta_abaixo_do_piso',
                                                    'ultima', v_ultima, 'piso', v_piso);
        continue;
      end if;

      update public.imoveis_leilao i set ativo = false
       where i.ativo and i.fonte = r.fonte and i.atualizado_em < (r.ultimo - margem);
      get diagnostics n = row_count;
      v_desativados := v_desativados + n;
    end;
  end loop;

  return jsonb_build_object('desativados', v_desativados, 'fontes_puladas', v_puladas, 'em', now());
end $function$;

comment on function public.desativar_imoveis_leiloeiro_stale(interval, numeric) is
  'Desativa lote que nao veio na ultima coleta. O gate e a SAUDE da coleta (piso aprendido em fonte_baseline_aprendida), nao a proporcao removida: o teto de 40% antigo se alimentava do proprio erro e travava para sempre a fonte que ficasse para tras. O parametro teto_pct fica por compatibilidade de assinatura e nao e mais usado.';

-- O DIAGNÓSTICO TEM DE DESCREVER A REGRA QUE EXISTE. Mantida no critério antigo, esta função
-- apontaria fontes que hoje limpam normalmente e esconderia as que não — invariante que
-- descreve regra revogada é pior que invariante nenhum.
create or replace function public.fontes_com_limpeza_pulada(margem interval default '36:00:00'::interval,
                                                            teto_pct numeric default 0.40)
returns table (fonte text, total bigint, candidatos bigint, pct numeric, ultimo_scrape timestamptz)
language sql stable security definer set search_path to 'public' as $$
  with ult as (
    select i.fonte, max(i.atualizado_em) as ultimo, count(*) as total
      from public.imoveis_leilao i
     where i.ativo and i.fonte is not null
       and i.fonte not in ('CEF','SUPORTE','atribuido_manual')
     group by i.fonte
      having max(i.atualizado_em) > now() - interval '10 days'
  )
  select u.fonte, u.total,
         (select count(*) from public.imoveis_leilao x
           where x.ativo and x.fonte = u.fonte and x.atualizado_em < u.ultimo - margem),
         round((select count(*) from public.imoveis_leilao x
                 where x.ativo and x.fonte = u.fonte and x.atualizado_em < u.ultimo - margem)::numeric
               / nullif(u.total,0), 3),
         u.ultimo
    from ult u
    left join public.fonte_baseline_aprendida() b on b.fonte = u.fonte
   where (not coalesce(b.tem_baseline, false)
          or coalesce((select s.total from public.fonte_saude s
                        where s.fonte = u.fonte and s.status = 'ok'
                        order by s.executado_em desc limit 1), 0) < coalesce(b.ativos_piso, 0))
     and (select count(*) from public.imoveis_leilao x
           where x.ativo and x.fonte = u.fonte and x.atualizado_em < u.ultimo - margem) > 0
   order by 3 desc;
$$;

comment on function public.fontes_com_limpeza_pulada(interval, numeric) is
  'Fontes em que desativar_imoveis_leiloeiro_stale PULA a limpeza E ha lote esperando ser limpo. Espelha o criterio NOVO (baseline aprendido + saude da ultima coleta), nao o teto de 40% antigo.';
