-- 05/11 (dono): o link de cobrança com termo segue o layout do fechamento tradicional da assessoria — título curto
-- (termo_titulo), preço e uma faixa de destaque (ex.: honorários de êxito). `subtitulo` é essa faixa.
alter table public.cobrancas_avulsas add column if not exists subtitulo text;
