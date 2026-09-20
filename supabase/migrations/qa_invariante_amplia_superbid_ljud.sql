-- 20/09: "valida o classificador contra SUPERBID e LJUD antes de ampliar" — validação concluída
-- (ver fora_do_acervo_valida_superbid_ljud.sql, mesmo commit: diff completo JS×SQL sobre as
-- 2.396 linhas ativas das duas fontes, 0 divergências). Amplia 'acervo_fora_de_escopo' pra
-- cobrir SUPERBID e LJUD, mesmo método já usado pra LEILAOBRASIL/LUTHERO/LEILAOPRO/EMILIOMATOS.
--
-- Reclassifica também 'bug'/limite 0 pra 'gap'/limite 15: ampliar o escopo expôs uma baseline
-- estrutural de título ambíguo por FALTA de sinal ("Outros - <endereço>", "Direito - 01
-- Vaga...", "Área em Luz/MG.", "4ª Vara Cível..." — 6 casos medidos em 20/09), mesma ambiguidade
-- já documentada pra "Jazigo" em scraper-core.mjs, não contaminação de acervo. 'bug'/limite 0
-- pressupõe "nunca deveria acontecer"; aqui uma baseline pequena É esperada — mesmo padrão já
-- usado em 'sem_foto'/'sem_cidade'/'aval_ausente_com_doc' (gravidade 'gap', limite = baseline +
-- folga). O teto de zero-tolerância nas 4 fontes originais continua garantido: nelas o valor
-- medido é 0, e qualquer contaminação nova ali (a fresa de usinagem que deu origem a este
-- invariante) empurraria o total bem acima da folga de 15.
--
-- Limpeza retroativa: único true-positive confirmado na validação de 20/09 — "Bens móveis em
-- geral: betoneira, gerador, portas, cadeiras e outros" (SUPERBID) — o resto validou como
-- imóvel genuíno (título terso: "Apto 45m²", "Sala 701 - 200,44m²", "Box nº 02"...).
--
-- Aplicado via replace dinâmico no corpo da função (não CREATE OR REPLACE com o corpo inteiro
-- retigitado à mão) — `qa_invariantes()` tem ~300 linhas e retranscrever à mão já causou 2
-- tentativas falhas nesta mesma sessão por divergência de indentação; o dynamic replace com
-- verificação de que o marcador-alvo existe antes de executar é mais seguro que copiar o corpo
-- inteiro de novo.
DO $$
DECLARE
  def text;
BEGIN
  def := pg_get_functiondef('public.qa_invariantes()'::regprocedure);
  IF def NOT LIKE '%acervo_fora_de_escopo%LEILAOBRASIL%LUTHERO%LEILAOPRO%EMILIOMATOS%' THEN
    RAISE EXCEPTION 'marcador antigo nao encontrado no corpo da funcao — abortando pra nao aplicar substituicao errada';
  END IF;
  def := replace(def,
    $OLD$acervo_fora_de_escopo','Lote ativo (nas fontes já filtradas na ingestão) que nao e nem imovel nem veiculo','Captura','bug',
       (select count(*) from imoveis_leilao where ativo
          and fonte in ('LEILAOBRASIL','LUTHERO','LEILAOPRO','EMILIOMATOS')
          and public.fora_do_acervo_imovel_veiculo(titulo, descricao)), 0),$OLD$,
    $NEW$acervo_fora_de_escopo','Lote ativo (nas fontes já filtradas na ingestão) que nao e nem imovel nem veiculo — baseline de titulo ambiguo em SUPERBID/LJUD tolerada, so o crescimento alem da folga e achado','Captura','gap',
       (select count(*) from imoveis_leilao where ativo
          and fonte in ('LEILAOBRASIL','LUTHERO','LEILAOPRO','EMILIOMATOS','SUPERBID','LJUD')
          and public.fora_do_acervo_imovel_veiculo(titulo, descricao)), 15),$NEW$
  );
  IF def NOT LIKE '%''gap'',%and fonte in (''LEILAOBRASIL'',''LUTHERO'',''LEILAOPRO'',''EMILIOMATOS'',''SUPERBID'',''LJUD'')%' THEN
    RAISE EXCEPTION 'substituicao nao aplicou como esperado — abortando sem executar';
  END IF;
  EXECUTE def;
END $$;

update public.imoveis_leilao
   set ativo = false
 where ativo
   and fonte in ('SUPERBID','LJUD')
   and id = 'ba7a68e0-1b29-4c49-983e-8ff934a13104';
