-- ─────────────────────────────────────────────────────────────────────────────────────────
-- O PAINEL DE INVARIANTES PAROU EM 25/08 E O VIGIA DISSE QUE ESTAVA RÁPIDO — 31/08/2026
--
-- MEDIDO, não deduzido. `qa_invariantes_execucao` tem `ok = false` nas quatro últimas
-- rodadas (26, 27, 28 e 29/08). A última rodada em que os 73 invariantes foram de fato
-- avaliados pelo monitor foi **25/08**. Seis dias.
--
-- ── O FURO ────────────────────────────────────────────────────────────────────────────────
-- `qa_invariantes()` é SECURITY INVOKER de propósito (ver qa_invariantes_restaura_search_path.sql:
-- o monitor e o health-check a chamam DIRETO como service_role). Mas o invariante
-- `nome_fontes_divergentes`, acrescentado em 18/08, lê `auth.users` — e `service_role` NÃO
-- tem SELECT nessa tabela. Reproduzido em 31/08 com `set local role service_role`:
--
--     ERROR: 42501: permission denied for table users
--     CONTEXT: SQL function "qa_invariantes" statement 1
--
-- A falha é na PRIMEIRA instrução, então NENHUM invariante roda. E é rápida — 167 ms.
--
-- Por que ninguém viu: a aba /admin usa `admin_qa_invariantes()`, que é SECURITY DEFINER de
-- postgres e portanto ENXERGA `auth.users`. A tela do dono continuou correta. Só o caminho
-- automático — o que roda sozinho todo dia — estava morto.
--
-- ── O VIGIA QUE ESCONDEU (a forma #10, dentro do vigia) ────────────────────────────────────
-- `qa_invariantes_lenta` existe desde 25/08 exatamente para que este painel não pare em
-- silêncio. Ele lê a coluna `ms` da última execução e compara com 5.000. Só que `ms` é
-- cronometrado em volta da chamada, dê ela certo ou errado — e uma chamada que FALHA volta
-- em 167 ms. O vigia leu 167, comparou com 5.000 e respondeu **'ok'**.
--
-- O número existia, era plausível, e media outra coisa: o tempo até o erro, reportado como
-- custo do painel. A coluna `ok` estava lá, gravada corretamente, e o invariante não a
-- consultava. Custo real medido hoje, server-side: **3.093 ms** — 15× o que o vigia reportava.
--
-- ── OS DOIS CONSERTOS ─────────────────────────────────────────────────────────────────────
-- 1. `nome_fontes_divergentes` passa a delegar a um helper SECURITY DEFINER, o mesmo padrão
--    que ~15 outros invariantes já usam (`qa_invariante_*`). NÃO damos SELECT em `auth.users`
--    para service_role: ampliar privilégio na tabela mais sensível do banco para consertar um
--    painel seria pagar caro demais. O helper lê uma contagem e devolve um número.
-- 2. `qa_invariantes_lenta` passa a reprovar quando a última rodada FALHOU — mesma regra que
--    ele já aplica para medição velha, e a mesma do `verificar:schema`: "não consegui checar"
--    reprova, nunca aprova. O título passa a nomear as três condições, senão o dono lê 9999 e
--    entende "está lento" quando o fato é "não rodou".
--
-- REGRA PARA O FUTURO (reforça a de 22/08): invariante novo que leia fora de `public` —
-- `auth.*` em especial — tem de entrar por helper SECURITY DEFINER. `qa_invariantes` roda
-- como service_role no caminho que importa, e service_role não enxerga `auth`.
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- 1) Helper SECURITY DEFINER para o único invariante que lê auth.users.
create or replace function public.qa_invariante_nome_fontes_divergentes()
returns bigint
language sql
stable
security definer
set search_path to 'public'
as $$
  select count(*)::bigint
    from public.perfis p
    join auth.users u on u.id = p.id
   where u.raw_user_meta_data->>'nome' is not null
     and p.nome is distinct from u.raw_user_meta_data->>'nome';
$$;

alter function public.qa_invariante_nome_fontes_divergentes() owner to postgres;
revoke execute on function public.qa_invariante_nome_fontes_divergentes() from public, anon;
grant execute on function public.qa_invariante_nome_fontes_divergentes() to service_role, authenticated;

