-- 23/10 — documental do dono travado: "não conseguimos ler Matrícula (HTTP 403); Edital (HTTP 403)"
-- (CEF, Feira de Santana/BA). O 403 era só a 1ª tentativa (Caixa recusa IP de datacenter); o Bright
-- Data, que fura esse bloqueio, nem foi chamado: a leitura usava a cota `geral` — que é dos CRONS DE
-- FUNDO (enriquecer/apurar), 25/dia em 4 turnos — e às 15h ela já tinha recusado ("subcota_dia").
-- Isso contraria a decisão do dono de 12/09 (brightdata_relatorio_isento_do_teto.sql): "relatório não
-- pode ser travado por orçamento de coleta". Lá a isenção cobriu só o DJEN ('certidao'); a leitura dos
-- PDFs do leiloeiro ficou de fora.
-- Remédio: propósito próprio, ISENTO, usado por api/gerar-documental.js SÓ quando a cota normal (a do
-- leiloeiro, ou `docs`) recusa por orçamento. O uso continua no ledger (custo visível); o PDF lido vai
-- para o bucket `documentos`, então a regeração não paga de novo.
insert into public.brightdata_reserva (proposito, reserva, teto, teto_dia, isento_teto, descricao, atualizado_em)
values ('relatorio_doc', 0, 150, null, true,
  'Leitura de edital/matrícula na geração do documental do CLIENTE, quando a cota normal (do leiloeiro ou '
  || '`docs`) recusou por orçamento. Isento do teto (decisão do dono, 12/09); consumo segue no ledger. '
  || 'O PDF lido vai para o bucket `documentos` e a regeração não paga de novo.', now())
on conflict (proposito) do update set isento_teto = true, descricao = excluded.descricao, atualizado_em = now();
