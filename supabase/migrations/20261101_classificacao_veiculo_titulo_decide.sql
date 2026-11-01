-- 01/11 — classificação de VEÍCULO refeita (dono: "carros no filtro de caminhão"). Medido no acervo ativo (9.533):
--  * coletores gravam `tipo_veiculo = 'carro'` como PADRÃO para qualquer coisa (CG 150, Atego, Kombi, Volare,
--    retroescavadeira) e o gatilho só classificava quando vinha nulo — o valor do coletor sempre vencia;
--  * o classificador testava palavras AMBÍGUAS de moto ("elite", "classic", "fan", "titan") antes dos modelos de carro
--    (Cobalt Elite, Zafira Elite viravam moto) e dava à DESCRIÇÃO o mesmo peso do título ("caminhão-guincho" na retirada
--    fazia carro virar caminhão); "88.763 km" casava com o padrão de modelo de caminhão (Porsche Cayenne → caminhão).
-- AGORA: título/modelo/marca decide (categoria escrita > modelo de ônibus/van/caminhão > moto inequívoca > carro >
-- moto ambígua > marca); só sem resposta pelo título vale o que o COLETOR mandou; a descrição é o último recurso.
-- Prova em seco antes de aplicar (comparação gravado × novo, amostra de cada transição) — ver HANDOFF 01/11.
create or replace function public.classificar_tipo_veiculo_titulo(p_titulo text, p_descricao text, p_marca text, p_modelo text)
returns text language plpgsql immutable set search_path to 'public' as $function$
declare
  t text := regexp_replace(lower(coalesce(p_titulo,'') || ' ' || coalesce(p_modelo,'') || ' ' || coalesce(p_marca,'')), 'r\$ ?[0-9.,]+', ' ', 'g');
  d text := lower(coalesce(p_descricao,''));
