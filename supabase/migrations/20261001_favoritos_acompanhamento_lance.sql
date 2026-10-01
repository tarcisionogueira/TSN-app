-- FAVORITOS / ACOMPANHAMENTO (01/10, pedido do dono): "tanto para imóveis como veículos, um campo de
-- acompanhamento em Minhas Análises; o que eu marcar vai para lá, com acesso direto à tela; e a cada
-- scraper, se o leilão não encerrou, puxar o valor atual de lance para saber se há disputa, se ela
-- evolui ou se segue sem lance."
--
-- Como o lance chega:
--  · VEÍCULOS da Superbid (8.686 de 11.886 ativos) trazem `raw.offerDetail.currentMaxBid` em TODA
--    coleta → um gatilho grava o histórico no mesmo instante em que o scraper atualiza o lote
--    (literalmente "a cada scraper", sem custo nenhum).
--  · IMÓVEIS não guardam lance corrente em fonte nenhuma (só o mínimo) e os demais veículos também
--    não → api/favoritos-lance-cron.js visita SÓ as páginas dos lotes favoritados e grava aqui.
-- "Não consegui medir" é ESTADO próprio (`nao_medido` + motivo), nunca "sem lance".

create table if not exists public.favoritos (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  tipo       text not null check (tipo in ('imovel', 'veiculo')),
  item_id    uuid not null,
  criado_em  timestamptz not null default now(),
  unique (user_id, tipo, item_id)
);
create index if not exists favoritos_item_idx on public.favoritos (tipo, item_id);

alter table public.favoritos enable row level security;
drop policy if exists favoritos_dono_le on public.favoritos;
create policy favoritos_dono_le on public.favoritos for select to authenticated using (user_id = auth.uid());
drop policy if exists favoritos_dono_insere on public.favoritos;
create policy favoritos_dono_insere on public.favoritos for insert to authenticated with check (user_id = auth.uid());
drop policy if exists favoritos_dono_apaga on public.favoritos;
create policy favoritos_dono_apaga on public.favoritos for delete to authenticated using (user_id = auth.uid());

create table if not exists public.favorito_lance (
  id          bigserial primary key,
  tipo        text not null check (tipo in ('imovel', 'veiculo')),
  item_id     uuid not null,
  valor       numeric,
  qtd_lances  integer,
  estado      text not null check (estado in ('com_lance', 'sem_lance', 'nao_medido')),
  origem      text not null,           -- 'scraper_superbid' | 'pagina_lote'
  motivo      text,                    -- obrigatório na prática quando estado = 'nao_medido'
  medido_em   timestamptz not null default now()
);
create index if not exists favorito_lance_item_idx on public.favorito_lance (tipo, item_id, medido_em desc);

-- Leitura só de quem favoritou o item; escrita só pelo servidor (service role, sem policy).
alter table public.favorito_lance enable row level security;
drop policy if exists favorito_lance_le on public.favorito_lance;
create policy favorito_lance_le on public.favorito_lance for select to authenticated
  using (exists (select 1 from public.favoritos f where f.user_id = auth.uid() and f.tipo = favorito_lance.tipo and f.item_id = favorito_lance.item_id));

-- ── GATILHO: veículo favoritado atualizado pelo scraper → grava o lance corrente ─────────────────
-- Superbid: sem lance, `currentMaxBid` = `initialBidValue` (lance inicial); com lance, ele sobe.
-- Grava quando o valor/estado muda ou quando a última medição tem mais de 6 h (prova de que segue
-- medindo, para "permanece sem lance" não confundir com "parou de medir").
create or replace function public.trg_favorito_lance_veiculo()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_atual numeric;
  v_inicial numeric;
  v_estado text;
  v_ult record;
begin
  if not exists (select 1 from public.favoritos f where f.tipo = 'veiculo' and f.item_id = new.id) then
    return new;
  end if;
  v_atual   := nullif(new.raw->'offerDetail'->>'currentMaxBid', '')::numeric;
  if v_atual is null then return new; end if;   -- fonte sem lance corrente: o cron cuida
  v_inicial := nullif(new.raw->'offerDetail'->>'initialBidValue', '')::numeric;
  v_estado  := case when coalesce(new.teve_lance, false) or (v_inicial is not null and v_atual > v_inicial) then 'com_lance' else 'sem_lance' end;
  select valor, estado, medido_em into v_ult from public.favorito_lance
   where tipo = 'veiculo' and item_id = new.id order by medido_em desc limit 1;
  if v_ult is null or v_ult.valor is distinct from v_atual or v_ult.estado <> v_estado or v_ult.medido_em < now() - interval '6 hours' then
    insert into public.favorito_lance (tipo, item_id, valor, estado, origem)
    values ('veiculo', new.id, v_atual, v_estado, 'scraper_superbid');
  end if;
  return new;
