-- Regressão de datas CEF (auditoria 2026-07-04):
-- scripts/scraper.js (GitHub Action) e api/scraper-caixa.js fazem upsert com
-- merge-duplicates enviando data_leilao=null em toda linha CEF (o CSV/JSON da
-- Caixa não traz a data — ela é renderizada por JS e preenchida depois pelo
-- enriquecedor Puppeteer). O merge sobrescrevia a data enriquecida com null a
-- cada rodada noturna (852 -> 294).
--
-- Correção: trigger BEFORE UPDATE que preserva a data existente quando o novo
-- valor chega vazio. Uma data NOVA (não-nula) continua sobrescrevendo normalmente.
-- Protege independentemente de qual scraper escreve. Idempotente.
create or replace function public.preservar_data_leilao()
returns trigger
language plpgsql
as $function$
begin
  if new.data_leilao is null or btrim(new.data_leilao) = '' then
    new.data_leilao := old.data_leilao;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_preservar_data_leilao on public.imoveis_leilao;
create trigger trg_preservar_data_leilao
  before update on public.imoveis_leilao
  for each row
  execute function public.preservar_data_leilao();
