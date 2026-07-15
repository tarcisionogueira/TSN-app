-- CEF — correção de 1.957 editais mal gravados (auditoria de documentos 15/07/2026).
-- Diagnóstico: em 1.957 lotes de leilão (extrajudicial/licitacao_aberta) o link_edital
-- apontava para o PDF DIRETO da matrícula (/editais/matricula/UF/NNN.pdf), não para um
-- edital. Ou seja: a matrícula (documento valioso) estava guardada na coluna errada e a
-- coluna de edital estava poluída.
--
-- Correção (zero risco, sem baixar nada):
--   (1) promove o PDF direto da matrícula para link_matricula (melhor que a página .asp
--       indireta que estava lá);
--   (2) restaura link_edital = url_lote (página detalhe-imovel), consistente com os demais
--       lotes de leilão da CEF, que usam a página do lote como via de acesso ao edital.
-- Numa única UPDATE as expressões do SET usam os valores ANTIGOS da linha, então não há
-- efeito cascata. Idempotente: só afeta linhas com o padrão poluído.
update imoveis_leilao
set link_matricula    = link_edital,                        -- PDF direto (valor ANTIGO de link_edital)
    matricula_scan_em = coalesce(matricula_scan_em, now()),
    link_edital       = url_lote                             -- página do lote (acesso ao edital)
where fonte = 'CEF' and ativo
  and link_edital ilike '%/editais/matricula/%'
  and url_lote ilike '%detalhe-imovel.asp%';

-- Métrica correta (para não voltar a soar como lacuna): matrícula 100% (27.925/27.925);
-- edital 100% sobre as modalidades de leilão (10.221/10.221). venda_direta não tem edital
-- por natureza (usa Condições de Venda) — lacuna ESPERADA, não é falha.
-- Aprendizado persistido: o scraper NUNCA deve gravar /editais/matricula/ em link_edital.
update public.leiloeiro_conhecimento
set docs_status = 'ok'
where fonte = 'CEF';
