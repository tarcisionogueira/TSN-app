-- ============================================================================
-- DISTRIBUIÇÃO RISCO × CONFIANÇA — o vigia da regra de 31/08
--
-- POR QUE EXISTE. A regra nova separou dois eixos que estavam colados: o RISCO
-- (o que a documentação prova) e a CONFIANÇA (quanto do necessário foi lido).
-- Antes dela, 19 de 19 documentais saíam "amarelo", porque duas travas no código
-- fechavam as duas saídas — vermelho exigia bloqueante (havia 0 em 177 riscos) e
-- verde era rebaixado por risco não confirmado (55% dos riscos eram
-- `constaNaDoc: false`). Consertar a régua não prova que ela passou a medir:
-- é PRECISO OLHAR A DISTRIBUIÇÃO. Se todos os próximos saírem "amarelo · alta",
-- a discriminação continua travada, só que num ponto diferente.
--
-- É FUNÇÃO, NÃO CONSULTA COLADA NO DOC — pela lição de 27/08: consulta em
-- documento não é testada e envelhece calada (foi assim que a checagem de
-- regressão de fonte errou nos dois sentidos até virar função).
--
-- DUAS DECISÕES QUE O NÚMERO SOZINHO ESCONDERIA:
--
-- 1. O LEGADO FICA FORA DA CONTA. Relatório anterior à regra não tem eixo de
--    confiança (`confianca` nulo). Contá-lo como célula inventaria uma
--    distribuição que nunca existiu — e como todos eles são "amarelo", ele
--    ainda enviesaria o veredito para o exato defeito que estamos medindo.
--    Aparece numa linha própria, para não sumir sem explicação.
--
-- 2. AMOSTRA MÍNIMA DE 5, e ela é o conserto de um defeito DESTA função. A
--    primeira versão, com n=1, imprimiu "TRAVADO: uma saída só — não
--    classifica". Plausível e errado: UM relatório só pode ocupar uma célula;
--    o número media "quantos relatórios existem" e reportava com o nome de
--    "quanto a régua discrimina". É a forma #10 do CLAUDE.md — o instrumento
--    mede uma coisa e reporta com o nome de outra — cometida dentro do próprio
--    instrumento de verificação. Abaixo de 5, ela diz que não sabe.
--
-- Verde = 'OK: esta discriminando'. Leia junto o `detalhe` de cada célula:
-- `riscos` alto com `confirmados` baixo é o sintoma de acervo documental fraco
-- (a confiança deveria estar caindo), não de imóvel arriscado.
-- ============================================================================
create or replace function public.documental_distribuicao()
returns table (bloco text, chave text, qtd text, pct text, detalhe text)
language sql
stable
security definer
set search_path = public
as $$
with base as (
  select
    d.result->>'nivelRisco'                              as risco,
    d.result->>'confianca'                               as confianca,
    coalesce(jsonb_array_length(d.result->'riscos'), 0)  as riscos,
    (select count(*) from jsonb_array_elements(coalesce(d.result->'riscos','[]'::jsonb)) r
      where (r->>'constaNaDoc')::boolean is true)        as confirmados
  from analises_documental d
  where d.status = 'concluida' and d.result is not null
),
novo as (select * from base where confianca is not null),
n as (select count(*)::numeric as total from novo)
select 'CELULA',
       risco || ' · confianca ' || confianca,
       count(*)::text,
       round(100.0 * count(*) / nullif((select total from n), 0))::text || '%',
       'riscos ' || round(avg(riscos), 1) || ' · confirmados ' || round(avg(confirmados), 1)
  from novo group by 1, 2
union all
select 'VEREDITO', 'amostra', (select total from n)::text, null,
       case when (select total from n) < 5
            then 'AMOSTRA INSUFICIENTE (min. 5) — o teste abaixo nao vale ainda'
            else 'amostra suficiente' end
union all
select 'VEREDITO', 'celulas ocupadas (de 9)',
       count(distinct risco || confianca)::text,
       round(100.0 * max(c) / nullif((select total from n), 0))::text || '% na maior',
       case
         when (select total from n) < 5                      then '(aguardando amostra)'
         when count(distinct risco || confianca) <= 1        then 'TRAVADO: uma saida so — nao classifica'
         when 100.0 * max(c) / (select total from n) > 80    then 'SATURANDO: >80% numa celula so'
         else 'OK: esta discriminando' end
  from (select risco, confianca, count(*) c from novo group by 1, 2) x
union all
select 'LEGADO', 'anteriores a regra (confianca nula)',
       count(*)::text, null, 'fora da conta acima'
  from base where confianca is null
order by 1, 3 desc;
$$;

-- Agregado do acervo inteiro, sem PII e sem corpo de relatório: é diagnóstico de
-- operação, não dado de cliente. Mesmo assim o EXECUTE fica só no service_role,
-- porque a função é SECURITY DEFINER e atravessa a RLS de `analises_documental`
-- de propósito (é o acervo inteiro que precisa ser contado, não o do leitor).
--
-- ⚠️ REVOGAR DOS TRÊS, E CONFERIR O ACL DEPOIS. Esta linha começou como um
-- `revoke ... from public` sozinho e NÃO revogou nada: o Supabase concede
-- EXECUTE a `anon` e `authenticated` por default privilege em toda função nova
-- de `public`, e grant em ROLE não sai por revoke do PUBLIC. O ACL logo após o
-- create dizia, por extenso, `{postgres=X/postgres,anon=X/postgres,
-- authenticated=X/postgres,service_role=X/postgres}` — SECURITY DEFINER aberta
-- ao anônimo, exatamente o achado que `auditoria_seguranca()` classifica como
-- crítico. É o espelho do erro do mesmo dia (revogar de `anon` quando o grant
-- estava no PUBLIC, `{=X/postgres}`), e nas duas vezes o comando "funcionou" sem
-- mudar nada. A única prova é reler `pg_proc.proacl`; o esperado aqui é
-- `{postgres=X/postgres,service_role=X/postgres}`.
revoke all on function public.documental_distribuicao() from public, anon, authenticated;
grant execute on function public.documental_distribuicao() to service_role;
