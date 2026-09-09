-- 09/09: BAYIT (e qualquer fonte futura) pode trazer VÁRIAS fotos por lote — hoje só existe
-- `link_foto` (1 única). Como não re-hospedamos foto (link externo direto pro site do
-- leiloeiro — ver leiloeiro_conhecimento, só CEF re-hospeda em imoveis-fotos), guardar a
-- galeria inteira não custa storage nosso, só linhas. Coluna nova, nullable, aditiva —
-- não muda nada do que já existe. `link_foto` continua sendo a capa (fotos[0]).
alter table public.imoveis_leilao add column if not exists fotos jsonb;
comment on column public.imoveis_leilao.fotos is
  'Galeria de fotos (array de URLs externas, hotlink direto no site do leiloeiro — não re-hospedadas). link_foto é a capa (fotos[0]). Ainda sem UI de galeria no front (09/09) — a coluna existe pra não perder o dado até isso ser construído.';
