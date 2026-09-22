-- Achado 22/09 (pedido do dono: "verifica outros lotes do mesmo leiloeiro com valor
-- suspeito" — investigando, achei que 39 lotes EDITAL_DJEN ativos tinham valor_avaliacao
-- NULL mesmo com o edital de origem (editais_leilao) trazendo o valor correto).
--
-- Causa raiz: este gatilho tratava QUALQUER valor_avaliacao >= R$100.000.000 como
-- "sentinela falsa" (pensado pro bug antigo do Superbid, que manda ~R$999.999.999 quando
-- não há avaliação real) — mas uma FAIXA não é o mesmo que um valor sentinela: fazenda/
-- imóvel rural grande pode legitimamente valer mais de R$100 milhões. Medido: 0 (zero)
-- imóvel ativo no acervo INTEIRO tinha valor_avaliacao >= 100 milhões — o gatilho vinha
-- zerando TODOS, silenciosamente, sem ninguém notar (2 casos confirmados nesta sessão:
-- R$122.000.000 e R$117.178.121,39, ambos batendo com o texto do edital de origem).
--
-- Corrigido: sentinela por LISTA EXATA (mesmos valores de `qa_invariantes()` →
-- 'valor_sentinela': 999999999/99999999/9999999999/111111111/123456789), não faixa —
-- imóvel real de qualquer valor deixa de ser descartado por engano. A checagem de RAZÃO
-- (avaliação > 20x o mínimo) continua — não investigada nesta sessão, sem evidência de
-- estar errada.
create or replace function public.sanitiza_imovel_valores()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
begin
  if new.valor_avaliacao is not null and (
       new.valor_avaliacao in (999999999,99999999,9999999999,111111111,123456789)
       or (coalesce(new.valor_minimo,0) > 0 and new.valor_avaliacao / new.valor_minimo > 20)
     ) then
    new.valor_avaliacao := null;
  end if;
  if new.valor_avaliacao is null or new.valor_avaliacao <= 0 then
    new.desconto_percentual := null;
  end if;
  return new;
end
$function$;
