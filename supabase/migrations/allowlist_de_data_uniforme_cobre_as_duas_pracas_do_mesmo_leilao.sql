-- 01/09 — `fonte_data_leilao_uniforme` acusou, e o acusado NAO era quem parecia.
-- ═══════════════════════════════════════════════════════════════════════════════════
-- O invariante marcou 1 achado. Olhando o acervo sem o filtro de data, tres fontes tem
-- "100+ lotes e <=2 datas": HASTA (584/1), BIASI (350/1) e GESTAOLEILOES (104/0). E facil
-- concluir "e o BIASI" e sair consertando o parser errado.
--
-- MEDIDO, rodando a consulta EXATA do invariante: e o HASTA. O `where data_leilao is not
-- null` vem ANTES do group by, entao `count(*) >= 100` conta so lotes DATADOS — e o BIASI
-- tem 1 lote datado em 350 (problema real, mas OUTRO, tratado em migracao propria).
--
-- ─── A CAUSA: a allowlist fixa uma data que legitimamente ANDA ────────────────────────
-- A linha do HASTA (25/08) certifica `data_leilao = 2026-08-28` — a 1a praca. O leilao
-- aconteceu, a fonte avancou para a 2a, e hoje o acervo inteiro esta em 2026-09-03. A
-- data mudou; o FATO certificado, nao.
--
-- E a propria evidencia de 25/08 ja dizia, com todas as letras: *"Leilao extrajudicial
-- nacional unico: 1a praca 28/08, 2a 03/09"*. A data de agora e a que estava escrita ali.
-- A linha nasceu cobrindo metade do leilao que descrevia.
--
-- ─── RE-VERIFICADO HOJE, nao herdado ─────────────────────────────────────────────────
-- Nao basta que a data bata com o que alguem escreveu ha uma semana — o que a allowlist
-- certifica e "o parser le por lote, nao carimba". Medido em 01/09 sobre o acervo vivo:
--   584 lotes ativos · 577 valor_minimo DISTINTOS · 208 cidades · 24 UFs
--   0 lotes com cidade suspeita (o defeito que o BIASI tem em 88% do acervo)
-- Carimbo em massa produziria o oposto: poucos valores, poucas cidades. Segue discriminando.
--
-- ─── O QUE ESTA LINHA NAO RESOLVE, e fica dito ───────────────────────────────────────
-- Quando o HASTA anunciar o PROXIMO leilao, o alerta volta. Isso e CORRETO e nao e para
-- ser silenciado: leilao novo e fato novo, e a pergunta "esta data unica e real ou e
-- carimbo?" precisa ser respondida de novo. O custo e uma verificacao por leilao; o
-- preco de automatizar seria aceitar data unica sem ninguem olhar — exatamente o que o
-- invariante existe para impedir (PESTANA 26/10).
insert into public.fonte_data_uniforme_verificada (fonte, data_leilao, verificado_em, evidencia)
values (
  'HASTA', '2026-09-03', now(),
  '2a praca do MESMO leilao ja nomeado na evidencia de 25/08 ("1a praca 28/08, 2a 03/09"). '
  'Re-verificado em 01/09 sobre o acervo vivo: 584 lotes ativos, 577 valor_minimo distintos, '
  '208 cidades, 24 UFs, 0 lote com cidade contendo " - " (o sintoma de titulo-no-campo-cidade). '
  'Parser lendo por lote, nao carimbando. Leilao extrajudicial nacional unico.'
)
on conflict (fonte, data_leilao) do update
  set verificado_em = excluded.verificado_em, evidencia = excluded.evidencia;
