-- 05/10 — o selo (tem_edital_doc/tem_matricula_doc) só era recalculado quando o LOTE era regravado
-- (gatilho em imoveis_leilao). Documento que entra/muda em imovel_anexos — espelho, upload da equipe,
-- reclassificação pelo conteúdo — ficava sem selo até a próxima coleta da fonte (e fonte parada,
-- nunca). Este gatilho regrava o link do lote, o que dispara o recálculo existente.
create or replace function public.trg_anexo_recalcula_selo()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  update public.imoveis_leilao set link_edital = link_edital
   where id = coalesce(new.imovel_id, old.imovel_id);
  return null;
end $$;

create or replace trigger imovel_anexos_recalcula_selo
after insert or delete or update of tipo, nome, url, storage_path on public.imovel_anexos
for each row execute function public.trg_anexo_recalcula_selo();
