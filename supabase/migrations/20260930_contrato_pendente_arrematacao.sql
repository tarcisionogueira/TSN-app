-- 30/09: termo de assessoria + procuração da ARREMATAÇÃO ATRIBUÍDA (api/_termo-assessoria.js).
-- O contrato pendente (bloqueio até a assinatura, ContratoObrigatorio) passa a aceitar
-- produto_tipo 'arrematacao' — produto_id = arrematacoes.id.
alter table public.contratos_pendentes drop constraint if exists contratos_pendentes_produto_tipo_check;
alter table public.contratos_pendentes add constraint contratos_pendentes_produto_tipo_check
  check (produto_tipo = any (array['plano','curso','ebook','arrematacao']));
