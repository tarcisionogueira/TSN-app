-- ─────────────────────────────────────────────────────────────────────────────────────────
-- O PAINEL DE INVARIANTES PASSA A VIGIAR O PRÓPRIO CUSTO — 25/08/2026
--
-- Companheira de `qa_invariantes_nao_cabia_no_teto_de_8s.sql`. Aquela consertou o defeito de
-- hoje (11,7 s → 3,3 s). Esta existe para que ele não volte em silêncio.
--
-- O QUE FALHOU NÃO FOI SÓ A CONSULTA — foi não haver NADA medindo o custo dela. O invariante
-- que estourou (`pino_generico_como_rua`) foi acrescentado sem que ninguém soubesse quanto
-- custava, e o total cruzou o teto de 8 s do PostgREST sem um número em lugar nenhum. Quem
-- descobriu foi o CLIENTE, com um 500 na tela, e mesmo assim só uma vez em `erros_cliente` —
-- porque o monitor diário, que deveria ter gritado, lia o mesmo RPC e engolia o erro.
--
-- A REGRA que este invariante grava: o painel de corretude tem que caber com folga no teto
-- que o PostgREST impõe. Limite de 5.000 ms = 62% dos 8 s — quando a medição passar disso,
-- ainda sobram 3 s para agir, e o alerta sai no painel E no e-mail do monitor.
--
-- E A PARTE QUE IMPORTA: `9999` quando NÃO HÁ medição, ou quando a última tem mais de 3 dias.
-- Sem isso, parar de medir devolveria "ok" para sempre — a trava mentindo exatamente como o
-- defeito que ela veio vigiar. Vale a mesma escolha do verificador de schema: "não consegui
-- checar" é reprovação, nunca aprovação.
--
-- Quem MEDE é `api/monitor-fontes-cron.js` (seção C4), que já chamava o RPC todo dia — agora
-- cronometra, grava aqui, e reporta como PROBLEMA quando a leitura falha, em vez de concluir
-- que nenhum dos 48 invariantes tem alerta.
-- ─────────────────────────────────────────────────────────────────────────────────────────

create table if not exists public.qa_invariantes_execucao (
  id            bigserial primary key,
  executado_em  timestamptz not null default now(),
  ms            integer     not null,
  ok            boolean     not null default true
);

create index if not exists qa_invariantes_execucao_recente_idx
  on public.qa_invariantes_execucao (executado_em desc);

-- Sem PII, mas RLS ligada por padrão da casa: ninguém lê direto. O painel chega por
-- `admin_qa_invariantes` (SECURITY DEFINER de postgres, dono da tabela) e o monitor por
-- service_role — os dois passam sem policy.
alter table public.qa_invariantes_execucao enable row level security;

comment on table public.qa_invariantes_execucao is
  'Duracao medida de qa_invariantes() a cada rodada do monitor. Alimenta o invariante qa_invariantes_lenta, que compara com o teto de 8s do PostgREST.';

do $do$
declare
  def    text;
  ancora text := '     (''limpeza_encerrados_pulada'',';
  novo   text;
begin
  select pg_get_functiondef(oid) into def from pg_proc where proname = 'qa_invariantes';
  if def is null then
    raise exception 'qa_invariantes nao existe — nada a aplicar';
  end if;

  if position('qa_invariantes_lenta' in def) > 0 then
    raise notice 'ja aplicado — nada a fazer';
    return;
  end if;

  if position(ancora in def) = 0 then
    raise exception 'ancora nao encontrada em qa_invariantes — revise antes de aplicar';
  end if;

  novo :=
'     (''qa_invariantes_lenta'',''Custo do proprio painel de invariantes perto do teto de 8s do PostgREST'',''Infra'',''bug'',
       coalesce((select case when e.executado_em < now() - interval ''3 days'' then 9999 else e.ms end
                   from public.qa_invariantes_execucao e
                  order by e.executado_em desc limit 1), 9999), 5000),
' || ancora;

  execute replace(def, ancora, novo);
  raise notice 'invariante qa_invariantes_lenta adicionado';
end $do$;
