-- ORIGEM DO VEÍCULO PELO EDITAL (25/09, caminho 1 do dono, sem custo). `scripts/edital-origem-veiculos.mjs`
-- lê a 1ª página do edital do evento (quem vende está lá: vara/tribunal, município/ministério,
-- "comitente vendedor … LTDA") e grava `origem_edital`. O gatilho continua sendo o único que decide
-- `origem_venda`: a listagem vence quando tem sinal; o edital só PREENCHE o `nao_identificado`.
-- Divergência (listagem diz X, edital diz Y) fica visível comparando as duas colunas.
alter table public.veiculos_leilao add column if not exists origem_edital text
  check (origem_edital is null or origem_edital in ('judicial','financeira','seguradora','patio','orgao_publico','corporativo'));
alter table public.veiculos_leilao add column if not exists comitente_edital text;

create or replace function public.trg_veiculo_origem_venda() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  new.origem_venda := public.classificar_origem_veiculo(new.fonte, new.raw, new.titulo, new.descricao, new.modalidade);
  if new.origem_venda = 'nao_identificado' and new.origem_edital is not null then
    new.origem_venda := new.origem_edital;
  end if;
  return new;
end $$;

drop trigger if exists veiculo_origem_venda on public.veiculos_leilao;
create trigger veiculo_origem_venda before insert or update of raw, titulo, descricao, modalidade, fonte, origem_edital
  on public.veiculos_leilao for each row execute function public.trg_veiculo_origem_venda();
