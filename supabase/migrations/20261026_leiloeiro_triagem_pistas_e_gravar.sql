-- TRIAGEM DO RESTO DA JUNTA PELO BANCO (26/10) — impressão digital de plataforma + gravação em leiloeiro_triagem.
--
-- Por que existe: o pedido do dono (26/10) é ligar TODOS os leiloeiros ativos da junta. Sobravam ~400 domínios
-- `nao_coletado`: 151 nunca triados (134 de SP, carga FENALEI de 25/10), 118 que "não abriram" e ~133 em
-- plataforma própria/desconhecida. A sessão não tem saída de rede própria — só o pg_net do banco abre site —
-- então a triagem roda em SQL: dispara `pagina_pedir_pelada` (lotes de 15, estado em `bastidor.req`,
-- tarefa 'tri2610'), e estas duas funções leem a resposta e gravam o veredito.
--
-- ⚠️ ACHADO QUE MUDA A LEITURA DA TRIAGEM ANTERIOR: 400 NÃO ERA "SITE FORA". 63 dos 118 "não abriram" eram
-- HTTP 400 de IIS/HTTP.sys e Cloudflare recusando os CABEÇALHOS de navegador do `pagina_pedir` (UA +
-- Accept-Language). O mesmo site responde 200 ao `pagina_pedir_pelada` (sem cabeçalho). A 1ª triagem gravou
-- "400" como se fosse o site; era o instrumento (forma nº 10).
--
-- `leiloeiro_triagem_pistas(html)`: função pura (não lê tabela) — título, generator, hosts de asset, crédito
--   de rodapé ("desenvolvido por", "Tecnologia X"), rotas mais frequentes, endpoints de API e redirecionamento
--   por script (`window.open('Principal.asp')`, que é tudo o que o HTML de uma família ASP do RJ entrega).
-- `leiloeiro_triagem_plataforma(html, erro)`: a família, por assinatura ESPECÍFICA (crédito/host do fornecedor),
--   antes das genéricas (WordPress/Wix). "Menciona" ≠ "roda": só host/crédito do fornecedor conta.
-- `leiloeiro_triagem_gravar(tarefa)`: escolhe a melhor resposta por domínio (200 > outra > erro) e faz upsert.

create or replace function public.leiloeiro_triagem_pistas(p_html text)
returns jsonb language sql immutable set search_path = public as $f$
  with h as (select left(coalesce(p_html,''), 600000) x)
  select jsonb_strip_nulls(jsonb_build_object(
    'titulo', (select left(regexp_replace(m[1], '\s+', ' ', 'g'), 90) from h, regexp_match(x, '<title[^>]*>([^<]{0,200})', 'i') m),
    'gen', (select left(m[1], 60) from h, regexp_match(x, '<meta[^>]+name=["'']generator["''][^>]+content=["'']([^"'']{0,80})', 'i') m),
    'hosts', (select string_agg(hh, ' ') from (select distinct lower(m[1]) hh from h, regexp_matches(x, '(?:src|href|action)=["'']https?://([a-z0-9.-]+)', 'gi') m
              where lower(m[1]) !~ '(google|gstatic|facebook|jquery|bootstrapcdn|cloudflare\.com|fontawesome|jsdelivr|unpkg|youtube|instagram|whatsapp|gtm|doubleclick|hotjar|tawk|recaptcha|wa\.me|twitter|linkedin|fonts\.|cdnjs|w3\.org|schema\.org|gmpg|apple\.com|tiktok)' limit 10) s),
    'credito', (select left(regexp_replace(regexp_replace(m[1], '<[^>]+>', ' ', 'g'), '\s+', ' ', 'g'), 140) from h,
               regexp_match(x, '((?:desenvolvid[oa]|developed|powered|criad[oa] por|produzid[oa]|plataforma|tecnologia|sistema)[^<]{0,20}(?:<[^>]+>[^<]{0,40}){0,3})', 'i') m),
    'rotas', (select string_agg(p || ':' || n, ' ' order by n desc) from (select lower(m[1]) p, count(*) n from h,
               regexp_matches(x, 'href=["''](?:https?://[^/"'']+)?/([a-z_-]{2,25})[/?"'']', 'gi') m group by 1 order by 2 desc limit 8) s),
    'apis', (select string_agg(distinct left(m[1], 80), ' ') from h, regexp_matches(x, '["''](https?://[^"'']*/(?:api|graphql|wp-json|ajax)[^"''\s]{0,60})', 'gi') m),
    'redir', (select left(coalesce(m[1], m[2], m[3]), 120) from h, regexp_match(x, 'window\.open\(\s*["'']([^"'']+)|location(?:\.href)?\s*=\s*["'']([^"'']+)|http-equiv=["'']?refresh["'']?[^>]*url=([^"''>\s]+)', 'i') m),
    'len', length(coalesce(p_html,''))
  ));
$f$;

