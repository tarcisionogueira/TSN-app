-- Pedido do dono (11/09): filtro por percentual de desconto na tela de veículos. Hoje o
-- desconto só é computado no FRONT (BuscaVeiculos.jsx `desconto()`) — não filtrável no
-- servidor. Mesmo padrão já usado em imoveis_leilao (`desconto_percentual`, calculado no
-- scraper): coluna própria, para o PostgREST poder filtrar (`.gte`) sem trazer o acervo
-- inteiro pro cliente. Mesma trava de outlier do front (>95% ou <=0 vira null — nunca um
-- desconto que não existe na vida real).
alter table public.veiculos_leilao add column if not exists desconto_percentual integer;

update public.veiculos_leilao
set desconto_percentual = case
  when valor_avaliacao > 0 and valor_minimo > 0 and valor_minimo < valor_avaliacao
    then round((1 - valor_minimo::numeric / valor_avaliacao) * 100)
  else null
end
where desconto_percentual is null;

-- Nunca > 95 nem <= 0 — mesma trava do front, agora também na origem do dado.
update public.veiculos_leilao set desconto_percentual = null
where desconto_percentual is not null and (desconto_percentual <= 0 or desconto_percentual > 95);
