-- Descrição opcional do documento pessoal (18/09, pedido do dono: "documentos pessoais"
-- em Meus Arrematados). Mesma razão de imovel_anexos.descricao (16/09): sem isso, uma
-- lista de "RG", "CPF", "Comprovante" repetidos perde a rastreabilidade de qual é qual
-- quando há mais de um do mesmo tipo (ex.: comprovante de residência atualizado).
alter table public.usuario_docs add column if not exists descricao text;
