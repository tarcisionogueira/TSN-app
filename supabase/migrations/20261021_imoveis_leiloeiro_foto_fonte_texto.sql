-- 21/10 (#265, dono: "no plano gratuito não deve ter esse indicativo de quem é o leiloeiro").
-- A #264 escondia nome/links, mas o leiloeiro seguia identificável por:
--   · FOTO: 6.994 lotes com link_foto no CDN do próprio leiloeiro — e até a cópia NOSSA tem o nome no caminho
--     (imoveis-fotos/bayit/bayit_681.jpg);
--   · FONTE / FONTE_ID ("BAYIT", "bayit_681");
--   · TEXTO: "Leiloeiro: FULANO - JUCESP 464", "www.fulanoleiloes.com.br", "canais da Superbid", e títulos de
--     reserva como "Imóvel Hasta Leilões 12107" (509 lotes).
-- Para quem NÃO pode ver o leiloeiro (pode_ver_leiloeiro()), e fora da Caixa (o vendedor é o banco):
--   foto → /api/img-proxy?imovel=<id>&capa=1 | &i=<n> (o servidor lê a URL no banco; mesmo desenho de veículos);
--   fonte/fonte_id → nulos; descrição e título → limpos por funções únicas (descricao_sem_leiloeiro / titulo_sem_leiloeiro).
-- Os endpoints do servidor que liam a tabela com a service key passam a ler esta view com a sessão de quem
-- chamou (busca-raio, publico, enriquecer-lote): a regra mora num lugar só.

create or replace function public.descricao_sem_leiloeiro(t text, f text)
returns text language sql immutable set search_path to 'public' as $function$
  with l as (select '[Ll][Ee][Ii][Ll][Oo][Ee][Ii][Rr]' as lei,
                    '[[:upper:]][[:alpha:]]+(\s+(d[aeo]s?|e)\s+|\s+)' as pal)
  select nullif(btrim(
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(t,
      -- "Leiloeiro(a): NOME - JUCE.." → só o rótulo
      lei || '[[:alpha:]]*s?\s*(\([aA]\))?[^\n:]{0,30}:[ \t]*[^\n.;:–]{0,80}', 'Leiloeiro: disponível no plano pago', 'g'),
      -- NOME (caixa alta ou "Nome Sobrenome") logo antes de "leiloeiro"
      '([[:upper:]][[:upper:]''¿ .-]{4,80}|(' || pal || '){1,6}[[:upper:]][[:lower:]]+),?\s*(?=' || lei || ')', '', 'g'),
      -- NOME logo depois de "leiloeiro (público) (oficial) (o Sr.)"
      '(' || lei || '[[:alpha:]]*s?(\s+[Pp][ÚúUu][Bb][Ll][Ii][Cc][Oo]s?|\s+[Pp][ÚúUu][Bb][Ll][Ii][Cc][Aa]s?)?(\s+[Oo][Ff][Ii][Cc][Ii][Aa](l|is|L|IS))?)\s+(o\s+|a\s+)?(Sr[a]?\.\s*)?([[:upper:]][[:upper:]''¿ .-]{4,80}[[:upper:]]|(' || pal || '){1,6}[[:upper:]][[:lower:]]+)', '\1', 'g'),
      'JUCE[[:upper:]]{1,4}[^\n,;)]{0,25}?\d[\d/.-]*[[:upper:]-]*', '', 'g'),                 -- registro na Junta
      '(https?://|www\.)\S+', '', 'gi'),                                                     -- links
      '\S+@\S+\.\S+|\m[a-z0-9-]+\.(com|net|org|leilao)(\.br)?\M\S*', '', 'gi'),               -- e-mail e domínio solto
      '\(?\m\d{2}\)?\s*9?\d{4}-\d{4}\M', '', 'g'),                                            -- telefone
      '\m[[:upper:]][[:alpha:]]+(\s[[:upper:]][[:alpha:]]+)?\s+Leil(õ|o)es\M', 'o leiloeiro', 'g'), -- marca "X Leilões"
      -- o nome da própria fonte no texto ("canais oficiais da Superbid"); nomes curtos/comuns ficam de fora
      case when length(coalesce(f,'')) >= 5 and f !~* '^(COMPREI|EDITAL_DJEN|MANUAL|CAIXA)$' then '\m' || f || '\M' else '\m\M(?!)' end, 'a plataforma', 'gi'),
      '[ \t]{2,}', ' ', 'g')
  ), '') from l
$function$;

