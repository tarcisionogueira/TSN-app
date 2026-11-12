-- Controles da comunicação do caso (12/11, pedido do dono)
--
-- 1) copiar_cliente: o cliente vai em CÓPIA nos e-mails automáticos ao jurídico (casos-acompanhamento-cron)
--    e vem marcado por padrão ao responder um e-mail do caso na caixa (CaixaEmail). O advogado que usar
--    "Responder a todos" alcança o cliente também.
-- 2) liga/desliga POR TIPO do e-mail automático ao jurídico: atualização do processo e guia das parcelas.
--    Antes havia um só "ligado" (acompanhamento_liberado_em) e ele era IGNORADO em caso com advogado
--    vinculado (o cron fazia `advogado_id || liberado_em`).
-- 3) acompanhamento_intervalo_manual: a frequência escolhida pela equipe não é sobrescrita pela leitura das
--    devolutivas (juridico-devolutivas-cron), que antes regravava o intervalo a cada resposta do escritório.
--    E o intervalo passa a ser obedecido (7/14/21/28 dias, sempre às segundas) — estava desligado no cron.

alter table public.casos
  add column if not exists copiar_cliente boolean not null default false,
  add column if not exists acompanhamento_atualizacao_ativa boolean not null default true,
  add column if not exists acompanhamento_guia_ativa boolean not null default true,
  add column if not exists acompanhamento_intervalo_manual boolean not null default false;

comment on column public.casos.copiar_cliente is 'Cliente em cópia nos e-mails automáticos ao jurídico e marcado por padrão ao responder e-mail do caso (12/11).';
comment on column public.casos.acompanhamento_atualizacao_ativa is 'Pedido automático de ATUALIZAÇÃO do processo ao jurídico ligado (12/11).';
comment on column public.casos.acompanhamento_guia_ativa is 'Pedido automático da GUIA de cada parcela ao jurídico ligado (12/11).';
comment on column public.casos.acompanhamento_intervalo_manual is 'Intervalo escolhido pela equipe: a leitura das devolutivas não sobrescreve (12/11).';
