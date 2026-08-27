-- ─────────────────────────────────────────────────────────────────────────────
-- O NÚMERO DO WHATSAPP SAI DA VARIÁVEL DE AMBIENTE E VIRA DADO  (27/08/2026)
--
-- POR QUE: o botão "Falar comigo no WhatsApp" da /live/:slug lia
-- VITE_WHATSAPP_NUMERO. Duas consequências ruins, ambas descobertas na prática:
--
--   1. Variável com prefixo VITE_ é COMPILADA no bundle. Salvá-la como "Secret"
--      na Vercel é contradição — e é exatamente o aviso que o painel dá. Um número
--      de WhatsApp comercial não é segredo: ele existe para estranhos discarem.
--   2. Mesmo salvando certo, trocar o número exige NOVO DEPLOY. Numa página de
--      campanha, isso é um número errado no ar até alguém lembrar de reconstruir.
--
-- Como dado na tabela do evento, o dono edita no admin e vale na hora. A env var
-- continua valendo como padrão, para o chat de suporte e para eventos sem número.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.eventos_live
  add column if not exists whatsapp_direto text;

comment on column public.eventos_live.whatsapp_direto is
  'WhatsApp de contato direto desta aula, formato internacional só dígitos (ex.: 55DDNNNNNNNNN).
   Nulo = usa VITE_WHATSAPP_NUMERO. Público por natureza — é o número que a landing convida
   a pessoa a chamar; não é segredo e não deve ser tratado como tal.';
