-- ─────────────────────────────────────────────────────────────────────────────────────────
-- REVISÃO DE 29/09 — GATILHOS (achados da revisão do dia, conferidos no banco)
--
-- 1. trg_zzz_situacao_geo disparava em TODO upsert de coletor: é `UPDATE OF ... estado`, e o upsert
--    manda o registro inteiro (estado incluso) — o PostgreSQL conta a coluna como "atualizada" mesmo
--    com o mesmo valor. Medido: ~4,7 ms por linha em SP (PostGIS em área urbana + restrições), em
--    ~milhares de linhas por rodada. A função é pura sobre (lat, lng, nível, UF): se nenhum mudou, o
--    resultado não muda. Dividido em INSERT e UPDATE, o de UPDATE com WHEN.
--    ⚠️ Recarregou camada de restrição/área urbana? O gatilho NÃO recalcula sozinho linha parada —
--    recalcule com `update imoveis_leilao set restricoes_geo = public.restricoes_geo(latitude,
--    longitude, geocod_nivel), restricoes_geo_em = now() where ...` (idem situacao_geo).
-- 2. situacao_geo/restricoes_geo estavam executáveis por PUBLIC/anon (ACL padrão). Não vazava nada
--    (tabelas com RLS sem política), mas não há motivo: sai de PUBLIC e anon. `authenticated` fica —
--    o gatilho é SECURITY INVOKER e uma edição de coordenada pela equipe passa por ele.
-- 3. trg_veiculo_local:
--    a) gravava `cidade_origem` em QUALQUER update de cidade/estado — num update só de UF, trocava o
--       texto original do coletor pela cidade já normalizada. Agora só quando a cidade muda.
--    b) ganhou a regra "o texto TERMINA com o nome do município" (a mesma de `cidade_pelo_ibge` dos
--       imóveis): LJUD grava cor/combustível antes da cidade ("Cinza Alvorada", "Gasolina Porto
--       Alegre"), WEBLEILOES grava "Veículo - Bauru". Seco em 29/09: 6 de 6 certos, 0 inventados.
--       Maior nome vence; nome ≥ 4 letras; sem candidato não mexe.
--    O resto dos 87 veículos fora do IBGE era o regex do LJUD cortando no conectivo ("Santa Cruz do
--    Sul" → "Sul") — corrigido no coletor (scraper-puppeteer.mjs, REGEX_LJUD_CIDADE_UF).
-- ─────────────────────────────────────────────────────────────────────────────────────────

drop trigger if exists trg_zzz_situacao_geo on public.imoveis_leilao;
create trigger trg_zzz_situacao_geo before insert on public.imoveis_leilao
  for each row execute function public.trg_situacao_geo();
drop trigger if exists trg_zzz_situacao_geo_upd on public.imoveis_leilao;
create trigger trg_zzz_situacao_geo_upd before update of latitude, longitude, geocod_nivel, estado on public.imoveis_leilao
  for each row when (new.latitude is distinct from old.latitude or new.longitude is distinct from old.longitude
                     or new.geocod_nivel is distinct from old.geocod_nivel or new.estado is distinct from old.estado)
  execute function public.trg_situacao_geo();

revoke execute on function public.situacao_geo(numeric, numeric, text, text) from public, anon;
revoke execute on function public.restricoes_geo(numeric, numeric, text) from public, anon;
grant execute on function public.situacao_geo(numeric, numeric, text, text) to authenticated, service_role;
grant execute on function public.restricoes_geo(numeric, numeric, text) to authenticated, service_role;

create or replace function public.trg_veiculo_local()
 returns trigger language plpgsql set search_path to 'public' as $function$
declare bruto text; limpa text; k text; v_uf text; m_nome text; m_uf text; n int;
begin
  bruto := nullif(btrim(coalesce(new.cidade, '')), '');
  if bruto is null then new.local_ibge := null; return new; end if;
  if tg_op = 'INSERT' or new.cidade is distinct from old.cidade then
    new.cidade_origem := bruto;
  end if;
  if public.chave_nome(bruto) in ('sem informacao', 'nao informado', 'sem cidade') then
    new.cidade := null; new.patio := null; new.local_ibge := false; return new;
  end if;
  limpa := btrim(regexp_replace(bruto, '\s*/\s*[A-Za-z]{2}\s*$', ''));
  if limpa ~* '\s+(i{1,3}|iv|vi{0,3})$' then
    new.patio := limpa;
    limpa := btrim(regexp_replace(limpa, '\s+(i{1,3}|iv|vi{0,3})$', '', 'i'));
  end if;
  k := public.chave_nome(limpa);
  v_uf := upper(nullif(btrim(coalesce(new.estado, '')), ''));

  select a.nome, a.uf into m_nome, m_uf from area_urbana_municipio a
   where public.chave_nome(a.nome) = k and a.uf = v_uf limit 1;
  if m_nome is null then
    select count(*) into n from area_urbana_municipio a where public.chave_nome(a.nome) = k;
    if n = 1 then
      select a.nome, a.uf into m_nome, m_uf from area_urbana_municipio a where public.chave_nome(a.nome) = k;
    end if;
  end if;
  if m_nome is null and v_uf is not null and length(k) >= 5 then
    select count(*) into n from area_urbana_municipio a where a.uf = v_uf and public.chave_nome(a.nome) like '% ' || k;
    if n = 1 then
      select a.nome, a.uf into m_nome, m_uf from area_urbana_municipio a where a.uf = v_uf and public.chave_nome(a.nome) like '% ' || k;
    end if;
  end if;
  -- (3b) texto que TERMINA com o nome do município: "cinza alvorada" → Alvorada.
  if m_nome is null and v_uf is not null then
    select a.nome, a.uf into m_nome, m_uf from area_urbana_municipio a
     where a.uf = v_uf and length(a.nome) >= 4 and k like '% ' || public.chave_nome(a.nome)
     order by length(a.nome) desc limit 1;
  end if;
  if m_nome is not null then
    new.cidade := m_nome; new.estado := m_uf; new.local_ibge := true;
  else
    new.cidade := initcap(limpa); new.local_ibge := false;
  end if;
  return new;
end $function$;
