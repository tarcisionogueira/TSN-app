-- 01/11 — leiloeiro ATIVO que a Junta lista SEM site, mas que declara site na lista de credenciados de um tribunal
-- (`leiloeiro_tribunal`, importação semanal de 29/10). Casados por `nome_norm` (mesma normalização dos dois lados).
-- Medido antes de gravar: 43 linhas da junta (38 leiloeiros; Jonas Gabriel/MGL aparece em 4 juntas), 37 domínios.
--   * 11 domínios já tinham lote no acervo (Destak, Silva, UP, TM, OA, Absoluta, Sublime, Vegas, Gold, VIP, MGL/DJEN)
--     → o leiloeiro já era coberto e a Junta só não sabia.
--   * 26 domínios novos, triados pelo banco (tarefa 'tri0111'): 8 Degrau + 2 ARES + 1 Soleon ligados no mesmo commit;
--     6 lojas Superbid (já entram pelo portal Superbid); 1 LJUD (portal LJUD); Bom Valor (fora, decisão do dono);
--     DNS morto / Cloudflare / 404 / 522 nos demais.
-- `site_origem = 'tribunal'` marca de onde veio. O status final de cobertura continua sendo recalculado por
-- `leiloeiro_junta_recruzar()` a partir dos lotes — aqui só sai de `sem_site` (que era falso para estes).
with m as (
  select distinct on (j.id) j.id, t.site,
         lower(regexp_replace(t.site, '^https?://(www\.)?([^/:?#]+).*$', '\2')) dom
    from leiloeiro_junta j
    join leiloeiro_tribunal t on t.nome_norm = j.nome_norm and coalesce(t.site, '') <> ''
   where j.situacao ilike 'ativ%' and coalesce(j.site, '') = '' and coalesce(j.dominio, '') = ''
   order by j.id, t.visto_em desc nulls last
),
ac as (
  select distinct lower(substring(url_lote from '://(?:www\.)?([^/:]+)')) h from imoveis_leilao where ativo
  union select distinct lower(substring(link_lote from '://(?:www\.)?([^/:]+)')) from veiculos_leilao where ativo
)
update leiloeiro_junta j
   set site = m.site, dominio = m.dom, site_origem = 'tribunal',
       coletado_status = case when exists (select 1 from ac where ac.h = m.dom) then 'coletado' else 'nao_coletado' end
  from m
 where j.id = m.id;
