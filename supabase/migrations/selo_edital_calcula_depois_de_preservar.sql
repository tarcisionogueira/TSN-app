-- 19/08 — selo_documento_dessincronizado acusou 7.721 no dia seguinte à sua criação, todos
-- CEF, todos na direção "arquivo existe, selo desligado". Não era gatilho ausente: era ORDEM.
-- Gatilhos BEFORE da mesma tabela disparam em ordem ALFABÉTICA, e `set_tem_edital_doc` (s)
-- roda antes de `trg_preservar_link_edital` (t). O upsert matinal da CEF manda a PÁGINA do
-- lote em link_edital (bootstrap deliberado, scripts/scraper.js:380); o cálculo do selo via
-- esse não-PDF e gravava false, e SÓ DEPOIS o preservador restaurava o PDF conquistado.
-- Resultado diário: link = PDF, selo = false — 7.721 selos verdadeiros escondidos na Busca.
-- Provado em transação desfeita: repro do update matinal ANTES do conserto flipava o selo
-- para false com o link preservado como PDF.
--
-- O conserto é um RENAME: `zzzz_` ordena depois de todos os `trg_*` — o cálculo passa a ver
-- o NEW já preservado. Mesma função, mesmas colunas; nenhuma regra muda.
drop trigger if exists set_tem_edital_doc on public.imoveis_leilao;
create trigger zzzz_set_tem_edital_doc
  before insert or update of link_edital, link_matricula, anexos, fonte, estado, fonte_id
  on public.imoveis_leilao
  for each row execute function public.trg_set_tem_edital_doc();

-- Ressincroniza o acervo (este UPDATE não dispara o gatilho: tem_*_doc não está na lista OF).
update public.imoveis_leilao i
   set tem_edital_doc    = public.calc_tem_edital_doc(i.id, i.link_edital, i.anexos),
       tem_matricula_doc = public.calc_tem_matricula_doc(i.id, i.link_matricula, i.anexos, i.fonte, i.estado, i.fonte_id)
 where i.tem_edital_doc    is distinct from public.calc_tem_edital_doc(i.id, i.link_edital, i.anexos)
    or i.tem_matricula_doc is distinct from public.calc_tem_matricula_doc(i.id, i.link_matricula, i.anexos, i.fonte, i.estado, i.fonte_id);
