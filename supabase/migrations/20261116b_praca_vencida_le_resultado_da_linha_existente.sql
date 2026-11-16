-- MESMO DEFEITO, OUTRO CAMPO (16/11, conferido no navegador): a ZUK continua listando o lote depois do leilão
-- ("Este leilão já foi encerrado, mas ainda aceita propostas" — ex. zuk_38206-238991, São Caetano do Sul, R$ 5 mi).
-- A apuração grava `resultado_leilao='sem_lance'`, e a regra é manter esse lote 15 dias na vitrine (proposta). Mas o
-- coletor não manda `resultado_leilao`: no upsert, o BEFORE INSERT avaliava a linha PROPOSTA sem o resultado, não via a
-- exceção do "sem lance" e desligava — e o `ativo=false` ia pelo EXCLUDED (ver 20261116_praca_vencida_le_fim_da_linha_existente).
-- Medido: ZUK 0 ativos × 72 desligados entre os "sem lance" apurados nos últimos 15 dias, os 72 regravados pela coleta
-- DEPOIS da apuração. Conserto: no INSERT, o gatilho também lê o resultado já gravado da linha de mesmo `fonte_id`.
create or replace function public.trg_desativa_leilao_encerrado()
 returns trigger
 language plpgsql
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_fim date := new.data_fim;
  v_res text := new.resultado_leilao;
  v_apur timestamptz := new.resultado_apurado_em;
  e record;
begin
  if new.ativo and tg_op = 'INSERT' and new.fonte_id is not null then
    select x.data_fim, x.praca1_fim, x.praca2_fim, x.resultado_leilao, x.resultado_apurado_em
      into e from public.imoveis_leilao x where x.fonte_id = new.fonte_id;
    if found then
      v_fim  := greatest(v_fim, e.data_fim, e.praca1_fim::date, e.praca2_fim::date);
      v_res  := coalesce(v_res, e.resultado_leilao);
      v_apur := coalesce(v_apur, e.resultado_apurado_em);
    end if;
  end if;
  if new.ativo and public.leilao_ja_encerrado(new.data_leilao, new.data_leilao_2, v_fim, new.modalidade)
     and not coalesce(v_res = 'sem_lance' and v_apur > now() - interval '15 days', false) then
    new.ativo := false;
    new.suprimido_motivo := coalesce(new.suprimido_motivo, 'praca_vencida');
  end if;
  return new;
end; $function$;

-- Devolve à vitrine o "sem lance" que a coleta derrubou depois da apuração (dentro dos 15 dias).
update public.imoveis_leilao
   set ativo = true, suprimido_motivo = null
 where not ativo and suprimido_motivo = 'praca_vencida'
   and resultado_leilao = 'sem_lance' and resultado_apurado_em > now() - interval '15 days'
   and atualizado_em > resultado_apurado_em;
