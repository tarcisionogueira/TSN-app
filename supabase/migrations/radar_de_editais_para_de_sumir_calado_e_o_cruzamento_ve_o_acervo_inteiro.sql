-- ══════════════════════════════════════════════════════════════════════════════════════
-- O RADAR DE EDITAIS PARA DE SUMIR CALADO, E O CRUZAMENTO PASSA A VER O ACERVO INTEIRO.
-- ══════════════════════════════════════════════════════════════════════════════════════
-- Três defeitos medidos em 03/09, ao apurar se dava para depender menos de leiloeiro. Nenhum
-- deles dá erro em lugar nenhum — os três são a família de sempre: ausência entregue como
-- resposta, e número plausível que mede outra coisa.
--
-- ── 1. O SILÊNCIO DO RADAR NÃO TEM VIGIA ───────────────────────────────────────────────
-- Desde 29/08 a captura diária do DJEN é do runner RESIDENCIAL (grátis, IP de casa) e o cron
-- da Vercel virou rede de segurança: ele só paga Bright Data depois de
-- `RADAR_DIAS_REDE_SEGURANCA` (7) dias sem nenhum pull bem-sucedido. O desenho está certo.
-- O que falta é o alarme do intervalo: enquanto o freio segura, o cron sai 200 e **não grava
-- nada, de propósito** (uma linha por run apagaria o sinal que o próprio freio lê). Então,
-- com o residencial parado, `monitor_runs` fica EM BRANCO por até 7 dias — e um radar mudo é
-- indistinguível de uma semana sem edital publicado. É a mesma frase que o código já escreve
-- sobre o disjuntor ("um dia inteiro sem edital com o log em branco é indistinguível de um
-- dia sem publicação"), só que ninguém a aplicou ao freio.
-- Estado que motivou isto: último pull OK em 01/09 01:01 (origem `residencial`), 2,5 dias
-- atrás, e a rede de segurança só assumiria em ~08/09. Nenhum dos 4 invariantes que citam
-- "edital" vigia o pipeline — todos falam do documento do lote.
--
-- ── 2. `leiloeiro_integrado` = false EM 477 DE 477, E É FALSO ──────────────────────────
-- `construirEhIntegrado` montava a lista com
--   .select('leiloeiro').eq('ativo',true).limit(5000)   -- sem order
-- sobre `imoveis_leilao`, que tem 29.875 linhas ativas das quais **76% são da Caixa**. Medida
-- a amostra REAL dessas 5.000: **4.570 são "Caixa Econômica Federal"** e sobram **30 dos 106
-- leiloeiros**. A lista de "integrados" nascia com 72% dos leiloeiros faltando, e o campo
-- passou a medir "estava nas primeiras 5.000 linhas", não "é integrado" (forma nº 9 + nº 10).
-- Rodando a regra ATUAL sobre o acervo COMPLETO: 35 dos 121 editais com nome casariam. O
-- banco tem 0. Consequência prática: o backlog de "leiloeiro a integrar" — que é a razão de
-- o Radar existir — estava cego.
-- A correção é a lista DISTINTA (106 linhas, não 29.875): não há o que truncar.
--
-- ── 3. `imovel_uf` ACEITA QUALQUER PAR DE LETRAS ───────────────────────────────────────
-- A validação era `/^[A-Za-z]{2}$/` — FORMATO, não conteúdo (forma nº 8: contar não-nulos não
-- é validar). 89 editais gravados com UF impossível: ME (41), CR (31), AN, CG, LA, LO, DO,
-- CL, AI, DI, CB, MF, VW. Hoje isso é ruído; ao abrir o radar para o Brasil, `imovel_uf` vira
-- o filtro principal por estado, e um filtro sujo é pior que filtro nenhum — ele responde.

-- ── 1. O invariante do pipeline ────────────────────────────────────────────────────────
-- DIAS desde o último pull bem-sucedido, de QUALQUER origem (residencial ou Vercel) — é o
-- mesmo sinal que o freio do cron lê, e de propósito: dois vigias lendo coisas diferentes
-- sobre o mesmo pipeline é como se cria a terceira verdade.
-- Nunca houve pull → 9999, NÃO zero. Zero seria "capturou agora", que é o oposto, e é
-- exatamente o erro que `qa_invariantes_lenta` já comete de propósito ao usar 9999.
create or replace function public.qa_invariante_radar_editais_sem_pull()
returns bigint
language sql
stable security definer
set search_path to 'public'
as $$
  select coalesce(
    (select floor(extract(epoch from (now() - max(ran_at))) / 86400)::bigint
       from public.monitor_runs
      where fonte = 'radar-editais-djen' and erro is null),
    9999);
$$;

comment on function public.qa_invariante_radar_editais_sem_pull() is
  'Dias desde o ultimo pull BEM-SUCEDIDO do DJEN (qualquer origem). 9999 = nunca houve. Limite 2: o residencial roda diariamente, e 2 dias de folga cobrem um fim de semana perdido sem virar ruido.';

-- Registro em `qa_invariantes()` pelo mesmo caminho idempotente que
-- `qa_invariante_live_numeros_congelados.sql` inaugurou: a função é grande, a linha entra
-- depois da última, e repetir aqui evita as duas direções da forma nº 7 (migração escrita e
-- não aplicada · função aplicada e não migrada).
do $do$
declare d text; alvo text; novo text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='qa_invariantes';
  alvo := E'public.qa_invariante_live_numeros_congelados(), 0)';
  if position(alvo in d) = 0 then raise exception 'ancora nao encontrada em qa_invariantes()'; end if;
  if position('radar_editais_sem_pull' in d) > 0 then raise notice 'ja registrado'; return; end if;
  novo := alvo || E',\n     (''radar_editais_sem_pull'',''Radar de Editais (DJEN) sem nenhum pull bem-sucedido — captura parada em silencio'',''Captura'',''bug'',\n       public.qa_invariante_radar_editais_sem_pull(), 2)';
  execute replace(d, alvo, novo);
end $do$;

-- ── 2. A lista DISTINTA de leiloeiros do acervo ────────────────────────────────────────
-- 106 linhas em vez de 29.875: não existe truncamento possível, e o critério fica auditável
-- no banco em vez de depender de quantas linhas couberam num `.limit()`.
create or replace function public.leiloeiros_do_acervo()
returns table(leiloeiro text)
language sql
stable security definer
set search_path to 'public'
as $$
  select distinct i.leiloeiro
    from public.imoveis_leilao i
   where i.ativo and i.leiloeiro is not null and length(btrim(i.leiloeiro)) >= 4;
$$;

revoke all on function public.leiloeiros_do_acervo() from public, anon, authenticated;
grant execute on function public.leiloeiros_do_acervo() to service_role;

comment on function public.leiloeiros_do_acervo() is
  'Nomes DISTINTOS de leiloeiro no acervo ativo. Existe porque a leitura equivalente com .limit(5000) sobre imoveis_leilao trazia 91% de linhas da Caixa e so 30 dos 106 leiloeiros - o cruzamento do Radar de Editais media o truncamento, nao a integracao.';

-- ── 3. Limpeza: UF que não é UF vira NULO ──────────────────────────────────────────────
-- Nulo é a resposta honesta ("não sei de que estado é"); "ME" é uma afirmação falsa que um
-- filtro por estado obedeceria.
update public.editais_leilao
   set imovel_uf = null, atualizado_em = now()
 where imovel_uf is not null
   and imovel_uf not in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA',
                         'PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO');