create or replace function public.titulo_sem_leiloeiro(t text, tipo text, cidade text, estado text)
returns text language sql immutable set search_path to 'public' as $function$
  select case
    -- título de reserva do scraper: "Imóvel Hasta Leilões 12107" → "Casa em Campinas/SP"
    when t ~* 'leil(õ|o)es|leiloeir' then
      coalesce(case when tipo !~* '^(outros?|imovel|imóvel)?$' then initcap(tipo) end, 'Imóvel') || coalesce(' em ' || nullif(cidade, '') || coalesce('/' || nullif(estado, ''), ''), '')
    else t end
$function$;

create or replace function public.foto_imovel_publica(p_id uuid, p_url text, p_i integer)
returns text language sql immutable set search_path to 'public' as $function$
  select case when coalesce(p_url, '') = '' then p_url
              when p_i is null then '/api/img-proxy?imovel=' || p_id || '&capa=1'
              else '/api/img-proxy?imovel=' || p_id || '&i=' || p_i end
$function$;

-- A view: mesmas colunas, na mesma ordem e tipo (create or replace view exige). Mostra cru quem pode ver o
-- leiloeiro, e a Caixa (fonte/foto da Caixa não identificam leiloeiro).
create or replace view public.imoveis_leilao_mascarado with (security_invoker = false) as
select
  i.id,
  -- fontes que NÃO são leiloeiro ficam visíveis: edital do Diário Oficial (a Busca filtra por ele), lote incluído
  -- pelo próprio cliente (MANUAL) e as de parceiro/webhook (id opaco; o portal do leiloeiro filtra por elas).
  case when (p.pode or i.fonte in ('CEF', 'caixa') or (i.fonte in ('EDITAL_DJEN', 'MANUAL') or i.fonte ~ '^(webhook|parceiro)_')) then i.fonte end as fonte,
  case when (p.pode or i.fonte in ('CEF', 'caixa') or (i.fonte in ('EDITAL_DJEN', 'MANUAL') or i.fonte ~ '^(webhook|parceiro)_')) then i.fonte_id end as fonte_id,
  case when (p.pode or i.fonte in ('CEF', 'caixa')) then i.titulo else public.titulo_sem_leiloeiro(i.titulo, i.tipo, i.cidade, i.estado) end as titulo,
  i.tipo,
  i.modalidade,
  i.estado,
  i.cidade,
  i.bairro,
  i.endereco,
  i.valor_avaliacao,
  i.valor_minimo,
  i.desconto_percentual,
  i.area_m2,
  case when (p.pode or i.fonte in ('CEF', 'caixa')) then i.descricao else public.descricao_sem_leiloeiro(i.descricao, i.fonte) end as descricao,
  case when p.pode then i.link_edital else null::text end as link_edital,
  case when (p.pode or i.fonte in ('CEF', 'caixa')) then i.link_foto else public.foto_imovel_publica(i.id, i.link_foto, null) end as link_foto,
  case when p.pode then i.leiloeiro else null::text end as leiloeiro,
  i.data_leilao,
  i.forma_pagamento,
  i.viavel,
  i.score_viabilidade,
  i.motivo_viabilidade,
  i.ativo,
  case when p.pode then i.raw else null::text end as raw,
  i.atualizado_em,
  i.criado_em,
  i.fracionado,
  case when p.pode then i.url_lote else null::text end as url_lote,
  i.nomecondominio,
  i.numero_edital,
  i.numero_matricula,
  i.numero_processo,
  case when p.pode then i.link_matricula else null::text end as link_matricula,
  i.geocod_nivel,
  case when p.pode then i.link_regras_venda else null::text end as link_regras_venda,
  i.latitude,
  i.longitude,
  i.cep,
  i.status,
  i.score_financeiro,
  i.score_juridico,
  i.score_calculado_em,
  i.pontos_proximos,
  i.proximidades_em,
  i.cidade_norm,
  case when p.pode then i.anexos else null::jsonb end as anexos,
  i.enriquecido_em,
  i.score_localizacao,
  i.geocod_reproc_em,
  i.valor_mercado,
  i.analise_viavel,
  i.analise_em,
  i.ficha_cef,
  i.matricula_scan_em,
  i.ficha_juridica,
  i.ocupacao,
  i.matricula_checada_em,
  i.proximidades_tentativas,
  i.valor_minimo_2,
  i.data_leilao_2,
  i.data_fim,
  i.doc_fatos,
  i.doc_fatos_em,
  i.proximidades_vazios,
  i.proximidades_vazio_em,
  i.proximidades_espelhos,
  i.valor_minimo_ref,
  i.tem_edital_doc,
  i.tem_matricula_doc,
  i.suprimido_motivo,
  i.geocod_tentativas,
  i.praca1_fim,
  i.praca2_fim,
  i.doc_descoberta_em,
  i.doc_descoberta_tentativas,
  case when (p.pode or i.fonte in ('CEF', 'caixa')) or jsonb_typeof(i.fotos) is distinct from 'array' then i.fotos
              else (select coalesce(jsonb_agg(public.foto_imovel_publica(i.id, e.v, (e.o - 1)::int) order by e.o), '[]'::jsonb)
                      from jsonb_array_elements_text(i.fotos) with ordinality e(v, o)) end as fotos,
  i.resultado_leilao,
  i.valor_lance_vencedor,
  i.resultado_apurado_em,
  i.resultado_apuracao_tentativas,
  i.resultado_origem,
  i.foto_espelhada_em,
  i.foto_espelho_tentativas,
  i.zuk_docs_em,
  i.situacao_geo,
  i.situacao_geo_em,
  i.restricoes_geo,
  i.restricoes_geo_em,
  i.correcao_edital,
  case when p.pode then i.anunciado_em else null::jsonb end as anunciado_em
  from public.imoveis_leilao i
  -- `offset 0`: calcula pode_ver_leiloeiro() UMA vez por consulta. Como LATERAL por linha, a contagem da Busca
  -- ficava 10× mais lenta (449 ms × 55 ms medidos) — e para `authenticated` cada linha consultava perfis.
  cross join (select public.pode_ver_leiloeiro() as pode offset 0) p;

