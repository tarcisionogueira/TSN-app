-- ─────────────────────────────────────────────────────────────────────────────────────────
-- TIPO DE VEÍCULO: Honda-moto e utilitários no filtro "Carro" — 24/09/2026 (dono, print)
-- "HONDA STRADA 2000" (CBX 200 Strada, moto) caía no Fiat Strada da regra de carro. Honda sem
-- modelo de CARRO Honda (Civic/Fit/City/HR-V/WR-V/CR-V/ZR-V/Accord) passa a ser moto. Kia K2500/K2700
-- e "Bomgo" entram como utilitário. Dry-run: 4 motos + 13 utilitários (Kangoo, Fiorino, Doblô,
-- Ducato, K2500) que estavam "carro" — reclassificados.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.classificar_tipo_veiculo(p_titulo text, p_descricao text, p_marca text, p_modelo text)
returns text language plpgsql immutable set search_path to 'public' as $$
declare
  -- preço colado no título (VLANCE: "AvaliaçãoR$ 35.038,80") casava com o modelo de caminhão
  -- "24.280"; tira os valores em R$ antes de classificar.
  t text := regexp_replace(lower(coalesce(p_titulo,'') || ' ' || coalesce(p_modelo,'') || ' ' || coalesce(p_marca,'')), 'r\$ ?[0-9.,]+', ' ', 'g');
  td text := t || ' ' || lower(coalesce(p_descricao,''));
