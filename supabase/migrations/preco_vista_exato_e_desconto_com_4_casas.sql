-- 02/09, pedido do dono: "quero 5 mil e 50 mil a vista" — e o percentual nao conseguia
-- expressar isso. 5.000 sobre 6.000 e um desconto de 16,666...%, e `desconto_vista_pct`
-- era numeric(5,2): o banco truncava para 16,67 e a TELA recalculava o valor a partir do
-- percentual truncado, imprimindo R$ 4.999,80. O valor exato ja estava gravado em
-- `preco_vista` (5000.00004) — mas o derivado vencia o explicito.
--
-- Duas correcoes, nesta ordem de importancia:
--  1. `preco_vista` passa a ser a FONTE do valor a vista (o cliente paga um VALOR, nao um
--     percentual). O pct vira rotulo derivado. Isso vive no codigo (utils/planosConfig.js).
--  2. o pct ganha casas para ser um rotulo fiel: numeric(5,2) -> numeric(7,4). 16.6667.
alter table public.planos_config  alter column desconto_vista_pct type numeric(7,4);
alter table public.ebooks_admin   alter column desconto_vista_pct type numeric(7,4);
alter table public.cursos_admin   alter column desconto_vista_pct type numeric(7,4);

-- O valor a vista tambem deixa de carregar a sujeira do calculo em ponto flutuante
-- (5000.00004 veio de 6000 * (1 - 0.166666666)). Dinheiro tem 2 casas.
alter table public.planos_config  alter column preco_vista type numeric(12,2);

comment on column public.planos_config.preco_vista is
  'Valor a vista EXATO — fonte da verdade. `desconto_vista_pct` e rotulo derivado dele; quem exibe deve preferir esta coluna (utils/planosConfig.js).';

-- Os dois planos que o dono pediu, com o valor cheio e o percentual coerente.
update public.planos_config set preco_vista = 5000.00,  desconto_vista_pct = round((1 - 5000.00  / 6000.00)  * 100, 4), atualizado_em = now() where plano_key = 'assessorado';
update public.planos_config set preco_vista = 50000.00, desconto_vista_pct = round((1 - 50000.00 / 60000.00) * 100, 4), atualizado_em = now() where plano_key = 'clube';

-- 02/09 — O EBOOK QUE A VITRINE DAVA DE GRACA E O SERVIDOR COBRAVA.
-- `obter_arquivo_ebook` (a RPC de entitlement) ja decide pelo PRECO: `if preco = 0 then
-- libera`. A vitrine de /membros olhava a flag `gratuito` ANTES do preco. "Lucre Antes de
-- Arrematar" estava com preco 49,90 E gratuito=true: o card anunciava "Gratis" e o
-- servidor recusava o arquivo a quem nao tem plano. Promessa que o backend nao cumpre.
-- O preco passa a mandar nos dois lados; aqui a linha existente e acertada.
update public.ebooks_admin set gratuito = false where coalesce(preco, 0) > 0 and gratuito;
update public.cursos_admin set gratuito = false where coalesce(preco, 0) > 0 and gratuito;
