-- ============================================================================
-- qa_invariantes(): remove CTEs mortas (vias_ativas / coord_multivia) — 04/09
--
-- Achado ao investigar `qa_invariantes_lenta` (ultima rodada real: 7075ms no
-- servidor, teto 5000; duas rodadas anteriores — 09-01 e 09-02 — vieram com
-- 8176/8202ms e `ok=false`, ou seja, JÁ estouraram o teto de 8s do PostgREST).
--
-- `vias_ativas` e `coord_multivia` calculam `via_normalizada(endereco)` para
-- TODO imóvel ativo com lat/long (dezenas de milhares de linhas) e agrupam por
-- coordenada — mas NENHUM invariante da lista `inv(...)` referencia essas duas
-- CTEs. É computação morta: o mesmo padrão do `pino_generico_como_rua`, que já
-- foi migrado para ler de `qa_medida_externa` (cache de 3 dias) exatamente
-- porque calcular isso ao vivo era caro — só que aqui as CTEs ficaram para trás,
-- sem consumidor, continuando a rodar em toda chamada.
--
-- Medido antes/depois (EXPLAIN ANALYZE puro, sem a rede/pooler que os ~7s do
-- painel também incluem): ~8.6s → ~7.4s. Real, mas não é a causa dominante —
-- perfilado depois em 9 sub-checks individuais (rls_escreve_sem_ler 57ms,
-- area_truncada_no_milhar 528ms, nome_fontes_divergentes 5ms,
-- anexo_de_espelho_purgado 33ms, editais_cruzamento_cego 2.7ms,
-- job_analise_sem_motor+caso_sem_analise_iniciada 140ms,
-- canal_sem_conversao_apurada 2.9ms, cadeia analises_datadas 43ms,
-- valor_diverge_do_titulo 79ms — nenhum isolado passa de ~530ms). A conclusão,
-- para não repetir a forma nº 10 (culpar um vilão sem medir): são ~50 checks
-- pequenos somando ~7s, não um gargalo único — resta perto do teto de 8s do
-- PostgREST e já falhou 2x esta semana, mas consertar de vez exige perfilar o
-- resto ou parar de computar tudo ao vivo a cada chamada, não um patch pontual.
--
-- Reescrita por substituição de texto sobre `pg_get_functiondef`, mesmo padrão
-- de `o_painel_ressuscitou_e_agora_o_vigia_separa_o_painel_da_rede.sql`: exige
-- a âncora aparecendo EXATAMENTE 1x, senão aborta (um replace que não substitui
-- nada não dá erro, e é assim que o conserto vira silêncio).
-- ============================================================================

do $mig$
declare
  def text := pg_get_functiondef('public.qa_invariantes()'::regprocedure);
  cte_de text := $anchor$  vias_ativas as (
    select id, geocod_nivel, latitude, longitude, public.via_normalizada(endereco) as via
      from public.imoveis_leilao
     where ativo and latitude is not null and longitude is not null
  ),
  coord_multivia as (
    select latitude, longitude from vias_ativas where via is not null
     group by 1, 2 having count(distinct via) > 1
  ),
$anchor$;
begin
  if (length(def) - length(replace(def, cte_de, ''))) / length(cte_de) <> 1 then
    raise exception 'ancora das CTEs mortas (vias_ativas/coord_multivia) nao aparece EXATAMENTE 1x em qa_invariantes() — nada foi alterado';
  end if;
  def := replace(def, cte_de, '');
  execute def;
end $mig$;
