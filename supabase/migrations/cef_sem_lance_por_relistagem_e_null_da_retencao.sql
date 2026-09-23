-- ─────────────────────────────────────────────────────────────────────────────────────────
-- APURAÇÃO DA CEF SEM ACESSAR A CAIXA + o NULL que desligou a limpeza de vencidos — 23/09/2026
--
-- Pedido do dono: "resolver o acesso à Caixa para apurar a CEF". O site de detalhe
-- (venda-imoveis.caixa.gov.br, ASP com sessão) volta vazio até pelo Bright Data (20/09).
-- Não precisa dele: o CSV diário da Caixa — que já baixamos sem problema — DIZ o resultado.
-- Leilão/licitação da Caixa que termina SEM lance volta à lista como VENDA ONLINE / VENDA
-- DIRETA, com o MESMO número de imóvel (fonte_id cef_<n>). Vendido some da lista.
--
-- 1) GATILHO `trg_cef_sem_lance_por_relistagem`: na gravação do CSV, OLD.modalidade de leilão
--    (extrajudicial / licitacao_aberta) → NEW.modalidade venda_online/venda_direta = SEM LANCE.
-- 2) RETROATIVO: 1.909 CEF ativos em venda_online com data_leilao PASSADA. Essa data só pode
--    ser do leilão antigo: o CSV nunca traz data para venda online (manda null, e
--    `trg_preservar_data_leilao` mantém a anterior) e o enriquecimento só lê rótulos de
--    leilão/licitação com data FUTURA. Amostra: enriquecido em 11/08, leilão em 13/08, hoje
--    em venda online a ~64% da avaliação — a trilha exata de "foi a leilão e não vendeu".
-- 3) VENDA ONLINE NÃO VENCE POR DATA (como venda direta já não vencia): a data ali é resto do
--    leilão; o imóvel segue à venda na Caixa e sai só quando some do CSV (sumiu_da_fonte).
--
-- 4) O DEFEITO DE 22/09 QUE ISSO DESCOBRIU: a retenção de 15 dias foi escrita como
--        not (resultado_leilao in ('sem_lance','indeterminado') and resultado_apurado_em > …)
--    Com resultado_leilao NULL — quase todos os lotes — a expressão vira NULL, e WHERE NULL
--    EXCLUI a linha. Desde 22/09 22h a limpeza horária e o gatilho de gravação não desligaram
--    NENHUM leilão vencido: ~4.560 lotes vencidos aparecendo como abertos (1.919 CEF
--    licitação, 1.909 CEF venda online, 732 de leiloeiros). O vigia `leilao_vencido_ativo`
--    tinha o MESMO NULL e respondia 0 — forma #10: número plausível medindo outra coisa.
--    E `resultado_leilao_atrasado` subiu 1.441 → 3.716 porque nada saía do ar.
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- (3) venda online não vence por data
create or replace function public.leilao_ja_encerrado(p_data_leilao text, p_data_leilao_2 timestamp with time zone, p_data_fim date, p_modalidade text)
 returns boolean language sql immutable set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  select case
    when coalesce(p_modalidade,'') ~* 'venda[_ -]?(direta|online)' then false
    else coalesce(
      (select max(x) from (values
        (case when p_data_leilao ~ '[0-9]:[0-9]'
              then (nullif(p_data_leilao,''))::timestamptz
              else (nullif(p_data_leilao,''))::timestamptz + interval '1 day' - interval '1 second'
         end),
        (p_data_leilao_2),
        ((p_data_fim)::timestamptz + interval '1 day' - interval '1 second')
      ) as t(x)) < now(),
      false)
  end;
$function$;

-- (4) retenção sem o NULL — limpeza horária e gatilho de gravação
create or replace function public.desativar_leiloes_encerrados()
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare v_n integer;
begin
  update public.imoveis_leilao
     set ativo = false, suprimido_motivo = 'praca_vencida'
   where ativo
     and public.leilao_ja_encerrado(data_leilao, data_leilao_2, data_fim, modalidade)
     and not coalesce(resultado_leilao in ('sem_lance', 'indeterminado')
                      and resultado_apurado_em > now() - interval '15 days', false);
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

create or replace function public.trg_desativa_leilao_encerrado()
 returns trigger language plpgsql set search_path to 'public', 'extensions', 'pg_temp'
as $function$
begin
  if new.ativo and public.leilao_ja_encerrado(new.data_leilao, new.data_leilao_2, new.data_fim, new.modalidade)
     and not coalesce(new.resultado_leilao in ('sem_lance', 'indeterminado')
                      and new.resultado_apurado_em > now() - interval '15 days', false)
  then
    new.ativo := false;
  end if;
  return new;
end;
$function$;

-- (1) CEF: leilão/licitação → venda online/direta na mesma gravação = SEM LANCE
create or replace function public.trg_cef_sem_lance_por_relistagem()
 returns trigger language plpgsql set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.fonte = 'CEF'
     and coalesce(old.modalidade,'') in ('extrajudicial','licitacao_aberta')
     and coalesce(new.modalidade,'') ~* 'venda[_ -]?(direta|online)'
     and (new.resultado_leilao is null or new.resultado_leilao = 'indeterminado')
  then
    new.resultado_leilao := 'sem_lance';
    new.resultado_apurado_em := now();
  end if;
  return new;
end;
$function$;
drop trigger if exists trg_cef_sem_lance_por_relistagem on public.imoveis_leilao;
create trigger trg_cef_sem_lance_por_relistagem before update of modalidade on public.imoveis_leilao
  for each row execute function public.trg_cef_sem_lance_por_relistagem();

-- (4b) vigia sem o NULL
do $do$
declare
  d text := pg_get_functiondef('public.qa_invariantes()'::regprocedure);
  velho text := $v$and not (i.resultado_leilao in ('sem_lance','indeterminado') and i.resultado_apurado_em > now() - interval '15 days')$v$;
  novo  text := $n$and not coalesce(i.resultado_leilao in ('sem_lance','indeterminado') and i.resultado_apurado_em > now() - interval '15 days', false)$n$;
begin
  if position(novo in d) > 0 then raise notice 'vigia ja corrigido'; return; end if;
  if (length(d) - length(replace(d, velho, ''))) / length(velho) <> 1 then
    raise exception 'ancora do leilao_vencido_ativo nao encontrada exatamente 1x — abortando';
  end if;
  execute replace(d, velho, novo);
end
$do$;

-- (2) retroativo: CEF em venda online/direta com data de leilão passada
update public.imoveis_leilao
   set resultado_leilao = 'sem_lance', resultado_apurado_em = now()
 where fonte = 'CEF' and ativo
   and modalidade ~* 'venda[_ -]?(direta|online)'
   and resultado_leilao is null
   and data_leilao ~ '^\d{4}-\d{2}-\d{2}' and data_leilao::date < current_date;
