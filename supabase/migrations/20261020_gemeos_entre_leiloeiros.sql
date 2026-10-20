-- 20/10 — GÊMEOS ENTRE LEILOEIROS (dono: "há vários lotes iguais em leiloeiros diferentes").
-- O print: a casa da Rua Andrade Fernandes, 120 (Vila Madalena, processo TRT-2 1000881-49.2023.5.02.0041,
-- matrícula 31.417) aparecia em 10 cards — HastaPública (2×), Grupo Lance, 3 Torres, Picelli, Cunha,
-- Lanceja, Shiokawa, Zaccarino, Sublime. O mesmo lote judicial divulgado por vários portais. As
-- reconciliações existentes só cobrem pares fixos (HASTA×CEF, leiloeiro×CEF, VLANCE×LJUD, mesma fonte).
--
-- Chave: UF + cidade + lance mínimo + avaliação + parte inteira da área (avaliação > 0 obrigatória: o
-- par lance = avaliação sozinho é comum demais). Grupo só vale com 2+ fontes. TRAVAS contra fundir
-- imóveis diferentes — qualquer uma derruba o GRUPO INTEIRO (conservador: perder um gêmeo é melhor
-- que esconder um imóvel real):
--   • matrículas diferentes (dígitos sem zeros à esquerda; uma CONTER a outra é a mesma — o formato
--     CNM "111138.2.0031417-75" contém 31417);
--   • números de processo diferentes;
--   • nº de lote/apto/unidade/sala/box diferente no título.
-- Fica 1 (decisão do dono, 20/10): o de leilão VIVO mais próximo; empate → mais documentos (edital +
-- matrícula); depois o mais antigo no acervo. Os outros saem via ativo=false +
-- suprimido_motivo='gemeo_entre_leiloeiros' (o gatilho preservar_supressao_gemeo segura o upsert do
-- coletor) e voltam sozinhos quando o grupo se desfaz. O que fica guarda em `anunciado_em` a lista dos
-- outros anúncios (fonte, leiloeiro, data, link) para a ficha mostrar "também anunciado em".
-- Seco em 20/10: 99 grupos, 156 cards a menos, nenhum com relatório de cliente; 5 grupos barrados por trava.
-- Roda todo dia no monitor-fontes-cron, depois das outras reconciliações. Idempotente.

alter table public.imoveis_leilao add column if not exists anunciado_em jsonb;

create or replace function public.gemeos_entre_leiloeiros_grupos()
returns table (id uuid, chave text, rn bigint, ativo boolean, suprimido_motivo text)
language sql stable security definer set search_path = public, pg_temp as $$
  with base as materialized (
    select i.id, i.fonte, i.ativo, i.suprimido_motivo, i.data_fim, i.criado_em,
           nullif(ltrim(regexp_replace(coalesce(i.numero_matricula,''),'\D','','g'),'0'),'') as mat,
           nullif(regexp_replace(coalesce(i.numero_processo,''),'\D','','g'),'') as proc,
           lower((regexp_match(coalesce(i.titulo,''),
             '(?:lote|apto|apartamento|unidade|sala|box)\s*(?:n[º°o.]*\s*)?(\d+[a-z]?)\M', 'i'))[1]) as unid,
           (i.data_fim is null or i.data_fim >= (now() at time zone 'America/Sao_Paulo')::date) as vivo,
           coalesce(i.tem_edital_doc,false)::int + coalesce(i.tem_matricula_doc,false)::int as docs,
           concat_ws('|', i.estado, i.cidade_norm, i.valor_minimo::numeric, i.valor_avaliacao::numeric, floor(i.area_m2)) as chave
      from public.imoveis_leilao i
     where (i.ativo or i.suprimido_motivo = 'gemeo_entre_leiloeiros')
       and i.fonte not in ('CEF','caixa','HASTA','EDITAL_DJEN')
       and i.tipo is distinct from 'veiculo'
       and coalesce(i.valor_minimo,0) > 1000 and coalesce(i.valor_avaliacao,0) > 1000
       and coalesce(i.area_m2,0) > 0 and i.cidade_norm is not null and i.estado is not null
  ),
  g as (select b.chave from base b group by b.chave having count(*) > 1 and count(distinct b.fonte) > 1),
  conflito as (
    select distinct a.chave from base a join base b on a.chave = b.chave and a.id < b.id
     where (a.mat is not null and b.mat is not null and strpos(a.mat, b.mat) = 0 and strpos(b.mat, a.mat) = 0)
        or (a.proc is not null and b.proc is not null and a.proc <> b.proc)
        or (a.unid is not null and b.unid is not null and a.unid <> b.unid)
  )
  select b.id, b.chave,
         row_number() over (partition by b.chave order by b.vivo desc, b.data_fim nulls last, b.docs desc, b.criado_em, b.id) as rn,
         b.ativo, b.suprimido_motivo
    from base b
   where b.chave in (select chave from g except select chave from conflito);
