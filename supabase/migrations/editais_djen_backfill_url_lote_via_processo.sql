-- Pedido do dono (22/09): "se conseguimos extrair a informação do site do leiloeiro, não
-- faz sentido direcionar a uma pagina generica, mas sim a do lote de interesse em questão."
--
-- EDITAL_DJEN quase sempre não tem link de lote (o DJEN só cita o site do leiloeiro em
-- texto — não é bug nosso, é o que a fonte publica). MAS quando o MESMO leiloeiro também é
-- capturado direto por outra fonte nossa (ex.: VLANCE, tenant hdleiloes.com.br), o número do
-- PROCESSO judicial é a mesma chave nos dois lados — CNJ, única por caso — e dá pra usar o
-- link REAL que o scraper direto já capturou, em vez do domínio genérico do EDITAL_DJEN.
--
-- CUIDADO medido no acervo real: um MESMO processo pode ter vários lotes/parcelas (ex.:
-- processo 5031819-86.2023.8.13.0433 tem 2 lotes VLANCE — chácara e sítio, endereços
-- diferentes). Linkar pelo processo quando há MAIS DE UM lote seria trocar "página genérica,
-- honesta" por "página específica, possivelmente ERRADA" — pior que o estado atual. Por
-- isso: só faz o backfill quando o processo casa com EXATAMENTE 1 lote ativo da fonte
-- integrada, e só quando esse lote tem link ESPECÍFICO de verdade (não adianta trocar um
-- genérico por outro). Ambíguo ou sem match real → não mexe, fica como está.
--
-- Medido em 22/09: hoje isso cobre só 2 dos 437 EDITAL_DJEN ativos (a maioria dos leiloeiros
-- citados pelo DJEN não é capturada por nenhuma fonte direta nossa — isso é limite da fonte,
-- não bug) — mas some sozinho conforme a VLANCE ganha tenants novos, e é seguro rodar sempre.
create or replace function public.editais_djen_backfill_url_lote()
returns table(imovel_id uuid, url_lote_novo text)
language sql
security definer
set search_path to 'public'
as $function$
  with vl as (
    select id, url_lote,
      regexp_replace((regexp_match(descricao, '\(Proc\.?\s*([\d.\-]+)\)'))[1], '\D', '', 'g') as proc_norm
    from imoveis_leilao
    where ativo and fonte <> 'EDITAL_DJEN'
      and url_lote is not null and url_lote !~ '^https?://[^/]+/?(\?.*)?$'  -- só link REAL (não genérico)
  ),
  vl_unico as (
    select proc_norm, (array_agg(id))[1] as vl_id, (array_agg(url_lote))[1] as vl_url
    from vl
    where proc_norm is not null and length(proc_norm) >= 15
    group by proc_norm
    having count(*) = 1  -- processo com 1 lote só = sem ambiguidade
  ),
  dj as (
    select id, regexp_replace(numero_processo, '\D', '', 'g') as proc_norm
    from imoveis_leilao
    where ativo and fonte = 'EDITAL_DJEN'
      and numero_processo is not null
      and (url_lote is null or url_lote ~ '^https?://[^/]+/?(\?.*)?$')  -- só troca quem hoje é genérico/vazio
  ),
  atualizados as (
    update imoveis_leilao i
       set url_lote = v.vl_url
      from dj join vl_unico v on v.proc_norm = dj.proc_norm and length(dj.proc_norm) >= 15
     where i.id = dj.id
    returning i.id, i.url_lote
  )
  select id, url_lote from atualizados;
$function$;

comment on function public.editais_djen_backfill_url_lote() is
  'Roda no fim do radar-editais-cron: linka EDITAL_DJEN ao lote REAL de outra fonte nossa (ex. VLANCE) quando o numero_processo casa com exatamente 1 lote — nunca em processo com 2+ lotes (ambiguo).';
