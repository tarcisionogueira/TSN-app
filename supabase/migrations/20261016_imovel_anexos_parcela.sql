-- Guia e comprovante de PARCELA também pela tela do arremate (16/10, dono: "o boleto recebido pelo advogado não
-- está nos imóveis do Marcos; quero anexar o comprovante e não há classificação adequada"). Tipos novos
-- guia_parcela / comprovante_parcela; o parcelas-documentos-cron lê e liga à parcela, e o que chega por e-mail no
-- caso é espelhado aqui já processado.
alter table public.imovel_anexos add column if not exists parcela_idx int;
alter table public.imovel_anexos add column if not exists parcela_status text;
alter table public.imovel_anexos add column if not exists parcela_aviso text;
alter table public.imovel_anexos add column if not exists parcela_processado_em timestamptz;
create index if not exists imovel_anexos_parcela_pend_idx on public.imovel_anexos (criado_em)
  where parcela_processado_em is null and tipo in ('guia_parcela', 'comprovante_parcela');
