-- 04/09 — as duas varreduras de "sumiu da fonte" que faltavam ganhar suprimido_motivo.
--
-- Achado investigando por que o contador de /leiloes caiu de ~30.700 para ~26.600 em 2 dias:
-- desativar_imoveis_cef_vencidos() (cron diário limpar-imoveis-stale-cron, adicionado em
-- 31/08) desativou 7.274 lotes da CEF nos últimos 3 dias, TODOS com suprimido_motivo NULO —
-- o mesmo buraco que a suprimido_motivo_passa_a_ser_preenchido.sql (12/08) fechou para o
-- sweep do scraper-puppeteer.mjs, mas essa migração não tocou nas duas varreduras que vivem
-- como RPC no banco (CEF é uma fonte separada, csv, não passa por scraper-puppeteer.mjs).
--
-- A queda em si NÃO é bug: os 7.274 lotes foram criados majoritariamente em meados de junho
-- (mediana ~90 dias atrás) e o scrape de CEF do dia (fonte_saude, status 'ok') não os
-- reencontrou no CSV — ou seja, sumiram da Caixa há tempo e só agora um cron recém-criado
-- (31/08) finalmente os alcançou. Mas até esta migração, ISSO FICAVA INVISÍVEL no rastro do
-- banco: a próxima vez que o acervo oscilar, dá para responder com uma consulta em vez de
-- reconstruir a investigação inteira.
--
-- desativar_imoveis_leiloeiro_stale() tinha o MESMO buraco — terceira varredura de "stale"
-- que não gravava motivo (a puppeteer.mjs, a CEF, e esta).

create or replace function public.desativar_imoveis_cef_vencidos(margem interval default '1 day'::interval)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n integer;
begin
  with mx as (
    select estado, max(atualizado_em) m
    from imoveis_leilao where fonte='CEF' group by estado
  )
  update imoveis_leilao t set ativo=false, suprimido_motivo='sumiu_da_fonte'
  from mx
  where mx.estado = t.estado
    and t.fonte='CEF' and t.ativo=true
    and t.atualizado_em < mx.m - margem;
  get diagnostics n = row_count;
  return n;
end;
$function$;

-- Reativação da CEF é a ÚNICA porta que devolve suprimido_motivo a null nesta fonte (o
-- upsert do scraper.js NÃO escreve `ativo`, de propósito — ver o comentário em scripts/
-- scraper.js). Sem isto, um lote que a Caixa republica no CSV voltava a ativo=true mas
-- ficava com o rótulo velho ("sumiu_da_fonte") para sempre — uma mentira honesta, mas
-- ainda uma mentira.
create or replace function public.reativar_imoveis_cef(p_fonte_ids text[])
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n integer;
begin
  update imoveis_leilao
     set ativo = true, suprimido_motivo = null
   where fonte = 'CEF'
     and ativo = false
     and status = 'disponivel'
     and fonte_id = any (p_fonte_ids);
  get diagnostics n = row_count;
  return n;
end;
$function$;

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
  -- O GATE PASSOU A OLHAR A SAUDE DA COLETA, NAO A PROPORCAO DA REMOCAO (18/08).
  --
  -- O teto de 40% sobre o acervo se alimentava do proprio erro: fonte que fica para tras tem
  -- reap maior, o teto trava mais, e ela nunca se recupera. VIP travada em 61% e PECINI em 77%
  -- por isso — nenhuma das duas teve UM lote encerrado removido desde que existem.
  --
  -- Agora a pergunta e outra e independente do acervo: "a ULTIMA coleta veio saudavel?",
  -- medida contra o piso APRENDIDO do historico da propria fonte (fonte_baseline_aprendida).
  -- Sem baseline (fonte nova, poucas amostras) nao desativa nada — silencio nao autoriza.
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

      update public.imoveis_leilao i set ativo = false, suprimido_motivo = 'sumiu_da_fonte'
       where i.ativo and i.fonte = r.fonte and i.atualizado_em < (r.ultimo - margem);
      get diagnostics n = row_count;
      v_desativados := v_desativados + n;
    end;
  end loop;

  return jsonb_build_object('desativados', v_desativados, 'fontes_puladas', v_puladas, 'em', now());
end $function$;

-- Grants preservados por construção: as três funções mantêm exatamente a mesma assinatura
-- (mesmos nomes/tipos/defaults de parâmetro) — CREATE OR REPLACE substitui o corpo sem criar
-- overload novo, então não há reset de EXECUTE para revisar (diferente do footgun já visto
-- nesta sessão com meu_nivel/garantia_7d_avaliar, que ADICIONARAM parâmetro).
