-- 03/10 — `mkt_clique_pago_sem_rastreio` media uma coisa e reportava com o nome de outra (forma nº 10).
--
-- Somava os cliques de TODOS os canais e comparava só com visitas com gclid. Com 100% da verba
-- no Meta (01/10 em diante), o alarme ficava ligado para sempre: clique de Meta nunca traz gclid.
-- E o `cliques` do Meta é o `clicks` da Graph API = QUALQUER clique (curtida, perfil, "ver mais"):
-- em 01-03/10 foram 138 "cliques", 78 `link_click` e 71 `landing_page_view`.
--
-- Agora é por canal, cada um contra o SEU identificador:
--   · Google Ads → cliques × visitas com gclid/gbraid/wbraid
--   · Meta Ads   → landing_page_view (o pixel VIU a página abrir; gravado em
--                  conversoes_detalhe.por_tipo pelo meta-insights-cron) × visitas com fbclid.
--                  Sem LPV na linha, cai para link_click e por último para cliques.
--   · outro canal → não entra (sem identificador próprio, a razão não significa nada).
-- Dispara se QUALQUER canal com 50+ chegadas em 8 dias tiver < 20% rastreadas.
--
-- Substitui só o trecho do invariante dentro do corpo vigente (o resto de qa_invariantes() tem
-- 90 itens e muda com frequência — reescrever a função inteira aqui arriscaria desfazer item
-- aplicado depois). Idempotente: se o trecho novo já está lá, não faz nada.
do $$
declare
  d text := pg_get_functiondef('public.qa_invariantes'::regproc);
  ini int := position('(''mkt_clique_pago_sem_rastreio''' in d);
  fim int := position('(''atribuicao_paga_perdida''' in d);
  novo text := $n$('mkt_clique_pago_sem_rastreio','Marketing: canal pago com 50+ chegadas em 8d e <20% de visitas com o ID do canal (Google: gclid · Meta: fbclid sobre landing_page_view) — rastreador perdendo','Ingestao','bug',
       (select (case when exists (
           select 1 from (
             select canal,
                    sum(case when canal ilike 'meta%' then coalesce(
                          (conversoes_detalhe->'por_tipo'->>'landing_page_view')::numeric,
                          (conversoes_detalhe->'por_tipo'->>'link_click')::numeric, cliques)
                        else cliques end) as chegadas
               from marketing_metricas_dia
              where data > current_date - 8 and (canal ilike 'google%' or canal ilike 'meta%')
              group by canal) m
            where m.chegadas >= 50
              and (select count(*) from visita_origem v
                    where v.primeira_em > now() - interval '8 days'
                      and case when m.canal ilike 'google%'
                               then (v.gclid is not null or v.gbraid is not null or v.wbraid is not null)
                               else v.fbclid is not null end) < 0.2 * m.chegadas)
         then 1 else 0 end)::bigint), 0),
     $n$;
begin
  if position('Google: gclid · Meta: fbclid' in d) > 0 then
    raise notice 'mkt_clique_pago_sem_rastreio ja esta por canal — nada a fazer';
    return;
  end if;
  if ini = 0 or fim = 0 or fim < ini then
    raise exception 'trecho de mkt_clique_pago_sem_rastreio nao encontrado no corpo de qa_invariantes()';
  end if;
  execute substr(d, 1, ini - 1) || novo || substr(d, fim);
end $$;
