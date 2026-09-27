-- 27/09 — GÊMEOS VLANCE × LJUD. A plataforma Vlance (sites próprios dos leiloeiros) e o portal
-- leiloesjudiciais.com.br (fonte LJUD) são o MESMO backend: `core/api/get-lotes` idêntica e o
-- MESMO `lote_id`. O LJUD grava `ljud_<lote_id>` e o Vlance `vlance_<dominio>_<lote_id>` — o mesmo
-- imóvel entrava 2× na busca. Medido ao escrever: 48 dos 84 VLANCE ativos tinham gêmeo LJUD ativo,
-- todos com título idêntico (dry-run conferido par a par). Chave EXATA (lote_id), sem heurística.
--
-- Fica o LJUD (acervo maior, monitor de saúde e apuração de resultado já maduros); sai o VLANCE via
-- `ativo=false` + `suprimido_motivo='gemeo_ljud'` — o gatilho `preservar_supressao_gemeo`
-- (gemeos_hasta_cef.sql) impede o upsert do scraper_vlance.py de ressuscitar a linha.
-- Reativa SÓ o que esta função suprimiu, quando o gêmeo LJUD sai de cena e o lote Vlance ainda é
-- vendável (data futura ou sem data). Roda todo dia no monitor-fontes-cron. Idempotente.
create or replace function public.reconciliar_gemeos_vlance_ljud()
returns jsonb language sql volatile security definer set search_path = public, pg_temp as $$
  with ljud as materialized (
    select substring(fonte_id from '^ljud_(\d+)$') as lote
      from public.imoveis_leilao where fonte = 'LJUD' and ativo
  ),
  sup as (
    update public.imoveis_leilao v
       set ativo = false, suprimido_motivo = 'gemeo_ljud'
     where v.fonte = 'VLANCE' and v.ativo and v.suprimido_motivo is null
       and substring(v.fonte_id from '_(\d+)$') in (select lote from ljud where lote is not null)
    returning 1
  ),
  rea as (
    update public.imoveis_leilao v
       set ativo = true, suprimido_motivo = null
     where v.fonte = 'VLANCE' and v.suprimido_motivo = 'gemeo_ljud'
       and substring(v.fonte_id from '_(\d+)$') not in (select lote from ljud where lote is not null)
       and (v.data_leilao is null or v.data_leilao !~ '^\d{4}-\d{2}-\d{2}'
            or substring(v.data_leilao, 1, 10)::date >= current_date)
    returning 1
  )
  select jsonb_build_object('suprimidos', (select count(*) from sup), 'reativados', (select count(*) from rea), 'em', now());
$$;
-- Função de OPERAÇÃO (service key/cron) — cliente nenhum executa.
revoke all on function public.reconciliar_gemeos_vlance_ljud() from public, anon, authenticated;

select public.reconciliar_gemeos_vlance_ljud();
