-- Corrige `mp_pagamentos.criado_em` para linhas descobertas pelo backfill semanal
-- (api/backfill-mp-pagamentos-cron.js), cujo upsert nunca gravava esta coluna — caía no
-- default da tabela (now(), a hora do BACKFILL), não a data real do pagamento.
--
-- Achado investigando "impressão de fluxo reduzido" do dono (10/09): agrupar pagamentos por
-- `criado_em` mostrava 36 aprovados na semana de 27/07 (R$ 4.117,50) caindo para 1-6/semana
-- depois — um "colapso" de ~95%. Cruzando com a data REAL dentro de `dados_mp` (o próprio
-- JSON que o Mercado Pago devolve), os 36 pagamentos daquela "semana" tinham `date_created`
-- espalhado de 26/06 a 01/08 — 5 semanas de histórico que o backfill descobriu tudo de uma vez
-- (rodou pela 1ª vez em 01-02/08) e carimbou com a mesma data. O "colapso" nunca existiu; era
-- o instrumento medindo "quando o backfill viu" e reportando como "quando o cliente pagou" —
-- a forma nº10 do CLAUDE.md, desta vez sobre dado financeiro.
--
-- `date_approved` (quando o dinheiro de fato confirmou) tem prioridade sobre `date_created`
-- (quando a tentativa começou) — é o que importa para "quando entrou dinheiro". Só corrige
-- onde `dados_mp` já tem uma das duas datas E ela diverge do que está gravado; pagamento sem
-- nenhuma das duas (não deveria existir, mas por segurança) fica como está.
update public.mp_pagamentos
   set criado_em = coalesce((dados_mp->>'date_approved')::timestamptz, (dados_mp->>'date_created')::timestamptz)
 where dados_mp is not null
   and coalesce((dados_mp->>'date_approved')::timestamptz, (dados_mp->>'date_created')::timestamptz) is not null
   and criado_em <> coalesce((dados_mp->>'date_approved')::timestamptz, (dados_mp->>'date_created')::timestamptz);
