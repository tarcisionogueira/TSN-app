-- ─────────────────────────────────────────────────────────────────────────────────────────
-- A LIMPEZA DE LOTES ENCERRADOS É PULADA EM SILÊNCIO — 18/08/2026
--
-- PERGUNTA DO DONO: "os 28 fora do sitemap, verifica se ainda estão ativos". Estão — e não
-- por descuido pontual: a rotina que existe para desativá-los é SISTEMATICAMENTE pulada, e
-- ninguém é avisado.
--
-- COMO `desativar_imoveis_leiloeiro_stale` decide: por fonte, pega o ÚLTIMO scrape
-- (max(atualizado_em)) e marca como candidato todo lote ativo que não foi tocado nas 36h
-- anteriores a ele — "não veio no último scrape, logo saiu do site". Se os candidatos passarem
-- de 40% do acervo da fonte, ela PULA: é a guarda anti-regressão, criada para um scrape
-- degradado não zerar uma fonte inteira.
--
-- O QUE A GUARDA NÃO SABE DISTINGUIR: um scrape DEGRADADO de um scrape PARCIAL POR DESENHO.
-- O scraper da PECINI visita só os lotes NOVOS — 4 a 6 por rodada. Todo o resto do acervo fica
-- "não visto no último scrape" por construção. Medido em 18/08:
--
--     PECINI ... 58 de 75 candidatos = 77,3%  → PULADA (e assim toda vez)
--     VIP ...... 61 de 100 candidatos = 61,0% → PULADA (medido HOJE, não é projeção)
--     CALIL .... 34 de 129 = 26,4%            → limpa normalmente (faz passada completa)
--
-- Ou seja: quanto MENOS completa é a passada do scraper, mais a limpeza é pulada — exatamente
-- ao contrário do que a fonte precisa. E a função já devolve `fontes_puladas` no JSON de
-- retorno desde que existe; o cron loga e ninguém lê. Uma fonte pode passar meses sem nunca
-- ter um lote encerrado removido, sem uma linha de alerta em lugar nenhum.
--
-- O QUE ESTE INVARIANTE **NÃO** AUTORIZA: desativar os 58. Eles não foram vistos e recusados
-- pelo site — eles NÃO FORAM OLHADOS. Marcar como encerrado o que nunca foi verificado é
-- afirmar uma medição que não houve, que é a forma que esta base inteira persegue. A resposta
-- de verdade vem de uma passada COMPLETA (PECINI_ALVO=antigos, agendado para 24/08): depois
-- dela, quem não voltou é que sumiu de fato.
--
-- Limite 0: fonte pulada é sempre algo a investigar, nem que a conclusão seja "o scrape
-- degradou mesmo e a guarda salvou o acervo" — que é o caso para o qual ela foi feita.
-- ─────────────────────────────────────────────────────────────────────────────────────────

create or replace function public.fontes_com_limpeza_pulada(margem interval default '36:00:00'::interval,
                                                            teto_pct numeric default 0.40)
returns table (fonte text, total bigint, candidatos bigint, pct numeric, ultimo_scrape timestamptz)
language sql stable security definer set search_path to 'public' as $$
  with ult as (
    select i.fonte, max(i.atualizado_em) as ultimo, count(*) as total
      from public.imoveis_leilao i
     where i.ativo and i.fonte is not null
       and i.fonte not in ('CEF','SUPORTE','atribuido_manual')
     group by i.fonte
    -- NOTA: a função original também exige `max(atualizado_em) < now() - 2h`, para não avaliar
    -- uma fonte no meio de um scrape. Aqui essa cláusula é DE PROPÓSITO omitida: ela é uma
    -- janela de execução, não um critério de saúde, e mantê-la faria a fonte recém-coletada
    -- desaparecer do diagnóstico justo depois de rodar — que foi como a PECINI escapou da
    -- primeira medição em 18/08.
      having max(i.atualizado_em) > now() - interval '10 days'
  ), cand as (
    select i.fonte, count(*) as reap
      from public.imoveis_leilao i join ult u on u.fonte = i.fonte
     where i.ativo and i.atualizado_em < (u.ultimo - margem)
     group by i.fonte
  )
  select u.fonte, u.total, coalesce(c.reap, 0),
         round(coalesce(c.reap,0)::numeric / nullif(u.total,0), 3), u.ultimo
    from ult u left join cand c on c.fonte = u.fonte
   where coalesce(c.reap,0)::numeric / nullif(u.total,0) > teto_pct
   order by 4 desc;
$$;

comment on function public.fontes_com_limpeza_pulada(interval, numeric) is
  'Fontes em que desativar_imoveis_leiloeiro_stale PULA a limpeza por estourar o teto de 40%. '
  'Scraper de passada parcial (só lotes novos) cai aqui sempre — ver a migração de 18/08.';

revoke all on function public.fontes_com_limpeza_pulada(interval, numeric) from public, anon;
grant execute on function public.fontes_com_limpeza_pulada(interval, numeric) to service_role, authenticated;

do $do$
declare def text; antes text; depois text;
begin
  select pg_get_functiondef(oid) into def from pg_proc where proname = 'qa_invariantes';

  antes := $a$     ('sem_cidade','Lote ativo sem cidade','Captura','gap',
       (select count(*) from imoveis_leilao where ativo and coalesce(cidade,'')=''), 30)$a$;

  depois := $b$     ('sem_cidade','Lote ativo sem cidade','Captura','gap',
       (select count(*) from imoveis_leilao where ativo and coalesce(cidade,'')=''), 30),
     ('limpeza_encerrados_pulada','Fonte cuja limpeza de lotes encerrados e pulada pelo teto','Captura','bug',
       (select count(*) from public.fontes_com_limpeza_pulada()), 0)$b$;

  if position(antes in def) = 0 then
    if position('limpeza_encerrados_pulada' in def) > 0 then
      raise notice 'invariante ja presente';
      return;
    end if;
    raise exception 'ancora nao encontrada em qa_invariantes()';
  end if;

  execute replace(def, antes, depois);
  raise notice 'qa_invariantes atualizada com limpeza_encerrados_pulada';
end $do$;
