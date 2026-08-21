-- =====================================================================================
-- INVARIANTE: fonte com muitos lotes ativos e UMA data de leilão em massa (21/08)
--
-- Achado do dono: a PESTANA gravou os 1.031 lotes ativos com a MESMA `data_leilao` (26/10/2026),
-- enquanto a fonte (Santander via Pestana) mostra o pregão em 25/08. O mapper usa `leilao.data`,
-- que não é a data por-leilão — resultado: data em massa errada, e o cliente pode PERDER o leilão
-- (a data que mostramos é mais tarde que a real). Nenhuma outra fonte tem isso: todas com 100+
-- lotes espalham por muitas datas (CEF 23, SUPERBID 73, LJUD 59, MEGA 21...).
--
-- A trava: qualquer fonte com >=100 lotes ativos e <=2 datas distintas de leilão. Verde hoje para
-- todas menos PESTANA (que fica em alerta até o scraper ser corrigido). Cirurgia de string sobre
-- o prosrc vivo (mesmo idioma das outras). O conserto do scraper depende de recon do campo certo
-- (scripts/recon-pestana-data.mjs, roda em produção) — esta trava é a rede que pega a reincidência.
-- =====================================================================================
do $outer$
declare corpo text; novo text; bloco text;
begin
  select prosrc into corpo from pg_proc where proname = 'qa_invariantes';
  if corpo is null then raise exception 'qa_invariantes nao existe'; end if;
  if position('fonte_data_leilao_uniforme' in corpo) > 0 then return; end if;
  if position('(''lote_sem_area_nem_matricula''' in corpo) = 0 then
    raise exception 'ancora (lote_sem_area_nem_matricula) nao encontrada';
  end if;

  bloco := $blk$     ('fonte_data_leilao_uniforme','Fonte com 100+ lotes ativos e 1-2 datas de leilao (data em massa errada, ex.: PESTANA 26/10)','Captura','bug',
       (select count(*) from (
          select fonte from imoveis_leilao
           where ativo and data_leilao is not null
           group by fonte
          having count(*) >= 100 and count(distinct data_leilao::date) <= 2
        ) u), 0),
$blk$;

  novo := replace(corpo, '(''lote_sem_area_nem_matricula''', bloco || '     (''lote_sem_area_nem_matricula''');
  if novo = corpo then raise exception 'NAO SUBSTITUIU'; end if;
  if position('fonte_data_leilao_uniforme' in novo) = 0 then raise exception 'invariante novo nao entrou'; end if;
  if position('(''lote_sem_area_nem_matricula''' in novo) = 0 then raise exception 'comeu o proximo'; end if;

  execute 'create or replace function public.qa_invariantes() returns table(chave text, titulo text, categoria text, gravidade text, valor bigint, limite bigint, status text) language sql stable as $corpo$' || novo || '$corpo$';
end $outer$;
