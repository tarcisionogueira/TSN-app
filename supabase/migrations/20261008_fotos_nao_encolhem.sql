-- GALERIA NÃO ENCOLHE PARA NULO (08/10). Coletores gravam em lote (`upsert` de um array); quando parte das
-- linhas traz `fotos` e parte não, o postgrest-js manda a UNIÃO das colunas e as linhas sem a chave viram
-- NULL — a galeria conquistada num dia anterior sumia na rodada seguinte. Mesmo princípio de
-- fotosPreservadas()/salvarImoveis no JS, agora para TODO coletor. Limpar de propósito: gravar '[]'.
create or replace function public.imovel_fotos_nao_encolhem() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if new.fotos is null and old.fotos is not null and jsonb_typeof(old.fotos) = 'array' and jsonb_array_length(old.fotos) > 1 then
    new.fotos := old.fotos;
  end if;
  return new;
end $$;
create or replace trigger trg_imovel_fotos_nao_encolhem
  before update of fotos on public.imoveis_leilao
  for each row execute function public.imovel_fotos_nao_encolhem();
