-- DOMICÍLIOS VAGOS — estoque ocioso por município. Aplicada em produção em 12/08.
--
-- A CAUSA-RAIZ ORIGINAL, que só ficou visível agora: o mapa antigo de `censo_domicilios`
-- falava em "Domicílios recenseados" + categoria "Vago" — vocabulário do agregado 4711
-- ("Domicílios recenseados, por espécie"). Mas a fonte apontava para o 4712, que é outro
-- assunto ("Domicílios particulares permanentes OCUPADOS"). O mapa foi escrito para uma
-- tabela e ligado a outra. Não deu erro: deu silêncio, e o silêncio durou 8 dias.
--
-- 4711 (Censo 2022):
--     variável   617  "Domicílios recenseados"                     (Domicílios)
--     variável   1000617 "… - percentual do total geral"           (%)
--     classificação 3 "Espécie", categorias 59993 (Total) e 60002 ("Particular permanente
--                     não ocupado - vago")
--
-- TRÊS CUIDADOS, todos aprendidos na marra hoje:
--  1. CLASSIFICAÇÃO PRECISA SER PEDIDA. Sem `&classificacao=`, o IBGE devolve só o TOTAL — e
--     `domicilios_vagos` ficaria eternamente vazio com a ingestão parecendo bem-sucedida. Por
--     isso `socio_fontes.classificacao` passou a existir e a entrar na URL.
--  2. `(?! - percentual)` impede que a variável de PERCENTUAL caia na coluna de contagem —
--     gravaria 11,8 (por cento) onde deve haver 589.020 (domicílios).
--  3. NÃO mapear `domicilios_ocupados` aqui: já vem do 4712, e mais preciso. Duas fontes
--     gravando a mesma coluna é ambiguidade esperando para acontecer.
--
-- Resultado conferido: São Paulo 589.020 vagos de 4.996.529 recenseados = 11,8%. Brasil 12,6%.
alter table public.socio_fontes add column if not exists classificacao text;
comment on column public.socio_fontes.classificacao is
  'Classificação do IBGE a pedir na URL (ex.: "3[59993,60002]"). Sem ela o agregado devolve só o TOTAL da variável.';

insert into public.socio_fontes (chave, descricao, agregado, periodo, mapa, classificacao, ativa, ordem)
values (
  'censo_domicilios_especie',
  'Censo 2022 — domicílios recenseados por espécie: total (cat 59993) e VAGOS (cat 60002) — estoque ocioso',
  '4711', '2022',
  '{"^domic(í|i)lios recenseados$": "domicilios",
    "^domic(í|i)lios recenseados(?! - percentual).*vago": "domicilios_vagos"}'::jsonb,
  '3[59993,60002]', true, 17)
on conflict (chave) do update set
  descricao = excluded.descricao, agregado = excluded.agregado, periodo = excluded.periodo,
  mapa = excluded.mapa, classificacao = excluded.classificacao, ativa = true;
