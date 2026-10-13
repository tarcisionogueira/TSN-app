-- 13/10: dois casos pontuais de qa_invariantes (aplicado via apply_migration).
-- (a) tipo_terreno_com_construcao: "IMÓVEL COMERCIAL COM QUADRA DE FUTEBOL SOCIETY, BAR E LANCHONETE"
--     (SUPERBID) gravado como terreno — o mercadológico ignoraria a construção.
-- (b) doc_debito_maior_que_avaliacao: iptuDebito = 1.845.833 num terreno avaliado em R$ 1,4 mi (Park
--     Lane, Guarujá). Os dígitos são R$ 18.458,33 sem a vírgula — leitura errada. Sem o documento para
--     confirmar, o número sai (ausente é melhor que errado); o próximo documental relê.
update public.imoveis_leilao set tipo = 'comercial' where id = 'b1c9ca9a-b3fc-45ce-bf48-03602c58e487' and tipo = 'terreno';
update public.imoveis_leilao set doc_fatos = jsonb_set(doc_fatos, '{custos}', (doc_fatos->'custos') - 'iptuDebito')
 where id = '6ce8b428-6676-4206-90c2-b5c5605817ce' and (doc_fatos->'custos'->>'iptuDebito')::numeric = 1845833;