create or replace function public.leiloeiro_triagem_plataforma(p_html text, p_erro text default null)
returns text language sql immutable set search_path = public as $f$
  select case
    when p_erro ~* 'resolve host' then 'DNS_MORTO'
    when p_erro ~* 'SSL' then 'SSL_INVALIDO'
    when p_erro is not null then 'SEM_RESPOSTA'
    when coalesce(p_html, '') = '' then 'SEM_RESPOSTA'
    when p_html ~* 'Tecnologia\s+SOLEON|d1mdxpzu4pgcoh\.cloudfront' then 'SOLEON'
    when p_html ~* 'suaplataformadeleilao' then 'DEGRAU'
    when p_html ~* 'plataformaleiloar|mercadoleiloar' then 'LEILOAR'
    when p_html ~* 'suporteleiloes' then 'SUPORTE'
    when p_html ~* 'icon-leilaopro|www\.leilao\.pro' then 'LEILAOPRO'
    when p_html ~* 'Plataforma Leilovia' then 'LEILOVIA'
    when p_html ~* 'Superbid Exchange' then 'SUPERBID'
    when p_html ~* 'bomvalor\.com\.br' then 'BOMVALOR'
    when p_html ~* 'leiloesbr\.com\.br' then 'LEILOESBR'
    when p_html ~* 'Ares Plataforma de Leil' then 'ARES'
    when p_html ~* 'window\.open\(\s*.mPrincipal\.asp' then 'ASP_PRINCIPAL'
    when p_html ~* 'leilotech' then 'LEILOTECH'
    when p_html ~* 'Plataforma Baston|static\.bastonleiloes' then 'BASTON'
    when p_html ~* 'href=["''](?:https?://[^/"'']+)?/externo/' then 'EXTERNO'
    when p_html ~* ':: Gest[^<]{0,6}o de Leil' then 'GESTAOPHP'
    when p_html ~* 'vipleiloes|leilaovip' then 'VIP'
    when p_html ~* 'portalzuk' then 'ZUK'
    when p_html ~* 'grupolance\.com\.br' then 'GRUPOLANCE'
    when p_html ~* 'leiloesjudiciais\.com\.br' then 'LJUD_WHITELABEL'
    when p_html ~* 'cdn\.positus\.global' and p_html ~* 'Nova Serrana' then 'NOVASERRANA'
    when p_html ~* 'www\.roisoft\.com' then 'ROISOFT'
    when p_html ~* 'leiloador\.com\.br|liveti\.net' then 'LEILOADOR'
    when p_html ~* 'jsit\.com\.br|appleilao' then 'APPLEILAO'
    when p_html ~* 'js\.pusher\.com' and p_html ~* '/build/' then 'LARAVEL_PUSHER'
    when p_html ~* 'wp-content|wp-json' then 'WORDPRESS'
    when p_html ~* 'Wix\.com Website Builder|wixstatic' then 'WIX'
    when p_html ~* 'blogger\.com|blogspot' then 'BLOGGER'
    when p_html ~* 'hostinger|Account Suspended|Parked Domain|Index of /|Dom[ií]nio n[ãa]o encontrado' then 'SEM_SITE'
    else 'DESCONHECIDA' end;
$f$;

create or replace function public.leiloeiro_triagem_gravar(p_tarefa text)
returns jsonb language plpgsql set search_path = public, net as $f$
declare v jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'leiloeiro_triagem_gravar: só o servidor';
  end if;
  with resp as (
    select b.extra dominio, split_part(b.fonte, '|', 2) variante, r.status_code st, r.error_msg erro, r.content html,
           row_number() over (partition by b.extra order by (r.status_code = 200) desc nulls last,
                              (r.status_code is not null) desc, length(coalesce(r.content, '')) desc, b.criado_em desc) rn
      from bastidor.req b left join net._http_response r on r.id = -b.req - 1000000000
     where b.tarefa = p_tarefa and b.fonte ~ '\|(www|nowww|http)$'
  ),
  melhor as (
    select r.*, leiloeiro_triagem_plataforma(r.html, case when r.st is null then coalesce(r.erro, 'sem resposta') end) plat
      from resp r where rn = 1
  ),
  gravado as (
    insert into leiloeiro_triagem as t (dominio, leiloeiros, status_http, url_final, bloqueado, plataforma, parser_existente, erro, medido_em, titulo, pistas, catalogo_ok)
    select m.dominio,
           coalesce((select array_agg(distinct j.nome) from leiloeiro_junta j where lower(regexp_replace(btrim(j.dominio), '^www\.', '')) = m.dominio), '{}'::text[]),
           coalesce(m.st, 0),
           case m.variante when 'nowww' then 'https://' || m.dominio || '/' when 'http' then 'http://www.' || m.dominio || '/'
                else 'https://www.' || m.dominio || '/' end,
           (coalesce(m.st, 0) in (403, 429, 503) or coalesce(m.html, '') ~* 'just a moment|cf-browser-verification'),
           m.plat,
           case m.plat when 'SOLEON' then 'scripts/scraper-soleon.mjs' when 'DEGRAU' then 'scripts/lib/leilaoeletronico-parse.mjs'
             when 'LEILOAR' then 'scripts/lib/leiloar-parse.mjs' when 'SUPORTE' then 'scripts/lib/suportev2-parse.mjs'
             when 'LEILAOPRO' then 'scripts/lib/leilaopro-parse.mjs' when 'LEILOVIA' then 'scripts/lib/leilovia-parse.mjs'
             when 'ARES' then 'scripts/lib/ares-parse.mjs' when 'BASTON' then 'scripts/lib/baston-parse.mjs'
             when 'EXTERNO' then 'scripts/lib/externo-parse.mjs' when 'GESTAOPHP' then 'scripts/scraper-gestao.mjs' end,
           left(m.erro, 200), now(),
           left((leiloeiro_triagem_pistas(m.html))->>'titulo', 150),
           left('via=pelada/' || coalesce(m.variante, '?') || ' ' || regexp_replace(leiloeiro_triagem_pistas(m.html)::text, '"apis": "[^"]*cdnjs[^"]*",', ''), 600),
           null
      from melhor m
    on conflict (dominio) do update set
      leiloeiros = case when cardinality(excluded.leiloeiros) > 0 then excluded.leiloeiros else t.leiloeiros end, status_http = excluded.status_http, url_final = excluded.url_final,
      bloqueado = excluded.bloqueado, plataforma = excluded.plataforma, parser_existente = excluded.parser_existente,
      erro = excluded.erro, medido_em = excluded.medido_em, titulo = excluded.titulo, pistas = excluded.pistas
    returning t.plataforma
  )
  select jsonb_build_object('gravados', count(*), 'por_plataforma', (select jsonb_object_agg(plataforma, n) from (select plataforma, count(*) n from gravado group by 1) z))
    into v from gravado;
  return v;
