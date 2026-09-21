-- Monitoramento do prazo REAL de liberação do dinheiro no Mercado Pago (21/09, pedido do
-- dono: "confirma com as mensalidades que está liberando quase imediato").
--
-- O MP já manda o campo `money_release_date` em CADA pagamento (data em que o valor fica
-- disponível pra saque/uso) — e já estava sendo gravado o tempo todo dentro de
-- `mp_pagamentos.dados_mp` (JSONB cru), só ninguém tinha comparado com `date_approved`.
-- Comparação em 15 pagamentos reais (avulso + recorrente, jul-set/2026): diferença de 0h em
-- TODOS — o MP libera na hora da aprovação, não em D+30. O `config_financeira.
-- prazo_recebimento_dias = 30` pro MP era um valor GENÉRICO (copiado do padrão de mercado),
-- nunca medido contra o que a conta de verdade faz — corrigido abaixo pra refletir o real.

update config_financeira set prazo_recebimento_dias = 0, atualizado_em = now()
where gateway = 'mp';

-- Função de diagnóstico — qualquer sessão futura roda isso pra reconferir o prazo real
-- (não precisa reler HANDOFF pra saber o número, a função MEDE toda vez que é chamada).
create or replace function public.mp_prazo_liberacao_diagnostico()
returns table (
  amostras bigint,
  media_horas numeric,
  maximo_horas numeric,
  pagamentos_atrasados bigint,
  ultima_medicao timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    count(*),
    round(avg(extract(epoch from ((dados_mp->>'money_release_date')::timestamptz - (dados_mp->>'date_approved')::timestamptz)) / 3600.0)::numeric, 2),
    round(max(extract(epoch from ((dados_mp->>'money_release_date')::timestamptz - (dados_mp->>'date_approved')::timestamptz)) / 3600.0)::numeric, 2),
    count(*) filter (where ((dados_mp->>'money_release_date')::timestamptz - (dados_mp->>'date_approved')::timestamptz) > interval '1 day'),
    max(criado_em)
  from mp_pagamentos
  where status = 'approved'
    and dados_mp ? 'money_release_date'
    and dados_mp ? 'date_approved'
    and criado_em > now() - interval '90 days';
$$;

revoke all on function public.mp_prazo_liberacao_diagnostico() from public, anon, authenticated;
grant execute on function public.mp_prazo_liberacao_diagnostico() to service_role;

-- Invariante nova em qa_invariantes(): se o MP algum dia passar a segurar dinheiro por mais
-- de 1 dia (mudança de política de risco pra esta conta, por exemplo), isso é uma mudança de
-- comportamento real que merece alerta — não é hipotético, é monitorar o que já sabemos que É
-- 0h hoje e detectar se um dia deixar de ser.
--
-- Inserida via replace no corpo da função (não um CREATE OR REPLACE reescrevendo tudo à mão):
-- qa_invariantes() já tem ~60 invariantes acumuladas ao longo de meses — retranscrever a
-- função inteira à mão pra acrescentar 1 linha é o tipo de transcrição longa e repetitiva
-- onde um erro de escape/aspas passa despercebido. Deixar o próprio Postgres fazer a edição
-- (ele já tem o texto exato) elimina esse risco. `IF position(...) = 0 THEN RAISE EXCEPTION`
-- garante que a migração FALHA (não aplica silenciosamente metade) se o marcador não bater —
-- por exemplo, se `qa_invariantes()` mudou desde que este arquivo foi escrito.
DO $do$
DECLARE
  src text;
  novo text;
  marcador_velho text := 'qa_invariante_editais_cruzamento_cego(), 0)' || chr(10) || '  )';
  marcador_novo text := 'qa_invariante_editais_cruzamento_cego(), 0),' || chr(10)
    || '     (''mp_liberacao_atrasada'',''Pagamento MP aprovado com liberacao de dinheiro atrasada (>1 dia) vs. padrao observado de 0h (achado 21/09)'',''Financeiro'',''critico'',' || chr(10)
    || '       (select count(*) from mp_pagamentos where status=''approved'' and dados_mp ? ''money_release_date'' and dados_mp ? ''date_approved'' and criado_em > now() - interval ''30 days'' and ((dados_mp->>''money_release_date'')::timestamptz - (dados_mp->>''date_approved'')::timestamptz) > interval ''1 day''), 0)' || chr(10)
    || '  )';
BEGIN
  src := pg_get_functiondef('public.qa_invariantes'::regproc);
  IF position(marcador_velho in src) = 0 THEN
    RAISE EXCEPTION 'qa_invariantes(): marcador esperado nao encontrado — funcao mudou desde que esta migracao foi escrita, revise antes de reaplicar';
  END IF;
  novo := replace(src, marcador_velho, marcador_novo);
  EXECUTE novo;
END $do$;
