-- ─────────────────────────────────────────────────────────────────────────────────────────
-- PESTANA: 1.021 alienações JUDICIAIS marcadas como extrajudicial — 17/08/2026
--
-- Todos os 1.021 lotes ativos são a MESMA frase, palavra por palavra:
--     "Alienação Judicial Por Venda Direta"
-- e estavam gravados com `modalidade = 'extrajudicial'`.
--
-- CAUSA (scripts/scraper-puppeteer.mjs, mapLotePestana). O mapper lia só `bem.origem`:
--     origem.includes('extra') ? 'extrajudicial'
--       : origem.includes('judicial') ? 'judicial'
--       : 'extrajudicial'
-- A ordem estava certa — se `origem` viesse preenchida, "Alienação Judicial…" daria
-- 'judicial'. Ela vem VAZIA nesses lotes, e o fallback é um palpite AFIRMATIVO. O dado estava
-- disponível o tempo todo em `leilao.nome`; o mapper simplesmente não olhava para lá.
--
-- É o defeito nº 1 da casa em outra roupa: ausência de informação entregue como afirmação.
-- "Não sei a natureza" virava "é extrajudicial", que é uma alegação de que NÃO há processo.
--
-- POR QUE NÃO É COSMÉTICO: `modalidade` decide (a) o risco jurídico que o cliente lê na ficha,
-- (b) a nota de Perfil do BidScore — `judicial` vale 4 e `extrajudicial` 6, então estávamos
-- pontuando esses lotes ACIMA do que a natureza deles justifica — e (c) o texto do parecer.
--
-- POR QUE 'judicial' E NÃO 'venda_direta'. A frase carrega os dois fatos: origem judicial e
-- modo de venda direta. O sistema tem as duas modalidades e só um campo para guardá-las.
-- Escolhido 'judicial' porque é o fato de RISCO — alienação por venda direta autorizada em
-- juízo depende de homologação e é atacável, e o cliente precisa saber disso antes de dar
-- lance. 'venda_direta' descreveria melhor a operação (sem praça, sem disputa) e daria nota 8
-- de Perfil, mas apagaria o processo. Entre exagerar o risco e escondê-lo, exagera-se.
-- Os 1.021 TÊM data de leilão, nenhum tem 2ª praça e nenhum tem número de processo.
-- Se um dia `modalidade` for desmembrada em natureza × modo de venda, este é o primeiro caso
-- a revisitar.
--
-- A CORREÇÃO DO CÓDIGO vai junto no mesmo commit (a migração sem ela seria desfeita na próxima
-- coleta, que é a forma nº 7 pela ponta contrária).
-- ─────────────────────────────────────────────────────────────────────────────────────────

update public.imoveis_leilao
   set modalidade = 'judicial'
 where ativo and modalidade = 'extrajudicial'
   and coalesce(titulo,'')    !~* 'extrajudicial'   -- 'extrajudicial' CONTÉM 'judicial'
   and coalesce(descricao,'') !~* 'extrajudicial'
   and (titulo ~* '\mjudicial\M' or descricao ~* '\mjudicial\M');  -- limite de palavra, idem
