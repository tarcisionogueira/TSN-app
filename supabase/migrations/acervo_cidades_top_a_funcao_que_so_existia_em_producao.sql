-- ─────────────────────────────────────────────────────────────────────────────────────────
-- `acervo_cidades_top()` — A FUNÇÃO QUE SÓ EXISTIA EM PRODUÇÃO (forma #7b) — 31/08/2026
--
-- O CI `verificar-schema.yml` ("Deriva código × banco") reprovava com:
--
--     ✗ FUNÇÃO NO BANCO SEM MIGRAÇÃO (forma #7b)
--         acervo_cidades_top()  — sem create function em nenhuma migração
--
-- Alguém a criou direto no SQL Editor e o `create function` nunca voltou ao repositório.
-- Recriar o banco a partir de `supabase/migrations/` a perderia — e `api/publico.js:644` a
-- chama para montar os hubs de cidade. É exatamente o defeito de `admin_metricas_negocio`,
-- cuja chave `pct_dom_venda` só existia em produção e teria impresso "0% venda" com cara de
-- resposta.
--
-- ⚠️ E O QUE ISSO CUSTOU, que vale mais que o conserto: a trava estava VERMELHA EM TODOS OS
-- COMMITS — `73e29dc`, `84e193a`, `9ebde29`, `d61218e`, `93a003d`, `b6123f2`, `9aed785`,
-- `8702c19`, `a278b5f` e os das branches. Um alarme que dispara sempre não é alarme: vira
-- ruído, e o próximo achado REAL de deriva chega num e-mail idêntico aos anteriores, que
-- ninguém mais abre. Este commit devolve o CI ao verde para que a PRÓXIMA falha signifique
-- alguma coisa.
--
-- Definição capturada com `pg_get_functiondef` do banco de produção, verbatim — o objetivo
-- aqui é o repositório passar a descrever o que EXISTE, não mudar comportamento. Os grants
-- reproduzem a ACL viva (`{=X/postgres, anon, authenticated, service_role}`): a função é
-- SECURITY INVOKER e só conta lotes ATIVOS por cidade (sem PII), então a leitura anônima é
-- o que os hubs públicos precisam.
-- ─────────────────────────────────────────────────────────────────────────────────────────

create or replace function public.acervo_cidades_top(p_limite integer default 60)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'uf', uf, 'cidade', cidade, 'cidade_norm', cidade_norm, 'total', total)
         order by total desc, cidade), '[]'::jsonb)
  from (
    select upper(estado) as uf,
           min(cidade) as cidade,
           cidade_norm,
           count(*)::int as total
      from public.imoveis_leilao
     where ativo and coalesce(estado,'') <> '' and coalesce(cidade_norm,'') <> ''
     group by upper(estado), cidade_norm
     order by count(*) desc
     limit least(greatest(coalesce(p_limite, 60), 1), 300)
  ) t;
$function$;

grant execute on function public.acervo_cidades_top(integer) to anon, authenticated, service_role;

comment on function public.acervo_cidades_top(integer) is
  'Top cidades por lotes ativos, para os hubs publicos (api/publico.js). Migracao escrita em 31/08 -- a funcao vivia so em producao e reprovava o verificador de deriva.';
