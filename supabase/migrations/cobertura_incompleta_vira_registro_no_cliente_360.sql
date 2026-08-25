-- ─────────────────────────────────────────────────────────────────────────────────────────
-- QUANDO NEM OS 200 KM FECHAM AS 12, O DONO PRECISA SABER — 25/08/2026
--
-- Fecha a regra do e-mail de oportunidades, decidida pelo dono nesta sessão:
--   1. Nunca mandar "não encontramos".
--   2. Se a combinação cidade do cadastro + perfil do investidor + filtros salvos não achar,
--      abrir o raio até encontrar (escada 25→50→100→200 km, no commit anterior).
--   3. Manter o teto de 200 km — a regra de 01/08 continua de pé, com o motivo dela: acima
--      disso o deslocamento inviabiliza visita e arremate.
--   4. E O QUE ESTA MIGRAÇÃO ACRESCENTA: se nem os 200 km fecharem as 12, isso vira
--      REGISTRO NO CLIENTE 360, para o dono tomar providência.
--
-- Por que registro e não e-mail de aviso: o cliente não deve receber uma mensagem dizendo
-- que a plataforma não achou nada — essa foi a instrução explícita. Mas o e-mail sair curto
-- em silêncio seria a forma nº 1 da lista do CLAUDE.md pelo avesso: a ausência entregue como
-- normalidade. O registro resolve os dois: o cliente recebe o que existe, e a lacuna fica
-- visível de quem pode agir.
--
-- SÓ GRAVA QUANDO FALTA. E-mail que fechou as 12 não deixa rastro — a tabela é a lista de
-- quem merece atenção, não um log de execução. Uma linha aqui é acionável por natureza:
-- mexer no filtro junto com o cliente, ampliar a captura naquela praça, ou decidir que para
-- aquele caso o teto de 200 km precisa ceder.
--
-- O registro guarda ATÉ ONDE se procurou (`raio_max_m`). Sem isso o painel diria "faltou"
-- sem dizer o alcance — e a providência depende exatamente disso: 4 de 12 achados a 25 km é
-- um problema de filtro estreito; 4 de 12 depois de varrer 200 km é falta de acervo.
--
-- VERIFICADO ponta a ponta antes de aplicar (em transação desfeita): gravei um faltante e o
-- `admin_360_estatisticas()` devolveu alerta_incompleto_7d = 1, clientes = 1 e o detalhe com
-- nome, plano, "5 de 12 (2 do filtro · 3 da região)", Barueri/SP e "buscou até 200 km".
-- Conferido também que `clientes_com_erro`, cuja chave é vizinha da âncora usada na edição,
-- continua respondendo.
-- ─────────────────────────────────────────────────────────────────────────────────────────

create table if not exists public.alerta_cobertura (
  id           bigserial primary key,
  user_id      uuid not null,
  executado_em timestamptz not null default now(),
  vagas        int  not null,
  encontrados  int  not null,
  contrato     int  not null default 0,
  regiao       int  not null default 0,
  raio_max_m   int,
  cidade_ref   text,
  uf_ref       text
);

create index if not exists alerta_cobertura_recente_idx on public.alerta_cobertura (executado_em desc);
alter table public.alerta_cobertura enable row level security;

comment on table public.alerta_cobertura is
  'Registro de e-mail de oportunidades que NAO fechou as 12 vagas nem esgotando a escada de raio ate 200km. So grava quando falta — linha aqui e sinal de que o cliente merece providencia (regra do dono, 25/08). Aparece no Cliente 360.';

do $do$
declare def text; ancora text := '''clientes_com_erro'','; novo text;
begin
  select pg_get_functiondef(oid) into def from pg_proc where proname='admin_360_estatisticas';
  if def is null then raise exception 'admin_360_estatisticas nao existe'; end if;
  if position('alerta_incompleto' in def) > 0 then
    raise notice 'ja aplicado — nada a fazer'; return;
  end if;
  if position(ancora in def) = 0 then
    raise exception 'ancora nao encontrada — revise antes de aplicar';
  end if;

  novo :=
'''alerta_incompleto_7d'', (select count(*) from public.alerta_cobertura where executado_em > now() - interval ''7 days''),
    ''alerta_incompleto_clientes'', (select count(distinct user_id) from public.alerta_cobertura where executado_em > now() - interval ''7 days''),
    ''alerta_incompleto_recentes'', coalesce((select jsonb_agg(x) from (
        select c.executado_em, c.encontrados, c.vagas, c.contrato, c.regiao, c.raio_max_m,
               c.cidade_ref, c.uf_ref, p.nome, p.role
          from public.alerta_cobertura c left join public.perfis p on p.id = c.user_id
         where c.executado_em > now() - interval ''30 days''
         order by c.executado_em desc limit 10) x), ''[]''::jsonb),
    ''clientes_com_erro'',';

  execute replace(def, ancora, novo);
  raise notice 'chaves de cobertura adicionadas ao 360';
end $do$;
