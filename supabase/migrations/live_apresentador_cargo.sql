-- Linha de cargo do apresentador (27/08/2026).
-- Estava escrita direto no JSX como "Fundador da BidPro Brasil". Funciona hoje e mente
-- no dia em que a aula tiver outro apresentador — e ninguém lembraria de ir no código
-- trocar. Cargo é dado do evento, como o nome e a bio.
alter table public.eventos_live
  add column if not exists apresentador_cargo text;

comment on column public.eventos_live.apresentador_cargo is
  'Linha curta sob o nome do apresentador (ex.: "Fundador da BidPro Brasil"). Nulo = some.';

update public.eventos_live
   set apresentador_cargo = 'Fundador da BidPro Brasil'
 where slug = 'leilao-ao-vivo' and apresentador_cargo is null;
