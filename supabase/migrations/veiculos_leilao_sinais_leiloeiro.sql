-- Sinistro/motor/documentação/pagamento do PILOTO de veículos (11/09) — o dono corrigiu a
-- avaliação anterior de "não temos como obter isso hoje": o leiloeiro (Sodré) já informa tudo
-- isso, só não estava sendo lido. Confirmado em dado REAL já capturado: `raw` (a resposta
-- inteira da API, guardada desde o início) tem `lot_sinister` ("média monta"/"pequena monta"),
-- `lot_is_scrap` (sucata — vendida sem ATPV-E, só certificado de baixa), `lot_status_financeable`
-- (financiável ou não), `lot_fuel`, `lot_transmission`, `lot_color`, `lot_optionals`. Motor e
-- situação de IPVA não têm campo próprio — vêm de regex sobre a descrição (que já traz "Motor:
-- Danificado", "IPVA 2026 PAGO" etc., em lista própria do leiloeiro).
alter table public.veiculos_leilao
  add column if not exists sinistro       text,     -- ex.: "média monta", "pequena monta" (direto de lot_sinister)
  add column if not exists is_sucata      boolean,  -- vendido sem ATPV-E (só certificado de baixa) — de lot_is_scrap
  add column if not exists financiavel    boolean,  -- de lot_status_financeable
  add column if not exists combustivel    text,
  add column if not exists cambio         text,
  add column if not exists cor            text,
  add column if not exists opcionais      jsonb,
  add column if not exists motor_alerta   boolean,  -- true = achou sinal de dano no texto; null = sem menção (NUNCA "false" = confirmado ok)
  add column if not exists ipva_situacao  text;

-- ── CONSERTO DO BUG DE DOUBLE-ENCODING (retroativo) ────────────────────────────────────────
-- `fotos`/`raw` eram gravados com `JSON.stringify()` numa coluna jsonb — o supabase-js já
-- serializa sozinho, então isso guardava uma STRING dentro do jsonb em vez do array/objeto.
-- Toda leitura no cliente (`Array.isArray(fotos)`) via `.filter/.map` recebia string, nunca
-- array: as fotos dos 70 lotes já capturados nunca apareciam. Corrige o que já está gravado;
-- o código do scraper (scripts/scraper-puppeteer.mjs) já para de cometer o erro daqui pra frente.
update public.veiculos_leilao
   set fotos = (fotos #>> '{}')::jsonb
 where jsonb_typeof(fotos) = 'string';
update public.veiculos_leilao
   set raw = (raw #>> '{}')::jsonb
 where jsonb_typeof(raw) = 'string';

-- Backfill dos novos campos a partir do `raw` já corrigido acima — sem isto, o admin só veria
-- sinistro/sucata/financiável a partir da PRÓXIMA coleta; os 70 já capturados ficam completos
-- imediatamente.
update public.veiculos_leilao
   set sinistro    = raw->>'lot_sinister',
       is_sucata   = case when raw ? 'lot_is_scrap' then (raw->>'lot_is_scrap')::boolean else null end,
       financiavel = case when raw ? 'lot_status_financeable' then (raw->>'lot_status_financeable')::boolean else null end,
       combustivel = raw->>'lot_fuel',
       cambio      = raw->>'lot_transmission',
       cor         = raw->>'lot_color',
       opcionais   = raw->'lot_optionals'
 where raw is not null and jsonb_typeof(raw) = 'object';

update public.veiculos_leilao
   set motor_alerta  = case when descricao ~* '\mmotor\M[^.]{0,25}\m(danificad|incomplet|ausente|substitu[íi]d)' then true else null end,
       ipva_situacao = upper((regexp_match(descricao, 'IPVA\s*\d{0,4}\s*(PAGO|ATRASADO|EM ABERTO|PENDENTE|N[ÃA]O PAGO)', 'i'))[1])
 where descricao is not null;
