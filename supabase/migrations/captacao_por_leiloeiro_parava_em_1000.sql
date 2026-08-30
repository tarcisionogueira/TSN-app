-- ─────────────────────────────────────────────────────────────────────────────────────────
-- "CAPTAÇÃO ATUAL POR LEILOEIRO" PARAVA EM 1.000 E NÃO DIZIA — 30/08
--
-- `relatorioCapitacao()` fazia `.select('fonte').eq('ativo', true)` e contava as linhas no
-- JavaScript. O PostgREST devolve no máximo 1.000 linhas por requisição; sem `.range()` o
-- script contava as MIL PRIMEIRAS e imprimia o resultado como se fosse o acervo inteiro.
--
-- A prova está no próprio painel que o dono viu, e é aritmética, não suspeita:
--     CEF 818 + GESTAOLEILOES 52 + RJLEILOES 40 + TORRES3 37 + BIASI 30 + VLANCE 9
--       + ZUK 3 + VIP 3 + PESTANA 2 + LEILOTECH 2 + SUPERBID 1 + VEGAS 1 + SBID9 1
--       + SUPORTE 1  =  1.000  EXATAMENTE
-- Real no mesmo instante: **30.616 ativos**, e só a CEF tem **23.484** — o painel dizia 818.
-- HASTA (584 ativos), LJUD, MEGA, SOLD e GRUPOLANCE nem apareciam na lista: ficaram fora das
-- mil primeiras linhas e viraram ausência, que se lê como "essa fonte não traz nada".
--
-- É a forma nº 10 do CLAUDE.md em estado puro: o número existe, é plausível, tem o nome de
-- "captação por leiloeiro" e mede "as mil primeiras linhas que o PostgREST quis mandar".
-- E é a MESMA raiz do `.limit(12)` de 12/08 (`AnalisesContext`): janela de transporte tratada
-- como se fosse o conjunto.
--
-- A contagem passa a ser feita no banco — uma consulta, sem teto, sem paginação para esquecer.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.acervo_por_fonte()
returns table(fonte text, ativos bigint)
language sql
stable
set search_path to 'public'
as $$
  select i.fonte, count(*) as ativos
    from public.imoveis_leilao i
   where i.ativo
   group by i.fonte
   order by count(*) desc, i.fonte;
$$;

revoke execute on function public.acervo_por_fonte() from public, anon;
grant  execute on function public.acervo_por_fonte() to authenticated, service_role;
