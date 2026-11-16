-- LOTE EM 2ª PRAÇA DESLIGADO A CADA COLETA (16/11, dono: "verifique as outras fontes com o mesmo problema de data").
--
-- O que se viu: 45 lotes da SUPORTE fora da busca como `praca_vencida` com `leilao_ja_encerrado(...) = false` — o
-- próprio banco sabia que estavam abertos. Ex.: Kleiber 2147 (R$ 1,5 mi), 2º leilão de 10/11 a 23/11 08h00
-- (conferido no site). Dos 33 da SUPORTE com `praca2_fim` futura e `data_leilao_2` passada, 0 estavam ativos.
--
-- Por quê: o coletor manda só a ABERTURA das praças (`data_leilao`/`data_leilao_2`, da página do lote). O FECHAMENTO
-- (`praca1_fim`/`praca2_fim`) é gravado por outra rotina (leitura do edital/lote). No upsert, os gatilhos BEFORE INSERT
-- rodam sobre a linha PROPOSTA, que não tem `praca*_fim`: `data_fim` sai = abertura da 2ª praça (já passada), este
-- gatilho desliga e carimba `praca_vencida` — e o Postgres leva esses valores para o `EXCLUDED` do ON CONFLICT. O
-- `ativo = false` chega à linha existente pronto; o BEFORE UPDATE (que veria o `praca2_fim` antigo) só sabe desligar.
-- O coletor manda `ativo: true` e `suprimido_motivo: null` e o lote morre do mesmo jeito, a cada rodada.
--
-- Conserto: no INSERT, o fim considerado inclui o `praca*_fim`/`data_fim` da linha que já existe com o mesmo
-- `fonte_id` (índice único). Uma leitura por índice por linha inserida. Fim antigo só ESTENDE o prazo até ele —
-- o mesmo que o BEFORE UPDATE já faria com a linha existente.
create or replace function public.trg_desativa_leilao_encerrado()
 returns trigger
 language plpgsql
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare v_fim date := new.data_fim;
begin
  if new.ativo and tg_op = 'INSERT' and new.fonte_id is not null then
    select greatest(v_fim, e.data_fim, e.praca1_fim::date, e.praca2_fim::date)
      into v_fim
      from public.imoveis_leilao e
     where e.fonte_id = new.fonte_id;
    v_fim := coalesce(v_fim, new.data_fim);
  end if;
  if new.ativo and public.leilao_ja_encerrado(new.data_leilao, new.data_leilao_2, v_fim, new.modalidade)
     and not coalesce(new.resultado_leilao = 'sem_lance' and new.resultado_apurado_em > now() - interval '15 days', false) then
    new.ativo := false;
    new.suprimido_motivo := coalesce(new.suprimido_motivo, 'praca_vencida');
  end if;
  return new;
end; $function$;

-- Devolve à busca o que este defeito desligou: só `praca_vencida` cujo fim gravado ainda não passou.
update public.imoveis_leilao
   set ativo = true, suprimido_motivo = null
 where not ativo and suprimido_motivo = 'praca_vencida'
   and (praca1_fim is not null or praca2_fim is not null)
   and not public.leilao_ja_encerrado(data_leilao, data_leilao_2, data_fim, modalidade);
