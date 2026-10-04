-- 04/10 — invariante sem_foto passa a medir FOTO QUE A CAPTURA PERDEU, não o tamanho do EDITAL_DJEN.
--
-- Em 04/10: 1.778 sem foto (limite 1.600). Destes, 587 são EDITAL_DJEN — lote lido de edital do Diário
-- da Justiça, que não tem foto por natureza (5 de 592 têm). O DJEN cresceu 106 só na última semana: o
-- alarme subia com o volume do DJEN, não com defeito de captura (forma nº 10 do CLAUDE.md — mede uma
-- coisa e reporta com o nome de outra). Sem o DJEN: 1.191.
-- Os 409 do LJUD ficam na conta: medido em 28/09 que 302 de 303 não têm foto nem no site do leiloeiro
-- (scraper-puppeteer.mjs, backfill og:image), mas é fonte de foto — regressão nela TEM que aparecer.
-- Patch por replace no corpo vigente (a função é editada por várias migrações).
do $mig$
declare d text;
  velho text := $v$(select count(*) from imoveis_leilao where ativo and coalesce(link_foto,'')=''), 1600)$v$;
  novo  text := $n$(select count(*) from imoveis_leilao where ativo and coalesce(link_foto,'')='' and fonte <> 'EDITAL_DJEN'), 1600)$n$;
begin
  d := pg_get_functiondef('public.qa_invariantes'::regproc);
  if position(novo in d) > 0 then return; end if;
  if position(velho in d) = 0 then raise exception 'qa_invariantes: trecho do sem_foto não encontrado'; end if;
  d := replace(d, velho, novo);
  d := replace(d, $t$'sem_foto','Lote ativo sem foto',$t$, $t$'sem_foto','Lote ativo sem foto (fora EDITAL_DJEN, que não tem foto por natureza)',$t$);
  execute d;
end $mig$;
