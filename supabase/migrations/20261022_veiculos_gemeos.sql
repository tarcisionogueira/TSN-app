-- GÊMEOS DE VEÍCULO (22/10, dono: "os carros parecem estar repetidos"). Medido no acervo ativo:
--   • 1ª e 2ª praça como DOIS itens (CERULI/ISAIAS/CRLEILOES/SUPERBID): Gol JFI-4972 a R$ 3.500 às 15:00
--     e a R$ 1.750 às 15:30 — o mesmo carro duas vezes na busca;
--   • republicação em outro leilão da mesma fonte (LJUD: Jeep JFM-5440 em 222642 e 224654);
--   • edital do DJEN × o lote do leiloeiro (HOB6I50 em EDITAL_DJEN e SAULOJULIO).
-- O que NÃO é gêmeo (e por isso a chave é placa/chassi, nunca a descrição): frota igual do mesmo vendedor
-- — os 5 Spark EUV do SUPERBID têm a MESMA descrição e preço, mas placa final e referência diferentes; e
-- "FORD KA 1997 1998 AZUL" em dois leilões da Hasta SP sem placa nenhuma não prova que é o mesmo carro.
-- Mesmo desenho dos imóveis (reconciliar_gemeos_mesma_fonte / entre_leiloeiros): fica 1 por veículo — o de
-- leilão vivo mais próximo, de fonte real antes do edital —, a 2ª praça vira valor_minimo_2/data_leilao_2
-- dele, os outros saem da vitrine com suprimido_motivo e VOLTAM sozinhos quando o que ficou sai de cena.

alter table public.veiculos_leilao add column if not exists suprimido_motivo text;
alter table public.veiculos_leilao add column if not exists valor_minimo_2 numeric;
alter table public.veiculos_leilao add column if not exists data_leilao_2 timestamptz;

-- Identidade do veículo: placa (coluna ou UMA só placa citada no texto — lote com várias não identifica),
-- senão chassi de 17. Placa antes do chassi: FBLEILOES tem o mesmo chassi em duas placas (erro do site).
create or replace function public.veiculo_identidade(p_placa text, p_chassi text, p_texto text)
 returns text language plpgsql immutable set search_path to 'public' as $$
declare v text; n int;
begin
  v := upper(regexp_replace(coalesce(p_placa, ''), '[^A-Za-z0-9]', '', 'g'));
  if v ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$' then return 'P:' || v; end if;
  select count(distinct x), min(x) into n, v
    from (select upper(m[1] || m[2]) x
            from regexp_matches(coalesce(p_texto, ''), '\mplaca\s*(?:n[º°o.]*\s*)?:?\s*([A-Za-z]{3})\s*-?\s*([0-9][A-Za-z0-9][0-9]{2})\M', 'gi') m) s;
  if n = 1 then return 'P:' || v; end if;
  v := upper(regexp_replace(coalesce(p_chassi, ''), '[^A-Za-z0-9]', '', 'g'));
  if length(v) = 17 and v !~ '^0+$' then return 'C:' || v; end if;
  return null;
end $$;

create or replace function public.gemeos_veiculos_grupos()
 returns table(id uuid, fonte text, fonte_id text, ativo boolean, suprimido_motivo text, valor_minimo numeric,
               data_leilao timestamptz, chave text, rn bigint)
 language sql stable set search_path to 'public', 'pg_temp' as $$
  with base as materialized (
    select v.id, v.fonte, v.fonte_id, v.ativo, v.suprimido_motivo, v.valor_minimo::numeric valor_minimo, v.data_leilao,
           (v.data_leilao is null or v.data_leilao >= now()) vivo,
           public.veiculo_identidade(v.placa, v.chassi, coalesce(v.titulo, '') || ' ' || left(coalesce(v.descricao, ''), 1500)) chave
      from public.veiculos_leilao v
     where v.ativo or v.suprimido_motivo = 'gemeo_veiculo'
  ),
  r as (
    select b.*, count(*) over w n,
           max(nullif(b.valor_minimo, 0)) over w pmax, min(nullif(b.valor_minimo, 0)) over w pmin,
           row_number() over (partition by b.chave order by (b.fonte <> 'EDITAL_DJEN') desc, b.vivo desc,
                                b.data_leilao nulls last, b.valor_minimo desc nulls last, b.fonte_id) rn
      from base b where b.chave is not null
    window w as (partition by b.chave)
  )
  -- preço compatível: igual (republicação) ou praça (até 2,05×) — placa repetida com preços sem relação
  -- é cadastro errado no site, não o mesmo lote.
  select id, fonte, fonte_id, ativo, suprimido_motivo, valor_minimo, data_leilao, chave, rn
    from r where n > 1 and (pmin is null or pmax <= pmin * 2.05);
