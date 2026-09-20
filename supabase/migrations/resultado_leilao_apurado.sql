-- RESULTADO REAL DO LEILÃO (com lance × sem lance), apurado no site do leiloeiro ao final do
-- dia do encerramento (pedido do dono, 20/09): aprender quais praças são mais disputadas e,
-- sobretudo, identificar os lotes SEM lance para propor compra direta ao leiloeiro. Nenhuma
-- fonte publica isso na coleta em massa (scraper geral só lê a LISTAGEM) — por isso a apuração
-- revisita a PÁGINA DO PRÓPRIO LOTE, à parte da coleta diária, e cada fonte apresenta o
-- resultado de um jeito ("vendido", "sem licitantes", "não vendido", valor do lance vencedor
-- quando publicado). Ver `api/_resultado-leilao.js` (leitura) e
-- `api/apurar-resultado-leilao-cron.js` (disparo diário).
--
-- `resultado_leilao` fica NULL até a apuração rodar OU quando ela roda e não consegue ler nada
-- de confiável na página — "não consegui verificar" é um valor DISTINTO de "sem lance" (mesma
-- cautela já aplicada em outras auditorias desta base: nunca tratar ausência de leitura como
-- resposta negativa).
alter table public.imoveis_leilao
  add column if not exists resultado_leilao text,               -- 'vendido' | 'sem_lance' | 'indeterminado' | null (ainda não apurado)
  add column if not exists valor_lance_vencedor numeric,         -- valor do lance/arremate lido na página, quando o leiloeiro publica
  add column if not exists resultado_apurado_em timestamptz,     -- quando a apuração rodou de fato (mesmo quando indeterminado)
  add column if not exists resultado_apuracao_tentativas int not null default 0;

comment on column public.imoveis_leilao.resultado_leilao is
  'Resultado apurado na página do lote após o leilão encerrar: vendido | sem_lance | indeterminado (apurado mas a página não deu sinal confiável) | NULL (ainda não apurado). Nunca inferido — só gravado quando a página do leiloeiro afirma.';
comment on column public.imoveis_leilao.resultado_apuracao_tentativas is
  'Quantas vezes a apuração já tentou ler esta página (teto de retentativas no cron — evita martelar a fonte por um lote cuja página nunca resolve).';

-- Índice pro cron diário selecionar rápido "o que encerra/encerrou nos últimos dias e ainda não
-- foi apurado" sem varrer a tabela inteira.
create index if not exists idx_imoveis_leilao_apuracao_pendente
  on public.imoveis_leilao (data_fim)
  where resultado_leilao is null;
