-- 30/08 — A ATRIBUIÇÃO DEPENDIA DO MAIS FRACO DE DOIS CAMINHOS QUE MEDEM A MESMA COISA
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- Sintoma: 17 de 53 cadastros de agosto (32%) chegaram com origem. R$ 765 em 30 dias e
-- nenhum pagante atribuído a anúncio — com esse buraco não dá para dizer se a campanha
-- funciona, e portanto não dá para lapidá-la.
--
-- ─── A MEDIÇÃO QUE MUDOU O DIAGNÓSTICO ────────────────────────────────────────────────
-- A hipótese era perda na CHEGADA. Falsa: `visita_origem` está saudável — 1.735 visitas em
-- 30 dias, 968 com gclid, 463 com gbraid, 1.243 com utm_source, 1.138 com utm_term.
-- (O "214 cliques × 19 visitas com gclid" do CLAUDE.md é um retrato de 14/08 e não descreve
-- mais o sistema; foi citado como atual numa análise desta sessão, o que estava errado.)
--
-- O app tem DOIS sistemas de captura paralelos, e o cadastro usava o pior:
--   tracker.js  → bp_aid + bp_orig → api/track.js → visita_origem   ...... saudável
--   marketing.js → tsn_mkt         → registrar_marketing → perfis.mkt_* .. vazando
--
-- ─── OS TRÊS DEFEITOS, todos no caminho fraco ─────────────────────────────────────────
-- 1. `gbraid`/`wbraid` NÃO ERAM CAPTURADOS. O Google manda estes no lugar do `gclid` quando
--    o clique vem sem cookie de terceiro (iOS/ATT, app→web, consentimento negado). São 463
--    das 1.431 visitas com click id — quase 1/3 da verba. O tracker gravava; `marketing.js`
--    não capturava; `perfis` nem tinha coluna. Mesmo defeito do `fbclid` corrigido em 28/08,
--    na outra metade do sistema.
-- 2. `registrar_marketing` DESCARTAVA `utm_content` e `utm_term`. As colunas
--    `perfis.mkt_utm_content/term` existem, o front captura desde 27/08 — e a função nunca
--    as escreveu. É a forma #7b: a coluna migrou, a função não. Por isso o `utm_term` do
--    ritual dava 0 com 1.138 visitas carregando o campo, e por isso não dá para comparar
--    criativo com criativo.
-- 3. `if (mkt)` PULAVA a chamada quando o localStorage estava vazio (aba anônima, storage
--    bloqueado, cadastro em navegador diferente do da chegada) — e o `AuthContext` ainda
--    engolia o desfecho: `supabase.rpc()` devolve `{data, error}` e NÃO LANÇA (forma #2),
--    então nem o try/catch via recusa de RLS ou 400. Atribuição perdida não dá erro em lugar
--    nenhum: só some do relatório.
--
-- ─── O CONSERTO ESTRUTURAL: o SERVIDOR passa a ter a última palavra ───────────────────
-- A função aceita `p_anon_id` e, para todo campo que o payload não trouxer, busca em
-- `visita_origem`. A chave é a mesma dos dois lados (`bp_aid`, agora exportado do tracker),
-- e a ponte foi medida: 35 dos 74 pares user↔anon já existem em `visita_origem`. A
-- atribuição deixa de depender do localStorage sobreviver da chegada até o cadastro.
--
-- ⚠️ NÃO recupera o passado. Os 31 perfis sem atribuição foram testados contra a ponte e o
-- resultado foi 0 recuperáveis — aquelas visitas não têm marca de anúncio, ou são anteriores
-- a 12/08, quando `visita_origem` começou. O conserto serve daqui para a frente.
--
-- A assinatura MUDA (ganha p_anon_id). `create or replace` com assinatura nova cria uma
-- SEGUNDA função e o PostgREST fica ambíguo — por isso o drop explícito da antiga.
alter table public.perfis add column if not exists mkt_gbraid text;
alter table public.perfis add column if not exists mkt_wbraid text;

drop function if exists public.registrar_marketing(jsonb);

create or replace function public.registrar_marketing(p jsonb, p_anon_id text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v uuid := auth.uid(); r public.visita_origem%rowtype; usou_visita boolean := false;
begin
  if v is null then return jsonb_build_object('ok', false, 'motivo', 'sem sessao'); end if;
  if p is null and coalesce(p_anon_id,'') = '' then
    return jsonb_build_object('ok', false, 'motivo', 'sem payload nem anon_id');
  end if;

  if coalesce(p_anon_id,'') <> '' then
    select * into r from public.visita_origem where anon_id = p_anon_id
     order by primeira_em limit 1;
    usou_visita := found;
  end if;

  update public.perfis set
    mkt_gclid        = coalesce(mkt_gclid,        nullif(p->>'gclid',''),        r.gclid),
    mkt_gbraid       = coalesce(mkt_gbraid,       nullif(p->>'gbraid',''),       r.gbraid),
    mkt_wbraid       = coalesce(mkt_wbraid,       nullif(p->>'wbraid',''),       r.wbraid),
    mkt_fbclid       = coalesce(mkt_fbclid,       nullif(p->>'fbclid',''),       r.fbclid),
    mkt_oppref       = coalesce(mkt_oppref,       nullif(p->>'oppref',''),       r.oppref),
    mkt_utm_source   = coalesce(mkt_utm_source,   nullif(p->>'utm_source',''),   r.utm_source),
    mkt_utm_medium   = coalesce(mkt_utm_medium,   nullif(p->>'utm_medium',''),   r.utm_medium),
    mkt_utm_campaign = coalesce(mkt_utm_campaign, nullif(p->>'utm_campaign',''), r.utm_campaign),
    mkt_utm_content  = coalesce(mkt_utm_content,  nullif(p->>'utm_content',''),  r.utm_content),
    mkt_utm_term     = coalesce(mkt_utm_term,     nullif(p->>'utm_term',''),     r.utm_term),
    mkt_referrer     = coalesce(mkt_referrer,     nullif(left(p->>'referrer',120),''), r.referrer_host),
    mkt_landing      = coalesce(mkt_landing,      nullif(left(p->>'landing',200),''),  r.landing),
    mkt_capturado_em = coalesce(mkt_capturado_em, now())
  where id = v and mkt_capturado_em is null;

  -- Devolve o DESFECHO, não um booleano: o chamador precisa distinguir "não veio de anúncio"
  -- de "não consegui registrar", que era exatamente a diferença que se perdia.
  return jsonb_build_object(
    'ok', true, 'gravou', found, 'usou_visita_origem', usou_visita,
    'tem_click_id', exists (select 1 from public.perfis x where x.id = v
                    and (x.mkt_gclid is not null or x.mkt_gbraid is not null
                      or x.mkt_wbraid is not null or x.mkt_fbclid is not null)),
    'tem_utm', exists (select 1 from public.perfis x where x.id = v and x.mkt_utm_source is not null));
end $$;

grant execute on function public.registrar_marketing(jsonb, text) to authenticated;

-- ── O INSTRUMENTO QUE RESPONDE "CONSERTOU?" ──────────────────────────────────────────
-- Sem ele, a única forma de saber seria alguém lembrar de rodar a consulta. Hoje leria 0.
create or replace function public.qa_invariante_cadastro_sem_origem()
returns bigint language sql stable set search_path to 'public' as $$
  select count(*)::bigint from public.perfis p
   where p.created_at > now() - interval '7 days'
     and p.mkt_capturado_em is null;
$$;

do $do$
declare d text; alvo text; novo text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'qa_invariantes';
  alvo := E'where i.ativo and not exists (select 1 from fonte_saude s where s.fonte = i.fonte)) c), 0)';
  if position(alvo in d) = 0 then raise exception 'ancora nao encontrada em qa_invariantes()'; end if;
  if position('cadastro_sem_origem' in d) > 0 then raise notice 'ja registrado'; return; end if;
  novo := alvo || E',\n     (''cadastro_sem_origem'',''Cadastro dos ultimos 7 dias sem NENHUMA origem registrada (nem payload nem visita_origem) — verba gasta sem saber de onde veio'',''Marketing'',''bug'',\n       public.qa_invariante_cadastro_sem_origem(), 0)';
  execute replace(d, alvo, novo);
end $do$;
