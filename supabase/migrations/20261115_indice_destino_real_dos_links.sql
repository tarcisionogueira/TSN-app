-- 15/11 — O link das amostras vindas do grounding do Gemini é um REDIRECIONADOR do Google
-- (vertexaisearch.cloud.google.com/grounding-api-redirect/…). 336 amostras em 21 cidades. Com ele, (1) a trava
-- anti-leilão (que lê a URL) não via nada — em Capão da Canoa o próprio lote em leilão no BidHero entrou como
-- comparável; (2) o "ver anúncio" abria um link opaco. O código novo resolve na entrada (api/_link-anuncio.js); esta
-- função conserta o acervo a partir das respostas do pg_net gravadas em bastidor.req (tarefa = p_tarefa):
--   · troca a URL pelo destino real (cabeçalho `location` que o pg_net devolve);
--   · com p_apagar_leilao, apaga a amostra cujo destino é site de leilão (mesma régua de URL_LEILAO em _valor-mercado.js).
create or replace function public.indice_aplicar_destinos(p_tarefa text, p_apagar_leilao boolean default false)
returns jsonb language plpgsql security definer set search_path = public, net as $$
declare v_trocadas int := 0; v_leilao int := 0; v_expirados int := 0;
begin
  create temp table if not exists pg_temp.dest (de text primary key, para text) on commit drop;
  insert into pg_temp.dest
  select distinct on (b.extra) b.extra, r.headers->>'location'
    from bastidor.req b join net._http_response r on r.id = b.req
   where b.tarefa = p_tarefa and r.headers->>'location' ~ '^https?://' and r.headers->>'location' !~ 'vertexaisearch\.cloud\.google\.com'
  on conflict do nothing;
  if p_apagar_leilao then
    with x as (
      delete from public.indice_amostra a using pg_temp.dest d
       where a.url = d.de and d.para ~* '(leil[aã]o|leiloes|leiloeir|caixa\.gov|hasta-publica|arremat|venda-?direta|//(www\.)?(bidhero|portalzuk|superbid|sold\.superbid|megaleiloes|biasileiloes|frazaoleiloes|pestanaleiloes|sodresantoro|leiloesjudiciais|lancenoleilao|grupolance|resale|imoveiscaixa|vipleiloes|lancejudicial|zukerman|hastavip|d1lance|e-?leiloes)\.)'
      returning 1)
    select count(*) into v_leilao from x;
  end if;
  with y as (update public.indice_amostra a set url = d.para from pg_temp.dest d where a.url = d.de returning 1)
  select count(*) into v_trocadas from y;
  -- O redirecionador do grounding EXPIRA (medido 15/11: 60 de 70 antigos davam 404 do próprio Google). Link morto
  -- vira nulo: a tela deixa de oferecer "ver anúncio" que abre um 404 e mostra só a busca. A amostra fica.
  with z as (update public.indice_amostra a set url = null from bastidor.req b join net._http_response r on r.id = b.req
              where b.tarefa = p_tarefa and r.status_code = 404 and a.url = b.extra and a.url ~ 'vertexaisearch\.cloud\.google\.com' returning 1)
  select count(*) into v_expirados from z;
  return jsonb_build_object('destinos', (select count(*) from pg_temp.dest), 'urls_trocadas', v_trocadas, 'leilao_apagadas', v_leilao, 'expirados_limpos', v_expirados);
end $$;
revoke all on function public.indice_aplicar_destinos(text, boolean) from public, anon, authenticated;
grant execute on function public.indice_aplicar_destinos(text, boolean) to service_role;
