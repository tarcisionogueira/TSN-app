-- 01/09 — LINHA DE BASE ANTES DE MEXER, e o funil medido por FUNÇÃO.
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- Pedido do dono: "registre antes para monitorarmos a evolução". O jeito errado de fazer
-- isso é anotar números num documento: consulta em documento não é testada e envelhece
-- calada (lição de 27/08), e — pior — o "depois" acabaria medido por uma consulta escrita
-- noutro dia, com filtros ligeiramente diferentes. Aí a comparação vira a forma nº 10:
-- dois números plausíveis medindo coisas distintas, com o nome de "evolução".
--
-- Por isso: UMA função calcula o funil para uma JANELA, e o antes e o depois saem os dois
-- dela. Se a régua mudar, muda para os dois lados — e foi exatamente o que aconteceu ainda
-- hoje, quando a LP ganhou um segundo CTA (ver a migração `..._passa_a_contar_os_dois_ctas`).
--
-- ⚠️ Comparação de rótulo por igualdade EXATA, não `like`: existe na base um clique de
-- 29/08 num botão antigo chamado só "Garantir minha vaga". Um `like 'Garantir minha vaga%'`
-- somaria esse evento histórico ao CTA fixo criado hoje e inflaria o "antes".
create or replace function public.lp_aula_funil(
  p_desde timestamptz,
  p_ate   timestamptz default now(),
  p_slug  text default 'leilao-ao-vivo'
) returns table(metrica text, valor numeric)
language sql stable set search_path to 'public' as $function$
  with rota as (select '/live/' || p_slug as r),
  visitas as (
    select e.anon_id,
           bool_or(e.tipo <> 'pageview')                as interagiu,
           bool_or(e.alvo in ('Quero participar',
                              'Garantir minha vaga · é gratuito')) as no_cta,
           bool_or(e.alvo = 'Garantir minha vaga · é gratuito')    as no_cta_fixo,
           bool_or(e.tipo = 'submit')                   as enviou,
           count(*) filter (where e.tipo = 'pageview')  as pvs
      from public.eventos_atividade e, rota
     where e.rota = rota.r and e.anon_id is not null
       and e.criado_em >= p_desde and e.criado_em < p_ate
     group by e.anon_id
  ),
  ins as (
    select count(*)::numeric n from public.live_inscricoes li
      join public.eventos_live ev on ev.id = li.evento_id and ev.slug = p_slug
     where li.criado_em >= p_desde and li.criado_em < p_ate
  ),
  ag as (
    select count(*)::numeric                                  pessoas,
           coalesce(sum(pvs),0)::numeric                      pageviews,
           count(*) filter (where interagiu)::numeric         interagiram,
           count(*) filter (where no_cta)::numeric            clicaram_cta,
           count(*) filter (where no_cta_fixo)::numeric       clicaram_cta_fixo,
           count(*) filter (where enviou)::numeric            enviaram_form
      from visitas
  )
  select * from (values
    ('pessoas',           (select pessoas           from ag)),
    ('pageviews',         (select pageviews         from ag)),
    ('interagiram',       (select interagiram       from ag)),
    ('clicaram_cta',      (select clicaram_cta      from ag)),
    ('clicaram_cta_fixo', (select clicaram_cta_fixo from ag)),
    ('enviaram_form',     (select enviaram_form     from ag)),
    ('inscricoes',        (select n                 from ins)),
    -- denominador PROTEGIDO: divisão por zero numa janela vazia devolveria erro, e a
    -- leitura viraria "não sei" com cara de falha do painel.
    ('pct_interagiram',  round(100 * (select interagiram  from ag) / nullif((select pessoas from ag),0), 2)),
    ('pct_clicaram_cta', round(100 * (select clicaram_cta from ag) / nullif((select pessoas from ag),0), 2)),
    ('pct_inscricao',    round(100 * (select n from ins)           / nullif((select pessoas from ag),0), 2))
  ) t(metrica, valor);
$function$;

revoke all on function public.lp_aula_funil(timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.lp_aula_funil(timestamptz, timestamptz, text) to service_role;

-- ─── O REGISTRO DA INTERVENÇÃO ───────────────────────────────────────────────────────
create table if not exists public.intervencao (
  chave        text primary key,
  titulo       text not null,
  hipotese     text not null,          -- o que se acredita que está errado
  mudanca      text not null,          -- o que foi alterado, por extenso
  como_medir   text not null,          -- a chamada EXATA que refaz a medição
  janela_de    timestamptz not null,   -- a janela do "antes"
  janela_ate   timestamptz not null,
  baseline     jsonb not null,         -- saída de lp_aula_funil na janela acima
  externo      jsonb,                  -- números de fora do banco (Meta), com a fonte
  decidido_em  timestamptz not null default now(),
  encerrado_em timestamptz,
  desfecho     text
);
comment on table public.intervencao is
  'Mudanca deliberada com a medicao de ANTES congelada. O "depois" tem de sair da MESMA funcao '
  'nomeada em como_medir — comparar com consulta escrita depois e a forma #10 disfarcada de evolucao.';
alter table public.intervencao enable row level security;
revoke insert, update, delete, truncate on public.intervencao from anon, authenticated;
