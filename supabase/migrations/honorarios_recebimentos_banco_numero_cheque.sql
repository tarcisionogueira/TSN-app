-- 18/09, pedido do dono: banco e número do cheque como campos PRÓPRIOS, não só dentro da
-- justificativa em texto livre — mais fácil de conferir/filtrar, e o painel mostra em
-- destaque em vez de exigir ler o parágrafo inteiro.
alter table public.honorarios_recebimentos
  add column if not exists banco text,
  add column if not exists numero_cheque text;

-- Backfill dos 3 cheques do Marcos já registrados nesta sessão (extraído da justificativa
-- que já tinha essa informação em texto — não é dado novo, só estrutura o que já existia).
update public.honorarios_recebimentos set banco = 'SICOOB Coopere', numero_cheque = '000094'
  where id = 'f3dd7879-b01f-4177-bce9-a1d9b6a2a6f2';
update public.honorarios_recebimentos set banco = 'SICOOB Coopere', numero_cheque = '000093'
  where id = '10be7bb4-a108-42e1-9330-ba57fce7cbae';
update public.honorarios_recebimentos set banco = 'Banco do Brasil', numero_cheque = '850310'
  where id = '821b6d40-0272-4394-914f-5b25a5119293';
