-- ═══════════════════════════════════════════════════════════════════════════════════════
-- PROXIMIDADES — reparo do resíduo deixado pelo job OSM (13/08)
--
-- CONTEXTO: em 10/08 o "vazio falso" foi corrigido em DOIS caminhos — o cron
-- (`api/enriquecer-proximidades.js`, que passou a exigir 3 observações em execuções
-- diferentes antes de aceitar `{}`) e o on-demand (`api/proximidades-imovel.js`, que passou a
-- devolver 502 "indeterminado" em vez de gravar vazio). Ficou de fora um TERCEIRO escritor,
-- que ninguém tinha mapeado: `scripts/enriquecer-osm.mjs`, job diário das 05h UTC.
--
-- O QUE ELE FAZIA: gravava `pontos_proximos = nearest` mesmo com `nearest = {}` e carimbava
-- `proximidades_em`. Dois estragos, ambos medidos:
--
--   1. Vazio de UMA observação virava veredito, furando a corroboração dos outros dois
--      caminhos. Assinatura no banco: `pontos_proximos = '{}'` com `proximidades_vazios = 0`
--      — estado que o cron é incapaz de produzir, porque ele grava o contador junto do `{}`.
--      Medido em 13/08: 293 lotes assim, 53 deles carimbados às 06:19 do mesmo dia, em 7
--      segundos e 37 cidades (o cron faz 12 por rodada de 300s — não era ele).
--
--   2. O pior: o carimbo diário DESLIGAVA a auto-cura de 10/08. A fila de revalidação do cron
--      procura `proximidades_em < now() - 30 dias`, e o job recarimbava 12.820 dos 13.101
--      lotes com geocode preciso a cada 48h. Nenhum envelhecia o bastante para ser
--      reconferido: o `{}` "com validade de 30 dias" era renovado todos os dias, para sempre.
--
-- CORREÇÃO NA RAIZ (mesmo commit): o job passa a gravar só `score_localizacao` quando não
-- acha POI, sem tocar em `pontos_proximos` nem em `proximidades_em` — o lote segue para o
-- cron corroborar. Ganhou também piso mínimo de POIs carregados (um extrato truncado
-- zerava o país inteiro num run) e mesclagem que preserva `praia`, categoria que só o
-- Overpass calcula e que o job apagava dos 411 lotes de praia.
--
-- ESTA MIGRAÇÃO devolve à fila o resíduo NÃO CORROBORADO. O critério é `proximidades_vazios
-- = 0`: são exatamente os que nunca tiveram uma observação de vazio registrada. Os que têm
-- contador >= 3 foram confirmados pelo cron em execuções distintas e ficam como estão —
-- agora com o relógio de 30 dias voltando a correr de verdade.
--
-- Espelha o reparo de `proximidades_vazio_falso_reparo.sql` (10/08). Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════════════════

update public.imoveis_leilao
   set pontos_proximos = null,
       proximidades_em = null,
       proximidades_tentativas = 0
 where ativo
   and pontos_proximos = '{}'::jsonb
   and coalesce(proximidades_vazios, 0) = 0;

-- Acompanhamento: `proximidades_vazio_falso` (limite 300) deve cair na hora e seguir caindo
-- conforme o cron drena a fila. Verde = valor <= 300.
--   select * from public.qa_invariantes() where chave = 'proximidades_vazio_falso';
-- E a assinatura do defeito deve ficar em ZERO e não voltar a crescer:
--   select count(*) from imoveis_leilao
--    where ativo and pontos_proximos = '{}'::jsonb and coalesce(proximidades_vazios,0) = 0;