end $$;

drop trigger if exists favorito_lance_veiculo on public.veiculos_leilao;
create trigger favorito_lance_veiculo after update of raw on public.veiculos_leilao
  for each row execute function public.trg_favorito_lance_veiculo();

-- ── LISTA DO CLIENTE: favoritos com o status de disputa ──────────────────────────────────────────
-- status: encerrado | com_lance | disputa (o lance SUBIU entre medições) | sem_lance | nao_medido
create or replace function public.meus_favoritos()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with f as (
    select f.tipo, f.item_id, f.criado_em from public.favoritos f where f.user_id = auth.uid()
  ),
  itens as (
    select f.tipo, f.item_id, f.criado_em,
           coalesce(i.titulo, v.titulo) titulo,
           coalesce(i.cidade, v.cidade) cidade,
           coalesce(i.estado, v.estado) uf,
           coalesce(i.link_foto, v.fotos->>0) foto,
           coalesce(i.valor_minimo, v.valor_minimo) valor_minimo,
           coalesce(i.valor_avaliacao, v.valor_fipe, v.valor_avaliacao) referencia,
           coalesce(i.url_lote, v.link_lote) link_lote,
           coalesce(i.ativo, v.ativo, false) ativo,
           coalesce(i.resultado_leilao, v.resultado_leilao) resultado,
           coalesce(i.valor_lance_vencedor, v.valor_lance_vencedor) lance_vencedor,
           coalesce(
             greatest(case when i.data_leilao ~ '^\d{4}-\d{2}-\d{2}' then i.data_leilao::timestamptz end, i.data_leilao_2, i.praca2_fim, i.praca1_fim),
             v.data_leilao) data_leilao
      from f
      left join public.imoveis_leilao i on f.tipo = 'imovel' and i.id = f.item_id
      left join public.veiculos_leilao v on f.tipo = 'veiculo' and v.id = f.item_id
  ),
  med as (
    select it.*,
           (select row_to_json(l) from (select valor, qtd_lances, estado, origem, motivo, medido_em from public.favorito_lance l
             where l.tipo = it.tipo and l.item_id = it.item_id order by medido_em desc limit 1) l) ultima,
           (select max(valor) from public.favorito_lance l where l.tipo = it.tipo and l.item_id = it.item_id
             and l.estado = 'com_lance' and l.medido_em < (select max(medido_em) from public.favorito_lance l2 where l2.tipo = it.tipo and l2.item_id = it.item_id)) lance_anterior,
           (select count(*) from public.favorito_lance l where l.tipo = it.tipo and l.item_id = it.item_id and l.estado <> 'nao_medido') medicoes
      from itens it
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'tipo', tipo, 'itemId', item_id, 'favoritadoEm', criado_em, 'titulo', titulo, 'cidade', cidade, 'uf', uf,
           'foto', foto, 'valorMinimo', valor_minimo, 'referencia', referencia, 'linkLote', link_lote,
           'dataLeilao', data_leilao, 'resultado', resultado, 'lanceVencedor', lance_vencedor,
           'ultimaMedicao', ultima, 'lanceAnterior', lance_anterior, 'medicoes', medicoes,
           'status', case
             when not ativo or (data_leilao is not null and data_leilao < now()) or resultado is not null then 'encerrado'
             when ultima is null then 'nao_medido'
             when (ultima->>'estado') = 'com_lance' and lance_anterior is not null and (ultima->>'valor')::numeric > lance_anterior then 'disputa'
             else ultima->>'estado' end)
         order by (case when not ativo then 1 else 0 end), data_leilao nulls last, criado_em desc), '[]'::jsonb)
    from med;
$$;
revoke all on function public.meus_favoritos() from public, anon;
grant execute on function public.meus_favoritos() to authenticated;
