-- ─────────────────────────────────────────────────────────────────────────────────────────
-- O GATILHO REBAIXAVA O PINO PORQUE A RUA MUDOU DE NOME — 25/08/2026
--
-- COMO APARECEU. O invariante `pino_generico_como_rua` marcava 49 contra limite 25. Fui
-- consertar os 49 e descobri que 46 deles eram FALSO POSITIVO — e que a mesma comparação
-- quebrada não estava só medindo: estava DEGRADANDO dado correto, todo dia, sozinha.
--
-- O DADO. Das 7 coordenadas acusadas, uma responde por 40 dos 49:
--     40 lotes  "Rua Projetada A, N. 311, Apto 202, Bl 07"                  geocod_nivel=endereco
--      1 lote   "Rua Mauro Portugal (antiga R Projetada A), N. 311, Apto 305" geocod_nivel=cidade
-- É A MESMA RUA. A CEF escreve o nome novo com o antigo entre parênteses; mesmo número 311,
-- mesmo condomínio. `via_normalizada` remove pontuação, então "mauro portugal antiga r
-- projetada a" ≠ "projetada a" — e o par vira "duas ruas na mesma coordenada".
--
-- Repare no `geocod_nivel` daquela linha: **cidade**. Ela não nasceu imprecisa. Foi o
-- gatilho `trg_geocode_pino_generico` que a rebaixou, por escrever o nome da própria rua de
-- outro jeito que as 40 vizinhas. O pino estava certo e virou "nível cidade" no mapa do
-- cliente. Alcance medido: **106 lotes ativos em 22 coordenadas, todos CEF**.
--
-- Descartei a hipótese contrária antes de concluir — se essas coordenadas fossem centroide
-- de cidade, os 46 seriam problema real e não falso positivo. Não são: os 500 lotes 'cidade'
-- do Rio se espalham por 32 pontos distintos, e cada coordenada em disputa serve uma cidade
-- só, com contagem de condomínio (41, 24, 4).
--
-- Os outros 5 casos são a mesma família: preposição ("Chrisostomo Pimentel DE Oliveira" vs
-- "Chrisostomo Pimentel Oliveira") e nome antigo declarado. Restam **3 conflitos de verdade**
-- (Arapiraca: Projetada F × Projetada G; Luziânia: Rua 8 Qd49 × Quadra 82 Rua 12).
--
-- É a família já documentada no CLAUDE.md na armadilha do `sem_cota`: a trava medindo a
-- coisa errada e mandando consertar o que está intacto. Só que aqui ela não pedia conserto —
-- ela executava um.
--
-- A REGRA NOVA: `mesma_via(a, b)`. Cada endereço declara um nome ATUAL e, quando traz
-- "(antiga X)", também um apelido. Duas linhas são a mesma rua quando o nome ATUAL de uma
-- está entre os apelidos da outra.
--
-- O detalhe que quase passou: NÃO basta cruzar os conjuntos de apelidos. "R Falcon (antiga R
-- Projetada)" e "R Helson Benevolo Xavier (antiga R Projetada)" são ruas DIFERENTES que
-- compartilham um nome-rascunho de loteamento; casá-las esconderia um pino genérico de
-- verdade. Exigir que o nome ATUAL de uma apareça na outra separa os dois casos. Mesmo
-- raciocínio para "Rua G (antiga Rua Da10)" × "Rua Paulo Fernandes Biazi (antiga Rua Da10)".
--
-- REGRESSÃO CONFERIDA NO ACERVO INTEIRO antes de aplicar: 0 linhas perdem a via (ninguém
-- fica cego), 467 lotes ativos declaram nome antigo entre parênteses, 6.743 mudam o nome
-- principal por causa de preposição. Auditei os pares que a regra nova funde e a antiga
-- separava, um por um — os 2 falso-merges acima foram achados assim e são o motivo da
-- exigência do nome atual. 10 casos de aceitação, 10 passam.
--
-- QUATRO CONSUMIDORAS, UMA DEFINIÇÃO. A comparação estava copiada em quatro lugares — o
-- gatilho, `demover_pinos_genericos` (roda no limpar-imoveis-stale-cron), o contador
-- `geocode_pinos_genericos` (monitor-dados-cron) e o invariante. Todas passam a chamar
-- `mesma_via`, para que a próxima correção não precise ser feita quatro vezes.
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- ── 1) A regra, em três funções pequenas ────────────────────────────────────────────────
create or replace function public.via_norm_um(p text)
returns text language sql immutable set search_path to 'public' as $$
  select nullif(btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            btrim(regexp_replace(
              translate(lower(btrim(coalesce(p,''))),
                'áàâãäéèêëíìîïóòôõöúùûüçñ','aaaaaeeeeiiiiooooouuuucn'),
              '[^a-z0-9]+',' ','g')),
            '^(r|rua|av|avenida|trav|travessa|tv|al|alameda|rod|rodovia|est|estr|estrada|pc|praca|largo|viela|qd|quadra)\s+',''),
          '\s+n\s*[0-9].*$',''),
        '\s+[0-9]+[a-z]?(\s.*)?$',''),
      '\m(de|da|do|das|dos)\M','','g'),
    '\s+',' ','g')), '')
