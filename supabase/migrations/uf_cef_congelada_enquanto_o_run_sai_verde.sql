-- ─────────────────────────────────────────────────────────────────────────────────────────
-- UMA UF DA CEF CONGELADA, COM O RUN VERDE TODO DIA — 18/08/2026
--
-- ACHADO. O RJ estava parado desde 05/08: **7.783 lotes ativos**, um terço do acervo CEF,
-- servidos ao cliente com preço e status de 12 dias atrás. O scraper diário rodava, terminava
-- com sucesso e imprimia "✅ Scraping concluído. 25407 imóveis processados" — número que
-- INCLUÍA os 8.200 do RJ que não entraram.
--
-- A linha que explicava tudo estava no log, sozinha, entre dois estados:
--
--     CEF CSV RJ...
--       CEF CSV RJ: 8200 imóveis, 8200 com foto
--     Erro ao salvar: ON CONFLICT DO UPDATE command cannot affect row a second time
--     CEF CSV MG...
--
-- CAUSA-RAIZ: o CSV da Caixa repete o mesmo `n do imovel` em algumas UFs. Um upsert com duas
-- linhas de mesma chave faz o Postgres abortar o COMANDO INTEIRO (SQLSTATE 21000) — ele se
-- recusa a atualizar a mesma linha duas vezes na mesma instrução. Não é erro de uma linha: é o
-- estado inteiro que não entra. Conserto em `scripts/scraper.js` (mesmo commit): dedup por
-- `fonte+fonte_id` antes do upsert.
--
-- TRÊS DEFEITOS EMPILHADOS, e é a soma deles que dá 12 dias de silêncio:
--   1. o upsert morria por linha duplicada;
--   2. `salvarImoveis` fazia `return` mudo no erro, e o laço seguia para a próxima UF;
--   3. `total += imoveis.length` somava o LIDO, não o GRAVADO — então `fonte_saude` da CEF
--      registrava 25.407 e status 'ok' justamente no dia em que um terço não foi salvo.
--   (o passo "Notify on failure" do workflow existia e nunca era alcançado: exit 0)
--
-- POR QUE NENHUMA VARREDURA PEGOU. `desativar_imoveis_cef_vencidos` compara cada lote com o
-- `max(atualizado_em)` do PRÓPRIO estado. Se o estado inteiro congela, todos os lotes ficam
-- igualmente velhos e nenhum é candidato: **o estado parece perfeitamente consistente consigo
-- mesmo**. A métrica é relativa ao último scrape, então "não houve scrape" é invisível para ela.
--
-- Daí este invariante comparar a UF com o último scrape da FONTE, não com o dela própria.
-- Medido ao criar: RJ com 286,4 horas de atraso (11,9 dias). Limite 0 — uma UF para trás das
-- outras é sempre coleta quebrada, nunca sazonalidade.
-- ─────────────────────────────────────────────────────────────────────────────────────────

create or replace function public.ufs_cef_congeladas(atraso interval default '48:00:00'::interval)
returns table (estado text, ativos bigint, ultimo_scrape timestamptz, atraso_horas numeric)
language sql stable security definer set search_path to 'public' as $$
  with g as (select max(atualizado_em) as global from public.imoveis_leilao where fonte='CEF' and ativo),
       p as (select i.estado, count(*) as ativos, max(i.atualizado_em) as ultimo
               from public.imoveis_leilao i where i.fonte='CEF' and i.ativo group by i.estado)
  select p.estado, p.ativos, p.ultimo,
         round(extract(epoch from (g.global - p.ultimo))/3600.0, 1)
    from p, g
   where p.ultimo < g.global - atraso
   order by p.ultimo;
$$;

comment on function public.ufs_cef_congeladas(interval) is
  'UF da CEF cujo ultimo scrape ficou para tras do ultimo scrape da fonte. Existe porque desativar_imoveis_cef_vencidos compara cada lote com o max do PROPRIO estado: um estado inteiro congelado parece consistente consigo mesmo e nunca e detectado. Ver migracao de 18/08 (RJ, 12 dias, upsert abortado por linha duplicada no CSV).';

revoke all on function public.ufs_cef_congeladas(interval) from public, anon;
grant execute on function public.ufs_cef_congeladas(interval) to service_role, authenticated;

do $do$
declare def text; antes text; depois text;
begin
  select pg_get_functiondef(oid) into def from pg_proc where proname = 'qa_invariantes';

  antes := $a$     ('sem_cidade','Lote ativo sem cidade','Captura','gap',
       (select count(*) from imoveis_leilao where ativo and coalesce(cidade,'')=''), 30)$a$;

  depois := $b$     ('sem_cidade','Lote ativo sem cidade','Captura','gap',
       (select count(*) from imoveis_leilao where ativo and coalesce(cidade,'')=''), 30),
     ('uf_cef_congelada','UF da CEF que parou de ser atualizada enquanto as outras seguiram','Captura','bug',
       (select count(*) from public.ufs_cef_congeladas()), 0)$b$;

  if position(antes in def) = 0 then
    if position('uf_cef_congelada' in def) > 0 then
      raise notice 'invariante ja presente';
      return;
    end if;
    raise exception 'ancora nao encontrada em qa_invariantes()';
  end if;

  execute replace(def, antes, depois);
  raise notice 'qa_invariantes atualizada com uf_cef_congelada';
end $do$;
