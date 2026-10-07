-- CORREÇÃO DE VALOR PELO EDITAL (07/10, pedido do dono: o relatório corrige também valor ERRADO, não
-- só o que falta). Rastro de cada correção: {"valor_minimo": {"de": 1600000, "para": 800000}, "em": ..., "fonte": url}.
-- O coletor (scripts/scraper-puppeteer.mjs, salvarImoveis) lê esta coluna: se a fonte trouxer DE NOVO o
-- mesmo valor errado (`de`), mantém o corrigido; se trouxer um valor DIFERENTE, o site mudou e vence.
alter table public.imoveis_leilao add column if not exists correcao_edital jsonb;
comment on column public.imoveis_leilao.correcao_edital is
  'Valores corrigidos pelo edital ao gerar relatório (de → para). O coletor não regrava o mesmo valor errado por cima.';
