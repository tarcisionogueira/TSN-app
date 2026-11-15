-- 15/11 (bug bounty 07/11 — achado 4): a fila de webhooks do Mercado Pago (mp_webhook_fila) não tinha vigilância. Evento
-- de DINHEIRO que esgotou as tentativas só gerava um e-mail de alertarErro; pendente parado (cron fora do ar) não
-- acusava nada. Dois invariantes em qa_invariantes():
--   mp_fila_falhou      — eventos 'falhou' nos últimos 30 dias (cada um é pagamento/assinatura sem efeito aplicado);
--   mp_fila_parada     — pendentes criados há mais de 24 h (o backoff vai até ~17 h; passou disso, o dreno parou).
do $mig$
declare d text := pg_get_functiondef('public.qa_invariantes'::regproc);
        ancora text := '(select valor from public.qa_cond_pagamento() where chave = ''pagamento_divergente_aberto''), 20)';
begin
  if position('mp_fila_falhou' in d) > 0 then return; end if;
  if position(ancora in d) = 0 then raise exception 'âncora de qa_invariantes não encontrada — revisar a migração'; end if;
  d := replace(d, ancora, ancora || $add$,
     ('mp_fila_falhou','Pagamentos: evento do Mercado Pago que esgotou as tentativas (mp_webhook_fila status falhou, 30 dias) — pagamento/assinatura sem efeito aplicado; reprocessar à mão','Pagamentos','bug',
       (select count(*) from public.mp_webhook_fila where status = 'falhou' and criado_em > now() - interval '30 days'), 0),
     ('mp_fila_parada','Pagamentos: evento do Mercado Pago pendente há mais de 24 h (o dreno processar-fila-webhook-mp-cron parou?)','Pagamentos','bug',
       (select count(*) from public.mp_webhook_fila where status = 'pendente' and criado_em < now() - interval '24 hours'), 0)$add$);
  execute d;
end $mig$;
