-- 28/10 (varredura do #374): lotes cuja DESCRIÇÃO é a vitrine de OUTROS lotes ("…Perdizes, São Paulo/SP R$ 1.387.500,00
-- Imóvel …, Timbaúba/PE R$ 5.970.000,00") — o extrator genérico do corpo pegava o bloco de destaques. Volta ao título
-- (o que o coletor grava quando não acha descrição); gatilho de preservação desligado só aqui, senão ele devolve a vitrine.
-- Resultado em 28/10: 126 linhas (61 ativas), todas GRUPOLANCE. O extrator (api/_texto-imovel.js, ehVitrineDeLotes)
-- passou a recusar bloco com 2+ "Cidade/UF R$ valor".
create table if not exists public._bkp_descricao_vitrine_20261028 as
  select id, fonte, fonte_id, descricao from public.imoveis_leilao
   where (select count(*) from regexp_matches(coalesce(descricao, ''), '[A-Za-zÀ-ÿ]\s*/\s*[A-Z]{2}\s+R\$\s*[\d.]+,\d{2}', 'g')) >= 2;
alter table public._bkp_descricao_vitrine_20261028 enable row level security;

set local session_replication_role = replica;
update public.imoveis_leilao i set descricao = left(i.titulo, 500)
  from public._bkp_descricao_vitrine_20261028 b where b.id = i.id;
