-- ─────────────────────────────────────────────────────────────────────────────────────────
-- O LEILÃO DE HOJE MORRE ÀS 00:00 DE HOJE — 24/08/2026
--
-- O QUE ACONTECEU. `leilao_ja_encerrado()` compara
--   max(data_leilao, data_leilao_2, data_fim + 1 dia - 1 segundo) < now()
-- Repare que só o `data_fim` ganha o "+1 dia - 1 segundo" — a extensão que faz a data valer
-- até o FIM do dia. `data_leilao` é `text` e, quando vem sem hora (o caso comum: '2026-08-24'),
-- `::timestamptz` resolve para MEIA-NOITE. Resultado: o lote é desativado às 00:00 do próprio
-- dia do pregão e some da busca exatamente no dia em que o leilão acontece — o dia em que o
-- cliente mais procuraria por ele. Sem erro, sem log, sem alarme: um DELETE lógico correto
-- executando sobre uma comparação errada.
--
-- COMO APARECEU. Dois lotes da PECINI em Eusébio/CE (10564, 10566), relidos com sucesso na
-- coleta das 15h de hoje — avaliação, lance e foto frescos — estavam `ativo = false`. A
-- releitura gravou dado bom numa linha invisível.
--
-- ALCANCE MEDIDO (não amostra): 835 lotes ATIVOS estão na única combinação em que nada segura
-- a data até o fim do dia — `data_leilao` sem hora, `data_leilao_2` nula e `data_fim` nula:
--   CEF 796 (próxima praça 26/08) · PECINI 16 · WEBLEILOES 15 · BIASI 6 · SUPORTE 2 (25/08+)
-- Cada um morre à meia-noite do seu próprio dia de leilão. Hoje pegou 2; amanhã pega PECINI,
-- WEBLEILOES e BIASI; quarta pega a CEF.
--
-- O CONSERTO. Data COM hora continua exata (o leiloeiro disse a hora, respeite-a). Data SECA
-- passa a valer até 23:59:59 — que é o que "leilão no dia 25" significa em português. É a
-- mesma extensão que o `data_fim` já tinha; o defeito era ela não valer para os três campos.
--
-- REATIVAÇÃO. Só os lotes com praça HOJE, que são os únicos que este defeito pode ter matado
-- cedo demais. Lote inativo com praça FUTURA (ZUK 32, CEF 8, WEBLEILOES 1) foi desativado por
-- OUTRA causa — o bug da meia-noite só dispara no dia da praça — e reativá-lo em massa seria
-- afirmar uma medição que não houve, que é justamente o erro que este arquivo existe para
-- consertar.
-- ─────────────────────────────────────────────────────────────────────────────────────────

create or replace function public.leilao_ja_encerrado(
  p_data_leilao text,
  p_data_leilao_2 timestamp with time zone,
  p_data_fim date,
  p_modalidade text
) returns boolean
  language sql
  immutable
  set search_path to 'public', 'extensions', 'pg_temp'
as $function$
  select case
    when coalesce(p_modalidade,'') ~* 'venda[_ -]?direta' then false
    else coalesce(
      (select max(x) from (values
        -- data COM hora: vale exata. Data SECA: vale até 23:59:59 do próprio dia.
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

-- REATIVAÇÃO CIRÚRGICA: só praça HOJE, só a forma que o defeito alcança, e com `returning`
-- para que o número seja PROVA e não afirmação (CLAUDE.md, forma 3: update que não alcança
-- linha nenhuma devolve sucesso e zero linha).
with revividos as (
  update imoveis_leilao set ativo = true
   where not ativo
     and nullif(data_leilao,'') is not null
     and data_leilao !~ '[0-9]:[0-9]'
     and data_leilao_2 is null
     and data_fim is null
     and (nullif(data_leilao,''))::date = current_date
     and coalesce(modalidade,'') !~* 'venda[_ -]?direta'
   returning fonte, fonte_id
)
select fonte, count(*) as reativados from revividos group by fonte;
