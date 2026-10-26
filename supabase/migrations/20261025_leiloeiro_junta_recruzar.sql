-- RE-CRUZAMENTO DO UNIVERSO OFICIAL (leiloeiro_junta) COM O QUE JÁ COLETAMOS (25/10, pedido do dono).
--
-- Por que existe: o cruzamento de 24/10 foi feito numa rodada solta e congelou o `coletado_status`
-- daquele instante. Nas 48 h seguintes entraram ~60 leiloeiros novos (46 tenants do LeilãoPro,
-- Degrau, Leiloar 2º template, Leilovia, Labasoft, SOLEON...) e todos continuavam "nao_coletado".
-- Um universo que não se atualiza sozinho mede a data do cruzamento, não a cobertura (forma nº 10).
--
-- COMPARA TENANTS, NÃO NOME DE FONTE: a evidência principal é o HOST do link do lote ativo
-- (imoveis_leilao.url_lote / veiculos_leilao.link_lote) contra o domínio do leiloeiro — cada tenant
-- de plataforma multi-tenant publica no próprio domínio, então o host já É o tenant.
--
-- Ordem de decisão (a primeira que casar vence):
--   coletado         host do lote ativo = domínio (ou mesmo radical registrável: x.com.br ~ x.leilao.br)
--                    em fonte que NÃO é agregadora; ou o NOME do leiloeiro bate com o leiloeiro do lote
--                    numa fonte não agregadora (ex.: portal SUPERBID, que hospeda vários leiloeiros).
--   agregador        só aparece via EDITAL_DJEN / LJUD (edital ou portal agregador): cobertura parcial.
--   codigo_sem_lote  o domínio está no código (tenant/scraper configurado) mas sem lote ativo hoje.
--   sem_site         a Junta não publica site e o e-mail não dá um domínio próprio.
--   nao_coletado     o resto.
--
-- `p_dominios_codigo`: domínios citados em scripts/lib, scripts/scraper* e api/ (o banco não enxerga o
-- repositório). Sem ele, usa o que a rodada anterior já sabia (`coletado_via` com 'codigo') + os
-- domínios com `parser_existente` na `leiloeiro_triagem`.
--
-- `p_aplicar = false` (padrão) é o ensaio a seco: devolve as transições sem gravar nada.
--
-- CARGA DE SP E MG (25/10, mesma sessão — dado, não schema; feita por função pg_temp de uma chamada):
--   * JUCESP e JUCEMG não abrem para o pg_net (jucesp: SSL/peer; jucemg: páginas de leiloeiro em 500),
--     então a fonte foi a API pública da FENALEI (`api.fenalei.org.br/api/public/leiloeiros?junta_id=2|12`),
--     a mesma já usada para 17 UFs. A matrícula gravada é a do array `matriculas` daquela junta.
--     junta = 'JUCESP-via-FENALEI' (536 registros, 6 duplicados → 530) e 'JUCEMG-via-FENALEI' (173 → 171).
--   * MG foi completada com a lista OFICIAL do PDF da JUCEMG (29/08, `scripts/dados/jucemg-dominios.json`):
--     54 leiloeiros com site que a FENALEI não lista (quase todos "MATRÍCULA SUPLEMENTAR"), junta
--     'JUCEMG-PDF-2908', matrícula 'pdf:<nome_norm>' porque o JSON não guardou o número.
--   * Validação contra o número publicado (forma nº 8): dos 73 números JUCESP citados nos editais do DJEN,
--     53 estão na lista SP (73%) — a FENALEI NÃO é a lista completa da JUCESP (a própria FENALEI informa
--     1.101 matrículas no total). MG: 219 ativos contra 236 do PDF oficial.
--
-- Rodar de novo (ensaio, depois aplicar):
--   select public.leiloeiro_junta_recruzar(false, string_to_array('<dominios do repo, separados por vírgula>', ','));
create or replace function public.leiloeiro_junta_recruzar(p_aplicar boolean default false, p_dominios_codigo text[] default null)
returns jsonb
language plpgsql
set search_path = public
as $fn$
declare
  v_cod text[];
  v_res jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'leiloeiro_junta_recruzar: só o servidor';
  end if;

  v_cod := coalesce(p_dominios_codigo, array(
    select distinct dominio from leiloeiro_junta where coletado_via like '%codigo%' and dominio is not null
    union
    select dominio from leiloeiro_triagem where parser_existente is not null));

  with
  lotes as (
    select fonte, lower(regexp_replace(url_lote, '^https?://(www\.)?([^/:?#]+).*$', '\2')) host, leiloeiro_chave(leiloeiro) lk
      from imoveis_leilao where ativo and url_lote ~ '^https?://'
    union all
    select fonte, lower(regexp_replace(link_lote, '^https?://(www\.)?([^/:?#]+).*$', '\2')), leiloeiro_chave(leiloeiro)
      from veiculos_leilao where ativo and link_lote ~ '^https?://'
  ),
  hosts as (
    select host, fonte, count(*) n,
           regexp_replace(regexp_replace(host, '\.(com|net|org|adv|lel|leilao)?\.?br$|\.(com|net|org|io|online|site)$', ''), '^.*\.', '') radical,
           regexp_replace(host, '\.(com|net|org|adv|lel|leilao)?\.?br$|\.(com|net|org|io|online|site)$', '') base
      from lotes group by 1, 2
  ),
  nomes as (select lk, fonte, count(*) n from lotes where lk is not null and length(lk) >= 8 group by 1, 2),
  j as (  -- domínio normalizado aqui (linhas antigas trazem 'www.'), sem regravar a coluna
    select id, antes, via_antes, dominio, nk,
           regexp_replace(dominio, '\.(com|net|org|adv|lel|leilao)?\.?br$|\.(com|net|org|io|online|site)$', '') dbase
      from (select id, coletado_status antes, coletado_via via_antes,
                   nullif(regexp_replace(lower(btrim(dominio)), '^www\.', ''), '') dominio,
                   leiloeiro_chave(nome) nk
              from leiloeiro_junta) j0
  ),
  ev as (
    select j.id,
      -- host igual / subdomínio, ou mesmo radical registrável (só quando os dois lados são "x.tld")
      (select string_agg(h.fonte || '(' || h.n || ')', ',' order by h.n desc) from hosts h
        where h.fonte not in ('EDITAL_DJEN', 'LJUD') and j.dominio is not null
          and (h.host = j.dominio or h.host like '%.' || j.dominio
               or (j.dbase !~ '\.' and length(j.dbase) >= 5
                   and h.radical = j.dbase
                   and (h.base !~ '\.' or h.base ~ '^(api|api-v2|static|cdn|img|imagens|arquivos|leilao|leiloes|app|painel|adm|portal|site)\.')))) ev_host,
      (select string_agg(h.fonte || '(' || h.n || ')', ',' order by h.n desc) from hosts h
        where h.fonte in ('EDITAL_DJEN', 'LJUD') and j.dominio is not null
          and (h.host = j.dominio or h.host like '%.' || j.dominio)) ev_host_agr,
      (select string_agg(n.fonte || '(' || n.n || ')', ',' order by n.n desc) from nomes n
        where n.lk = j.nk and n.fonte not in ('EDITAL_DJEN', 'LJUD')) ev_nome,
      (select string_agg(n.fonte || '(' || n.n || ')', ',' order by n.n desc) from nomes n
        where n.lk = j.nk and n.fonte in ('EDITAL_DJEN', 'LJUD')) ev_nome_agr,
      (j.dominio is not null and exists (
         select 1 from unnest(v_cod) c(d)
          where c.d = j.dominio or c.d like '%.' || j.dominio
             or (j.dbase !~ '\.' and length(j.dbase) >= 5
                 and regexp_replace(c.d, '\.(com|net|org|adv|lel|leilao)?\.?br$|\.(com|net|org|io|online|site)$', '') = j.dbase))) ev_cod
    from j
  ),
  novo as (
    select j.id, j.antes, j.via_antes, j.dominio,
      case when ev.ev_host is not null or ev.ev_nome is not null then 'coletado'
           when ev.ev_host_agr is not null or ev.ev_nome_agr is not null then 'agregador'
           when ev.ev_cod then 'codigo_sem_lote'
           when j.dominio is null then 'sem_site'
           else 'nao_coletado' end depois,
      nullif(concat_ws(' ; ',
        'host:' || ev.ev_host, 'nome:' || ev.ev_nome,
        'agregador_host:' || ev.ev_host_agr, 'agregador_nome:' || ev.ev_nome_agr,
        case when ev.ev_cod then 'codigo' end), '') via
    from j join ev using (id)
  ),
  mud as (
    update leiloeiro_junta l set coletado_status = n.depois, coletado_via = n.via
      from novo n
     where p_aplicar and l.id = n.id
       and (l.coletado_status is distinct from n.depois or l.coletado_via is distinct from n.via)
    returning l.id
  )
  select jsonb_build_object(
      'aplicado', p_aplicar,
      'linhas_gravadas', (select count(*) from mud),
      'dominios_codigo', coalesce(array_length(v_cod, 1), 0),
      'transicoes', (select jsonb_object_agg(k, c) from (
          select coalesce(antes, '(nulo)') || ' -> ' || depois k, count(*) c from novo
           where antes is distinct from depois group by 1) t),
      'depois', (select jsonb_object_agg(depois, c) from (select depois, count(*) c from novo group by 1) t),
      -- amostra por transição (até 12 domínios distintos) para conferir à mão ANTES de aplicar
      'amostras', (select jsonb_object_agg(k, a) from (
          select k, jsonb_agg(x) a from (
            select coalesce(antes, '(nulo)') || ' -> ' || depois k, dominio || ' | ' || coalesce(via, '-') x,
                   row_number() over (partition by antes, depois order by dominio) rn
              from (select distinct antes, depois, dominio, via from novo
                     where antes is distinct from depois and dominio is not null) d) z
           where rn <= 12 group by k) t))
    into v_res;
  return v_res;
