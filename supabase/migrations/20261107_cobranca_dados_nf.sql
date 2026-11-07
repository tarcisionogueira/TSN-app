-- 07/11 — Dados para a NOTA FISCAL na cobrança avulsa (dono: "apesar de o sistema ainda não emitir nota
-- automaticamente, é ideal pedir os dados; já preenchidos → direto para o pagamento; faltando → completar").
--
-- Formato = o `tomador` que api/_nfse.js vai enviar quando a emissão for ligada:
--   { tipo: 'PF'|'PJ', doc, nome, email, cep, logradouro, numero, complemento, bairro, cidade, uf, gravado_em }
-- Gravado só pelo servidor (api/dados-nota-fiscal.js). A página pública recebe uma visão MASCARADA
-- (api/cobranca-avulsa-info.js); o documento inteiro nunca volta ao navegador.
-- Também alimenta o pagador do Mercado Pago e do Inter, para o cliente não digitar os mesmos dados duas vezes.
alter table public.cobrancas_avulsas add column if not exists dados_nf jsonb;
