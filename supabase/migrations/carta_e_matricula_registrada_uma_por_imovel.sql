-- 29/08 — OS DOIS DOCUMENTOS QUE ENCERRAM A ASSESSORIA PASSAM A SER UM POR IMÓVEL
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- `uniq_imovel_anexos_imovel_tipo_doc` cobria só 'edital' e 'matricula'. Com a tela do caso
-- oferecendo upload de `carta_arrematacao` e `matricula_registrada` (os dois que fecham a
-- assessoria), a falta do índice teria efeito ruim em dois degraus:
--   1. o botão diz **"Substituir"** e, sem o tipo na lista de únicos do endpoint, o servidor
--      INSERIA uma segunda linha — a tela prometendo troca e o banco acumulando;
--   2. duas cartas no mesmo imóvel deixam o leitor achar a errada primeiro, e é justamente
--      neste ponto que `concluir_assessorias_entregues()` decide o fim de um serviço pago.
--
-- `api/upload-anexo.js` já foi ajustado (TIPOS_UNICOS), e o caminho de substituição lá é um
-- PATCH na linha existente — compatível com índice único. Este índice é a garantia que
-- sobrevive à próxima rota de upload que alguém escrever sem lembrar da lista do endpoint.
--
-- Conferido antes: 1 `carta_arrematacao` e 0 `matricula_registrada` no acervo — nenhuma
-- duplicata para o índice recusar. E testado depois: a 2ª carta no mesmo imóvel é recusada.
drop index if exists uniq_imovel_anexos_imovel_tipo_doc;

create unique index uniq_imovel_anexos_imovel_tipo_doc
  on public.imovel_anexos (imovel_id, tipo)
  where tipo in ('edital', 'matricula', 'carta_arrematacao', 'matricula_registrada');
