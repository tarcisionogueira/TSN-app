-- ============================================================================
-- O PAINEL RESSUSCITOU — e o vigia dele ainda não sabe DE QUEM é o tempo (31/08)
--
-- MEDIDO, não deduzido:
--   • `qa_invariantes_execucao` gravou **`ok = true` em 31/08 15:03**, a primeira
--     rodada bem-sucedida desde 25/08. O conserto da manhã (helper SECURITY
--     DEFINER para `nome_fontes_divergentes`) funcionou — o painel voltou.
--   • Mas a rodada levou **7.109 ms** e o limite é 5.000, então o invariante
--     `qa_invariantes_lenta` acusa.
--   • Cronometrado NO SERVIDOR, duas vezes, sob os dois papéis:
--     `postgres` 3.135 ms · `service_role` 3.079 ms, 73 linhas.
--
-- Ou seja: **~4 s dos 7,1 s não são o painel.** São o percurso — handshake,
-- pooler, PostgREST, volta. E o invariante chama os 7,1 s de "painel passou de
-- 5s", que é a **forma #10**: o número existe, é plausível, e leva quem for
-- agir a otimizar invariante (3,1 s) deixando intacta a metade maior do tempo.
--
-- ⚠️ O QUE EU **NÃO** SEI, e por isso não conserto no escuro: se esses ~4 s são
-- crônicos ou foram de hoje. Só existe **uma** amostra bem-sucedida depois do
-- conserto, e a anterior comparável (25/08, 3.259 ms ponta a ponta) não tem
-- medição de servidor para comparar. Chutar aqui seria repetir o defeito que
-- esta migração existe para corrigir.
--
-- ENTÃO O CONSERTO É NO INSTRUMENTO, não no palpite: passar a gravar os DOIS
-- números, para que a próxima rodada responda sozinha qual metade se moveu.
--   • `ms`          continua sendo ponta a ponta (é o que arrisca estourar o
--                   teto de 8s do PostgREST — essa parte do título era certa).
--   • `ms_servidor` passa a ser o custo do painel em si.
-- O invariante julga `coalesce(ms_servidor, ms)`: com a medição nova ele fala
-- do PAINEL; sem ela (linhas antigas) cai no comportamento de hoje em vez de
-- ficar cego. E o título para de prometer o que ele não distinguia.
-- ============================================================================

alter table public.qa_invariantes_execucao
  add column if not exists ms_servidor int;

comment on column public.qa_invariantes_execucao.ms_servidor is
  'Custo do painel cronometrado DENTRO do banco (clock_timestamp em volta da chamada). '
  'Difere de `ms`, que é ponta a ponta e inclui rede/pooler/PostgREST. A diferença entre '
  'os dois é o percurso — em 31/08 era ~4s de 7,1s. Nulo nas linhas anteriores a 31/08.';

-- Painel + o próprio cronômetro, numa ida só. NÃO grava: quem grava continua
-- sendo o monitor, para não existirem dois escritores da mesma linha.
create or replace function public.qa_invariantes_medido()
returns table (
  chave text, titulo text, categoria text, gravidade text,
  valor bigint, limite bigint, status text, ms_servidor bigint
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  t0    timestamptz := clock_timestamp();
  dados jsonb;
  m     bigint;
begin
  -- Materializa ANTES de parar o cronômetro. Sem isso, `clock_timestamp()` no
  -- SELECT seria avaliado a cada linha entregue e mediria o consumo do chamador
  -- junto com o do painel — o mesmo erro de escopo que se está consertando.
  select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) into dados
    from public.qa_invariantes() q;
  m := round(extract(epoch from clock_timestamp() - t0) * 1000);

  return query
    select x.chave, x.titulo, x.categoria, x.gravidade, x.valor, x.limite, x.status, m
      from jsonb_to_recordset(dados) as x(
        chave text, titulo text, categoria text, gravidade text,
        valor bigint, limite bigint, status text);
end $$;

-- Só o monitor chama. Revogar dos TRÊS: o Supabase concede EXECUTE a `anon` e
-- `authenticated` por default privilege em toda função nova de `public`, e
-- `revoke ... from public` sozinho NÃO tira grant de papel (aprendido duas
-- vezes hoje, nos dois sentidos). Confira em `pg_proc.proacl` depois de aplicar.
revoke all on function public.qa_invariantes_medido() from public, anon, authenticated;
grant execute on function public.qa_invariantes_medido() to service_role;

-- ─── O invariante passa a julgar o PAINEL, não o percurso ────────────────────
-- Reescrita por substituição de texto sobre `pg_get_functiondef`, o mesmo padrão
-- de `o_painel_de_invariantes_parou_e_o_vigia_disse_que_estava_rapido.sql`, e com
-- a mesma exigência: se a âncora não for encontrada, ABORTA. Um replace que não
-- substitui nada não dá erro, e é assim que o conserto vira silêncio.
do $mig$
declare
  def        text := pg_get_functiondef('public.qa_invariantes()'::regprocedure);
  titulo_de  text := 'Painel de invariantes: ultima rodada FALHOU, sumiu ha 3+ dias, ou passou de 5s (teto do PostgREST e 8s)';
  titulo_para text := 'Painel de invariantes: ultima rodada FALHOU, sumiu ha 3+ dias, ou o PAINEL (nao a rede) passou de 5s';
  medida_de  text := 'else e.ms end';
  medida_para text := 'else coalesce(e.ms_servidor, e.ms) end';
begin
  -- Exigir occorrencia UNICA, nao "pelo menos uma": `replace` troca TODAS, e uma
  -- ancora que aparecesse duas vezes reescreveria um invariante vizinho em
  -- silencio. Conferido antes de aplicar: 1 e 1.
  if (length(def) - length(replace(def, titulo_de, ''))) / length(titulo_de) <> 1 then
    raise exception 'ancora do TITULO nao aparece EXATAMENTE 1x em qa_invariantes() — nada foi alterado';
  end if;
  if (length(def) - length(replace(def, medida_de, ''))) / length(medida_de) <> 1 then
    raise exception 'ancora da MEDIDA nao aparece EXATAMENTE 1x em qa_invariantes() — nada foi alterado';
  end if;
  def := replace(def, titulo_de, titulo_para);
  def := replace(def, medida_de, medida_para);
  execute def;
end $mig$;
