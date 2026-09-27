-- 27/09 — "SUMIU DA FONTE" SÓ COM COLETA COMPLETA. Pedido do dono: fonte que falha NÃO pode
-- apagar o que já foi coletado; fica sem lote NOVO, mas o acervo fica.
--
-- desativar_imoveis_leiloeiro_stale() desligava todo lote ativo que a última coleta não tocou.
-- A guarda conferia a última medição com status 'ok' (a de dias atrás) e ignorava que a MAIS
-- RECENTE tinha sido parcial por falta de cota. CALIL em 27/09: coleta parcial leu 15 e deixou 39
-- por buscar (status 'parcial_cota') → 45 lotes com leilão até 29/10 escondidos como
-- 'sumiu_da_fonte'. O parâmetro `teto_pct` (0,40) existia na assinatura e NUNCA era usado.
--
-- Agora: (1) a medição MAIS RECENTE não pode indicar coleta INCOMPLETA — parcial_cota, sem_cota,
-- falhou, vazio, ou degradado POR QUEDA de volume → pula, com o motivo. Degradado por QUALIDADE
-- (ex.: LJUD 'link 0<0.9', coleta inteira com link ruim) não trava a limpeza, senão a fonte nunca
-- mais seria varrida e acumularia lote vencido; (2) o teto passa a valer: se a varredura desligaria mais
-- de `teto_pct` do acervo ativo da fonte, pula — queda desse tamanho é coleta quebrada até prova
-- em contrário, não 40% de lotes retirados num dia.
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

      -- a medição MAIS RECENTE (qualquer status), fora teste de escopo reduzido
      select s.status, s.total, s.motivo into v_status, v_ultima, v_motivo
        from public.fonte_saude s
       where s.fonte = r.fonte and coalesce(s.estrategia, '') not ilike '%escopo-reduzido%'
       order by s.executado_em desc limit 1;

      if not coalesce(v_tem, false) then
        v_puladas := v_puladas || jsonb_build_object('fonte', r.fonte, 'motivo', 'sem_baseline_aprendida');
        continue;
      end if;
      if v_status is null or v_status in ('parcial_cota','sem_cota','falhou','vazio')
         or (v_status = 'degradado' and coalesce(v_motivo, '') ilike '%queda%') then
        v_puladas := v_puladas || jsonb_build_object('fonte', r.fonte, 'motivo', 'coleta_incompleta', 'status', v_status);
        continue;
      end if;
      if coalesce(v_ultima, 0) < coalesce(v_piso, 0) then
        v_puladas := v_puladas || jsonb_build_object('fonte', r.fonte, 'motivo', 'coleta_abaixo_do_piso',
                                                    'ultima', v_ultima, 'piso', v_piso);
        continue;
      end if;

      select count(*) into v_alvo from public.imoveis_leilao i
       where i.ativo and i.fonte = r.fonte and i.atualizado_em < (r.ultimo - margem);
      if v_alvo > teto_pct * r.total then
        v_puladas := v_puladas || jsonb_build_object('fonte', r.fonte, 'motivo', 'teto_desativacao',
                                                    'desligaria', v_alvo, 'ativos', r.total);
        continue;
      end if;

      update public.imoveis_leilao i set ativo = false, suprimido_motivo = 'sumiu_da_fonte'
       where i.ativo and i.fonte = r.fonte and i.atualizado_em < (r.ultimo - margem);
      get diagnostics n = row_count;
      v_desativados := v_desativados + n;
    end;
  end loop;

  return jsonb_build_object('desativados', v_desativados, 'fontes_puladas', v_puladas, 'em', now());
end $function$;

-- DEVOLVE o que foi escondido sem prova: 'sumiu_da_fonte' com praça AINDA POR VIR, em fonte cuja
-- medição mais recente indica coleta INCOMPLETA (mesmo critério da guarda acima). Nas fontes com
-- coleta ok o "sumiu" pode ser legítimo (retirado/vendido antes da praça) e fica como está.
-- Se um lote devolvido tiver saído mesmo, a próxima coleta COMPLETA desliga de novo.
with fonte_nao_ok as (
  select distinct on (fonte) fonte, status, motivo from public.fonte_saude
   where coalesce(estrategia,'') not ilike '%escopo-reduzido%'
   order by fonte, executado_em desc
)
update public.imoveis_leilao i
   set ativo = true, suprimido_motivo = null
  from fonte_nao_ok f
 where f.fonte = i.fonte
   and (f.status in ('parcial_cota','sem_cota','falhou','vazio') or (f.status = 'degradado' and coalesce(f.motivo,'') ilike '%queda%'))
   and not i.ativo and i.suprimido_motivo = 'sumiu_da_fonte'
   and coalesce(i.data_fim, case when i.data_leilao ~ '^\d{4}-\d{2}-\d{2}' then substring(i.data_leilao,1,10)::date end) >= current_date;
