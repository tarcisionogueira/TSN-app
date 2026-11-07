-- 07/11 — Dados da NOTA FISCAL também no honorário de êxito (mesmo formato de cobrancas_avulsas.dados_nf,
-- ver api/_dados-nf.js). Quem paga o honorário pode ser o arrematante, outra pessoa ou uma empresa; o registro é
-- gravado só pelo servidor (api/dados-nota-fiscal.js) e serve de pagador para Mercado Pago e Asaas quando a página
-- não manda o documento (ela só vê o documento mascarado).
alter table public.arrematacoes add column if not exists dados_nf jsonb;
