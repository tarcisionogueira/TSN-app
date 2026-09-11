-- 11/09: o upsert (onConflict: 'fonte,fonte_id') falhou com "no unique or exclusion constraint
-- matching" — o índice único anterior (veiculos_leilao_piloto.sql) era PARCIAL (where fonte_id
-- is not null), e Postgres não infere índice parcial como alvo de ON CONFLICT sem repetir o
-- predicado na cláusula. Troca por índice único simples (NULLs continuam não conflitando entre
-- si, comportamento padrão do Postgres — não muda nada na prática, todo escritor sempre grava
-- fonte_id).
drop index if exists public.veiculos_leilao_fonte_id_unico;
create unique index if not exists veiculos_leilao_fonte_id_unico
  on public.veiculos_leilao (fonte, fonte_id);
