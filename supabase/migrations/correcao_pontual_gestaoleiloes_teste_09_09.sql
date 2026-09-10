-- CORREÇÃO PONTUAL DE DADO HISTÓRICO (10/09) — não é estrutural, seguro pular num rebuild
-- do zero (o WHERE não casa nenhuma linha nova; vira no-op).
--
-- A ÚNICA linha já contaminada pelo incidente descrito em `escopo_reduzido_nao_e_baseline.sql`:
-- o teste pontual de 09/09 (1 dos 5 domínios do cluster, GESTAO_MAX_EVENTOS=2) que
-- `registrarSaude` gravou como `estrategia='principal', status='degradado', total=1` — igual a
-- uma medição de produção de verdade. Sem esta correção, `fonte_regressao_suspeita()`
-- continuaria acusando GESTAOLEILOES por até 7 dias (até o freio residencial liberar o próximo
-- cron de escopo cheio, quinta 17/09), mesmo já com o código e as funções SQL corrigidos —
-- as duas só passam a IGNORAR linhas que JÁ CARREGAM o sufixo a partir de agora.
--
-- Identificada por id EXATO (não por fonte+data, que poderia casar outras linhas no futuro) e
-- travada por 4 condições adicionais (fonte, estrategia atual, total, timestamp ao milissegundo)
-- — só pode afetar a linha 1536, e só enquanto ela ainda estiver exatamente como foi gravada.
update public.fonte_saude
   set estrategia = 'principal-escopo-reduzido'
 where id = 1536
   and fonte = 'GESTAOLEILOES'
   and estrategia = 'principal'
   and total = 1
   and executado_em = '2026-09-09 10:52:10.262148+00';
