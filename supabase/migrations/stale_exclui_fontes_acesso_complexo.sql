-- ─────────────────────────────────────────────────────────────────────────────────────────
-- FONTES DE ACESSO COMPLEXO SAEM DA VARREDURA DE "SUMIU DA FONTE" — 18/09/2026
--
-- Pedido do dono: para leiloeiros de acesso complexo (login-gated: ZUK/GRUPOLANCE/SBID9/
-- VENDASGOV/SOLD; Cloudflare pago: TORRES3; só-residencial: HASTA), o lote capturado uma vez
-- deve ficar disponível na tela até a DATA DO LEILÃO vencer — não até a próxima recoleta
-- confirmar de novo. É o mesmo texto do dono: "uma vez armazenado, o sistema gerencia de
-- acordo com a data do leilão".
--
-- O GAP: `desativar_imoveis_leiloeiro_stale` (rodada diária, 5h UTC, `api/limpar-imoveis-
-- stale-cron.js`) usa margem FIXA de 36h pra TODAS as fontes — "não veio na coleta desde a
-- última varredura + 36h = saiu do site". Isso pressupõe recoleta em ritmo próximo de diário.
-- Se a cadência dessas fontes for espaçada (proposta do dono: recheck menos frequente,
-- justamente pela complexidade do acesso), a MESMA lógica que devia proteger o acervo passaria
-- a apagar lote que segue disponível, só porque não foi revisitado dentro de 36h — o oposto do
-- pedido. HASTA já mostrou esse padrão: 18 dias sem coletar de verdade (16/09, ritual de
-- abertura), e o único motivo de não ter sido isto ANTES é o guard `coleta_abaixo_do_piso` —
-- que só protege quando a última medição JÁ está abaixo do piso aprendido, não quando ela
-- simplesmente não aconteceu ainda dentro do espaçamento novo.
--
-- CONSERTO: estas 7 fontes saem da varredura de staleness — a mesma exceção que CEF/SUPORTE/
-- atribuido_manual já tinham, por razão análoga (elas também não seguem o ritmo "recoleta
-- ~diária" que a função pressupõe). O ciclo de vida delas passa a depender SÓ de
-- `desativar_leiloes_encerrados()` (data_leilao vencida) — que já roda de hora em hora
-- (`api/desativar-encerrados-cron.js`) e não depende de recoleta nenhuma.
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
       -- acesso complexo (login-gated/Cloudflare pago/só-residencial): ciclo de vida por
       -- data_leilao, não por recoleta — ver comentário acima.
       and i.fonte not in ('CEF','SUPORTE','atribuido_manual',
                            'ZUK','GRUPOLANCE','SBID9','VENDASGOV','SOLD','TORRES3','HASTA')
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

      update public.imoveis_leilao i set ativo = false, suprimido_motivo = 'sumiu_da_fonte'
       where i.ativo and i.fonte = r.fonte and i.atualizado_em < (r.ultimo - margem);
      get diagnostics n = row_count;
      v_desativados := v_desativados + n;
    end;
  end loop;

  return jsonb_build_object('desativados', v_desativados, 'fontes_puladas', v_puladas, 'em', now());
end $function$;
