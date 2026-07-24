-- ════════════════════════════════════════════════════════════════════════════
-- MATRÍCULA — resolução GENERALIZADA em todos os leiloeiros (gatilho: terreno ZUK
-- zuk_36771-229309 aparecia "sem matrícula" e nunca era resolvido).
--
-- Diagnóstico (24/07/2026): a fila de captura (documentos_fila) era tratada como
-- LEDGER, não como fila de TRABALHO. O drenador (captura-documentos.mjs) marcava
-- status='ok'/'erro' e a linha FICAVA na fila; enfileirar_docs_faltantes() excluía
-- QUALQUER lote já presente na fila → um lote que:
--   • errou 4× (tentativas>=4)  →  562 lotes, OU
--   • foi "ok" mas SEM matrícula (só pegou o edital) → 1.327 lotes,
-- ficava PRESO para sempre, nunca mais re-tentado (1.889 lotes ativos sem matrícula).
-- Além disso a captura GENÉRICA (navegador público) nunca resolve fontes LOGIN-GATED
-- (ZUK, GRUPOLANCE): pega o edital público e marca "ok" — por isso o acervo ZUK/GL
-- entupia de "ok sem matrícula". Essas fontes têm pipeline PRÓPRIO de login (4×/dia).
--
-- Correção:
--  1) A fila vira fila de TRABALHO: purga o que já foi PROCESSADO (ok / erro terminal)
--     e o que já RESOLVEU/INATIVOU — assim nada fica preso e re-enfileira quando o
--     negative-cache (matricula_checada_em) vencer.
--  2) O enfileirador é CIENTE DA FONTE:
--     • pula fontes onde a matrícula NÃO é publicada no lote (docs_status='esperado':
--       SUPERBID/SOLD/SBID9/SBID21/VENDASGOV) — lá "sem matrícula no lote" é NORMAL
--       (vem no edital/na análise), então não gastamos captura à toa;
--     • pula fontes LOGIN-GATED com pipeline próprio (ZUK, GRUPOLANCE) — quem resolve
--       essas é matricula-zuk.yml / matricula-grupolance.yml (login), não a genérica;
--     • respeita o cooldown do negative-cache: checado há <30d não re-enfileira
--       (evita re-capturar todo dia um lote cuja matrícula não está na página pública).
--       Pagos (PECINI/RJLEILOES/GESTAOLEILOES): a re-checagem a cada 30d captura o
--       link novo que vier na PRÓXIMA COLETA (Bright Data), sem esforço manual.
--  3) matricula_cobertura(): visão por leiloeiro (auditoria "em todos os leiloeiros").
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.enfileirar_docs_faltantes(p_limite integer default 3000)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_ins int;
begin
  -- 1) HIGIENE — a fila é de TRABALHO, não ledger. Remove o que já foi processado
  -- (ok, ou erro TERMINAL após 4 tentativas) e o que já resolveu/inativou. Assim o
  -- lote deixa a fila e volta a ser elegível quando o cooldown vencer (corrige os
  -- 1.889 lotes que ficavam presos e nunca mais eram tentados).
  delete from documentos_fila f
  where f.status = 'ok'
     or (f.status = 'erro' and coalesce(f.tentativas,0) >= 4)
     or exists (
       select 1 from imoveis_leilao il
       where il.id = f.imovel_id
         and (not il.ativo
              or (il.link_matricula is not null and il.link_matricula <> '')
              or exists (select 1 from imovel_anexos a where a.imovel_id = il.id and a.tipo = 'matricula')));

  -- 2) ENFILEIRA candidatos: ativo, com página, SEM matrícula, em fonte que PUBLICA a
  -- matrícula no lote e SEM pipeline de login próprio, fora do cooldown de negative-cache.
  with cand as (
    select il.id
    from imoveis_leilao il
    left join leiloeiro_conhecimento lc on lc.fonte = il.fonte
    where il.ativo
      -- CEF tem links determinísticos (fila própria); SUPORTE é interno.
      and il.fonte not in ('CEF','SUPORTE')
      -- Login-gated com pipeline dedicado (4×/dia) — a captura genérica não resolve.
      and il.fonte not in ('ZUK','GRUPOLANCE')
      -- Fonte onde a matrícula NÃO é publicada no lote → não gasta captura à toa.
      and coalesce(lc.docs_status,'') <> 'esperado'
      and il.url_lote ~ '^https?://'
      and (il.link_matricula is null or il.link_matricula = '')
      -- negative-cache: só re-checa depois de 30 dias (captura o link novo da próxima coleta paga).
      and (il.matricula_checada_em is null or il.matricula_checada_em < now() - interval '30 days')
      and not exists (select 1 from imovel_anexos a where a.imovel_id = il.id and a.tipo = 'matricula')
      and not exists (select 1 from documentos_fila f where f.imovel_id = il.id)
    -- Nunca-checados primeiro (garante que a CAUDA — ex.: terrenos sem desconto — seja
    -- alcançada), depois maior desconto (mais relevante), depois id (determinístico).
    order by (il.matricula_checada_em is null) desc, il.desconto_percentual desc nulls last, il.id
    limit p_limite
  ), ins as (
    insert into documentos_fila (imovel_id)
    select id from cand
    on conflict (imovel_id) do nothing
    returning imovel_id
  )
  select count(*)::int into v_ins from ins;
  return v_ins;
