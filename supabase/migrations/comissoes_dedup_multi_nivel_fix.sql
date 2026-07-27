-- Fix (motor de comissão de rede) — bug SILENCIOSO de pagamento.
-- O índice único de `comissoes` era coarse demais: idx_comissoes_gateway_payment em
-- (gateway_payment_id, origem). Como o RPC distribuir_comissao_rede grava `origem = p_tipo`
-- (CONSTANTE por pagamento) e insere UMA linha por nível da rede + UMA do bônus infinito, o
-- 2º insert (nível 2+, ou infinito das faixas de liderança) violava a unicidade → a função
-- plpgsql abortava SEM handler → rollback de TUDO (inclusive o nível 1 já inserido) → e o
-- chamador engolia o erro. Resultado: assim que um pagamento gerasse >1 lançamento, NENHUMA
-- comissão era paga, sem alerta. Dormente hoje (todos os ranks são r1/max_nivel=1/infinito=0),
-- quebraria na 1ª promoção de parceiro. Regrain para o grão REAL de uma comissão:
-- (pagamento, beneficiário, tipo) — 1 linha por destinatário e nível (rede_nN / infinito).
-- Sem duplicatas atuais (verificado). Mais permissivo que o antigo → não quebra inserts de 1 linha.
drop index if exists public.idx_comissoes_gateway_payment;
create unique index idx_comissoes_gateway_payment
  on public.comissoes (gateway_payment_id, beneficiario_id, tipo)
  where gateway_payment_id is not null;

-- Idempotência de BANCO para comissao_rede/comissao_infinito. Antes só existia
-- uq_saldo_credito_origem (honorario_exito/comissao_venda), deixando a comissão de rede sem
-- trava única — a idempotência dependia só do `not exists (origem_id)` do RPC (sem proteção de
-- concorrência). origem_id já codifica pagamento+nível (`{payment}-nN` / `{payment}-infN`), único.
create unique index if not exists uq_saldo_comissao_rede_origem
  on public.saldo_lancamentos (origem_id)
  where tipo in ('comissao_rede','comissao_infinito') and origem_id is not null;
