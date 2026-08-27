-- ─────────────────────────────────────────────────────────────────────────────
-- NÚMEROS DA PLATAFORMA PARA A LANDING DA AULA  (27/08/2026)
--
-- POR QUE VIVO E NÃO ESCRITO NO TEXTO: a autoridade do apresentador na landing vem
-- do acervo, não de adjetivo. Só que número escrito à mão em texto de bio ENVELHECE
-- em silêncio — daqui a três meses a página diria "28 mil lotes" com o acervo em
-- outro patamar, e ninguém teria como saber. Vindo do banco, ou está certo ou não
-- aparece.
--
-- NÃO devolve `estados`: o acervo tem 28 valores distintos em `estado` para 27 UFs
-- possíveis, ou seja, há lixo lá dentro (é o mesmo rastro dos 71 lotes sem estado já
-- anotados no HANDOFF). Publicar "28 estados" seria imprimir o defeito como se fosse
-- resultado. Cidade e leiloeiro são contagens que se sustentam.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.live_plataforma_numeros()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'lotes',      count(*) filter (where ativo),
    'leiloeiros', count(distinct fonte) filter (where ativo),
    'cidades',    count(distinct cidade) filter (where ativo and cidade is not null)
  ) from imoveis_leilao;
$$;

grant execute on function public.live_plataforma_numeros() to anon, authenticated;