$$;

comment on function public.via_norm_um(text) is
  'Normaliza UM nome de via. Remove acento, tipo de logradouro, numero e preposicoes (de/da/do/das/dos) — e a preposicao que fazia "Chrisostomo Pimentel De Oliveira" e "Chrisostomo Pimentel Oliveira" parecerem ruas distintas.';

create or replace function public.via_atual(endereco text)
returns text language sql immutable set search_path to 'public' as $$
  select public.via_norm_um(btrim(regexp_replace(
    btrim(split_part(coalesce(endereco,''), ',', 1)), '\s*\([^)]*\)', '', 'g')))
$$;

-- Elemento [1] e SEMPRE o nome atual; [2], quando existe, e o nome antigo declarado entre
-- parenteses. Sem nome atual legivel devolve vazio — linha inutil para este teste.
create or replace function public.vias_do_endereco(endereco text)
returns text[] language sql immutable set search_path to 'public' as $$
  select case
    when a is null          then '{}'::text[]
    when b is null or b = a then array[a]
    else                         array[a, b]
  end
  from (
    select public.via_atual(endereco) as a,
           public.via_norm_um(btrim(regexp_replace(
             coalesce((regexp_match(btrim(split_part(coalesce(endereco,''), ',', 1)), '\(([^)]*)\)'))[1], ''),
             '^\s*(antiga|antigo|ant|ex|anterior|anteriormente)\s+', '', 'i'))) as b
  ) t
$$;

-- A DEFINICAO UNICA. Exigir o nome ATUAL de um lado e o que impede dois nomes antigos
-- genericos iguais ("R Projetada", "Rua Da10") de fundirem ruas diferentes.
create or replace function public.mesma_via(end_a text, end_b text)
returns boolean language sql immutable set search_path to 'public' as $$
  select public.via_atual(end_a) = any(public.vias_do_endereco(end_b))
      or public.via_atual(end_b) = any(public.vias_do_endereco(end_a))
$$;

-- ── 2) O PRÉ-FILTRO, e por que ele existe ───────────────────────────────────────────────
-- Aplicar `mesma_via` linha a linha sobre o acervo custa DEZENAS de segundos: o `exists`
-- correlacionado renormaliza os vizinhos a cada linha. Medido: >60 s, estourando o teto.
--
-- O corte que resolve é texto cru, sem regex: numa coordenada onde TODOS os endereços têm o
-- mesmo primeiro trecho, `via_atual` é igual para todos, logo `mesma_via` é verdadeiro e não
-- pode haver conflito. É um filtro SÃO — não descarta nenhum conflito possível. Corta 30.854
-- linhas para 5.652.
--
-- Duas escolhas que parecem detalhe e não são:
--   • `min <> max` em vez de `count(distinct)`: o distinct obriga um Sort de 25 mil linhas;
--     min/max roda em HashAggregate. Medido: 1.725 ms → 1.560 ms.
--   • `materialized` nas CTEs: sem isso o planejador empurra a normalização para dentro do
--     scan e normaliza as 25 mil linhas de novo. Medido sem: 7.996 ms. Com: 2.808 ms.
--
-- O mesmo bloco aparece em três funções. Tentei fatorá-lo numa função de conjunto e o
-- planejador degradou o plano (2.808 ms → 7.494 ms), então a duplicação é deliberada: aqui
-- ela é mais barata que a indireção. A REGRA continua num lugar só (`mesma_via`) — o que se
-- repete é o filtro, não o critério.

