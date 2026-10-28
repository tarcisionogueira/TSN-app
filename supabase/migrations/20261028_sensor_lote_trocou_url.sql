-- #374 (28/10): sensor de "id reaproveitado" em TODAS as fontes. A Globo reusava o id do lote para outro imóvel e os
-- gatilhos de preservação grudavam o imóvel antigo no novo (245 lotes). Não há rastro retroativo — o url_lote antigo
-- some no upsert —, então daqui para a frente toda troca de URL de uma linha existente fica registrada aqui.
-- Uma troca isolada pode ser cosmética (slug editado); muitas numa fonte = a fonte reusa id → checagem de identidade
-- no coletor, como scraper-globo.mjs/aposentarReaproveitados. Consulta: select fonte, count(*) from lote_trocou_url
-- where em > now() - interval '7 days' group by 1 order by 2 desc;
create table if not exists public.lote_trocou_url (
  id bigserial primary key,
  imovel_id uuid not null, fonte text, fonte_id text,
  url_antiga text, url_nova text, titulo_antigo text, titulo_novo text,
  em timestamptz not null default now()
);
create index if not exists idx_lote_trocou_url_fonte_em on public.lote_trocou_url (fonte, em desc);
alter table public.lote_trocou_url enable row level security;

create or replace function public.trg_lote_trocou_url()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare norm_a text; norm_n text;
begin
  norm_a := regexp_replace(regexp_replace(regexp_replace(lower(old.url_lote), '^https?://(www\.)?', ''), '[?#].*$', ''), '/+$', '');
  norm_n := regexp_replace(regexp_replace(regexp_replace(lower(new.url_lote), '^https?://(www\.)?', ''), '[?#].*$', ''), '/+$', '');
  if norm_a is distinct from norm_n then
    insert into public.lote_trocou_url (imovel_id, fonte, fonte_id, url_antiga, url_nova, titulo_antigo, titulo_novo)
    values (new.id, new.fonte, new.fonte_id, old.url_lote, new.url_lote, old.titulo, new.titulo);
  end if;
  return new;
end $function$;

drop trigger if exists trg_zzzzz_lote_trocou_url on public.imoveis_leilao;
create trigger trg_zzzzz_lote_trocou_url after update of url_lote on public.imoveis_leilao
  for each row when (old.url_lote is not null and new.url_lote is not null and old.url_lote is distinct from new.url_lote)
  execute function public.trg_lote_trocou_url();