begin
  if t ~ '^\s*(motor|motores|bomba|bombas|pe[çc]as|conj\.?|kit)\y' then return null; end if;
  if t ~ '^[^a-zà-ú]*(\d+\s*)?(um\s+)?caminh(ão|ao)\y' then return 'caminhao'; end if;
  if t ~ '\ysemi-?rr?eboques?\y|\yreboques?\y|\ytrailer\y|\y(sr|r)/(?!t\y)' then return 'reboque'; end if;
  if t ~ '\y[oô]nibus\y|\ymicro-?[oô]nibus\y|\yminibus\y' then return 'onibus'; end if;
  if t ~ '\ycaminh(ão|ao|oes|ões)\y|\ycavalo mec[âa]nico\y|\ycarreta\y' then return 'caminhao'; end if;
  if t ~ '\ymoto(cicleta|neta)?s?\y|\yscooter\y|\ytric[ií]c(lo|los)\y|\yquadric[ií]c(lo|los)\y|\yciclomotor\y' then return 'moto'; end if;
  if t ~ '\ytrator(es)?\y|\ym[áa]quina (agr[íi]cola|pesada)\y|\yretroescavadeira\y|\ymotoniveladora\y|\yempilhadeira\y|\ycolheitadeira\y|\yescavadeira\y|\yp[áa] carregadeira\y|\y(mini-?)?carregadeiras?\y|\yminicarregadeiras?\y|\ymanipulador(es)?\y|\yrolo compactador\y|\yguindastes?\y|\yskid ?steer\y|\y(semeadora|plantadeira|pulverizador|ro[çc]adeira|grade aradora|valetadeira|perfuratriz|vibroacabadora|fresadora|bazuca)s?\y|\y(bobcat|komatsu|jcb|caterpillar|massey|john deere|new holland|valtra|marchesan|jacto|stara|liebherr|doosan|sany|xcmg|liugong|sdlg)\y' then return 'maquina'; end if;
  if t ~ '\ylancha\y|\yembarca[çc][ãa]o\y|\ybarco\y|\yjet-?ski\y' then return 'embarcacao'; end if;
  if t ~ '\yambul[âa]ncia\y|\yutilit[áa]rio\y' and t !~ '\y(sorento|discovery|land rover|hilux|sw4|pajero|l200|ranger|s10|amarok|frontier)\y' then return 'van_utilitario'; end if;
  if t ~ '\y(marcopolo|busscar|induscar|comil|volare|irizar|neobus|caio|mpolo|viaggio|paradiso)\y|\yiveco\y.*\ycityclass\y|\ycityclass\y.*\yiveco\y|\yscania\y.*\yk ?\d{3}\y|\yof[ -]?\d{4}\y|\y\d{1,2}\.?\d{3} ?e?od\y|\yvolvo\y.*\yb ?\d{1,2}[mr]\y' then return 'onibus'; end if;
  if t ~ '\y(sprinter|master|ducato|jumper|jumpy|boxer|daily|bongo|kombi|dobl[oò]|fiorino|kangoo|kgoo|partner|berlingo|trafic|transit|expert|besta|topic|furg[ãa]o|van|k ?2[57]00|bomgo|hr(?!-?v))\y' then return 'van_utilitario'; end if;
  if t ~ '\yford.{0,3}cargo\y|\ycargo (?!19|20)\d{3,4}\y|\y(atego|axor|accelo|actros|atron|constellation|worker|tector|stralis|vertis|eurocargo|tector|delivery|vm ?\d{3}|fh ?\d{3}|fm ?\d{3}|fmx)\y|\y\d{1,2}\.\d{3}(?![0-9,]|\s*(km|kms|quil|lts|litros|kg|h\y))(?=.*\y(vw|volkswagen|mercedes|m\.?\s?benz|ford|iveco|volvo|scania|agrale|constellation|worker|delivery|titan|caminh)\y)|\y(8|9|11|13|15|17|19|24|25|26|31)\d{3}\y(?=.*\y(vw|volkswagen|titan|constellation|worker|delivery)\y)|\yf[- ]?(350|400|600|4000|11000|12000|14000|16000|22000)\y|\y(chevrolet|gm)\y.*\yd ?(40|60|70|10000|11000|12000|14000)\y|\y(l|lk|lp|la|mb|lo) ?(?!19|20)\d{3,4}\y(?=.*\y(m\.?\s?benz|mercedes)\y)|\yscania\y' then return 'caminhao'; end if;
  if (t ~ '\yiveco\y' and t !~ '\ydaily\y') or (t ~ '\yvolvo\y' and t !~ '\y(xc ?\d+|ex ?\d+|s\d0|v\d0|c30)\y') then return 'caminhao'; end if;
  if t ~ '\y(cbx|cg ?\d{2,3}|nxr|xre ?\d*|pcx|biz|bros|ybr|xtz|fazer|factor|crypton|lander|tenere|nmax|xmax|burgman|cbr? ?\d{3,4}|crf ?\d*|dominar|fz ?\d{2}|ys ?\d{3}|xr ?\d{3}|c ?100)\y' then return 'moto'; end if;
  if t ~ '\y(gol|voyage|saveiro|fox|crossfox|spacefox|polo|virtus|jetta|golf|passat|up|nivus|t-?cross|taos|tiguan|amarok|parati|santana|uno|p[aá]lio|siena|strada|toro|argo|cronos|mobi|punto|idea|weekend|celta|corsa|prisma|onix|cobalt|spin|cruze|tracker|s10|montana|astra|vectra|classic|agile|kadett|monza|opala|meriva|zafira|captiva|equinox|trailblazer|blazer|ka|fiesta|focus|ecosport|ranger|fusion|escort|courier|edge|territory|sandero|logan|duster|kwid|clio|megane|scenic|symbol|fluence|captur|oroch|hb20s?|creta|tucson|ix35|azera|elantra|i30|sonata|fit|city|civic|hr-?v|wr-?v|cr-?v|accord|corolla|etios|yaris|hilux|sw4|rav4|prius|march|versa|sentra|kicks|frontier|livina|tiida|aircross|xsara|picasso|compass|renegade|commander|cherokee|wrangler|journey|l200|pajero|outlander|asx|lancer|tiggo|qq|celer|arrizo|sportage|cerato|picanto|soul|sorento|jimny|vitara|swift|sx4|cooper|evoque|freelander|discovery|xc60|xc90|320i|gla|c180|pampa|belina|chevette|marea|tempra|brava|stilo|linea|bravo|bora|touareg|dolphin|tiggo ?\d?|pt cruiser|cruiser|cayenne|macan|s-?cross|grand vitara|xc ?\d+|dakota|journey)\y' then return 'carro'; end if;
  if t ~ '\y(yamaha|kawasaki|harley|davidson|royal|enfield|triumph|ducati|shineray|dafra|haojue|kasinski|sundown|ktm|bajaj|zontes|avelloz|jta|jtz|mvk|garinni|voltz|benelli|traxx|suzuki (?!jimny|vitara|grand|swift|sx4|s-?cross))\y' then return 'moto'; end if;
  if t ~ '\y(cg|titan|bros|nxr|fan|biz|pop|pcx|xre|cbr?|cb ?\d{3}|cbx|crf|lead|elite|fazer|ybr|factor|crypton|xtz|tenere|lander|nmax|xmax|crosser|hornet|twister|falcon|burgman|intruder|yes|an ?125|ninja|mt-?\d{2}|xj6|xt ?660|dt ?180|shadow|sahara|next|neo|hunter|meteor|himalayan|interceptor|adx ?\d{3}|dk ?\d{3}|dr ?\d{3}|nh ?\d{3}|gsr ?\d{3}|g ?310|gs ?\d{3,4})\y' then return 'moto'; end if;
  if t ~ '\yhonda\y' and t !~ '\y(civic|fit|city|hr-?v|wr-?v|cr-?v|zr-?v|accord|crv|hrv|wrv)\y' then return 'moto'; end if;
  if t ~ '\y(vw|volkswagen|fiat|chevrolet|gm|ford|renault|hyundai|toyota|nissan|peugeot|citroen|citro[eë]n|jeep|kia|chery|caoa|mitsubishi|audi|land rover|mini|jac|lifan|byd|gwm|haval|subaru|ssangyong|volvo car|dodge|bmw|mercedes-benz (?=.*\y(classe|c ?\d{3}|e ?\d{3}|gla|glc|cla|a ?\d{3})\y))\y' then return 'carro'; end if;
  if t ~ '\yautom[óo]vel\y|\yve[íi]culo de passeio\y' then return 'carro'; end if;
  return null;
