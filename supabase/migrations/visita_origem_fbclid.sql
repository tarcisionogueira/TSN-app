-- visita_origem.fbclid — o clique do Meta no PRIMEIRO TOQUE (18/08)
--
-- O QUE FALTAVA. `visita_origem` guardava `gclid`, `gbraid` e `wbraid` (Google) e nenhum
-- identificador do Meta. Os três lugares estavam de acordo em esquecer: `origemPrimeiroToque()`
-- (src/utils/tracker.js) não lia `fbclid` da URL, `api/track.js` não o punha na linha, e a
-- tabela não tinha onde guardá-lo. Como as três camadas concordavam, nada dava erro.
--
-- POR QUE IMPORTA AGORA. `perfis.mkt_fbclid` já existe e é preenchido no CADASTRO, então a
-- atribuição de quem se inscreve funciona. O que não existia era o nível de VISITA — e é
-- exatamente ali que mora o cruzamento que revelou a perda do Google: 201 cliques pagos contra
-- as visitas que o rastreador de fato registrou. Sem esta coluna, a mesma pergunta não pode
-- ser feita sobre uma campanha do Meta: o funil só apareceria a partir do cadastro, e uma
-- perda entre o clique e a primeira página ficaria invisível — que é a faixa onde a perda
-- costuma estar.
--
-- Que o tráfego do Meta JÁ CHEGA está medido: `l.instagram.com` (4 visitas) e
-- `www.facebook.com` (1) aparecem em `referrer_host`, com `mkt_fbclid` zerado em todos os
-- perfis. Hoje esse visitante é indistinguível de orgânico.
--
-- Aditivo e reversível: coluna anulável, sem default, sem backfill (não há o que reconstruir —
-- o dado nunca foi coletado; inventar valor aqui seria pior que a lacuna honesta).

alter table public.visita_origem
  add column if not exists fbclid text;

comment on column public.visita_origem.fbclid is
  'Click ID do Meta (fbclid) do primeiro toque. Espelha gclid/gbraid/wbraid do Google. '
  'Preenchido por api/track.js a partir de origemPrimeiroToque() em src/utils/tracker.js.';

-- Índice parcial, no mesmo padrão do `visita_origem_gclid_idx`: só as linhas que têm o valor.
-- A grande maioria das visitas é orgânica e não carrega click id — indexar tudo pagaria
-- escrita em toda visita para acelerar a consulta de uma minoria.
create index if not exists visita_origem_fbclid_idx
  on public.visita_origem (fbclid) where fbclid is not null;
