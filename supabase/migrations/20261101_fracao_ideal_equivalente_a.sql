-- 01/11 (#398) — "pertencendo-lhe … uma fração ideal EQUIVALENTE A 2,55% do todo" é a cláusula cartorial de condomínio
-- (apartamento inteiro), não venda de fatia. Barrava VIP 22321 e SODRE 2779089. Espelho de RE_CLAUSULAS_V4 em
-- scripts/lib/scraper-core.mjs (mesma mudança, teste em scripts/testes/fracao-ideal.mjs). Os lotes barrados voltam
-- sozinhos na próxima coleta: a barreira roda de novo na reativação (20261101_gatilhos_imovel_pulam_o_que_nao_mudou).
do $do$
declare def text; velho text := $v$\s*:?\s*(de\s+)?[0-9]'$v$; novo text := $v$\s*:?\s*(de\s+|equivalente\s+a\s+)?[0-9]'$v$; n int;
begin
  def := pg_get_functiondef('public.fracao_ideal_barrada(text,text)'::regprocedure);
  if position('equivalente\s+a' in def) > 0 then raise notice 'já aplicado'; return; end if;
  n := (length(def) - length(replace(def, velho, ''))) / length(velho);
  if n <> 1 then raise exception 'âncora encontrada % vezes em fracao_ideal_barrada — NÃO aplico às cegas', n; end if;
  execute replace(def, velho, novo);
end $do$;