end $function$;

create or replace function public.classificar_tipo_veiculo_descricao(p_descricao text)
returns text language plpgsql immutable set search_path to 'public' as $function$
declare d text := lower(coalesce(p_descricao,''));
begin
  if d ~ '\ymoto(cicleta|neta)?\y' and d !~ '\y(autom[óo]vel|carro)\y' then return 'moto'; end if;
  if d ~ '\y[oô]nibus\y' then return 'onibus'; end if;
  if d ~ '\ysemi-?rr?eboque\y|\yreboque\y' then return 'reboque'; end if;
  if d ~ '\ycaminh(ão|ao)\y' and d !~ '\ycaminh(ão|ao)[ -]guincho\y|\yguincho\y' then return 'caminhao'; end if;
  return null;
end $function$;

create or replace function public.classificar_tipo_veiculo(p_titulo text, p_descricao text, p_marca text, p_modelo text)
returns text language sql immutable set search_path to 'public' as $f$
  select coalesce(public.classificar_tipo_veiculo_titulo(p_titulo, p_descricao, p_marca, p_modelo),
                  public.classificar_tipo_veiculo_descricao(p_descricao));
$f$;

-- O título decide; o valor do coletor só vale quando o título não diz nada; a descrição por último.
create or replace function public.trg_tipo_veiculo_preenche()
returns trigger language plpgsql set search_path to 'public' as $f$
begin
  -- Sem exceção para "correção manual": não há tela que edite o tipo, e a coleta diária reenvia o padrão do coletor
  -- ('carro') com o MESMO texto — uma exceção por "só o tipo mudou" desfaria a reclassificação todo dia.
  new.tipo_veiculo := coalesce(public.classificar_tipo_veiculo_titulo(new.titulo, new.descricao, new.marca, new.modelo),
                               new.tipo_veiculo,
                               public.classificar_tipo_veiculo_descricao(new.descricao));
  return new;
end $f$;

-- Reclassifica o acervo ATIVO.
update public.veiculos_leilao v
   set tipo_veiculo = n.novo
  from (select id, coalesce(public.classificar_tipo_veiculo_titulo(titulo, descricao, marca, modelo), tipo_veiculo,
                            public.classificar_tipo_veiculo_descricao(descricao)) novo
          from public.veiculos_leilao where ativo) n
 where v.id = n.id and v.tipo_veiculo is distinct from n.novo;
