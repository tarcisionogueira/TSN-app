-- 17/09, pedido do dono: permitir pagar PARTE no Pix e o RESTO no cartão, numa única sessão
-- do link (honorário de êxito OU cobrança avulsa) — quem abre o link digita quanto quer pagar
-- de Pix agora, paga, e ao compensar o sistema libera o formulário de cartão pro saldo.
--
-- 'pix_mp' é um método NOVO em honorarios_recebimentos: o Pix pago PELO PRÓPRIO LINK (via
-- api/mp-checkout.js), diferente de 'pix_externo' (recebido fora do sistema, registrado
-- manualmente pelo admin). Até aqui o webhook gravava TUDO que vinha do link como 'cartao_mp'
-- mesmo quando era Pix — rótulo errado desde que honorário em partes existe; corrigido junto.
alter table public.honorarios_recebimentos drop constraint if exists honorarios_recebimentos_metodo_check;
alter table public.honorarios_recebimentos add constraint honorarios_recebimentos_metodo_check
  check (metodo in ('pix_externo','pix_mp','cheque','cartao_mp','dinheiro','transferencia'));

-- Cobrança avulsa não tem ledger de partes (é um objeto simples, sem registro manual de
-- admin) — só precisa saber quanto do Pix parcial já entrou, pra saber o saldo do cartão.
alter table public.cobrancas_avulsas
  add column if not exists valor_pago_pix numeric(15,2) not null default 0;
