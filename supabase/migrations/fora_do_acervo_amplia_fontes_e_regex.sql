-- Pedido do dono (21/09, depois do achado do "Fiat Fiorino" misturado nos imóveis): "verifica
-- se tem mais algum tipo de bem misturado no acervo". `fora_do_acervo_imovel_veiculo()` já
-- existia pra isso, mas `qa_invariantes()` só a aplicava a 6 fontes (LEILAOBRASIL, LUTHERO,
-- LEILAOPRO, EMILIOMATOS, SUPERBID, LJUD) — rodando ela SEM esse recorte contra o acervo
-- inteiro, apareceram 28 lotes ativos em MAIS 8 fontes nunca cobertas por este invariante.
--
-- Conferido um a um (não supor): 24 são MESMO bem errado — móveis de escritório, eletro-
-- domésticos e até MARCAS/trademarks (ex.: "A Marca Henrifarma") em VIP/BAYIT/LEILOTECH, e um
-- lote "Bens móveis em geral: betoneira, gerador..." de massa falida no KRONLEILOES. Os outros
-- 4 são FALSOS POSITIVOS do regex — imóvel de verdade descrito de um jeito que a função não
-- reconhecia: "28,00 alquires" (unidade de área rural), "vagaS de garagem LOCADA" (regex só
-- pegava singular) e "EX SUCURSAL BANCARIA" (prédio de agência bancária). Corrigido pra
-- reconhecer os 3 padrões novos SEM remover nenhum desses do acervo — são imóvel de verdade.
--
-- O 4º ("Df8b5dbe-9ba7-4572-9393-687f783292e0", ALBERTOMACEDOLEILOES) é um bug DIFERENTE — o
-- título é literalmente um UUID, sem nenhum texto descritivo — não dá pra saber se é imóvel
-- mal descrito ou outra coisa. NÃO desativado; fica como achado separado pro dono avaliar.
--
-- As duas correções de regex abaixo (retypar a expressão inteira à mão seria o mesmo risco de
-- transcrição já visto na migração do webhook MP) são feitas via replace no texto que o
-- próprio Postgres já tem da função — testadas lado a lado (função nova vs antiga) contra o
-- acervo inteiro ANTES de aplicar de verdade: confirmado que só os 3 casos-alvo mudam de
-- resultado, nada mais no acervo é afetado.
DO $do$
DECLARE
  src text;
  novo text;
BEGIN
  src := pg_get_functiondef('public.fora_do_acervo_imovel_veiculo'::regproc);

  IF position('vaga\s+de\s+garagem' in src) = 0 THEN
    RAISE EXCEPTION 'fora_do_acervo_imovel_veiculo(): marcador 1 (vaga de garagem) nao encontrado';
  END IF;
  novo := replace(src, 'vaga\s+de\s+garagem', 'vagas?\s+de\s+garagem');

  IF position('hectares?)' in novo) = 0 THEN
    RAISE EXCEPTION 'fora_do_acervo_imovel_veiculo(): marcador 2 (hectares) nao encontrado';
  END IF;
  novo := replace(novo, 'hectares?)', 'hectares?|alqueires?|alquires?|sucursal\s+banc[áa]ria|ag[êe]ncia\s+banc[áa]ria)');

  EXECUTE novo;
END $do$;

-- Desativa os 23 confirmados como bem errado (móveis/eletrodomésticos/marca/bens diversos de
-- massa falida) — NUNCA os casos revistos acima (imóvel real, só mal reconhecido pelo regex
-- antigo) nem "Varzea do Tanque" (BAYIT, sem descrição pra confirmar — pode ser terra de
-- verdade, fica ativo por precaução) nem o UUID-título do ALBERTOMACEDOLEILOES.
update imoveis_leilao
set ativo = false, suprimido_motivo = 'fora_do_acervo_imovel_veiculo (correção 21/09 — móveis/eletrodomésticos/marca misturados)'
where ativo
  and fonte in ('VIP', 'BAYIT', 'LEILOTECH', 'KRONLEILOES')
  and public.fora_do_acervo_imovel_veiculo(titulo, descricao)
  and titulo <> 'Varzea do Tanque';

-- Amplia o escopo do invariante `acervo_fora_de_escopo` (em qa_invariantes()) pras 8 fontes
-- onde o achado apareceu, pra não ficar invisível de novo — mesma técnica seletiva de sempre
-- (substitui só a lista de fontes na cláusula já existente, não retranscreve a função
-- inteira à mão).
DO $do$
DECLARE
  src text;
  novo text;
  marcador_velho text := $m$fonte in ('LEILAOBRASIL','LUTHERO','LEILAOPRO','EMILIOMATOS','SUPERBID','LJUD')$m$;
  marcador_novo text := $m$fonte in ('LEILAOBRASIL','LUTHERO','LEILAOPRO','EMILIOMATOS','SUPERBID','LJUD','VIP','BAYIT','LEILOTECH','KRONLEILOES','SBID9','GRUPOLANCE','FRAZAO','ALBERTOMACEDOLEILOES')$m$;
BEGIN
  src := pg_get_functiondef('public.qa_invariantes'::regproc);
  IF position(marcador_velho in src) = 0 THEN
    RAISE EXCEPTION 'qa_invariantes(): marcador da lista de fontes nao encontrado — revise antes de reaplicar';
  END IF;
  novo := replace(src, marcador_velho, marcador_novo);
  EXECUTE novo;
END $do$;