-- ── 4. Re-marcação do acervo com a lista COMPLETA ──────────────────────────────────────
-- Sem isto o conserto do item 2 só valeria para editais FUTUROS, e os 477 já capturados
-- seguiriam todos "não integrado" — o backlog continuaria cego justamente sobre o acervo que
-- já temos. A regra é a MESMA do JS (`ehIntegrado`): normaliza os dois lados, exige 4+
-- caracteres e testa contenção nos dois sentidos.
with des as (select 'àáâãäçèéêëìíîïñòóôõöùúûüýÀÁÂÃÄÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ' a,
                    'aaaaaceeeeiiiinooooouuuuyAAAAACEEEEIIIINOOOOOUUUUY' b),
acervo as (
  select distinct trim(regexp_replace(lower(translate(leiloeiro, (select a from des), (select b from des))), '[^a-z0-9]+', ' ', 'g')) v
    from public.imoveis_leilao where ativo and leiloeiro is not null
)
update public.editais_leilao e
   set leiloeiro_integrado = true, atualizado_em = now()
 where e.leiloeiro_nome is not null
   and not e.leiloeiro_integrado
   and exists (
     select 1 from acervo a
      where length(a.v) >= 4
        and length(trim(regexp_replace(lower(translate(e.leiloeiro_nome, (select a from des), (select b from des))), '[^a-z0-9]+', ' ', 'g'))) >= 4
        and (a.v like '%' || trim(regexp_replace(lower(translate(e.leiloeiro_nome, (select a from des), (select b from des))), '[^a-z0-9]+', ' ', 'g')) || '%'
          or trim(regexp_replace(lower(translate(e.leiloeiro_nome, (select a from des), (select b from des))), '[^a-z0-9]+', ' ', 'g')) like '%' || a.v || '%'));

-- ── 5. A conferência que RECUSA em vez de seguir ───────────────────────────────────────
do $$
declare n_uf int; n_int int; n_leil int;
begin
  select count(*) into n_uf from public.editais_leilao
   where imovel_uf is not null
     and imovel_uf not in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA',
                           'PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO');
  select count(*) into n_int from public.editais_leilao where leiloeiro_integrado;
  select count(*) into n_leil from public.leiloeiros_do_acervo();

  if n_uf > 0 then raise exception 'ainda restam % editais com UF impossivel', n_uf; end if;
  if n_leil < 50 then raise exception 'leiloeiros_do_acervo() devolveu so % nomes — a lista voltou a truncar', n_leil; end if;
  -- Zero marcado depois da re-marcacao significaria que o conserto nao consertou: o ensaio
  -- feito antes de aplicar mediu 35 casamentos sobre os 121 editais com nome.
  if n_int = 0 then raise exception 're-marcacao nao marcou NENHUM edital — investigar antes de seguir'; end if;
  raise notice 'ok: % editais integrados, % leiloeiros na lista', n_int, n_leil;
end $$;