-- (a) O GATILHO — o que causava o dano. Roda uma vez por escrita, sobre os poucos vizinhos
--     da coordenada, então aqui `mesma_via` direto é barato e não precisa de pré-filtro.
create or replace function public.trg_geocode_pino_generico()
returns trigger language plpgsql set search_path to 'public' as $function$
declare
  v_via text;
  v_conflito boolean;
begin
  if new.geocod_nivel is null or new.geocod_nivel not in ('rua', 'endereco') then
    return new;
  end if;
  if new.latitude is null or new.longitude is null or new.latitude = 0 then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.latitude is not distinct from old.latitude
     and new.longitude is not distinct from old.longitude
     and new.geocod_nivel is not distinct from old.geocod_nivel
     and new.endereco is not distinct from old.endereco then
    return new;
  end if;

  v_via := public.via_atual(new.endereco);
  if v_via is null then return new; end if;

  -- 25/08: era `via_normalizada(i.endereco) <> v_via`, string contra string. Rebaixou 106
  -- lotes cujo endereco so escrevia o nome da rua de outro jeito.
  select exists (
    select 1
    from public.imoveis_leilao i
    where i.ativo
      and i.id <> new.id
      and i.latitude = new.latitude
      and i.longitude = new.longitude
      and public.via_atual(i.endereco) is not null
      and not public.mesma_via(i.endereco, new.endereco)
  ) into v_conflito;

  -- SO A PROPRIA LINHA. O `update public.imoveis_leilao` que existia aqui era a causa do
  -- 21000 que derrubava upserts inteiros. A linha irma se rebaixa quando for escrita.
  if v_conflito then
    new.geocod_nivel := 'cidade';
  end if;

  return new;
end;
$function$;

-- (b) O REBAIXAMENTO EM MASSA (limpar-imoveis-stale-cron). Verificado sob `statement_timeout
--     = 8s`: passa, e rebaixou exatamente os 3 conflitos reais.
create or replace function public.demover_pinos_genericos()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n integer;
begin
  with susp as materialized (
    select latitude, longitude from public.imoveis_leilao
     where ativo and latitude is not null and longitude is not null
       and btrim(split_part(coalesce(endereco,''), ',', 1)) <> ''
     group by 1, 2
    having min(lower(btrim(split_part(coalesce(endereco,''), ',', 1))))
        <> max(lower(btrim(split_part(coalesce(endereco,''), ',', 1))))
  ),
  v as materialized (
    select b.id, b.geocod_nivel, b.latitude, b.longitude,
           public.vias_do_endereco(b.endereco) as aliases
      from public.imoveis_leilao b
      join susp s on s.latitude = b.latitude and s.longitude = b.longitude
     where b.ativo
  ),
  alvo as materialized (
    select distinct a.id
      from v a join v b on b.latitude = a.latitude and b.longitude = a.longitude and b.id <> a.id
     where a.geocod_nivel in ('rua','endereco')
       and cardinality(a.aliases) > 0 and cardinality(b.aliases) > 0
       and not (a.aliases[1] = any(b.aliases) or b.aliases[1] = any(a.aliases))
  )
  update public.imoveis_leilao i set geocod_nivel = 'cidade'
    from alvo where i.id = alvo.id;
  get diagnostics n = row_count;
  return n;
end $function$;

