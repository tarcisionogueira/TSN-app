-- 29/08 — O INSTRUMENTO DO RITUAL ENXERGAVA 22 DE 32 FONTES E CHAMAVA ISSO DE "ÍNTEGRO"
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- `fonte_regressao_suspeita()` é lida no ritual de abertura (CLAUDE.md, item 2) com a regra
-- "vazio = íntegro". Ela não tem UM chamador em código — é instrumento de leitura humana, e
-- por isso envelheceu calada, que é a terceira vez que isso acontece nesta base (17/08, 18/08,
-- 27/08). Medido hoje, ela tinha DOIS pontos cegos, e os dois devolvem silêncio:
--
--   A) O GATE `mediana >= 20` de `fonte_baseline_aprendida().tem_baseline` excluía
--      10 das 32 fontes PARA SEMPRE — entre elas duas PAGAS reportando zero/quase-zero:
--      RJLEILOES (mediana 12) e VENDASGOV, além de VEGAS com 2 lotes contra mediana 15.
--      Leiloeiro pequeno era invisível por ser pequeno, não por estar são.
--
--   B) NENHUMA CHECAGEM DE IDADE. A função pega a última medição real e a compara com o
--      piso como se fosse de agora. EMILIOMATOS estava com 9 dias sem medição, ALFA e
--      NORDESTE com 8 — todas respondendo "sem regressão" a partir de leitura da semana
--      passada. Com o teto do Bright Data saturado (550/550 hoje), a última medição real
--      recua um dia a cada dia e a função segue afirmando com a mesma confiança.
--
-- É o princípio que o CLAUDE.md já aplica ao `verificar:schema`: tratar "não consegui
-- checar" como "está tudo bem" é cometer, dentro da própria trava, o defeito que ela
-- existe para pegar. Aqui isso vira uma linha `medicao_velha`, não um silêncio.
--
-- E A LIÇÃO DE 29/08 (sessão 13c): todo instrumento nasce com o MOTIVO DA RECUSA NOMEADO.
-- A função passa a devolver `motivo` (regressao | zerou | medicao_velha) em vez de deixar
-- quem lê inferir do conjunto de colunas por que aquela linha está ali.
--
-- ─── PRÉ-REQUISITO QUE VEIO JUNTO (senão isto nasce com a forma #5 dentro) ──────────────
-- `scraper-rj.mjs` e `scraper-pecini.mjs` gravavam recusa de ORÇAMENTO como `status='falhou'`
-- (a `FalhaDeAcesso` do RJ descartava o `semCota` que o `ErroBrightData` já calculava; o
-- PECINI escrevia o motivo na prosa e não no campo). São 21 linhas assim, e 8 delas do
-- RJLEILOES entre 13/08 e 29/08 — várias com um `queda vs anterior (coletados 0<5)`
-- FABRICADO por cima, porque `registrarSaude` comparou um zero de orçamento com a coleta
-- anterior. O filtro de `sem_cota`/`parcial_cota` desta função (o conserto de 18/08) era
-- contornado por essas linhas: elas diziam `falhou`. Coletores corrigidos no mesmo commit;
-- as 21 linhas são reclassificadas abaixo.

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 1) DADO: recusa de orçamento gravada como falha da fonte
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Critério conferido linha a linha antes de rodar (21 linhas: RJLEILOES 8, CALIL 4,
-- TORRES3 4, VEGAS 4, PECINI 1). Todas com total = 0 e o motivo dizendo "orçamento" por
-- extenso — nenhuma ambígua. CALIL/TORRES3/VEGAS pararam em 16/08 pelo conserto daquele
-- dia em `_saude-fonte.mjs`; RJLEILOES e PECINI seguiam porque montam a validação por conta.
update public.fonte_saude
   set status = 'sem_cota'
 where status = 'falhou'
   and total = 0
   and (motivo ilike '%teto_global%' or motivo ilike '%sem cota%' or motivo ilike '%subcota%'
        or motivo ilike '%cota_indisponivel%' or motivo ilike '%reservado_para_outros%');

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 2) O INSTRUMENTO
-- ─────────────────────────────────────────────────────────────────────────────────────
drop function if exists public.fonte_regressao_suspeita(integer);

create or replace function public.fonte_regressao_suspeita(
  p_dias_expiracao integer default 7,
  p_horas_frescor  integer default 108)   -- espelha MAX_IDADE_H de api/monitor-fontes-cron.js:
                                          -- 4,5 dias cobrem o maior gap legítimo (qui→seg = 96 h)
                                          -- sem acusar o fim de semana. Mudou lá, mude aqui.
returns table(
  fonte text,
  motivo text,                 -- regressao | zerou | medicao_velha — SEMPRE preenchido
  total integer,
  ativos_piso integer,
  ativos_mediana integer,
  n_amostras bigint,
  status text,
  medido_em timestamp with time zone,
  horas_sem_medir integer,
  expirados_recentes bigint,
  faltando integer)            -- só faz sentido em 'regressao'; nulo nos outros (ver nota)
