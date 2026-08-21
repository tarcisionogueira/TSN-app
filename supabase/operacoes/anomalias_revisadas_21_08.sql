-- OPERAÇÃO (não é migração de schema) — resolução das anomalias de relatório REVISADAS em
-- 21/08 (sessão Claude, P2 da fila de pendências). Rodar no SQL Editor na janela de produção,
-- junto com o checklist do HANDOFF.
--
-- A revisão, caso a caso (19 abertas → 17 resolvem, 2 ficam):
--   · cnj_vazio (5): integração ok — nº de processo CONCRETO consultado e o DataJud não tem o
--     processo (2007/2018/fora da base). O caso "extrajudicial" (id 15) é deliberado: o lote
--     tinha nº de processo nos docs. Nada a corrigir.
--   · mercado_area_incoerente (3) + area_divergente (1): mitigação automática JÁ aplicada pelo
--     gerador (mercado ancorado na avaliação / área da matrícula preferida); a causa é dado da
--     fonte (área total vs privativa).
--   · avaliacao_ausente (3): a fonte não publica avaliação; relatório segue sem, por desenho.
--   · avaliacao_incoerente (1): leitura errada foi DESCARTADA pelo gerador — mitigação correta.
--   · sem_parecer (id 60): recompletado pelo self-heal em 21/08 00:05 (parecer 8.118 chars).
--   · yield_nao_fecha (ids 55/59): relatórios PRÉ-metodologia de 20/08; números antigos são
--     mantidos até regerar, por desenho.
--   · sem_preco_m2 (id 56): lote sem área E sem matrícula (população do invariante
--     lote_sem_area_nem_matricula) — sem R$/m² possível até a área existir.
--
-- FICAM ABERTAS (trabalho real, registrado no HANDOFF como feature):
--   · ids 51 e 52 — pagamento_contradiz_documento: o relatório assume à vista, mas o lote tem
--     entrada + parcelas. Considerar o plano de pagamento no capital/ROI é FEATURE do gerador.

update relatorio_anomalias
   set resolvido = true,
       detalhe = detalhe || ' | REVISADO 21/08 (sessão Claude): ' || case
         when tipo = 'cnj_vazio' then 'integração CNJ ok; DataJud não possui o processo (retorno vazio esperado). Nada a corrigir.'
         when tipo in ('mercado_area_incoerente','area_divergente') then 'mitigação automática já aplicada (mercado ancorado na avaliação / área da matrícula); causa é dado da fonte.'
         when tipo = 'avaliacao_ausente' then 'fonte não publica avaliação; relatório segue sem, por desenho.'
         when tipo = 'avaliacao_incoerente' then 'leitura errada DESCARTADA pelo gerador — mitigação correta.'
         when campo = 'sem_parecer' then 'recompletado pelo self-heal em 21/08 00:05 — flag obsoleta.'
         when campo = 'yield_nao_fecha' then 'relatório pré-metodologia de 20/08; números mantidos até regerar, por desenho.'
         when campo = 'sem_preco_m2' then 'lote sem área e sem matrícula — sem R$/m² possível até a área existir.'
         else 'revisado.' end
 where not resolvido and id not in (51, 52);
-- Esperado: 17 linhas. Conferir: select tipo, count(*) from relatorio_anomalias where not resolvido group by 1;  → só pagamento_contradiz_documento (2).
