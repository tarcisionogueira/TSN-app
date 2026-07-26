-- Limpeza de anexos INSTITUCIONAIS capturados por engano como documento do lote.
-- O SUPERBID publica no rodapé/config global o "Relatório de Transparência e
-- Igualdade Salarial" (Lei 14.611/2023). O enriquecerDocumentosLote (via
-- vasculharDocumentos de api/_doc-scan.js) harvestava qualquer .pdf da página de
-- detalhe e gravava esse PDF corporativo como anexo (tipo='outro') em 452 lotes —
-- poluía o laudo documental ("já lemos … Relatório de Transparência …") mesmo com
-- a matrícula/edital de verdade faltando.
--
-- Raiz corrigida em api/_doc-scan.js (RE_DOC_INSTITUCIONAL em ehDocumento) → não
-- recaptura. Esta migração remove o que já estava gravado. Idempotente (roda de novo
-- sem efeito). O denylist do DOWNLOAD já existia (captura-documentos.mjs) — por isso
-- quase todas eram link-only; as poucas com storage_path ficam órfãs no bucket (triviais).

delete from imovel_anexos a
using imoveis_leilao il
where a.imovel_id = il.id
  and a.nome ~* 'igualdade.?salarial|transpar[êe]ncia.?(e.?)?(igualdade|salarial)|quem.?somos|trabalhe.?conosco|c[óo]digo.?de.?(conduta|[ée]tica)|governan[çc]a.?corporativa|rela[çc][õo]es.?com.?investidores';