language sql
stable
set search_path to 'public'
as $function$
  with base as (
    -- SEM o filtro `where b.tem_baseline` que existia aqui: era ele que apagava as 10
    -- fontes pequenas. O porte agora é critério POR RAMO, não porteira de entrada.
    select b.fonte, b.ativos_piso, b.ativos_mediana, b.n_amostras, b.tem_baseline
      from public.fonte_baseline_aprendida() b
  ),
  ultima as (
    select b.fonte, b.ativos_piso, b.ativos_mediana, b.n_amostras, b.tem_baseline,
           u.total, u.status, u.executado_em,
           round(extract(epoch from (now() - u.executado_em)) / 3600.0)::int as horas
      from base b
      join lateral (
        select s.total, s.status, s.executado_em from public.fonte_saude s
         where s.fonte = b.fonte
           -- Os dois são decisão de ORÇAMENTO, não leitura do acervo: 'sem_cota' não tentou,
           -- 'parcial_cota' tentou e foi interrompido. Nenhum dos dois mede a fonte — e é
           -- justamente por PULAR essas linhas que a idade da última medição real importa.
           and s.status not in ('sem_cota', 'parcial_cota')
         order by s.executado_em desc limit 1
      ) u on true
  ),
  expirados as (
    select i.fonte, count(*) as n
      from public.imoveis_leilao i
     where not i.ativo
       and i.atualizado_em > now() - (p_dias_expiracao || ' days')::interval
       and public.leilao_encerrado(i.modalidade, i.data_leilao, i.data_leilao_2)
     group by i.fonte
  ),
  avaliado as (
    select u.*, coalesce(e.n, 0) as exp_n,
      case
        -- (1) IDADE PRIMEIRO. Se a última medição real está velha, não há o que afirmar
        --     sobre volume: a linha diz "não consegui verificar", que é uma resposta, e
        --     não a ausência de uma.
        when u.horas > p_horas_frescor then 'medicao_velha'
        -- (2) ZEROU. Zero não é oscilação: não precisa de baseline robusto, só da certeza
        --     de que a fonte já produziu (>= 2 leituras sadias, porte >= 3).
        when u.total = 0 and u.n_amostras >= 2 and u.ativos_mediana >= 3 then 'zerou'
        -- (3) REGRESSÃO de volume. Exige histórico (>= 3 leituras) e porte mínimo (mediana
        --     >= 5) — em vez do antigo >= 20, que era porteira e não critério. O piso já
        --     é `max(mediana/2, 3)`, então fonte minúscula não dispara por ±1 lote.
        when u.n_amostras >= 3 and u.ativos_mediana >= 5
             and u.total + coalesce(e.n, 0) < u.ativos_piso then 'regressao'
      end as motivo
      from ultima u left join expirados e on e.fonte = u.fonte
  )
  select a.fonte, a.motivo, a.total, a.ativos_piso, a.ativos_mediana, a.n_amostras,
         a.status, a.executado_em, a.horas, a.exp_n,
         -- NULO fora de 'regressao' de propósito. Em `medicao_velha` este número sairia
         -- negativo e plausível ("faltando -19"), descrevendo uma comparação que a função
         -- justamente se recusa a fazer. Número que não mede o que o nome diz é a forma
         -- nº 10 do CLAUDE.md — melhor vazio que enganoso.
         case when a.motivo = 'regressao'
              then (a.ativos_piso - a.total - a.exp_n::int) end as faltando
    from avaliado a
   where a.motivo is not null
   order by case a.motivo when 'zerou' then 1 when 'regressao' then 2 else 3 end,
            a.ativos_mediana desc;
$function$;

comment on function public.fonte_regressao_suspeita(integer, integer) is
  'Fontes com problema de captura, cada linha com o MOTIVO nomeado: zerou (parou de trazer '
  'lote), regressao (volume abaixo do piso aprendido) ou medicao_velha (sem medição real '
  'recente — a função nao consegue afirmar nada, e diz isso em vez de calar). Ignora '
  'sem_cota/parcial_cota: decisao de orcamento nao mede a fonte.';

revoke all on function public.fonte_regressao_suspeita(integer, integer) from public, anon;
grant execute on function public.fonte_regressao_suspeita(integer, integer) to service_role, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- 3) A TRAVA CONTRA A REINCIDÊNCIA
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Consertar os dois coletores não impede o terceiro. Este invariante vigia o SINTOMA no
-- rastro do banco: linha que diz `falhou` com um motivo que confessa orçamento. Não faço
-- a função de regressão casar prosa (isso seria trocar um instrumento frágil por outro);
-- o casamento de texto fica AQUI, onde o trabalho dele é acusar a contradição, não medir
-- a fonte. Janela de 7 dias: acusa o que está acontecendo, não o histórico já corrigido.
create or replace function public.qa_invariante_fonte_orcamento_como_falha()
returns bigint language sql stable set search_path to 'public' as $$
  select count(*)::bigint from public.fonte_saude
   where status = 'falhou'
     and executado_em > now() - interval '7 days'
     and (motivo ilike '%teto_global%' or motivo ilike '%sem cota%' or motivo ilike '%subcota%'
          or motivo ilike '%cota_indisponivel%' or motivo ilike '%reservado_para_outros%');
$$;

-- Registro em qa_invariantes() por reescrita da definição — mesmo padrão de
-- `qa_invariante_live_numeros_congelados.sql`. Idempotente.
do $do$
declare d text; alvo text; novo text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'qa_invariantes';
  alvo := E'where i.ativo and not exists (select 1 from fonte_saude s where s.fonte = i.fonte)) c), 0)';
  if position(alvo in d) = 0 then raise exception 'ancora nao encontrada em qa_invariantes()'; end if;
  if position('fonte_orcamento_como_falha' in d) > 0 then raise notice 'ja registrado'; return; end if;
  novo := alvo || E',\n     (''fonte_orcamento_como_falha'',''Recusa de orcamento gravada como falha da fonte (manda consertar parser intacto)'',''Captura'',''bug'',\n       public.qa_invariante_fonte_orcamento_como_falha(), 0)';
  execute replace(d, alvo, novo);
end $do$;