-- Favoritos: a foto do imóvel também passa pelo proxy por id para quem não pode ver o leiloeiro (o título de
-- reserva idem). Aplicado por substituição no corpo vivo (a função é grande e já mascara o link do lote).
do $$
declare d text := pg_get_functiondef('public.meus_favoritos'::regproc); n text;
begin
  n := replace(d, $x$coalesce(i.titulo, v.titulo) titulo,$x$,
    $x$coalesce(case when public.pode_ver_leiloeiro() or i.fonte in ('CEF', 'caixa') then i.titulo else public.titulo_sem_leiloeiro(i.titulo, i.tipo, i.cidade, i.estado) end, v.titulo) titulo,$x$);
  n := replace(n, $x$coalesce(i.link_foto, case$x$,
    $x$coalesce(case when public.pode_ver_leiloeiro() or i.fonte in ('CEF', 'caixa') then i.link_foto else public.foto_imovel_publica(i.id, i.link_foto, null) end, case$x$);
  if n = d then raise notice 'meus_favoritos já ajustado'; return; end if;
  execute n;
end $$;
-- 21/10 (#265): o CTE `filtrados` levava `i.*` e era lido duas vezes (contagem + página) — materializava TODAS as
-- colunas de todos os lotes do raio, e com a view mascarada isso passou a incluir a limpeza da descrição de cada
-- um (explorador: 2,2 s × Pro 0,85 s, raio de 50 km em SP). Agora filtra/conta só por id + chaves de ordenação e
-- busca as colunas completas apenas das linhas da página. Mesmos filtros, mesma ordem, mesmo retorno.
create or replace function public.buscar_por_raio_v2(lat double precision, lng double precision, raio_metros double precision, lim integer DEFAULT 24, off integer DEFAULT 0, tipos_filtro text[] DEFAULT '{}'::text[], estado_filtro text DEFAULT ''::text, modalidades_filtro text[] DEFAULT '{}'::text[], pagamentos_filtro text[] DEFAULT '{}'::text[], valor_min double precision DEFAULT 0, valor_max double precision DEFAULT '9999999999'::bigint, desconto_min double precision DEFAULT 0, data_de text DEFAULT NULL::text, data_ate text DEFAULT NULL::text, sem_data boolean DEFAULT false, ordenacao text DEFAULT 'distancia'::text, resultado_filtro text DEFAULT ''::text)
 RETURNS TABLE(id uuid, titulo text, tipo text, modalidade text, estado text, cidade text, bairro text, endereco text, valor_minimo double precision, valor_avaliacao double precision, desconto_percentual double precision, area_m2 double precision, latitude double precision, longitude double precision, link_foto text, url_lote text, data_leilao text, forma_pagamento text, fonte text, fonte_id text, score_financeiro integer, score_juridico integer, score_localizacao numeric, distancia_km double precision, total bigint, leiloeiro text, descricao text, link_edital text, link_matricula text, fracionado boolean, viavel boolean, score_viabilidade integer, numero_edital text, numero_matricula text, numero_processo text, valor_mercado numeric, analise_viavel boolean, valor_minimo_ref double precision, data_leilao_2 timestamp with time zone, data_fim date, praca1_fim timestamp with time zone, praca2_fim timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with filtrados as (
    select
      i.id, i.valor_minimo_ref, i.desconto_percentual, i.data_fim,
      round(cast(
        earth_distance(
          ll_to_earth(i.latitude::float8, i.longitude::float8),
          ll_to_earth($1, $2)
        ) / 1000.0 as numeric
      ), 1)::float8 as distancia_km
    from public.imoveis_leilao i
    where
      i.ativo = true
      and (i.fonte is distinct from 'EDITAL_DJEN' or coalesce(i.valor_minimo, 0) > 0)
      and i.latitude is not null and i.latitude != 0
      and i.longitude is not null and i.longitude != 0
      and earth_box(ll_to_earth($1, $2), $3) @> ll_to_earth(i.latitude::float8, i.longitude::float8)
      and earth_distance(ll_to_earth(i.latitude::float8, i.longitude::float8), ll_to_earth($1, $2)) <= $3
      and (cardinality(tipos_filtro) = 0 or i.tipo = any(tipos_filtro) or i.tipo = 'imovel')
      and (estado_filtro = '' or i.estado = estado_filtro)
      and (cardinality(modalidades_filtro) = 0 or i.modalidade = any(modalidades_filtro))
      and (
        cardinality(pagamentos_filtro) = 0
        or ((i.modalidade = 'judicial' or i.forma_pagamento = 'hipotecado') and 'hipotecado' = any(pagamentos_filtro))
        or (i.modalidade is distinct from 'judicial' and i.forma_pagamento = 'a_vista'   and 'a_vista'    = any(pagamentos_filtro))
        or (i.modalidade is distinct from 'judicial' and i.forma_pagamento = 'financiado' and 'financiado' = any(pagamentos_filtro))
      )
      and (valor_min <= 0 or (i.valor_minimo_ref is not null and i.valor_minimo_ref >= valor_min))
      and (valor_max >= 9999999999 or (i.valor_minimo_ref is not null and i.valor_minimo_ref <= valor_max))
      and (desconto_min <= 0 or (i.desconto_percentual is not null and i.desconto_percentual >= desconto_min))
      and (
        (sem_data and i.data_leilao is null)
        or (not sem_data
            and (data_de is null or (i.data_leilao is not null and i.data_leilao >= data_de))
            and (data_ate is null or (i.data_leilao is not null and i.data_leilao <= data_ate)))
      )
      and (coalesce(resultado_filtro, '') = ''
           or (resultado_filtro = 'nao_apurado' and i.resultado_leilao is null)
           or (resultado_filtro not in ('', 'nao_apurado') and i.resultado_leilao = resultado_filtro))
  ),
  pagina as (
    select f.*, (select count(*) from filtrados) as total
      from filtrados f
     order by
       case when ordenacao = 'valor_asc'     then f.valor_minimo_ref  end asc  nulls last,
       case when ordenacao = 'desconto_desc' then f.desconto_percentual end desc nulls last,
       case when ordenacao = 'desconto_asc'  then f.desconto_percentual end asc  nulls last,
       case when ordenacao = 'data_asc'      then f.data_fim            end asc  nulls last,
       f.distancia_km asc,
       f.id asc
     limit $4 offset $5
  )
  -- As colunas vêm da VIEW mascarada (leiloeiro, links, fonte, foto e texto conforme quem lê) — só para a página.
  select
    v.id, v.titulo, v.tipo, v.modalidade, v.estado, v.cidade, v.bairro, v.endereco,
    v.valor_minimo::float8, v.valor_avaliacao::float8, v.desconto_percentual::float8, v.area_m2::float8,
    v.latitude::float8, v.longitude::float8, v.link_foto, coalesce(v.url_lote, v.link_edital) as url_lote,
    v.data_leilao, v.forma_pagamento, v.fonte, v.fonte_id, v.score_financeiro, v.score_juridico,
    v.score_localizacao,
    p.distancia_km,
    p.total,
    v.leiloeiro, v.descricao, v.link_edital, v.link_matricula, v.fracionado, v.viavel,
    v.score_viabilidade, v.numero_edital, v.numero_matricula, v.numero_processo,
    v.valor_mercado, v.analise_viavel,
    v.valor_minimo_ref::float8, v.data_leilao_2, v.data_fim, v.praca1_fim, v.praca2_fim
  from pagina p
  join public.imoveis_leilao_mascarado v on v.id = p.id
  order by
    case when ordenacao = 'valor_asc'     then p.valor_minimo_ref  end asc  nulls last,
    case when ordenacao = 'desconto_desc' then p.desconto_percentual end desc nulls last,
    case when ordenacao = 'desconto_asc'  then p.desconto_percentual end asc  nulls last,
    case when ordenacao = 'data_asc'      then p.data_fim            end asc  nulls last,
    p.distancia_km asc,
    p.id asc;
$function$;
