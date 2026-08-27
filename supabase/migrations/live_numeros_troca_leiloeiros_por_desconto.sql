-- DECISAO DO DONO (27/08): tirar "leiloeiros acompanhados" do bloco de credencial da aula.
-- "os concorrentes anunciam mais de 900 leiloeiros no acervo e isso nao seria atrativo."
--
-- Ele esta certo, e o motivo vale registrar: contagem de FONTES e a unica metrica desta pagina
-- em que o numero maior vence, e um agregador que so LISTA sempre vai ter mais do que quem
-- enriquece lote a lote. Exibir 30 ao lado dos "900+" do concorrente convida a comparacao
-- errada — como se o produto fosse quantidade de fontes, e nao o que se sabe sobre cada imovel.
--
-- No lugar entra o LOTE COM DESCONTO REAL (>=50%): fala com o investidor, e e um numero que so
-- quem cruza avaliacao x lance consegue produzir. Hoje: 6.024.
-- `leiloeiros` continua no retorno para nao quebrar quem ja consome a RPC; muda o que a tela EXIBE.
create or replace function public.live_plataforma_numeros()
returns jsonb
language sql stable security definer set search_path to 'public' as $function$
  select jsonb_build_object(
    'lotes',       count(*) filter (where ativo),
    'leiloeiros',  count(distinct fonte) filter (where ativo),
    'cidades',     count(distinct cidade) filter (where ativo and cidade is not null),
    -- teto de 95% corta valor sentinela; piso de 50% e o que faz o numero significar algo.
    'com_desconto', count(*) filter (where ativo and desconto_percentual between 50 and 95)
  ) from imoveis_leilao;
$function$;
