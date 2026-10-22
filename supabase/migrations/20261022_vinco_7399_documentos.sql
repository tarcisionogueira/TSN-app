-- 22/10: documentos do Vinco 7399 (leilão no mesmo dia, 10h) gravados à mão enquanto o conserto do
-- scraper-gestao.mjs (documento já lido não se perde + fila sem teto de 30 no residencial) não roda.
-- Lidos em loteAnexos.php?idLote=7399 (anexoCarregar → sishp/leilao/448/anexos/*.pdf).
insert into public.imoveis_leilao (fonte, fonte_id, anexos, link_matricula, link_edital)
values ('GESTAOLEILOES', 'gestao_vincoleiloes_7399',
  '[{"tipo":"laudo","nome":"Auto de Penhora e Avaliação","url":"https://vincoleiloes.com.br/sishp/leilao/448/anexos/2090.pdf"},
    {"tipo":"matricula","nome":"Matrícula","url":"https://vincoleiloes.com.br/sishp/leilao/448/anexos/2091.pdf"},
    {"tipo":"edital","nome":"Edital 1000002","url":"https://vincoleiloes.com.br/sishp/leilao/448/anexos/2368.pdf"}]'::jsonb,
  'https://vincoleiloes.com.br/sishp/leilao/448/anexos/2091.pdf',
  'https://vincoleiloes.com.br/sishp/leilao/448/anexos/2368.pdf')
on conflict (fonte_id) do update set anexos = excluded.anexos, link_matricula = excluded.link_matricula, link_edital = excluded.link_edital;
