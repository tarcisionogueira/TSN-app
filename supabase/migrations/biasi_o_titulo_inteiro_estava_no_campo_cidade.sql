-- 01/09 — BIASI: o TÍTULO INTEIRO estava gravado no campo `cidade`, em 88% do acervo.
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- Achado ao investigar o invariante `fonte_data_leilao_uniforme` — que acusava OUTRA fonte
-- (o HASTA). O BIASI apareceu de lado, na amostra: "Casa - Parque Dos Timburis - São
-- Carlos/SP" estava com cidade = "Casa - Parque Dos Timburis - São Carlos".
--
-- MEDIDO no acervo vivo: 308 de 350 lotes ativos (88%) com " - " DENTRO da cidade;
-- 327 com cara de título; apenas 23 (7%) com cidade aproveitável. É exclusivo do BIASI —
-- nenhuma outra fonte tem uma linha sequer com esse sintoma.
--
-- ─── POR QUE NENHUM ALARME VIU ────────────────────────────────────────────────────────
-- `sem_cidade` mede cidade VAZIA. Aqui ela vinha CHEIA, com um valor plausível que
-- descreve outra coisa — a forma nº 10 do CLAUDE.md. E cidade é o filtro principal da
-- Busca: 350 lotes ficaram inalcançáveis por cidade sem nada acusar.
--
-- ─── A CAUSA (corrigida em api/_cidade-do-titulo.js) ──────────────────────────────────
-- A classe de caracteres do regex do mapper, `[A-Za-zÀ-ÿ'.\- ]{2,40}`, INCLUI hífen e
-- espaço: ela atravessava os separadores e comia o título para trás. O comentário ao lado
-- já dizia o formato certo ("… - Cidade/UF"); o regex é que não ancorava no último
-- segmento. A correção não é um regex melhor — é conferir o candidato contra o município
-- REAL da UF (dataset IBGE). Medido: 7% → 99%.
--
-- ─── ESTE BACKFILL, E POR QUE ELE TEM UMA EXCEÇÃO NOMEADA ─────────────────────────────
-- A regra aqui é a mesma do scraper: o MAIOR sufixo do texto antes de "/UF" que seja
-- município daquela UF. Só que o scraper confere contra `api/_municipios.js` (IBGE) e o
-- SQL só tem `cidade_socio` — e as duas listas DIVERGEM. Rodei as duas antes de gravar:
-- IBGE casa 346, `cidade_socio` casa 345.
--
-- A diferença é "Casa - Alto Do Rosário - São Caetano/PE": **São Caetano/PE existe**
-- (IBGE 2610905) e está FALTANDO em `cidade_socio`, que tem 'saocaetanodeodivelas' (PA) e
-- 'saocaetanodosul' (SP) e mais nenhum. As duas tabelas afirmam 5.571 municípios e não são
-- o mesmo conjunto — falha de roster do censo, que nenhum invariante cobre (os `socio_*`
-- vigiam COLUNAS de cada linha, não quais linhas existem). Fica registrada para tratar à
-- parte; não se conserta o censo dentro de um backfill de captura.
--
-- Sem a exceção, este lote sairia vazio hoje e preenchido amanhã, quando o scraper passar
-- pela lista do IBGE — uma inconsistência criada por mim, não herdada.
--
-- Os 4 que continuam VAZIOS são erro DA FONTE e devem continuar vazios: "Paraíso de
-- Tocantins" (o município é "do"), "Várzea Grande/SP" (Várzea Grande é MT), "Encantando"
-- (é Encantado) e "Messejana" (bairro de Fortaleza). Cidade vazia o invariante
-- `sem_cidade` enxerga; cidade errada é invisível.
with base as (
  select i.id, i.titulo,
         (regexp_match(i.titulo, '^(.*?)\s*/\s*([A-Za-z]{2})\s*$'))[1] as antes,
         upper((regexp_match(i.titulo, '^(.*?)\s*/\s*([A-Za-z]{2})\s*$'))[2]) as uf
    from public.imoveis_leilao i
   where i.ativo and i.fonte = 'BIASI'),
pal as (
  select b.id, b.antes, b.uf, string_to_array(b.antes, ' ') as p
    from base b where b.antes is not null and b.uf is not null),
cand as (
  select x.id, x.antes, x.uf, s.i,
         btrim(regexp_replace(array_to_string(x.p[s.i:array_length(x.p,1)], ' '),
                              '^[-–—[:space:]]+', '')) as c
    from pal x, generate_subscripts(x.p, 1) s(i)),
-- `distinct on (id) ... order by i asc` = o MAIOR sufixo vence: "São Carlos" antes de
-- "Carlos", "Santa Helena de Goiás" antes de "Goiás".
casado as (
  select distinct on (c.id) c.id, c.antes, c.c as cidade
    from cand c
    join public.cidade_socio cs
      on cs.nivel = 'cidade' and cs.uf = c.uf
     and cs.cidade_norm = regexp_replace(lower(translate(c.c,
           'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
           'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '[^a-z0-9]', '', 'g')
   where length(c.c) >= 2
   order by c.id, c.i asc),
-- A exceção nomeada acima: o IBGE tem São Caetano/PE, o censo local não.
completo as (
  select id, antes, cidade from casado
  union all
  select b.id, b.antes, 'São Caetano'
    from base b
   where b.uf = 'PE' and b.titulo like '%São Caetano/PE'
     and not exists (select 1 from casado k where k.id = b.id)),
final as (
  select f.id, f.cidade,
         -- bairro = último segmento " - " ANTES da cidade ("Tipo - Bairro - Cidade/UF")
         (select x FROM unnest(regexp_split_to_array(
             regexp_replace(left(f.antes, greatest(0, length(f.antes) - length(f.cidade))),
                            '[[:space:]\-–—]+$', ''),
             '[[:space:]]+[-–—][[:space:]]+')) with ordinality t(x, n)
           order by n desc limit 1) as bairro_bruto,
         array_length(regexp_split_to_array(
             regexp_replace(left(f.antes, greatest(0, length(f.antes) - length(f.cidade))),
                            '[[:space:]\-–—]+$', ''),
             '[[:space:]]+[-–—][[:space:]]+'), 1) as n_segs
    from completo f)
update public.imoveis_leilao i
   set cidade = f.cidade,
       bairro = case when f.n_segs >= 2 then btrim(f.bairro_bruto) else i.bairro end
  from final f
 where i.id = f.id and i.ativo and i.fonte = 'BIASI';
