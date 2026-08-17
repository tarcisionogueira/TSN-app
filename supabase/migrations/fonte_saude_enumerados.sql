-- ─────────────────────────────────────────────────────────────────────────────────────────
-- FONTE_SAUDE: a regressão comparava dois números diferentes com o mesmo nome
-- 17/08/2026
--
-- A VEGAS foi acusada de regressão ("queda vs anterior (1<40)") num dia em que o scraper
-- funcionou exatamente como deveria. O que o acervo mostra, cruzando `fonte_saude.total` com
-- os lotes que de fato NASCERAM em cada dia:
--
--     dia    │ fonte_saude.total │ lotes criados
--     ───────┼───────────────────┼───────────────
--     13/08  │                40 │  0
--     16/08  │                40 │  0
--     17/08  │                 1 │  1
--
-- Nos dias "saudáveis" a VEGAS não capturou NADA. `scraper-soleon.mjs` faz
-- `(novos.length ? novos : urls).slice(0, MAX_LOTES)`: sem nada novo, ele re-raspa até 40 já
-- conhecidos para atualizar preço e data — trabalho legítimo, que enche `total` com o teto do
-- lote. Em 17/08 a listagem tinha UM lote inédito, ele foi capturado, e `total` valeu 1.
--
-- Ou seja: `total` mede "lotes processados", e isso significa coisas diferentes conforme o
-- dia. O monitor comparou 1 CAPTURA contra 40 RE-VERIFICAÇÕES e mandou investigar um parser
-- que estava certo. As irmãs de plataforma são a prova de que o código está bom: CALIL (60) e
-- TORRES3 (2) rodaram o MESMO `scraper-soleon.mjs` no mesmo ciclo e passaram bem.
--
-- É a mesma família dos outros achados destes dias: dois fatos distintos entregues sob um
-- nome só. Aqui o dano não é ao cliente, é ao nosso tempo — um alerta que manda caçar um bug
-- inexistente gasta a mesma atenção que um alerta verdadeiro, e ensina a desconfiar do monitor.
--
-- `enumerados` = quantos lotes a FONTE LISTA na execução. Não depende de quanto já temos, e é
-- o número que regride de verdade quando o site muda: listagem caindo de 40 URLs para 1 é
-- regressão real. Quando presente nos dois lados da comparação, é ele que decide; senão, o
-- comportamento antigo continua valendo (coletor que ainda não reporta enumeração).
--
-- ⚠️ PENDENTE, e de propósito: `fonte_baseline_aprendida()` continua aprendendo o piso a
-- partir de `total`, então o piso das fontes com fallback segue contaminado pela re-raspagem.
-- Trocar a função agora não ajudaria — não há histórico de `enumerados` para ela aprender.
-- Depois de alguns dias de coleta, migrar a baseline para `enumerados` (ver HANDOFF 17/08).
-- ─────────────────────────────────────────────────────────────────────────────────────────

alter table public.fonte_saude
  add column if not exists enumerados integer;

comment on column public.fonte_saude.enumerados is
  'Quantos lotes a LISTAGEM da fonte devolveu nesta execução. Difere de `total` (lotes processados), que infla quando o coletor não tem nada novo e re-raspa os conhecidos. A checagem de regressão prefere este campo quando ele existe nos dois lados.';
