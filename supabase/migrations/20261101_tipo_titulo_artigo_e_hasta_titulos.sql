-- 01/11 — (1) bug em tipo_imovel_titulo_explicito (20261101_tipo_imovel_pelo_titulo): o prefixo opcional "(o|a)" sem
-- separador comia o "A" de "Apartamento" e o título deixava de ser reconhecido. Agora o artigo/numeral só sai quando
-- seguido de espaço ou pontuação. (2) HASTA: 670 ativos com título "Imóvel Hasta Leilões <id>" e tipo "outros" — o
-- leitor só montava título no formato CEF. Coletor corrigido (scripts/lib/hasta-parse.mjs); aqui o acervo gravado
-- ganha o título pela 1ª frase da descrição (medido em seco: 670 de 670) e o gatilho de tipo refaz o tipo. Veículo
-- no título ("HONDA/XRE 300", "I/FORD RANGER") sai do acervo de imóveis (bem_movel_barrado sobre o título novo).
create or replace function public.tipo_imovel_titulo_explicito(p_titulo text)
returns text language sql immutable set search_path = public as $f$
  with s as (select regexp_replace(lower(public.sem_acento(coalesce(p_titulo,''))),
                    '^\W*((lote|item)\s*\d+\s*[-:–]\s*)?((\d+|um|uma|o|a|01)(\s*[).-]\s*|\s+))?', '') t)
  select case
    when t ~ '^(apartamento|apto|ap\.|flat|kitnet|kitinete|studio|cobertura|loft)\y' then 'apartamento'
    when t ~ '^(casa|sobrado|chale|edicula)\y' then 'casa'
    when t ~ '^(sala comercial|sala|salas|loja|lojas|galpao|barracao|predio comercial|predio|ponto comercial|conjunto comercial|laje corporativa|ex-?agencia|agencia|hotel|pousada|armazem|deposito)\y' then 'comercial'
    when t ~ '^(fazenda|sitio|chacara|imovel rural|area rural|propriedade rural)\y' then 'rural'
    when t ~ '^(terreno|lote urbano|lote de terreno|lote|area de terra|gleba)\y' and t !~ '^lote\s*n?[º°o.]?\s*\d+\s*[-:–]?\s*(imovel|bem|apart|casa|sala|vaga|box|unidade|direitos)' then 'terreno'
  end from s
$f$;

with x as (
  select id, cidade, estado,
         btrim(regexp_replace(split_part(regexp_replace(coalesce(descricao,''),
           '\s*(\||\.\s|IPTU:|Matr[íi]cula:|Empreendimento:|Endere[çc]o:).*$', ''), E'\n', 1), '\s+', ' ', 'g')) p
    from public.imoveis_leilao
   where ativo and fonte = 'HASTA' and titulo ~* '^im[óo]vel hasta leil[õo]es \d+$'
)
update public.imoveis_leilao i
   set titulo = left(upper(left(x.p, 1)) || substr(regexp_replace(regexp_replace(x.p, '(\d)\s*m2\y', '\1 m²', 'gi'), '[,;:\s]+$', ''), 2), 80)
              || coalesce(' — ' || x.cidade || '/' || x.estado, '')
  from x
 where i.id = x.id and length(x.p) >= 4 and x.p ~ '^[A-Za-zÀ-ÿ]';

update public.imoveis_leilao set ativo = false, suprimido_motivo = 'nao_imovel'
 where ativo and fonte = 'HASTA' and (public.bem_movel_barrado(titulo, null) or public.titulo_comeca_com_veiculo(titulo));

update public.imoveis_leilao
   set tipo = public.tipo_imovel_pelo_titulo(titulo, descricao, tipo)
 where ativo and tipo is distinct from public.tipo_imovel_pelo_titulo(titulo, descricao, tipo);