-- (c) O CONTADOR do monitor-dados-cron.
create or replace function public.geocode_pinos_genericos()
returns table(latitude numeric, longitude numeric, lotes_precisos bigint, vias bigint)
language sql stable set search_path to 'public' as $function$
  with susp as materialized (
    select latitude, longitude from public.imoveis_leilao
     where ativo and latitude is not null and longitude is not null
       and btrim(split_part(coalesce(endereco,''), ',', 1)) <> ''
     group by 1, 2
    having min(lower(btrim(split_part(coalesce(endereco,''), ',', 1))))
        <> max(lower(btrim(split_part(coalesce(endereco,''), ',', 1))))
  ),
  v as materialized (
    select b.id, b.geocod_nivel, b.latitude, b.longitude,
           public.vias_do_endereco(b.endereco) as aliases
      from public.imoveis_leilao b
      join susp s on s.latitude = b.latitude and s.longitude = b.longitude
     where b.ativo
  ),
  conf as materialized (
    select distinct a.latitude as lat, a.longitude as lon
      from v a join v b on b.latitude = a.latitude and b.longitude = a.longitude and b.id <> a.id
     where cardinality(a.aliases) > 0 and cardinality(b.aliases) > 0
       and not (a.aliases[1] = any(b.aliases) or b.aliases[1] = any(a.aliases))
  )
  select v.latitude, v.longitude,
         count(*) filter (where v.geocod_nivel in ('rua','endereco')) as lotes_precisos,
         count(distinct v.aliases[1]) as vias
    from v join conf c on c.lat = v.latitude and c.lon = v.longitude
   group by 1, 2
  having count(*) filter (where v.geocod_nivel in ('rua','endereco')) > 0
$function$;

create or replace function public.geocode_pinos_genericos_total()
returns bigint language sql stable set search_path to 'public' as $function$
  select public.qa_pinos_genericos()
$function$;

-- (d) A CONTAGEM que o monitor mede uma vez por dia. Medido: 2.808 ms — cabe no teto de 8 s
--     como statement própria, mas NÃO cabe somada às outras 48 (ver parte 4).
create or replace function public.qa_pinos_genericos()
returns bigint language sql stable set search_path to 'public' as $function$
  with susp as materialized (
    select latitude, longitude from public.imoveis_leilao
     where ativo and latitude is not null and longitude is not null
       and btrim(split_part(coalesce(endereco,''), ',', 1)) <> ''
     group by 1, 2
    having min(lower(btrim(split_part(coalesce(endereco,''), ',', 1))))
        <> max(lower(btrim(split_part(coalesce(endereco,''), ',', 1))))
  ),
  v as materialized (
    select b.id, b.geocod_nivel, b.latitude, b.longitude,
           public.vias_do_endereco(b.endereco) as aliases
      from public.imoveis_leilao b
      join susp s on s.latitude = b.latitude and s.longitude = b.longitude
     where b.ativo
  )
  select count(distinct a.id)
    from v a join v b on b.latitude = a.latitude and b.longitude = a.longitude and b.id <> a.id
   where a.geocod_nivel in ('rua','endereco')
     and cardinality(a.aliases) > 0 and cardinality(b.aliases) > 0
     and not (a.aliases[1] = any(b.aliases) or b.aliases[1] = any(a.aliases))
$function$;

-- tentativas intermediarias desta migracao, removidas para nao virarem codigo morto
drop function if exists public.qa_pino_conflito(text[], text[], boolean[]);
drop function if exists public.coords_com_vias_conflitantes();

-- ── 3) Reparo das 106 vítimas ───────────────────────────────────────────────────────────
-- Vítima = linha em 'cidade' que divide a coordenada EXATA com uma linha precisa cuja rua,
-- pela regra corrigida, é a mesma. Um geocode de cidade de verdade não cairia exatamente
-- sobre o ponto preciso do vizinho. Medido: 106 lotes, 22 coordenadas, todos CEF — Rio de
-- Janeiro, São Gonçalo, Nova Iguaçu, Itaboraí, Campos, Araçatuba, Campo Largo, Cidade
-- Ocidental, Lauro de Freitas, Mossoró.
--
-- NÃO devolvo 'rua' nem 'endereco': eu não sei qual dos dois a linha tinha antes de ser
-- rebaixada, e inventar um nível é afirmar precisão que ninguém mediu. Marco 'refazer', a
-- fila de re-geocode já existente (`imoveis_leilao_geocode_fila_idx`) — o nível volta
-- MEDIDO, não chutado. A coordenada é preservada.
--
-- Roda DEPOIS do gatilho corrigido de propósito: na ordem inversa, o próprio UPDATE do
-- reparo dispararia a regra velha e rebaixaria tudo de novo.
do $do$
declare n integer;
begin
  update public.imoveis_leilao a
     set geocod_nivel = 'refazer'
   where a.ativo and a.geocod_nivel = 'cidade'
     and a.latitude is not null and a.longitude is not null
     and exists (
       select 1 from public.imoveis_leilao b
        where b.ativo and b.id <> a.id
          and b.latitude = a.latitude and b.longitude = a.longitude
          and b.geocod_nivel in ('rua','endereco')
          and public.mesma_via(a.endereco, b.endereco));
  get diagnostics n = row_count;
  raise notice 'pinos devolvidos a fila de re-geocode: %', n;
