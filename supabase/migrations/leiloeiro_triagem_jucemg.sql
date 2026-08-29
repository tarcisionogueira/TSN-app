-- TRIAGEM DOS LEILOEIROS DA JUCEMG (29/08) — onde mora o resultado de `recon-triagem-jucemg.mjs`.
--
-- O dono trouxe a lista oficial da Junta Comercial de MG (236 leiloeiros); cruzada com o acervo,
-- só 6 estavam no sistema e sobraram 141 sites. A pergunta era "quanto custa trazer", e o custo
-- depende da PLATAFORMA, não do leiloeiro: as 34 fontes que temos hoje não são 34 parsers —
-- SOLEON serve 4 e a família Superbid serve outras 4.
--
-- POR QUE `status_http` E `bloqueado` SÃO COLUNAS SEPARADAS DE `plataforma`: fundir "não
-- consegui ler" com "não achei nada" produziria uma lista de sites sem plataforma que na
-- verdade nunca foram lidos — e faria descartar dezenas de leiloeiros bons por erro de
-- instrumento. Site bloqueado no acesso grátis é RESULTADO (entra na lista do que custa
-- dinheiro), não ausência de dado.
--
-- `titulo` e `pistas` (hosts de script/CSS + meta generator) existem porque a primeira rodada
-- devolveu 63 "DESCONHECIDA" e nada com que agir. Um `cdn.plataformaX.com.br` repetido em 20
-- sites é uma família nova que vale UM parser — e isso só aparece guardando a evidência, não
-- o veredito.
--
-- `status_http` é o status DA HOME. Na v1 uma variável só era sobrescrita a cada caminho
-- tentado, e como quase todo site devolve 404 em `/lotes/imovel` (um palpite nosso, não uma
-- rota do site), a coluna dizia "404" sobre sites cuja home respondia 200.
create table if not exists public.leiloeiro_triagem (
  dominio           text primary key,
  leiloeiros        text[] not null default '{}',
  status_http       int,
  catalogo_ok       text,
  titulo            text,
  pistas            text,
  url_final         text,
  servidor          text,
  bloqueado         boolean not null default false,
  plataforma        text,
  parser_existente  text,
  erro              text,
  medido_em         timestamptz not null default now()
);

create index if not exists leiloeiro_triagem_plataforma_idx
  on public.leiloeiro_triagem (plataforma, bloqueado);

alter table public.leiloeiro_triagem enable row level security;
