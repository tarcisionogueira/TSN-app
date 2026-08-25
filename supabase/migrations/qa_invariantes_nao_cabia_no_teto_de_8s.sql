-- ─────────────────────────────────────────────────────────────────────────────────────────
-- A ABA QUE VIGIA OS DEFEITOS ERA A QUE NÃO ABRIA — 25/08/2026
--
-- O RASTRO. `erros_cliente` tinha um 500 de produção em 23/08:
--     /admin — Supabase 500 em "rpc/admin_qa_invariantes":
--     canceling statement due to statement timeout
--
-- A MEDIÇÃO. `qa_invariantes()` executa em ~11,7 s com `shared hit=450687` e ZERO leitura de
-- disco — ou seja, não é I/O nem cache frio: é CPU. E o teto é 8 s:
--     authenticated   statement_timeout = 8s     ← o /admin
--     service_role     rolconfig = null           ← herda o authenticator, 8s
-- Confirmado sob o teto real (`set statement_timeout='8s'`), e o CONTEXT do cancelamento
-- aponta o culpado por nome: `SQL function "via_normalizada"`.
--
-- ONDE O TEMPO IA. Dos 48 invariantes, TRÊS consomem 11,4 s dos 11,7 s; os outros 45 somam
-- 0,4 s:
--     pino_generico_como_rua            7.259 ms   ← 62% do total
--     selo_documento_dessincronizado    2.182 ms
--     bem_movel_no_acervo               1.981 ms
--
-- A CAUSA no maior deles é algorítmica, não falta de índice: um `exists` correlacionado que,
-- para cada lote ativo com coordenada, varre de novo os lotes ativos procurando outro na
-- MESMA coordenada com via diferente — e avalia `via_normalizada()` dos dois lados, dentro
-- do laço. Índice não conserta produto de linhas, e a tabela recebe ~29 mil escritas por dia:
-- índice novo aqui teria custo permanente de escrita para resolver um custo de leitura.
--
-- A REESCRITA é algébrica e exata. "existe b na mesma coordenada com via ≠ via(a)" é o mesmo
-- que "esta coordenada tem 2 ou mais vias distintas" — porque o próprio `a` já contribui a
-- sua via para a contagem daquela coordenada. Se há 2+ vias, uma delas é ≠ via(a); se há 1,
-- ela é a de `a`. Vira uma passada só, com `group by` na coordenada.
--
-- ENSAIO ANTES DE APLICAR (o número igual não bastava — comparei os CONJUNTOS de id):
--     valor antigo 49 · valor novo 49 · só no antigo 0 · só no novo 0
--
-- POR QUE ISSO IMPORTA MAIS DO QUE UMA TELA LENTA: o mesmo RPC é lido pelo monitor diário
-- (`api/monitor-fontes-cron.js`, seção C4), que roda como service_role — também sob 8 s — e
-- lê o resultado com `const { data: inv } = await supabase.rpc(...)` SEM checar `error`.
-- Estourando o teto, `inv` vem nulo, o laço não itera e o monitor conclui que NENHUM dos 48
-- invariantes tem alerta. A trava de corretude do produto estava desarmada em silêncio, que
-- é a forma nº 2 da lista do CLAUDE.md. O conserto do lado JS vai no mesmo commit.
-- ─────────────────────────────────────────────────────────────────────────────────────────

do $do$
declare
  def          text;
  ancora_cte   text := '  inv(chave, titulo, categoria, gravidade, valor, limite) as (';
  ancora_fim   text := 'via_normalizada(a.endereco))), 25),';
  ctes_novas   text;
  bloco_novo   text;
  ini          int;
  fim_rel      int;
begin
  select pg_get_functiondef(oid) into def from pg_proc where proname = 'qa_invariantes';
  if def is null then
    raise exception 'qa_invariantes nao existe — nada a aplicar';
  end if;

  if position('coord_multivia' in def) > 0 then
    raise notice 'ja aplicado — nada a fazer';
    return;
  end if;

  -- 1) as duas CTEs: uma passada calculando a via de cada lote, e as coordenadas com 2+ vias.
  --    `vias_ativas` e referenciada DUAS vezes, entao o Postgres a materializa (nao inlina)
  --    desde a 12 — que e exatamente o que queremos: via_normalizada() uma vez por linha.
  ctes_novas :=
'  vias_ativas as (
    select id, geocod_nivel, latitude, longitude, public.via_normalizada(endereco) as via
      from public.imoveis_leilao
     where ativo and latitude is not null and longitude is not null
  ),
  coord_multivia as (
    select latitude, longitude from vias_ativas where via is not null
     group by 1, 2 having count(distinct via) > 1
  ),
' || ancora_cte;

  if position(ancora_cte in def) = 0 then
    raise exception 'ancora das CTEs nao encontrada — revise antes de aplicar';
  end if;
  def := replace(def, ancora_cte, ctes_novas);

  -- 2) o invariante em si, agora lendo as CTEs.
  bloco_novo :=
'(''pino_generico_como_rua'',''Coordenada compartilhada por vias diferentes ainda marcada como precisa'',''Captura'',''bug'',
       (select count(*) from vias_ativas v
          join coord_multivia c on c.latitude = v.latitude and c.longitude = v.longitude
         where v.geocod_nivel in (''rua'',''endereco'') and v.via is not null), 25),';

  ini := position('(''pino_generico_como_rua''' in def);
  if ini = 0 then
    raise exception 'invariante pino_generico_como_rua nao encontrado — revise antes de aplicar';
  end if;
  fim_rel := position(ancora_fim in substring(def from ini));
  if fim_rel = 0 then
    raise exception 'fim do bloco pino_generico_como_rua nao encontrado — revise antes de aplicar';
  end if;

  def := left(def, ini - 1)
      || bloco_novo
      || substring(def from ini + fim_rel - 1 + length(ancora_fim));

  execute def;
  raise notice 'pino_generico_como_rua reescrito em uma passada';
end $do$;

-- ── O SEGUNDO MAIOR: bem_movel_no_acervo (1.981 ms) ──────────────────────────────────────
-- `bem_movel_barrado(titulo, descricao)` é IMMUTABLE e puramente textual — logo, indexável.
-- O invariante conta lotes ativos que a regra `acervo.bem_movel` barraria; o valor correto é
-- ZERO, então o índice parcial nasce e permanece VAZIO (8 KB medidos).
--
-- A troca, explicitada para poder ser contestada: o predicado passa a ser avaliado uma vez
-- por ESCRITA (~29 mil/dia) em vez de 30 mil vezes por ABERTURA do painel. Em CPU total é
-- quase empate; o que muda é ONDE o custo cai — o caminho de escrita não tem teto, o
-- interativo tem 8 s e é onde o cliente vê o 500.
--
-- Medido depois: Index Only Scan, Heap Fetches 0 — 1.981 ms → 0,074 ms.
--
-- ⚠️ CONCURRENTLY não roda dentro de transação. Se este arquivo for aplicado por uma
--    ferramenta que envolve tudo num BEGIN, rode esta linha separadamente.
create index concurrently if not exists idx_imoveis_bem_movel_barrado
  on public.imoveis_leilao (id)
  where ativo and public.bem_movel_barrado(titulo, descricao);

-- RESULTADO MEDIDO, ponta a ponta:
--   antes   11.710 ms  → estourava os 8 s (500 na tela do /admin, monitor mudo)
--   depois   3.252 ms  → 41% do teto, com 49 invariantes (um a mais que antes)
