-- 01/11 — classificação de IMÓVEL (dono: "casas no filtro de apartamento"). Duas causas, medidas no acervo ativo:
--  (1) a Busca SEMPRE somava o balde genérico 'imovel' a qualquer filtro de tipo (Busca.jsx + buscar_por_raio_v2 e
--      _sem_geocode_count) — quem pede "Apartamento" recebia também os lotes sem tipo. Consertado no mesmo commit:
--      o balde vira um botão próprio ("Tipo não informado") e deixa de entrar nos outros filtros;
--  (2) o tipo vem do COLETOR, e alguns erram de forma sistemática: "Casa 308 m²" e "Sobrado" como apartamento
--      (MEGA, SUPERBID, GESTAO), "Sala c/ 33m²" e "Prédio" como apartamento, "Prédio Comercial" como casa, "Imóvel
--      rural (…ha)" como terreno, "LOTE URBANO … LOTEAMENTO CASA DA GENTE" como casa, "Ex-agência" sem tipo.
-- REGRA: quando o TÍTULO COMEÇA nomeando o tipo, ele vale — com as exceções medidas em seco (o título genérico não diz
-- tudo): "Terreno com residência/galpão" continua casa/comercial; casa em "Chácara X" (nome de bairro) vira casa, mas
-- não quando há hectare/alqueire; "Gleba" não tira de rural; misto residencial/comercial não troca.
-- Gatilho (vence o valor do coletor em toda gravação) + reclassificação do acervo ativo.

create or replace function public.tipo_imovel_titulo_explicito(p_titulo text)
returns text language sql immutable set search_path = public as $f$
  with s as (select regexp_replace(lower(public.sem_acento(coalesce(p_titulo,''))),
                    '^\W*((lote|item)\s*\d+\s*[-:–]\s*)?((\d+|um|uma|o|a|01)\s*[).-]?\s*)?', '') t)
  select case
    when t ~ '^(apartamento|apto|ap\.|flat|kitnet|kitinete|studio|cobertura|loft)\y' then 'apartamento'
    when t ~ '^(casa|sobrado|chale|edicula)\y' then 'casa'
    when t ~ '^(sala comercial|sala|salas|loja|lojas|galpao|barracao|predio comercial|predio|ponto comercial|conjunto comercial|laje corporativa|ex-?agencia|agencia|hotel|pousada|armazem|deposito)\y' then 'comercial'
    when t ~ '^(fazenda|sitio|chacara|imovel rural|area rural|propriedade rural)\y' then 'rural'
    -- "LOTE 002 IMÓVEL: …" é o número do lote do LEILÃO, não terreno
    when t ~ '^(terreno|lote urbano|lote de terreno|lote|area de terra|gleba)\y' and t !~ '^lote\s*n?[º°o.]?\s*\d+\s*[-:–]?\s*(imovel|bem|apart|casa|sala|vaga|box|unidade|direitos)' then 'terreno'
  end from s
$f$;

create or replace function public.tipo_imovel_pelo_titulo(p_titulo text, p_descricao text, p_tipo text)
returns text language plpgsql immutable set search_path = public as $f$
declare
  k text := public.tipo_imovel_titulo_explicito(p_titulo);
  tit text := lower(public.sem_acento(coalesce(p_titulo,'')));
  txt text;
begin
  if k is null or k = p_tipo then return p_tipo; end if;
  if p_tipo is null or p_tipo in ('imovel', 'outros') then return k; end if;
  txt := regexp_replace(lower(public.sem_acento(coalesce(p_titulo,'') || ' ' || left(coalesce(p_descricao,''), 400))),
                        'loteamento\s+(denominado\s+)?[a-z ]{0,20}casa[a-z ]{0,20}', ' ', 'g');
  if k = 'apartamento' then return k; end if;
  if k = 'casa' then
    if p_tipo = 'apartamento' then return k; end if;
    if p_tipo = 'rural' and txt !~ '(hectare|\d\s*ha\y|alqueire|\ysitio\s*[-–:]?\s*\d)' then return k; end if;
    return p_tipo;
  end if;
  if k = 'comercial' then
    if p_tipo in ('apartamento', 'casa', 'terreno') and tit !~ 'resid' then return k; end if;
    return p_tipo;
  end if;
  if k = 'rural' then
    if p_tipo in ('terreno', 'casa') then return k; end if;
    return p_tipo;
  end if;
  if k = 'terreno' then
    if p_tipo = 'apartamento' and tit !~ 'apto|apart' then return k; end if;
    if p_tipo = 'casa' and txt !~ '(\ycasas?\y|resid|constru|edific|sobrado|benfeitori|moradia|edicula)' then return k; end if;
    if p_tipo = 'rural' and tit ~ '^\W*((lote|item)\s*\d+\s*[-:–]\s*)?(lote|terreno urbano)' and txt !~ '(hectare|\d\s*ha\y|alqueire|rural)' then return k; end if;
    return p_tipo;
  end if;
  return p_tipo;
end $f$;

create or replace function public.trg_tipo_imovel_pelo_titulo()
returns trigger language plpgsql set search_path = public as $f$
begin
  if tg_op = 'UPDATE' and new.titulo is not distinct from old.titulo and new.descricao is not distinct from old.descricao
     and new.tipo is not distinct from old.tipo then
    return new;
  end if;
  new.tipo := public.tipo_imovel_pelo_titulo(new.titulo, new.descricao, new.tipo);
  return new;
end $f$;

-- "trg_tipo_a…" roda ANTES de trg_tipo_construido_pelo_titulo e trg_tipo_lote_sem_construcao (ordem alfabética).
create or replace trigger trg_tipo_aa_pelo_titulo
  before insert or update on public.imoveis_leilao
  for each row execute function public.trg_tipo_imovel_pelo_titulo();

update public.imoveis_leilao
   set tipo = public.tipo_imovel_pelo_titulo(titulo, descricao, tipo)
 where ativo and tipo is distinct from public.tipo_imovel_pelo_titulo(titulo, descricao, tipo);