end $f$;

-- RÓTULO DE FAMÍLIA PELAS PISTAS JÁ GRAVADAS (26/10). Os ~130 domínios "DESCONHECIDA/NEXTJS/SPA/..." da 1ª triagem
-- não foram relidos (custaria ~150 páginas); as `pistas` que ela gravou (hosts de asset, título) já bastam para
-- agrupar por FORNECEDOR. Só reclassifica o que estava sem família — nunca mexe em família já identificada.
create or replace function public.leiloeiro_triagem_rotular()
returns jsonb language plpgsql set search_path = public as $f$
declare v jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'leiloeiro_triagem_rotular: só o servidor';
  end if;
  with alvo as (
    select t.dominio,
      case
        when t.pistas ~* 'roisoft' then 'ROISOFT'
        when t.pistas ~* 'codepen' and t.pistas ~* '(^| )leiloes\.' then 'CODEPEN_SUBDOMINIO'
        when t.pistas ~* 'liveti\.net|leiloador\.com\.br' then 'LEILOADOR'
        when t.pistas ~* 'triacca\.com\.br' then 'TRIACCA'
        when t.pistas ~* 'leiloesjudiciais\.com\.br|leiloesjudiciaisbrasil' then 'LJUD_WHITELABEL'
        when t.pistas ~* 'leiloesbr\.com\.br|marciopinho\.com\.br' then 'LEILOESBR'
        when t.pistas ~* 'plataformaleiloar|mercadoleiloar' then 'LEILOAR'
        when t.pistas ~* 'suaplataformadeleilao' then 'DEGRAU'
        when t.pistas ~* 'bomvalor' then 'BOMVALOR'
        when t.pistas ~* 'leilotech' then 'LEILOTECH'
        when t.pistas ~* 'paganini\.tech' then 'PAGANINI'
        when t.pistas ~* 'positus\.global' and coalesce(t.titulo, '') ~* 'Nova Serrana' then 'NOVASERRANA'
        when coalesce(t.titulo, '') ~* '(&reg;|®) \| Leil' then 'FRAZAO_SISTEMA'
        when coalesce(t.titulo, '') ~* '^Leil[õo]es Brasil - ' then 'LEILOESBRASIL_UF'
        when coalesce(t.titulo, '') ~* '^Carregando' then 'ARES'
        when coalesce(t.titulo, '') ~* 'Account Suspended|Parked Domain|Index of /|P[áa]gina padr|Em Breve|SISTEMA INDISPONIVEL|403 Forbidden' then 'SEM_SITE'
      end nova
      from leiloeiro_triagem t
     where t.plataforma in ('DESCONHECIDA', 'NEXTJS', 'SPA', 'NUXT', 'WIX', 'WORDPRESS')
  ),
  mud as (
    update leiloeiro_triagem t set plataforma = a.nova
      from alvo a where a.dominio = t.dominio and a.nova is not null and a.nova is distinct from t.plataforma
    returning t.plataforma
  )
  select coalesce(jsonb_object_agg(plataforma, n), '{}'::jsonb) into v from (select plataforma, count(*) n from mud group by 1) z;
  return v;
end $f$;