$$;

create or replace function public.reconciliar_gemeos_veiculos()
 returns jsonb language plpgsql set search_path to 'public', 'pg_temp' as $$
declare v_sup int := 0; v_rea int := 0; v_merge int := 0; v_grupos int := 0;
begin
  create temp table _gv on commit drop as select * from public.gemeos_veiculos_grupos();
  select count(distinct chave) into v_grupos from _gv;

  -- 2ª praça (mesma fonte, preço ≤ 75% e data igual ou depois) vira dado do que fica.
  update public.veiculos_leilao i set valor_minimo_2 = t.valor_minimo, data_leilao_2 = t.data_leilao
    from _gv k
    join lateral (select g.valor_minimo, g.data_leilao from _gv g
                   where g.chave = k.chave and g.rn > 1 and g.fonte = k.fonte
                     and g.valor_minimo <= k.valor_minimo * 0.75
                     and (k.data_leilao is null or g.data_leilao is null or g.data_leilao >= k.data_leilao)
                   order by g.valor_minimo limit 1) t on true
   where i.id = k.id and k.rn = 1
     and (i.valor_minimo_2 is distinct from t.valor_minimo or i.data_leilao_2 is distinct from t.data_leilao);
  get diagnostics v_merge = row_count;
  update public.veiculos_leilao i set valor_minimo_2 = null, data_leilao_2 = null
   where i.valor_minimo_2 is not null
     and not exists (select 1 from _gv k join _gv g on g.chave = k.chave and g.rn > 1 and g.fonte = k.fonte
                      where k.id = i.id and k.rn = 1 and g.valor_minimo <= k.valor_minimo * 0.75);

  update public.veiculos_leilao i set ativo = false, suprimido_motivo = 'gemeo_veiculo'
    from _gv g
   where i.id = g.id and g.rn > 1 and i.ativo and i.suprimido_motivo is null;
  get diagnostics v_sup = row_count;

  -- reativa SÓ o que esta função suprimiu e cujo gêmeo saiu de cena (leilão ainda vivo)
  update public.veiculos_leilao i set ativo = true, suprimido_motivo = null
   where i.suprimido_motivo = 'gemeo_veiculo'
     and (i.data_leilao is null or i.data_leilao >= now())
     and not exists (select 1 from _gv g where g.id = i.id and g.rn > 1);
  get diagnostics v_rea = row_count;

  return jsonb_build_object('grupos', v_grupos, 'suprimidos', v_sup, 'reativados', v_rea, 'praca2', v_merge, 'em', now());
end $$;

-- SECURITY INVOKER de propósito: só o service role (cron) consegue alterar a tabela; anon/authenticated
-- chamando a RPC não passam da RLS.
-- O coletor regrava `ativo = true` a cada rodada: sem isto o gêmeo voltaria à vitrine até o próximo cron.
create or replace function public.preservar_supressao_gemeo_veiculo()
 returns trigger language plpgsql set search_path to 'public' as $$
begin
  if old.suprimido_motivo = 'gemeo_veiculo' and new.suprimido_motivo is not distinct from old.suprimido_motivo and new.ativo then
    new.ativo := false;
  end if;
  return new;
end $$;

create or replace trigger trg_preservar_supressao_gemeo_veiculo before update on public.veiculos_leilao
  for each row execute function public.preservar_supressao_gemeo_veiculo();
