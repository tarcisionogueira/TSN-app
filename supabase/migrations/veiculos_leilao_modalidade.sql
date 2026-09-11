-- Pedido do dono (11/09): modalidade (judicial/extrajudicial) pros veículos, igual já existe
-- pros imóveis. NUNCA deixa em aberto/nulo — quando o leiloeiro não informa, grava
-- 'nao_identificado' explícito (mesmo princípio de `classificarPatio()`: estado sem sinal
-- claro é um ESTADO, não ausência de linha) — assim nenhum lote fica de fora da listagem
-- por falta desse dado.
--
-- SODRE tem sinal REAL por lote: `raw->>'lot_is_judicial'` é campo PRÓPRIO da API (achado
-- ao investigar este pedido, lote real: "lot_is_judicial": false) — nada de regex sobre
-- texto solto, que já mordeu esta base antes (SOLEON, 11/09 mais cedo). SUPORTE não visita
-- página de detalhe do veículo (só a listagem leve) e não tem esse sinal capturado hoje —
-- fica 'nao_identificado' até, se o dono quiser, o scraper passar a visitar o detalhe.
alter table public.veiculos_leilao add column if not exists modalidade text
  check (modalidade in ('judicial','extrajudicial','nao_identificado'));

update public.veiculos_leilao
set modalidade = case
  when fonte = 'SODRE' and raw->>'lot_is_judicial' = 'true' then 'judicial'
  when fonte = 'SODRE' and raw->>'lot_is_judicial' = 'false' then 'extrajudicial'
  else 'nao_identificado'
end
where modalidade is null;