comment on function public.qa_invariante_nome_fontes_divergentes() is
  'Conta clientes com nome divergente entre perfis e auth.users. SECURITY DEFINER porque service_role nao le auth.users — sem isto qa_invariantes() inteira falha com 42501 (achado de 31/08).';

-- 2) Cirurgia de string em qa_invariantes(): troca a leitura direta de auth.users pelo helper
--    e ensina o vigia a honrar a coluna `ok`. Falha alto se as âncoras não existirem — aplicar
--    uma migração que não achou o que ia trocar seria o mesmo defeito que ela vem consertar.
do $do$
declare
  def       text;
  corpo     text;
  ancora_a  text := 'select count(*) from perfis p join auth.users u on u.id = p.id';
  ancora_b  text := 'from public.qa_invariantes_execucao e';
  velho_a   text;
  novo_a    text;
  velho_b   text;
  novo_b    text;
begin
  select prosrc into corpo from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'qa_invariantes';
  if corpo is null then
    raise exception 'qa_invariantes nao existe — nada a aplicar';
  end if;

  -- (a) auth.users → helper
  velho_a := '(select count(*) from perfis p join auth.users u on u.id = p.id' || e'\n' ||
             '         where u.raw_user_meta_data->>''nome'' is not null' || e'\n' ||
             '           and p.nome is distinct from u.raw_user_meta_data->>''nome'')';
  novo_a  := 'public.qa_invariante_nome_fontes_divergentes()';

  if position(ancora_a in corpo) = 0 then
    if position(novo_a in corpo) > 0 then
      raise notice '(a) ja aplicado';
    else
      raise exception '(a) ancora nao encontrada em qa_invariantes — NAO aplico as cegas';
    end if;
  elsif position(velho_a in corpo) = 0 then
    raise exception '(a) ancora presente mas o trecho completo nao casou — o corpo mudou, revise a mao';
  else
    corpo := replace(corpo, velho_a, novo_a);
  end if;

  -- (b) o vigia passa a reprovar rodada que FALHOU
  velho_b := 'coalesce((select case when e.executado_em < now() - interval ''3 days'' then 9999 else e.ms end' || e'\n' ||
             '                   from public.qa_invariantes_execucao e' || e'\n' ||
             '                  order by e.executado_em desc limit 1), 9999)';
  novo_b  := 'coalesce((select case when e.executado_em < now() - interval ''3 days'' then 9999' || e'\n' ||
             '                      when not e.ok then 9999' || e'\n' ||
             '                      else e.ms end' || e'\n' ||
             '                   from public.qa_invariantes_execucao e' || e'\n' ||
             '                  order by e.executado_em desc limit 1), 9999)';

  if position(ancora_b in corpo) = 0 then
    raise exception '(b) qa_invariantes_lenta nao encontrado — NAO aplico as cegas';
  elsif position('when not e.ok then 9999' in corpo) > 0 then
    raise notice '(b) ja aplicado';
  elsif position(velho_b in corpo) = 0 then
    raise exception '(b) trecho do vigia nao casou — o corpo mudou, revise a mao';
  else
    corpo := replace(corpo, velho_b, novo_b);
    -- o titulo tem de dizer o que o 9999 significa nas TRES condicoes
    corpo := replace(corpo,
      '''qa_invariantes_lenta'',''Custo do proprio painel de invariantes perto do teto de 8s do PostgREST''',
      '''qa_invariantes_lenta'',''Painel de invariantes: ultima rodada FALHOU, sumiu ha 3+ dias, ou passou de 5s (teto do PostgREST e 8s)''');
  end if;

  -- `set search_path to 'public'` REEMITIDO — a regra de 22/08: prosrc guarda so o corpo, e
  -- recriar sem esta clausula deixa proconfig nulo e quebra a chamada via definer.
  def := 'create or replace function public.qa_invariantes()' || e'\n' ||
         ' returns table(chave text, titulo text, categoria text, gravidade text, valor bigint, limite bigint, status text)' || e'\n' ||
         ' language sql stable set search_path to ''public'' as $corpo$' || corpo || '$corpo$';
  execute def;
end
$do$;

alter function public.qa_invariantes() owner to postgres;
revoke execute on function public.qa_invariantes() from public, anon;
grant execute on function public.qa_invariantes() to service_role;
