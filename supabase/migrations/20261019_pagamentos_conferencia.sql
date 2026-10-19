-- ─────────────────────────────────────────────────────────────────────────────────────────
-- Pendência 232 (bug bounty 18–19/10): pagamento APROVADO no gateway que o webhook não pode
-- aplicar (valor acima do saldo do honorário/cobrança, ou honorário/cobrança já quitado por
-- outro pagamento — dois boletos vivos, boleto antigo pago depois da reemissão) era descartado:
-- console.error + removerEventoProcessado + 200. Como a resposta é 200 o gateway não reentrega,
-- então desfazer a marca não servia para nada — o dinheiro entrava na conta sem rastro no sistema.
--
-- Agora vai para esta fila de conferência humana (api/_webhook-core.js →
-- registrarPagamentoParaConferir) e o invariante abaixo grita enquanto houver item aberto.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.pagamentos_conferencia (
  id bigint generated always as identity primary key,
  gateway text not null,
  gateway_payment_id text not null,
  referencia text,             -- 'arrematacao:<uuid>' | 'cobranca:<uuid>'
  valor numeric,
  esperado numeric,
  motivo text not null,        -- 'valor_acima_do_saldo' | 'ja_quitado'
  criado_em timestamptz not null default now(),
  conferido_em timestamptz,
  conferido_obs text,
  unique (gateway, gateway_payment_id)
);
alter table public.pagamentos_conferencia enable row level security;
-- Sem política: só service_role (webhooks) lê/escreve; o admin confere pelo SQL/painel.

-- Invariante novo + venda direta das plataformas ARES (Zaccarino/Cunha = mesma plataforma do
-- Shiokawa, que já era exceção: lá a data é o prazo da proposta, não praça).
DO $do$
DECLARE
  src text;
  novo text;
BEGIN
  src := pg_get_functiondef('public.qa_invariantes'::regproc);
  IF position($m$('resultado_leilao_atrasado',$m$ in src) = 0
     OR position($m$fonte not in ('COMPREI', 'SHIOKAWA')$m$ in src) = 0 THEN
    RAISE EXCEPTION 'qa_invariantes(): marcador esperado nao encontrado — revise antes de reaplicar';
  END IF;
  IF position('pagamento_sem_conferencia' in src) > 0 THEN RETURN; END IF;
  novo := replace(src, $m$('resultado_leilao_atrasado',$m$,
    $m$('pagamento_sem_conferencia','Pagamento aprovado no gateway que o webhook nao aplicou (excedente ou ja quitado) aguardando conferencia/devolucao','Financeiro','critico',
       (select count(*) from public.pagamentos_conferencia where conferido_em is null), 0),
     ('resultado_leilao_atrasado',$m$);
  novo := replace(novo, $m$fonte not in ('COMPREI', 'SHIOKAWA')$m$, $m$fonte not in ('COMPREI', 'SHIOKAWA', 'ZACCARINO', 'CUNHA')$m$);
  EXECUTE novo;
END $do$;
