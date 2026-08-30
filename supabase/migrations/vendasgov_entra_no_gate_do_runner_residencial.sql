-- ─────────────────────────────────────────────────────────────────────────────────────────
-- VENDASGOV NÃO ESTAVA NO GATE — e por isso seria pulada PARA SEMPRE, em silêncio — 29/08
--
-- Defeito meu, na mesma sessão: adicionei `rodar VENDASGOV` ao `runner-residencial.sh` e NÃO
-- registrei a fonte em `coleta_cliente`. `coleta_cliente_claim` faz
--     select ... where fonte = p_fonte and ativo;  if not found then return false;
-- ou seja, fonte desconhecida é recusada exatamente como fonte fora da janela — e o CLI imprime
-- a MESMA frase para os dois casos:
--     [gate] VENDASGOV: NÃO é a hora (2x/semana) ou já em curso — pulando
-- No log do dono isso apareceu no meio de cinco linhas idênticas de fontes realmente em janela,
-- indistinguível delas. A migração para o residencial teria ficado "feita" e nunca rodado.
--
-- `fontes_acervo` é o que `coleta_cliente_concluir` usa para exigir PROVA de gravação antes de
-- fechar a janela (migração `coleta_gate_concluir_exige_prova.sql`). Sem ele o carimbo sairia
-- sem conferir nada — que é o defeito que aquela migração existe para impedir.
--
-- `ultima_em` nulo de propósito: a fonte fica claimável na PRÓXIMA rodada, que é o teste que
-- interessa (ela colhe zero desde 15/08 e precisa ser exercitada de um IP residencial).
-- ─────────────────────────────────────────────────────────────────────────────────────────
insert into public.coleta_cliente (fonte, intervalo_horas, ativo, fontes_acervo, ultima_em, tentativa_em)
values ('VENDASGOV', 72, true, array['VENDASGOV'], null, null)
on conflict (fonte) do update
  set ativo = true, intervalo_horas = 72, fontes_acervo = array['VENDASGOV'];
