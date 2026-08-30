-- 29/08 — O CANAL DE ERRO QUE NINGUÉM VIGIAVA ERA JUSTAMENTE O QUE O CLIENTE ENXERGA
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- O bloqueio do botão "Solicitar" (ver `analise_jobs_o_participante_precisa_LER_o_que_escreveu`)
-- ficou **6 dias** no ar sem um alarme, com dois pagantes batendo nele. O motivo não é que
-- faltava registro — o registro existia, no canal errado. São DOIS, e só um é vigiado:
--
--   `erros_cliente`                  exceção NÃO tratada / resposta ruim de API.
--                                    Tem `resolvido`, dedup por fingerprint, e é lido pelo
--                                    360, pelo health-check e pelo ritual de abertura.
--
--   `eventos_atividade` tipo erro_ui erro TRATADO, que virou mensagem NA TELA, carimbado
--                                    com o rótulo do clique (tracker.js). Ninguém alerta.
--
-- O erro de RLS foi capturado pelo `Caso.jsx` e mostrado ao usuário — então caiu no segundo
-- canal. Resultado: o 360 informava `erros_invisiveis_7d: 0` **enquanto três falhas que o
-- cliente viu com os próprios olhos** estavam registradas, com nome de botão e tudo.
--
-- A inversão é o ponto: o canal com MENOS vigilância é o que contém os erros de MAIOR
-- consequência — o cliente não só foi afetado, ele VIU. Um `erro_ui` nunca é ruído de
-- browser: é alguém que clicou num botão e recebeu um "não".
--
-- Janela de 7 dias, como o `alerta_acima_do_capital`: `eventos_atividade` não tem coluna
-- de resolução, então o invariante se limpa sozinho conforme o evento envelhece — em vez
-- de exigir uma máquina de baixa que a tabela não tem.
--
-- `role = 'admin'` fica de fora DE PROPÓSITO: o alvo aqui é falha que atinge CLIENTE. O
-- timeout do /admin (23/08) é conhecido, está no HANDOFF como vigiado, e deixá-lo aqui
-- faria o alarme nascer vermelho por um item já decidido — que é como alarme vira ruído.
create or replace function public.qa_invariante_erro_na_tela_do_cliente()
returns bigint language sql stable set search_path to 'public' as $$
  select count(*)::bigint from public.eventos_atividade
   where tipo = 'erro_ui'
     and criado_em > now() - interval '7 days'
     and coalesce(role, '') <> 'admin';
$$;

do $do$
declare d text; alvo text; novo text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'qa_invariantes';
  alvo := E'where i.ativo and not exists (select 1 from fonte_saude s where s.fonte = i.fonte)) c), 0)';
  if position(alvo in d) = 0 then raise exception 'ancora nao encontrada em qa_invariantes()'; end if;
  if position('erro_na_tela_do_cliente' in d) > 0 then raise notice 'ja registrado'; return; end if;
  novo := alvo || E',\n     (''erro_na_tela_do_cliente'',''Cliente clicou e recebeu erro NA TELA (eventos_atividade.erro_ui) — canal fora do erros_cliente'',''Atendimento'',''bug'',\n       public.qa_invariante_erro_na_tela_do_cliente(), 0)';
  execute replace(d, alvo, novo);
end $do$;
