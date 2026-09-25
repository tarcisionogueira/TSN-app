-- 25/09: o coletor da ZUK só marcava "judicial" quando o título dizia "judicial", e o card
-- judicial da ZUK diz o comitente ("Tribunal de Justiça do Estado de São Paulo"). 126 de 559
-- ativos (e o histórico inteiro) estavam como extrajudicial — ex.: Z37342, processo
-- 0007278-58.2005.8.26.0008. O coletor foi corrigido (scripts/scraper-puppeteer.mjs); isto
-- conserta o acervo já gravado. Idempotente.
update public.imoveis_leilao
   set modalidade = 'judicial'
 where fonte = 'ZUK'
   and modalidade is distinct from 'judicial'
   and titulo ~* '(judicial|tribunal|justi[çc]a|\mvara\M|judici[áa]rio)'
   and titulo !~* 'extrajudicial';