$$;
revoke all on function public.gemeos_entre_leiloeiros_grupos() from public, anon, authenticated;

create or replace function public.reconciliar_gemeos_entre_leiloeiros()
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_sup int := 0; v_rea int := 0; v_lista int := 0; v_grupos int := 0;
begin
  create temp table _g on commit drop as select * from public.gemeos_entre_leiloeiros_grupos();
  select count(distinct chave) into v_grupos from _g;

  -- Quem fica guarda a lista dos outros anúncios (e quem deixou de ser o principal perde a sua).
  update public.imoveis_leilao i
     set anunciado_em = x.lista
    from (select k.id, jsonb_agg(jsonb_build_object('id', o.id, 'fonte', o.fonte, 'leiloeiro', o.leiloeiro,
                   'data_leilao', o.data_leilao, 'url_lote', o.url_lote) order by o.data_fim nulls last) as lista
            from _g k join _g g2 on g2.chave = k.chave and g2.rn > 1
            join public.imoveis_leilao o on o.id = g2.id
           where k.rn = 1 group by k.id) x
   where i.id = x.id and i.anunciado_em is distinct from x.lista;
  get diagnostics v_lista = row_count;
  update public.imoveis_leilao i set anunciado_em = null
   where i.anunciado_em is not null and not exists (select 1 from _g where _g.id = i.id and _g.rn = 1);

  update public.imoveis_leilao i set ativo = false, suprimido_motivo = 'gemeo_entre_leiloeiros'
    from _g
   where i.id = _g.id and _g.rn > 1 and i.ativo and i.suprimido_motivo is null;
  get diagnostics v_sup = row_count;

  -- Volta quem não é mais cópia de ninguém (grupo desfeito ou virou o principal), se ainda vende.
  update public.imoveis_leilao i set ativo = true, suprimido_motivo = null
   where i.suprimido_motivo = 'gemeo_entre_leiloeiros'
     and (i.data_fim is null or i.data_fim >= (now() at time zone 'America/Sao_Paulo')::date)
     and not exists (select 1 from _g where _g.id = i.id and _g.rn > 1);
  get diagnostics v_rea = row_count;

  return jsonb_build_object('grupos', v_grupos, 'suprimidos', v_sup, 'reativados', v_rea, 'listas', v_lista, 'em', now());
end $$;
revoke all on function public.reconciliar_gemeos_entre_leiloeiros() from public, anon, authenticated;

-- O upsert do coletor não religa a cópia (mesma regra dos outros gêmeos).
create or replace function public.preservar_supressao_gemeo()
 returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if old.suprimido_motivo in ('gemeo_hasta', 'gemeo_mesma_fonte', 'segunda_praca_em_outro_anuncio', 'relistado', 'gemeo_entre_leiloeiros')
     and new.suprimido_motivo is not distinct from old.suprimido_motivo and new.ativo then
    new.ativo := false;
  end if;
  return new;
end $function$;
