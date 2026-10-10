-- 10/10 — GÊMEOS NA MESMA FONTE (dono: "vários imóveis iguais na busca").
-- O print mostrava 4 terrenos da Rua Olavo Bilac (COMPREI) — esses NÃO eram cópia: 4 matrículas
-- (13345, 29596, 37133, 42016), lotes vizinhos do mesmo processo, mesma foto ilustrativa. Mas a
-- varredura por matrícula achou 90 cópias REAIS em 17 fontes, de três tipos:
--   (a) 1ª e 2ª praça publicadas como ITENS separados (CERULI, ISAIAS, CRLEILOES): 100% e 50% da
--       mesma avaliação, ids consecutivos;
--   (b) o mesmo bem republicado num leilão novo (JELEILOES, FREITAS, KLEILOES, LJUD 5×);
--   (c) URL dupla do mesmo lote (ALBERTOMACEDO: slug × uuid).
-- Chave: fonte + UF + cidade + matrícula + área + nº do lote/unidade + quadra, e preços compatíveis
-- (iguais ou até 2,05× = praça). Matrícula que é DATA (CALIL grava 06042026) ou ANO (DANIELGARCIA
-- "2026") fica fora — não identifica o bem.
-- Fica o vivo de maior lance; a 2ª praça do gêmeo vira valor_minimo_2/data_leilao_2 dele. Sai via
-- ativo=false + suprimido_motivo='gemeo_mesma_fonte'; trg_preservar_supressao_gemeo segura o upsert
-- do scraper; reativa sozinho quando o que ficou sai de cena. Roda todo dia no monitor-fontes-cron.
-- 1ª rodada: 90 suprimidos, 22 com 2ª praça fundida; 2ª rodada 0/0/0 (idempotente).

create or replace function public.gemeos_mesma_fonte_grupos()
returns table (id uuid, fonte text, fonte_id text, ativo boolean, suprimido_motivo text, valor_minimo numeric, data_leilao text, vivo boolean, chave text, rn bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  with base as (
    select i.id, i.fonte, i.fonte_id, i.ativo, i.suprimido_motivo, i.valor_minimo::numeric valor_minimo, i.data_leilao::text data_leilao,
           (i.data_leilao is null or i.data_leilao::text !~ '^\d{4}-\d{2}-\d{2}' or substring(i.data_leilao::text,1,10)::date >= current_date) as vivo,
           i.fonte || '|' || coalesce(i.estado,'') || '|' || coalesce(i.cidade_norm,'') || '|' ||
             regexp_replace(i.numero_matricula,'\D','','g') || '|' || coalesce(round(i.area_m2)::text,'0') || '|' ||
             coalesce(lower((regexp_match(i.titulo || ' ' || left(coalesce(i.descricao,''),600),
               '(?:lote|apto|apartamento|unidade|casa|sala|box)\s*(?:n[º°o.]*\s*)?(\d+[a-z]?)', 'i'))[1]),'') || '|' ||
             coalesce(lower((regexp_match(i.titulo || ' ' || left(coalesce(i.descricao,''),600), 'quadra\s*(\w+)', 'i'))[1]),'') as chave
      from public.imoveis_leilao i
     where (i.ativo or i.suprimido_motivo = 'gemeo_mesma_fonte')
       and i.numero_matricula is not null
       and length(regexp_replace(i.numero_matricula,'\D','','g')) >= 3
       and regexp_replace(i.numero_matricula,'\D','','g') !~ '^(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])(19|20)\d\d$'
       and regexp_replace(i.numero_matricula,'\D','','g') !~ '^(19|20)\d\d$'
       and coalesce(i.valor_minimo,0) > 0
  ),
  r as (
    select b.*, row_number() over (partition by b.chave order by (b.ativo or b.suprimido_motivo = 'gemeo_mesma_fonte') and b.vivo desc,
                                                            b.valor_minimo desc, b.fonte_id) rn,
           max(b.valor_minimo) over (partition by b.chave) pmax, min(b.valor_minimo) over (partition by b.chave) pmin,
           count(*) over (partition by b.chave) n
      from base b
  )
  select id, fonte, fonte_id, ativo, suprimido_motivo, valor_minimo, data_leilao, vivo, chave, rn
    from r where n > 1 and pmax <= pmin * 2.05;
$$;
revoke all on function public.gemeos_mesma_fonte_grupos() from public, anon, authenticated;

create or replace function public.reconciliar_gemeos_mesma_fonte()
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_sup int := 0; v_rea int := 0; v_merge int := 0;
begin
  -- Data só com dia → meio-dia de Brasília (meia-noite UTC exibiria o dia ANTERIOR no Brasil).
  with g as (select * from public.gemeos_mesma_fonte_grupos()),
       k as (select * from g where rn = 1 and ativo),
       t as (select distinct on (chave) chave, valor_minimo, data_leilao from g where rn > 1 order by chave, valor_minimo)
  update public.imoveis_leilao i
     set valor_minimo_2 = t.valor_minimo,
         data_leilao_2 = case when t.data_leilao ~ '^\d{4}-\d{2}-\d{2}' and t.data_leilao is distinct from i.data_leilao
                              then (case when length(t.data_leilao) = 10 then t.data_leilao || 'T12:00:00-03:00' else t.data_leilao end)::timestamptz
                              else i.data_leilao_2 end
    from k join t using (chave)
   where i.id = k.id and i.valor_minimo_2 is null and t.valor_minimo <= k.valor_minimo * 0.75;
  get diagnostics v_merge = row_count;

  with g as (select * from public.gemeos_mesma_fonte_grupos())
  update public.imoveis_leilao i set ativo = false, suprimido_motivo = 'gemeo_mesma_fonte'
    from g
   where i.id = g.id and g.rn > 1 and i.ativo and i.suprimido_motivo is null
     and exists (select 1 from g k where k.chave = g.chave and k.rn = 1 and k.ativo);
  get diagnostics v_sup = row_count;

  with g as (select * from public.gemeos_mesma_fonte_grupos())
  update public.imoveis_leilao i set ativo = true, suprimido_motivo = null
   where i.suprimido_motivo = 'gemeo_mesma_fonte'
     and (i.data_leilao is null or i.data_leilao !~ '^\d{4}-\d{2}-\d{2}' or substring(i.data_leilao,1,10)::date >= current_date)
     and not exists (select 1 from g where g.id = i.id and g.rn > 1
                       and exists (select 1 from g k where k.chave = g.chave and k.rn = 1 and k.ativo));
  get diagnostics v_rea = row_count;

  return jsonb_build_object('suprimidos', v_sup, 'reativados', v_rea, 'praca2_fundida', v_merge, 'em', now());
end $$;
revoke all on function public.reconciliar_gemeos_mesma_fonte() from public, anon, authenticated;