end $do$;

-- ── 4) A checagem cara sai do caminho do clique ─────────────────────────────────────────
-- Mesmo padrão de `qa_invariantes_execucao` (migração de hoje mais cedo): o monitor mede uma
-- vez por dia e grava; o invariante lê o número medido. Sem isso, este teste sozinho
-- custaria ~2,8 s dentro de `qa_invariantes()` e comeria de volta o teto que a migração da
-- manhã recuperou — seria trocar um defeito pelo mesmo defeito.
--
-- E o fallback é 9999: sem medição, ou com medição de mais de 3 dias, ACUSA. "Não consegui
-- checar" reprova, não aprova — a mesma escolha do verificador de schema.
create table if not exists public.qa_medida_externa (
  chave      text primary key,
  valor      bigint      not null,
  medido_em  timestamptz not null default now()
);
alter table public.qa_medida_externa enable row level security;

comment on table public.qa_medida_externa is
  'Invariantes caros demais para recalcular a cada abertura do painel. O monitor diario mede e grava; qa_invariantes() le o valor com fallback de 9999 quando a medicao envelhece.';

do $do$
declare def text; ancora text := '     (''pino_generico_como_rua'','; ini int; fim int; novo text;
begin
  select pg_get_functiondef(oid) into def from pg_proc where proname = 'qa_invariantes';
  if def is null then raise exception 'qa_invariantes nao existe'; end if;
  if position('qa_medida_externa' in def) > 0 then
    raise notice 'ja aplicado — nada a fazer'; return;
  end if;
  ini := position(ancora in def);
  if ini = 0 then raise exception 'ancora do invariante nao encontrada — revise antes de aplicar'; end if;
  fim := position(', 25),' in substring(def from ini));
  if fim = 0 then raise exception 'fim do bloco nao encontrado — revise antes de aplicar'; end if;

  novo :=
'     (''pino_generico_como_rua'',''Coordenada compartilhada por vias diferentes ainda marcada como precisa'',''Captura'',''bug'',
       coalesce((select case when m.medido_em < now() - interval ''3 days'' then 9999 else m.valor end
                   from public.qa_medida_externa m where m.chave = ''pino_generico_como_rua''), 9999), 25),';

  def := left(def, ini - 1) || novo || substring(def from ini + fim - 1 + length(', 25),'));
  execute def;
  raise notice 'invariante passa a ler a medicao do monitor';
end $do$;

-- primeira medicao, para o invariante nao nascer em 9999
insert into public.qa_medida_externa (chave, valor, medido_em)
values ('pino_generico_como_rua', public.qa_pinos_genericos(), now())
on conflict (chave) do update set valor = excluded.valor, medido_em = excluded.medido_em;

-- ── RESULTADO MEDIDO ────────────────────────────────────────────────────────────────────
--   invariante            49 (46 falso positivo) → 0, depois de rebaixar os 3 reais
--   pinos indevidamente rebaixados               → 106 devolvidos à fila de re-geocode
--   qa_invariantes() total       3.252 ms → 2.674 ms   (33% do teto de 8 s)
--
-- TESTES DE COMPORTAMENTO, contra o gatilho em produção, em transação desfeita ao final:
--   A) "Rua Mauro Portugal (antiga R Projetada A)" entre 40 vizinhas em "Rua Projetada A"
--      → pedi 'endereco', ficou 'endereco'.  NÃO rebaixa mais.
--   B) "Rua Projetada F" × "Rua Projetada G" na mesma coordenada
--      → pedi 'rua', ficou 'cidade'.  O conflito real continua sendo rebaixado.
-- Os dois sentidos, não só o feliz.
