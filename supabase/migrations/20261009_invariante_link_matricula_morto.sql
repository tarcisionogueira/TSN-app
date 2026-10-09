-- 09/10 — Pendência #22. Auditoria dos 143 PDFs `matricula_grupolance_auto.pdf` pelo CONTEÚDO
-- (scripts/auditar-matricula-grupolance.mjs): 0 edital, 0 laudo — são certidões de matrícula reais
-- (62% escaneadas; o documental manda o PDF ao modelo como documento, então lê). A suspeita de
-- "edital salvo como matrícula" NÃO se confirmou.
--
-- O defeito real era outro: 390 lotes (113 ativos — GRUPOLANCE 69, ZUK 44) com `link_matricula`
-- apontando para arquivo do NOSSO Storage que não existia mais, todos com selo verde de matrícula.
-- Causa: a retenção apagava o arquivo e não zerava o link (consertado em 04/10 em
-- api/limpar-documentos-cron.js → zerarLinksMatricula), deixando o passivo anterior.
-- Saneamento aplicado uma vez em 09/10 (390 linhas; o trigger recalculou o selo):
--   update imoveis_leilao i set link_matricula = null
--    where i.link_matricula like '%/storage/v1/object/%/documentos/%'
--      and not exists (select 1 from storage.objects o where o.bucket_id = 'documentos'
--            and o.name = substring(i.link_matricula from '/object/(?:sign|public)/documentos/([^?]+)'));
-- Com o link nulo, os coletores (filtro `link_matricula is null`) voltam a tentar a matrícula.
--
-- Vigia: invariante `link_matricula_morto` em qa_invariantes() (limite 0). Patch por âncora sobre
-- o corpo vigente — idempotente.
do $$
declare d text; ancora text := E'\n  )\n  select chave, titulo, categoria, gravidade, valor::bigint, limite::bigint,';
  novo text := E',\n     (''link_matricula_morto'',''Documental: link_matricula aponta para arquivo do NOSSO Storage que não existe mais — selo verde de matrícula sem documento (limpeza apagou o arquivo e não zerou o link?)'',''Documental'',''bug'',\n       (select count(*) from imoveis_leilao i where i.ativo and i.link_matricula like ''%/storage/v1/object/%/documentos/%''\n          and not exists (select 1 from storage.objects o where o.bucket_id = ''documentos''\n                and o.name = substring(i.link_matricula from ''/object/(?:sign|public)/documentos/([^?]+)''))), 0)';
begin
  d := pg_get_functiondef('public.qa_invariantes'::regproc);
  if position('link_matricula_morto' in d) > 0 then return; end if;
  if position(ancora in d) = 0 then raise exception 'qa_invariantes: ancora nao encontrada'; end if;
  execute replace(d, ancora, novo || ancora);
end $$;
