-- ─────────────────────────────────────────────────────────────────────────────────────────
-- A VARREDURA DO PINO GENÉRICO MORRIA EM TIMEOUT — E O CRON ENGOLIA (23/08/2026)
--
-- SINTOMA: `pino_generico_como_rua` foi de 45 (madrugada) para 92 no mesmo dia, 91 deles
-- CEF regravados às 09h UTC. O rastro decisivo estava no log do cron das 05h
-- (`limpar-imoveis-stale`): `pinos: {"erro": "... canceling statement due to statement
-- timeout (57014)"}` — com o cron devolvendo ok:true. Ou seja: a varredura diária que é o
-- ÚNICO caminho de convergência (o trigger tem early-return na recoleta rotineira e só
-- rebaixa a própria linha desde 18/08) vinha FALHANDO EM SILÊNCIO, e o invariante só
-- crescia. É a forma clássica desta base: falha entregue como sucesso.
--
-- CAUSA: a função original testava cada linha com um EXISTS correlacionado que recalcula
-- `via_normalizada(b.endereco)` para cada PAR de linhas — O(n·k) chamadas da normalização
-- (regex pesada) sobre 25 mil lotes ativos com coordenada. Estourava o statement_timeout.
--
-- CONSERTO: mesma regra, UMA passada — normaliza cada endereço UMA vez (CTE materializada),
-- agrupa por coordenada exata e rebaixa os rotulados 'rua'/'endereco' nos grupos com 2+
-- vias distintas. Semântica idêntica à original (grupo com 2+ vias ⇔ toda linha do grupo
-- tem um parceiro de via diferente): medido em produção, as duas formas acham os MESMOS 92
-- lotes — a nova em 1,1 s (EXPLAIN ANALYZE), folga de sobra dentro do timeout.
--
-- O companheiro deste arquivo (mesmo commit): `api/limpar-imoveis-stale-cron.js` passa a
-- ALERTAR (alertarErro → erros_cliente/e-mail) quando qualquer passo best-effort devolve
-- {erro} — best-effort pode não derrubar o cron, mas não pode ser invisível.
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- Regra de 22/08: toda recriação DEVE reemitir `set search_path to 'public'`.
create or replace function public.demover_pinos_genericos()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare n integer;
begin
  with candidatos as materialized (
    select id, latitude, longitude, public.via_normalizada(endereco) as via, geocod_nivel
      from public.imoveis_leilao
     where ativo and latitude is not null and longitude is not null
       and public.via_normalizada(endereco) is not null
  ), grupos as (
    select latitude, longitude
      from candidatos
     group by 1, 2
    having count(distinct via) > 1
  )
  update public.imoveis_leilao i
     set geocod_nivel = 'cidade'
    from candidatos c
    join grupos g on g.latitude = c.latitude and g.longitude = c.longitude
   where i.id = c.id
     and c.geocod_nivel in ('rua','endereco');
  get diagnostics n = row_count;
  return n;
end $$;

comment on function public.demover_pinos_genericos() is
  'Rebaixa a cidade os lotes em coordenada compartilhada por vias diferentes. Necessaria porque o trigger tem early-return quando nada muda na recoleta — a linha irma nunca reavalia sozinha. Chamada pelo cron limpar-imoveis-stale. Reescrita em 23/08 numa passada so (via_normalizada calculada 1x por linha): a forma com EXISTS correlacionado estourava statement_timeout e a varredura falhava em silencio.';

revoke all on function public.demover_pinos_genericos() from public, anon;
grant execute on function public.demover_pinos_genericos() to service_role;