begin
  -- 0) não é veículo: motor avulso, bomba, peças (vêm no acervo de veículos de algumas fontes)
  if t ~ '^\s*(motor|motores|bomba|bombas|pe[çc]as|conj\.?|kit)\y' then return null; end if;
  -- 1) palavra EXPLÍCITA de categoria (título + descrição) — regra de 13/09
  if td ~ '\ymoto(cicleta|neta)?s?\y|\yscooter\y|\ytric[ií]c(lo|los)\y|\yquadric[ií]c(lo|los)\y' then return 'moto'; end if;
  if td ~ '\y[oô]nibus\y|\ymicro-?[oô]nibus\y|\yminibus\y' then return 'onibus'; end if;
  if td ~ '\ycaminh(ão|ao|oes|ões)\y|\ycarreta\y|\ycavalo mec[âa]nico\y' then return 'caminhao'; end if;
  if td ~ '\ytrator(es)?\y|\ym[áa]quina (agr[íi]cola|pesada)\y|\yretroescavadeira\y|\ymotoniveladora\y|\yempilhadeira\y|\ycolheitadeira\y|\yescavadeira\y|\ypa carregadeira\y' then return 'maquina'; end if;
  if td ~ '\ysemi-?reboque\y|\yreboque\y|\ytrailer\y' then return 'reboque'; end if;
  if td ~ '\ylancha\y|\yembarca[çc][ãa]o\y|\ybarco\y|\yjet-?ski\y' then return 'embarcacao'; end if;
  -- 2) MODELOS de ônibus / caminhão / van (só título+marca+modelo: a descrição cita outros veículos)
  if t ~ '\y(marcopolo|busscar|induscar|comil|volare|irizar|neobus)\y|\yof[ -]?\d{4}\y' then return 'onibus'; end if;
  if t ~ '\yford.{0,3}cargo\y|\ycargo (?!19|20)\d{3,4}\y|\y(atego|axor|accelo|actros|constellation|worker|tector|stralis|vm ?\d{3}|fh ?\d{3}|fm ?\d{3})\y|\y\d{2}\.\d{3}\y(?!,)|\yf-?(4000|11000|12000|14000|16000)\y|\y(l|lk|lp|mb) ?(?!19|20)\d{4}\y|\yscania\y' then return 'caminhao'; end if;
  if t ~ '\y(sprinter|master|ducato|jumper|boxer|daily|bongo|kombi|doblo|fiorino|kangoo|partner|berlingo|trafic|transit|expert|besta|topic|furg[ãa]o|van|k ?2[57]00|bomgo)\y' or t ~ '\yhr\y(?!-)' then return 'van_utilitario'; end if;
  -- 3) MOTO: marcas que no Brasil só vendem moto + modelos de moto conhecidos
  if t ~ '\y(yamaha|kawasaki|harley|davidson|royal|enfield|triumph|ducati|shineray|dafra|haojue|kasinski|sundown|ktm|bajaj|zontes|avelloz|jta|mvk|garinni|voltz|benelli|traxx)\y' then return 'moto'; end if;
  if t ~ '\y(cg|titan|bros|nxr|fan|biz|pop|pcx|xre|cbr?|cb ?\d{3}|cbx|crf|lead|elite|fazer|ybr|factor|crypton|xtz|tenere|lander|nmax|xmax|crosser|hornet|twister|falcon|burgman|intruder|yes|an ?125|ninja|mt-?\d{2}|xj6|xt ?660|dt ?180|shadow|sahara|next|neo|hunter|meteor|himalayan|interceptor)\y' then return 'moto'; end if;
  -- 3b) HONDA sem modelo de CARRO Honda = moto (24/09: "HONDA STRADA 2000" é a CBX 200 Strada e
  --     caía no Fiat Strada da regra de carro; no leilão, Honda sem Civic/Fit/City/HR-V… é moto)
  if t ~ '\yhonda\y' and t !~ '\y(civic|fit|city|hr-?v|wr-?v|cr-?v|zr-?v|accord|crv|hrv|wrv)\y' then return 'moto'; end if;
  -- 4) CARRO: modelos (picape conta como carro na taxonomia da busca)
  if t ~ '\y(gol|voyage|saveiro|fox|crossfox|spacefox|polo|virtus|jetta|golf|passat|up|nivus|t-?cross|taos|tiguan|amarok|parati|santana|uno|p[aá]lio|siena|strada|toro|argo|cronos|mobi|punto|idea|weekend|celta|corsa|prisma|onix|cobalt|spin|cruze|tracker|s10|montana|astra|vectra|classic|agile|kadett|monza|opala|meriva|zafira|captiva|equinox|trailblazer|blazer|ka|fiesta|focus|ecosport|ranger|fusion|escort|courier|edge|territory|sandero|logan|duster|kwid|clio|megane|scenic|symbol|fluence|captur|oroch|hb20s?|creta|tucson|ix35|azera|elantra|i30|sonata|fit|city|civic|hr-?v|wr-?v|cr-?v|accord|corolla|etios|yaris|hilux|sw4|rav4|prius|march|versa|sentra|kicks|frontier|livina|tiida|aircross|xsara|picasso|compass|renegade|commander|cherokee|wrangler|l200|pajero|outlander|asx|lancer|tiggo|qq|celer|arrizo|sportage|cerato|picanto|soul|sorento|jimny|vitara|swift|sx4|cooper|evoque|freelander|discovery|xc60|xc90|320i|gla|c180|pampa|belina|chevette|marea|tempra|brava|stilo|linea|bravo|golf|bora|touareg|saveiro|montana)\y' then return 'carro'; end if;
  -- 5) MARCA que no Brasil só vende automóvel (depois de descartar modelos de caminhão/van)
  if t ~ '\y(vw|volkswagen|fiat|chevrolet|gm|ford|renault|hyundai|toyota|nissan|peugeot|citroen|citro[eë]n|jeep|kia|chery|caoa|mitsubishi|audi|land rover|mini|jac|lifan|byd|gwm|haval|subaru|ssangyong|volvo car)\y' then return 'carro'; end if;
  return null;
end $$;

update public.veiculos_leilao
   set tipo_veiculo = public.classificar_tipo_veiculo(titulo, descricao, marca, modelo)
 where tipo_veiculo = 'carro'
   and public.classificar_tipo_veiculo(titulo, descricao, marca, modelo) in ('moto', 'van_utilitario');