end
$fn$;

comment on function public.leiloeiro_junta_recruzar(boolean, text[]) is
  'Recalcula leiloeiro_junta.coletado_status/coletado_via contra o acervo ATIVO (host do lote = domínio do tenant; nome do leiloeiro; domínios no código). p_aplicar=false é ensaio a seco. Só service_role/postgres.';

-- 26/10 — FALLBACK SEM leiloeiro_triagem. Rodando do cron diário (sem lista do repositório), o fallback somava
-- os domínios com `parser_existente` na triagem: isso é "a plataforma é de uma família conhecida", não "está
-- configurado no código". Ensaio a seco: 198 nao_coletado virariam codigo_sem_lote (arrematabem.com.br,
-- Leilotech pronto mas NÃO integrado) — o número de "faltam" cairia sem nada ter sido conectado (forma nº 10).
-- Agora o fallback é só o que uma rodada com a lista do repositório já marcou (`coletado_via` com 'codigo').
do $$
declare d text := pg_get_functiondef('public.leiloeiro_junta_recruzar(boolean, text[])'::regprocedure); n text;
begin
  n := replace(d, E'    union\n    select dominio from leiloeiro_triagem where parser_existente is not null));', '));');
  if n = d then raise exception 'fallback: trecho não encontrado'; end if;
  execute n;
end $$;
