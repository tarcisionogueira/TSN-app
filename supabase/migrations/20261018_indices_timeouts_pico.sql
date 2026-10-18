-- ─────────────────────────────────────────────────────────────────────────────────────────
-- TIMEOUTS NOS PICOS DE COLETA (pendência 222) — 18/10
--
-- Medido em postgres_logs (24 h até 18/10 02h UTC, 52 timeouts). As duas maiores famílias:
--
-- (1) "última atualização da fonte" — `fonte=eq.X & ativo=eq.true & order=atualizado_em.desc & limit=1`
--     (coleta-oportunista, coleta-recente, monitor-fontes-cron, scraper-soleon…). O plano usava o índice
--     de `atualizado_em` de trás pra frente filtrando fonte/ativo: 8 ms para a CEF, mas para uma fonte com
--     ZERO lote ativo (HASTA, LEJE) ele percorre o índice inteiro (83 mil linhas) sem achar nada — e no pico
--     isso passa de 8 s. 10 timeouts num dia. Índice parcial (fonte, atualizado_em) resolve em 1 leitura.
--
-- (2) acervo_cidades_uf / acervo_cidades_todas (páginas públicas de cidade): varriam todos os ~30 mil ativos
--     e filtravam a UF na mão (112 ms parado; estoura sob carga). 10 timeouts. Índice parcial em
--     (upper(estado), cidade_norm) incluindo `cidade` deixa as duas funções lerem só o índice.
--
-- CREATE INDEX comum (não CONCURRENTLY: a migração roda em transação); tabela de 83 mil linhas = segundos.
-- ─────────────────────────────────────────────────────────────────────────────────────────

create index if not exists idx_imoveis_ativo_fonte_atualizado
  on public.imoveis_leilao (fonte, atualizado_em desc) where ativo;

create index if not exists idx_imoveis_ativo_uf_cidade
  on public.imoveis_leilao (upper(estado), cidade_norm) include (cidade) where ativo;

-- (3) desativar_leiloes_encerrados: 5 timeouts. Custa ~28 ms por lote desligado (os ~30 gatilhos BEFORE), e o
--     teto de 500 por chamada = até 14 s quando vence uma onda de praças — passa dos 8 s mesmo sem carga.
--     Lote de 150 (~4 s no pior caso); o api/desativar-encerrados-cron.js repete enquanto vier lote cheio,
--     dentro de um orçamento de tempo. Corpo idêntico ao de produção, só o `limit` mudou.
create or replace function public.desativar_leiloes_encerrados()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_n integer; v_v integer;
begin
  with alvo as (
    select id from public.imoveis_leilao
     where ativo
       and coalesce(modalidade, '') !~* 'venda[_ -]?(direta|online)'
       and (data_leilao is not null or data_leilao_2 is not null or data_fim is not null)
       and (data_leilao is null or left(data_leilao, 10) <= to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'))
       and (data_leilao_2 is null or data_leilao_2 < now())
       and (data_fim is null or data_fim <= current_date)
       and public.leilao_ja_encerrado(data_leilao, data_leilao_2, data_fim, modalidade)
       and ( not coalesce(resultado_leilao = 'sem_lance'
                          and resultado_apurado_em > now() - interval '15 days', false)
          or greatest(data_leilao_2::date, data_fim,
                      case when data_leilao ~ '^\d{4}-\d{2}-\d{2}' then left(data_leilao, 10)::date end)
             < current_date - 15 )
     limit 150
  )
  update public.imoveis_leilao i
     set ativo = false, suprimido_motivo = 'praca_vencida'
    from alvo where i.id = alvo.id;
  get diagnostics v_n = row_count;

  update public.veiculos_leilao
     set ativo = false
   where ativo
     and data_leilao < now()
     and ( (data_leilao < now() and (resultado_leilao in ('vendido', 'cancelado') or coalesce(teve_lance, false)))
        or data_leilao < now() - interval '15 days'
        or (data_leilao < now() - interval '10 days'
            and not coalesce(resultado_leilao = 'sem_lance'
                             and resultado_apurado_em > now() - interval '15 days', false)) );
  get diagnostics v_v = row_count;

  return v_n + v_v;
end;
$function$;