end
$function$;

comment on function public.enfileirar_docs_faltantes(integer) is
  'Enfileira lotes ATIVOS sem matrícula na documentos_fila para o drenador (captura-documentos.mjs). Fila = trabalho: purga processados/resolvidos. Pula fontes login-gated (ZUK/GRUPOLANCE, pipeline próprio) e não-publicadoras (docs_status=esperado). Respeita cooldown de 30d do negative-cache matricula_checada_em (re-checa a próxima coleta paga).';

-- ── Auditoria: cobertura de matrícula por leiloeiro (grátis × pago × publica) ──
create or replace function public.matricula_cobertura()
returns table (
  fonte text, custo text, publica_matricula boolean,
  ativos int, com_matricula int, sem_matricula int, cobertura_pct numeric,
  na_fila int, checados_sem int
)
language sql
security definer
set search_path to 'public'
as $function$
  select
    il.fonte,
    max(lc.custo) as custo,
    coalesce(max(lc.docs_status),'') <> 'esperado' as publica_matricula,
    count(*)::int as ativos,
    count(*) filter (where
      (il.link_matricula is not null and il.link_matricula <> '')
      or il.numero_matricula is not null
      or exists (select 1 from imovel_anexos a where a.imovel_id = il.id and a.tipo = 'matricula')
    )::int as com_matricula,
    count(*) filter (where
      not ((il.link_matricula is not null and il.link_matricula <> '')
        or il.numero_matricula is not null
        or exists (select 1 from imovel_anexos a where a.imovel_id = il.id and a.tipo = 'matricula'))
    )::int as sem_matricula,
    round(100.0 * count(*) filter (where
      (il.link_matricula is not null and il.link_matricula <> '')
      or il.numero_matricula is not null
      or exists (select 1 from imovel_anexos a where a.imovel_id = il.id and a.tipo = 'matricula')
    ) / nullif(count(*),0), 1) as cobertura_pct,
    count(*) filter (where exists (select 1 from documentos_fila f where f.imovel_id = il.id))::int as na_fila,
    count(*) filter (where il.matricula_checada_em is not null
      and not ((il.link_matricula is not null and il.link_matricula <> '')
        or exists (select 1 from imovel_anexos a where a.imovel_id = il.id and a.tipo = 'matricula')))::int as checados_sem
  from imoveis_leilao il
  left join leiloeiro_conhecimento lc on lc.fonte = il.fonte
  where il.ativo and il.fonte <> 'SUPORTE'
  group by il.fonte
  order by ativos desc;
$function$;

comment on function public.matricula_cobertura() is
  'Auditoria de matrícula por leiloeiro: ativos, com/sem matrícula, cobertura %, quantos na fila e quantos já checados sem matrícula (negative-cache). custo=pago/gratis/misto; publica_matricula=false quando a fonte não publica matrícula no lote (docs_status=esperado).';
