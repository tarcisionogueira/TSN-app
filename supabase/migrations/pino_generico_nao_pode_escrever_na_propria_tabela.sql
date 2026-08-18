-- ─────────────────────────────────────────────────────────────────────────────────────────
-- A COLISÃO DO UPSERT: O TRIGGER ESCREVIA NA TABELA QUE ESTAVA SENDO UPSERTADA — 18/08/2026
--
-- SINTOMA (2 dias de caça): `ON CONFLICT DO UPDATE command cannot affect row a second time`
-- (SQLSTATE 21000) derrubava o upsert INTEIRO da CEF/RJ — 8.200 lotes, 12 dias de acervo
-- congelado, com o run saindo verde. Depois do conserto do laço, a bissecção mostrou "colisão
-- ENTRE LINHAS": o bloco falhava, as duas metades passavam, e todas as linhas entravam.
--
-- HIPÓTESES ELIMINADAS, na ordem em que caíram:
--   1. duplicata em `fonte+fonte_id` no payload  → o dedup acusa ZERO;
--   2. `id` viajando no payload                  → não viaja;
--   3. outra UNIQUE servindo de árbitro          → só há (id), (fonte_id) e (fonte, fonte_id);
--   4. trigger reescrevendo `fonte`/`fonte_id`   → nenhum dos 11 toca essas colunas;
--   5. collation não-determinística              → `fonte`/`fonte_id` são determinísticas.
--
-- CAUSA REAL. `trg_geocode_pino_generico` é BEFORE INSERT OR UPDATE em `imoveis_leilao` e,
-- ao detectar pino genérico (duas vias diferentes na MESMA coordenada), rodava:
--
--     update public.imoveis_leilao i set geocod_nivel = 'cidade'
--      where i.ativo and i.id <> new.id
--        and i.latitude = new.latitude and i.longitude = new.longitude;
--
-- Ou seja: escrevia na PRÓPRIA TABELA que o `INSERT … ON CONFLICT` estava processando. Quando
-- o lote trazia duas linhas na mesma coordenada, a segunda linha já tinha sido tocada pelo
-- UPDATE do trigger da primeira — e o Postgres se recusa a afetar a mesma linha duas vezes na
-- mesma instrução. Não havia chave duplicada em lugar nenhum: a colisão era do TRIGGER.
--
-- Por que caiu justo no RJ: é o estado com mais lotes empilhados na mesma coordenada —
-- 5.106 linhas em 687 coordenadas (GO 1.139, SP 1.002). Em blocos de 500, o par é quase certo.
--
-- REPRODUZIDO antes de consertar, com duas linhas reais de `fonte_id` distintos que só
-- compartilham a coordenada: `sqlstate=21000`. E é ACERVO-INTEIRO, não CEF: o trigger vale
-- para todas as fontes, e qualquer coletor que mande duas linhas coincidentes no mesmo lote
-- perde o lote inteiro.
--
-- CONSERTO. O trigger passa a rebaixar SÓ A PRÓPRIA LINHA (`new`), sem escrever na tabela.
-- Não se perde a regra: a detecção não filtra por `geocod_nivel`, então quando a linha irmã
-- for escrita — e a coleta reescreve todas —, ela detecta o mesmo conflito e se rebaixa
-- sozinha. Converge em um ciclo de coleta, sem uma instrução aninhada na outra.
--
-- Passivo hoje: 21 linhas ainda em 'rua'/'endereco' numa coordenada compartilhada — o trigger
-- vinha fazendo o trabalho. Rebaixadas abaixo, de uma vez, fora de qualquer upsert.
-- ─────────────────────────────────────────────────────────────────────────────────────────

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

  v_via := public.via_normalizada(new.endereco);
  if v_via is null then return new; end if;

  select exists (
    select 1
    from public.imoveis_leilao i
    where i.ativo
      and i.id <> new.id
      and i.latitude = new.latitude
      and i.longitude = new.longitude
      and public.via_normalizada(i.endereco) is not null
      and public.via_normalizada(i.endereco) <> v_via
  ) into v_conflito;

  -- SÓ A PRÓPRIA LINHA. O `update public.imoveis_leilao` que existia aqui era a causa do
  -- 21000 — ver o cabeçalho desta migração. A linha irmã se rebaixa quando for escrita:
  -- a detecção acima não filtra por `geocod_nivel`, então ela enxerga o mesmo conflito.
  if v_conflito then
    new.geocod_nivel := 'cidade';
  end if;

  return new;
end;
$function$;

comment on function public.trg_geocode_pino_generico() is
  'Rebaixa para geocod_nivel=cidade quando duas vias diferentes caem na MESMA coordenada (pino generico). NAO pode escrever em imoveis_leilao: era a causa do 21000 que derrubava upserts inteiros — ver migracao de 18/08.';

-- Passivo: rebaixa de uma vez as linhas que ficariam esperando a proxima escrita.
update public.imoveis_leilao a
   set geocod_nivel = 'cidade'
 where a.ativo and a.geocod_nivel in ('rua','endereco')
   and a.latitude is not null and a.longitude is not null
   and public.via_normalizada(a.endereco) is not null
   and exists (select 1 from public.imoveis_leilao b
                where b.ativo and b.id <> a.id
                  and b.latitude = a.latitude and b.longitude = a.longitude
                  and public.via_normalizada(b.endereco) is not null
                  and public.via_normalizada(b.endereco) <> public.via_normalizada(a.endereco));

-- INVARIANTE. A regra agora depende de CONVERGÊNCIA (cada linha se rebaixa quando é escrita),
-- e convergência que para de acontecer não dá erro — só deixa pino impreciso passando por
-- preciso. Limite 25 e não 0: entre a chegada de um lote novo e a próxima escrita da linha
-- irmã existe uma janela legítima. O que se vigia é o número CRESCER e ficar.
do $do$
declare def text; antes text; depois text;
begin
  select pg_get_functiondef(oid) into def from pg_proc where proname = 'qa_invariantes';

  antes := $a$     ('sem_cidade','Lote ativo sem cidade','Captura','gap',
       (select count(*) from imoveis_leilao where ativo and coalesce(cidade,'')=''), 30)$a$;

  depois := $b$     ('sem_cidade','Lote ativo sem cidade','Captura','gap',
       (select count(*) from imoveis_leilao where ativo and coalesce(cidade,'')=''), 30),
     ('pino_generico_como_rua','Coordenada compartilhada por vias diferentes ainda marcada como precisa','Captura','bug',
       (select count(*) from imoveis_leilao a
         where a.ativo and a.geocod_nivel in ('rua','endereco')
           and a.latitude is not null and a.longitude is not null
           and public.via_normalizada(a.endereco) is not null
           and exists (select 1 from imoveis_leilao b
                        where b.ativo and b.id <> a.id
                          and b.latitude = a.latitude and b.longitude = a.longitude
                          and public.via_normalizada(b.endereco) is not null
                          and public.via_normalizada(b.endereco) <> public.via_normalizada(a.endereco))), 25)$b$;

  if position(antes in def) = 0 then
    if position('pino_generico_como_rua' in def) > 0 then
      raise notice 'invariante ja presente';
      return;
    end if;
    raise exception 'ancora nao encontrada em qa_invariantes()';
  end if;

  execute replace(def, antes, depois);
  raise notice 'qa_invariantes atualizada com pino_generico_como_rua';
end $do$;
