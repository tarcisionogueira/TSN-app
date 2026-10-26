-- #305 (26/10): desativar_leiloes_encerrados lia os 34.286 lotes ativos a cada chamada (2,1 s com o banco ocioso,
-- statement timeout de 8 s sob concorrência: 25/10 19:37 e 22:37). 17.017 nem têm data — nunca são elegíveis.
-- Mesmas regras, agora por índice: só os ativos com 1ª praça já passada (~2.926) + os sem data_leilao com
-- 2ª praça/data_fim (~39). A parte de veículos não muda.
create index if not exists idx_il_ativo_dl10
  on public.imoveis_leilao (left(data_leilao, 10)) where ativo and data_leilao is not null;
create index if not exists idx_il_ativo_sem_dl
  on public.imoveis_leilao (id) where ativo and data_leilao is null and (data_leilao_2 is not null or data_fim is not null);

create or replace function public.desativar_leiloes_encerrados()
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare v_n integer; v_v integer; v_hoje text := to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD');
begin
  with cand as (
    select id, data_leilao, data_leilao_2, data_fim, modalidade, resultado_leilao, resultado_apurado_em
      from public.imoveis_leilao where ativo and data_leilao is not null and left(data_leilao, 10) <= v_hoje
    union all
    select id, data_leilao, data_leilao_2, data_fim, modalidade, resultado_leilao, resultado_apurado_em
      from public.imoveis_leilao where ativo and data_leilao is null and (data_leilao_2 is not null or data_fim is not null)
  ), alvo as (
    select id from cand
     where coalesce(modalidade, '') !~* 'venda[_ -]?(direta|online)'
       and (data_leilao_2 is null or data_leilao_2 < now())
       and (data_fim is null or data_fim <= current_date)
       and public.leilao_ja_encerrado(data_leilao, data_leilao_2, data_fim, modalidade)
       and ( not coalesce(resultado_leilao = 'sem_lance'
                          and resultado_apurado_em > now() - interval '15 days', false)
          or greatest(data_leilao_2::date, data_fim,
                      case when data_leilao ~ '^\d{4}-\d{2}-\d{2}' then left(data_leilao, 10)::date end)
             < current_date - 15 )
     limit 40
  )
  update public.imoveis_leilao i
     set ativo = false, suprimido_motivo = 'praca_vencida'
    from alvo where i.id = alvo.id;
  get diagnostics v_n = row_count;

  with alvo_v as (
    select id from public.veiculos_leilao
     where ativo
       and data_leilao < now()
       and ( (resultado_leilao in ('vendido', 'cancelado') or coalesce(teve_lance, false))
          or data_leilao < now() - interval '15 days'
          or (data_leilao < now() - interval '10 days'
              and not coalesce(resultado_leilao = 'sem_lance'
                               and resultado_apurado_em > now() - interval '15 days', false)) )
     limit 40
  )
  update public.veiculos_leilao v
     set ativo = false
    from alvo_v where v.id = alvo_v.id;
  get diagnostics v_v = row_count;

  return v_n + v_v;
end;
$function$;

-- Também aplicado em 26/10 e INÚTIL na prática: o planejador não prova o predicado deste índice parcial para a
-- consulta de registrar_anexos_do_espelho (testado com enable_seqscan=off: escolhe outro índice). Registrado aqui
-- porque existe no banco; a remoção é do dono (DROP trava o MCP):  drop index public.idx_doc_espelho_copiado;
create index if not exists idx_doc_espelho_copiado
  on public.documento_espelho (imovel_id, tipo, bytes desc)
  include (storage_path, url_origem, criado_em)
  where status = 'copiado' and imovel_id is not null and storage_path is not null
    and coalesce(bytes, 0) >= 5000 and tipo in ('matricula', 'edital', 'laudo', 'regras');
