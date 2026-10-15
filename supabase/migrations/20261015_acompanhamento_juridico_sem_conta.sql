-- Acompanhamento jurídico semanal para caso SEM conta de advogado vinculada (15/10, dono).
--
-- O casos-acompanhamento-cron só cobrava casos com advogado_id (conta na plataforma). O escritório
-- Cajado de Menezes atende os 3 casos pós-arremate (Marcos, Rafael, Matheus) mas ainda não aceitou o
-- convite — e o pedido da guia virava só aviso interno. Agora o caso pode ter os e-mails do escritório
-- direto (acompanhamento_para / _cc) e o cron cobra igual.
--
-- acompanhamento_liberado_em: trava do 1º envio. O dono pediu para ver o rascunho antes; o cron só envia
-- para quem tiver a data preenchida (o `?seco=1` mostra o texto completo antes).
-- acompanhamento_assunto: assunto da conversa que o escritório JÁ conhece (ex.: "Lote para avaliação —
-- Condomínio Vila Rica"); o e-mail semanal sai como "Re: <assunto>", respondendo à última mensagem do
-- caso em email_caixa (In-Reply-To/References), e fica na mesma conversa do imóvel.

alter table public.casos add column if not exists acompanhamento_para text[];
alter table public.casos add column if not exists acompanhamento_cc text[];
alter table public.casos add column if not exists acompanhamento_liberado_em timestamptz;
alter table public.casos add column if not exists acompanhamento_assunto text;

comment on column public.casos.acompanhamento_para is 'E-mails do jurídico (Para) quando o caso não tem advogado_id — usados pelo casos-acompanhamento-cron.';
comment on column public.casos.acompanhamento_liberado_em is 'Trava: o cron só envia o acompanhamento depois que o dono aprovou o rascunho.';
comment on column public.casos.acompanhamento_assunto is 'Assunto da conversa existente com o escritório; o e-mail sai como "Re: <assunto>".';
