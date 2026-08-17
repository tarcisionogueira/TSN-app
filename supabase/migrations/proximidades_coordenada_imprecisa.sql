-- ─────────────────────────────────────────────────────────────────────────────────────────
-- PROXIMIDADES: "nenhum ponto de interesse" era, em 100% dos casos, coordenada imprecisa
-- 17/08/2026
--
-- O invariante `proximidades_vazio_falso` subiu 924 → 987 → 1.075 em três dias. A causa não
-- estava no Overpass "às vezes falhar": estava em QUEM é servido por ele.
--
-- O retrato que fecha o caso, por nível de geocode (lotes ativos):
--
--     geocod_nivel │ vazios │ cheios
--     ─────────────┼────────┼────────
--     endereco     │      0 │ 13.077   ← servido pelo EXTRATO LOCAL (Geofabrik), zero falsos
--     cidade       │  1.035 │  1.488
--     bairro       │    272 │    776
--     rua          │    110 │    185
--
-- ZERO falsos vazios onde a coordenada é precisa. Todos os 1.417 vivem em coordenada
-- imprecisa — exatamente a população que `scripts/enriquecer-osm.mjs` se recusa a tocar
-- (`.eq('geocod_nivel','endereco')`), deixando-a só para o cron do Overpass, que é o único
-- caminho do sistema capaz de gravar `{}`.
--
-- E o vazio é comprovadamente FALSO, não uma propriedade do lugar: na MESMA coordenada,
-- no MESMO dia, o acervo tem os dois desfechos.
--
--     -23.5329,-46.6395 (centroide SP) → 36 vazios × 55 cheios
--     -22.9129,-43.2003 (centroide RJ) → 33 vazios × 78 cheios
--
-- Não existe leitura em que o centro de São Paulo não tenha escola num raio de 4 km. A tela
-- dizia "Nenhum ponto de interesse mapeado nas proximidades" — uma AFIRMAÇÃO DE AUSÊNCIA —
-- para 1.075 lotes onde a verdade é "a coordenada é o centroide da cidade e nunca olhamos".
--
-- ─── TRÊS DEFEITOS ESTRUTURAIS QUE A CORROBORAÇÃO DE 3 OBSERVAÇÕES NÃO PEGAVA ──────────────
--
-- 1. O CONTADOR NUNCA ERA ZERADO AO CONFIRMAR. Ao gravar `{}` o cron guardava
--    `proximidades_vazios: n` (=3). Passados os 30 dias de validade, o lote voltava à fila
--    JÁ com 3 — e o PRIMEIRO vazio da revalidação dava n=4 ≥ 3, reconfirmando na hora. A
--    revalidação, que existe para curar o engano, virou carimbo automático dele. Medido:
--    50 lotes com contador > 3, DOIS deles em 26 — reconfirmados 23 vezes sem nunca terem
--    tido uma segunda opinião.
--
-- 2. AS "3 OBSERVAÇÕES EM EXECUÇÕES DIFERENTES" NÃO TINHAM ESPAÇAMENTO NEM DIVERSIDADE.
--    O cron roda a cada 15 min: três observações cabem em 45 minutos, sob a mesma condição
--    de carga — e nada obrigava que viessem de espelhos DIFERENTES. É o mesmo erro que o
--    cabeçalho de `_proximidades.js` documenta ("corroboração instantânea não corrobora
--    nada"), reintroduzido pela porta dos fundos: em vez de 0 segundo, 45 minutos.
--
-- 3. O ON-DEMAND ALIMENTAVA O MESMO CONTADOR SEM ESPAÇAMENTO NENHUM. `proximidades-imovel`
--    incrementa `proximidades_vazios` a cada abertura da ficha. Um cliente recarregando a
--    página três vezes seguidas fabricava sozinho a "corroboração temporal" do cron.
--
-- ─── O QUE MUDA (decisão do dono, 17/08) ───────────────────────────────────────────────────
--
--   • cidade  → NÃO calcula. A ficha passa a dizer "localização aproximada", que é a verdade.
--               Distância a partir do centroide de uma capital não descreve imóvel nenhum:
--               91 lotes compartilham a coordenada -23.5329,-46.6395.
--   • rua/bairro → passam a ser servidos pelo EXTRATO LOCAL (mesma fonte que deu 0 falsos em
--               13.077 lotes), rotulados como origem aproximada. Só `pontos_proximos`:
--               `score_localizacao` continua exclusivo de `endereco`, como validado com o dono.
--   • O Overpass deixa de servir `cidade` — some a única população em que ele produzia dano.
--
-- `proximidades_vazio_em` JÁ EXISTIA no banco e não era usada em NENHUM ponto do repositório
-- (nem em migração): uma sessão anterior criou a coluna para este mesmo espaçamento temporal
-- e nunca ligou o fio. Agora ela é lida e escrita — ver `api/enriquecer-proximidades.js`.
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- Quais espelhos do Overpass já reportaram vazio para este lote. A confirmação passa a exigir
-- DOIS espelhos distintos: um espelho com extrato regional/desatualizado responde 200 com
-- `elements: []` — vazio de aparência perfeitamente saudável — e sozinho ele não pode mais
-- condenar um lote. Sem esta coluna, "qual espelho respondeu" era informação que o sistema
-- simplesmente não guardava, e por isso o mecanismo só pôde ser inferido, nunca provado.
alter table public.imoveis_leilao
  add column if not exists proximidades_espelhos text[];

comment on column public.imoveis_leilao.proximidades_espelhos is
  'Espelhos do Overpass que já responderam VAZIO para este lote. Confirmar `{}` exige >= 2 distintos, além das 3 observações espaçadas por >= 6h (proximidades_vazio_em).';

comment on column public.imoveis_leilao.proximidades_vazio_em is
  'Quando o último vazio foi CONTADO. Observação nova só conta passadas 6h — impede que 3 leituras em 45 min (cron a cada 15 min) ou 3 recarregamentos da ficha pelo cliente virem "corroboração temporal".';

-- ─── REPARO DO DADO ────────────────────────────────────────────────────────────────────────
-- Todo `{}` do acervo está em coordenada imprecisa (endereco tem ZERO), então todos saem.
-- Volta para `null` = "ainda não sabemos", que é o estado honesto e o que recoloca o lote na
-- fila do job certo. NÃO é perda: um vazio verdadeiro (gleba rural) se reconfirma barato pelo
-- extrato local, agora sem depender de espelho público nenhum.
--
-- `proximidades_em` volta a null junto — senão o lote fica com carimbo de "calculado" sem
-- pontos, que é o estado ambíguo que este arquivo inteiro existe para eliminar.
update public.imoveis_leilao
   set pontos_proximos      = null,
       proximidades_em      = null,
       proximidades_vazios  = 0,
       proximidades_vazio_em = null,
       proximidades_espelhos = null
 where pontos_proximos = '{}'::jsonb;
