-- #371 (28/10): rede de segurança de LOCALIZAÇÃO. 204 lotes ativos de 57 fontes (LeilãoPro 125, Suporte 24, outras 55)
-- entravam sem UF e sem cidade — e lote sem UF some de /leiloes. Cada parser tem a sua leitura de cidade; esta função é
-- o último recurso, comum a todos, e só devolve município que EXISTE no IBGE (area_urbana_municipio).
--
-- Medido em 1.500 lotes ativos com cidade/UF conhecidas (fora CEF e GLOBOLEILOES), fingindo não saber — 1.353 respostas:
--   título com UF explícita  1.132 → UF 100% · cidade 98,8%
--   descrição com UF         195   → UF 99,0% · cidade 98,5%  (antes das exclusões de CNPJ/ORI/travessão: 92%)
--   slug / cidade única      26    → UF 96–100%
--   total                          → UF 99,8% · cidade 98,6%
-- Aplicado em 28/10: sem UF 204 → 118; sem cidade 291 → 202; cidade suja 16 → 0. Os 118 não nomeiam lugar nenhum no
-- texto gravado (descrição curta, sem endereço) — só o parser, lendo o bloco de localização da página, resolve.
--
-- O que NÃO fazer: aceitar nome de cidade sem UF que exista em mais de uma UF (General Carneiro = PR e MT), ler cidade
-- sem UF da DESCRIÇÃO (nome de rua: "Rua Araújo de Porto Alegre" fica em Cachoeira do Sul), aceitar sufixo colado em
-- palavra de bairro ("Vila Olímpia (SP)" não é Olímpia/SP), ou usar a descrição para CORRIGIR cidade já gravada: na
-- GLOBOLEILOES a descrição de ~125 lotes é de OUTRO imóvel (loja na Mooca com texto de terreno em Pindamonhangaba) —
-- ali o título/URL estão certos e a descrição é que está errada (#374). Por isso o gatilho só age em lote SEM UF/cidade.

create table if not exists public.municipio_norm (
  nome_norm text not null, uf text not null, nome text not null, primary key (nome_norm, uf)
);
insert into public.municipio_norm (nome_norm, uf, nome)
select distinct on (public.sem_acento(nome), uf) public.sem_acento(nome), uf, nome from public.area_urbana_municipio
on conflict do nothing;
alter table public.municipio_norm enable row level security;

create or replace function public.local_do_texto(p_titulo text, p_descricao text, p_url text,
  out cidade text, out uf text, out via text)
 language plpgsql stable set search_path to 'public'
as $function$
declare
  ufs constant text := 'ac|al|ap|am|ba|ce|df|es|go|ma|mt|ms|mg|pa|pb|pr|pe|pi|rj|rn|rs|ro|rr|sc|sp|se|to';
  -- UF que também é palavra comum: só vale com separador explícito (/ , – -), nunca colada por espaço.
  ufs_palavra constant text[] := array['se','pe','ma','es','to','am','al','ce','ac','ap','pa'];
  -- Palavra de bairro/logradouro logo antes do sufixo: o sufixo é parte de um nome de lugar MENOR, não o município
  -- ("Vila Olímpia (SP)" é bairro de São Paulo, não Olímpia/SP).
  antes_proibido constant text := '^(vila|vl|jardim|jd|bairro|parque|pq|conjunto|residencial|loteamento|condominio|edificio|ed|rua|r|av|avenida|travessa|tv|praca|alameda|estrada|rodovia|distrito|localidade|setor|nucleo|chacara|sitio|fazenda)$';
  textos text[]; nomes text[] := array['titulo','slug','descricao'];
  x text; m text[]; pal text[]; n int; i int; c text; achou_c text; achou_uf text; k int;
begin
  textos := array[
    public.sem_acento(coalesce(p_titulo, '')),
    -- slug do leilão/lote: hífen vira espaço, data/hora do LeilãoPro sai, "poa" = Porto Alegre, estado por extenso vira sigla
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
      public.sem_acento(coalesce((regexp_match(coalesce(p_url, ''), '/(?:leilao|lote|eventos/leilao/[^/]+/lote/\d+)/([^/?#]+)'))[1], '')),
      '-\d{2}-\d{2}-\d{4}.*$', ''), '[-_]+', ' ', 'g'),
      '\mpoa\M', 'porto alegre rs', 'g'),
      '\msanta catarina\M', 'sc', 'g'), '\mrio grande do sul\M', 'rs', 'g'),
      '\mminas gerais\M', 'mg', 'g'), '\mmato grosso do sul\M', 'ms', 'g'),
    -- descrição: o rodapé do leiloeiro ("CNPJ … Praça dos Omaguás, 98, Pinheiros, São Paulo/SP", VIP) sai antes
    regexp_replace(public.sem_acento(left(coalesce(p_descricao, ''), 3000)), '\mcnpj\M.{0,250}', ' ', 'g')
  ];
  -- 1) CIDADE + UF EXPLÍCITA, conferida no IBGE. Vence a ÚLTIMA ocorrência do texto (o lugar do bem costuma vir depois
  --    de comarca/cartório); referências de foro/cartório são riscadas antes (Paiçandu × "CRI de Maringá/PR", 16/09;
  --    "ORI de Rio do Sul/SC", "comarca de Coromandel – MG", "distrito judiciário de Santa Fé de Goiás – GO", 28/10).
  for k in 1..3 loop
    x := regexp_replace(textos[k], '\m(comarca|vara|tribunal|foro|juizo|cri|ori|ci|circunscricao|cartorio|oficio|registro de imoveis|distrito judiciario|leiloeir[oa])\M[^/,;]{0,40}?(/|,|-|–|\()\s*(' || ufs || ')\M', ' ', 'g');
    achou_c := null; achou_uf := null;
    for m in select regexp_matches(x, '([a-z][a-z''.]*(?:\s+[a-z''.]+){0,5}?)\s*(/{1,2}|,|\s[-–]\s?|[-–]|\(|\s)\s*(' || ufs || ')\M', 'g') loop
      if m[2] ~ '^\s$' and m[3] = any(ufs_palavra) then continue; end if;
      pal := regexp_split_to_array(trim(m[1]), '\s+'); n := array_length(pal, 1);
      for i in 1..n loop  -- maior sufixo que é município daquela UF
        if i > 1 and pal[i - 1] ~ antes_proibido then exit; end if;
        c := array_to_string(pal[i:n], ' ');
        c := regexp_replace(c, '^((de|do|da|dos|das|e|em|no|na|nos|nas)\s+)+', '');
        select mn.nome into achou_c from public.municipio_norm mn where mn.nome_norm = c and mn.uf = upper(m[3]);
        if found then achou_uf := upper(m[3]); exit; end if;
      end loop;
      if achou_uf is not null then cidade := achou_c; uf := achou_uf; via := 'uf_explicita_' || nomes[k]; end if;
      achou_uf := null;
    end loop;
    if uf is not null then return; end if;
  end loop;
  -- 2) SEM UF: "em <cidade>", "cidade/município de <cidade>", "de <cidade>" — só no título e no slug, só nome que existe
  --    em UMA UF, e nunca dentro de nome de logradouro ("Rua Araújo de Porto Alegre", Cachoeira do Sul, 28/10).
  for k in 1..2 loop
    for m in select regexp_matches(textos[k], '(?:^|\s)((?:\S+\s+){0,3})(em|cidade de|municipio de|de)\s+([a-z][a-z''.]*(?:\s+[a-z''.]+){0,4})', 'g') loop
      if m[1] ~ '\m(rua|r|av|avenida|travessa|tv|alameda|estrada|rodovia|praca|edificio|ed|residencial|condominio|loteamento|bairro|vila|jardim|parque|distrito|localidade|comarca|vara|foro|cri)\M' then continue; end if;
      pal := regexp_split_to_array(trim(m[3]), '\s+'); n := array_length(pal, 1);
      for i in reverse n..1 loop  -- maior prefixo que é município de uma UF só
        c := array_to_string(pal[1:i], ' ');
        select min(mn.nome), min(mn.uf) into achou_c, achou_uf from public.municipio_norm mn where mn.nome_norm = c having count(*) = 1;
        if achou_uf is not null then cidade := achou_c; uf := achou_uf; via := 'cidade_unica_' || nomes[k]; return; end if;
      end loop;
    end loop;
  end loop;
end $function$;

-- Gatilho: só quando o lote chega SEM UF, SEM cidade, ou com cidade SUJA (WHEN barato). `trg_zx_` roda antes de
-- trg_zy_uf_pela_cidade_unica e de trg_zzz_situacao_geo, que precisam da UF. Cidade sai no nome oficial do IBGE.
create or replace function public.trg_local_do_texto()
 returns trigger language plpgsql set search_path to 'public'
as $function$
declare r record; m text[]; v_nome text; v_uf text;
begin
  -- CIDADE SUJA, consertada antes de qualquer inferência (28/10) — NUNCA apagada se dá para limpar:
  --   "Betim/mg", "Recife/pe" (SUPORTE): parte antes da barra, se é município daquela UF;
  --   "Serra Do Cipó (antigo…), Município De Santana Do Riacho/mg": o "município de X" vence;
  --   "1506138" (LJUD): código IBGE — só se a UF dele bate com a UF gravada (o LJUD mandou 1506138 = Redenção/PA
  --     num apartamento em Recife/PE; aí o código é descartado e o título decide);
  --   "São José do Rio Preto/SP Avaliação: R$425.000,00 …" (GESTAOLEILOES): o "<cidade>/<UF>" do começo.
  if new.cidade ~ '^\d{7}$' then
    select a.nome, a.uf into v_nome, v_uf from public.area_urbana_municipio a where a.cd_mun = new.cidade;
    if v_nome is not null and (new.estado is null or new.estado !~ '^[A-Z]{2}$' or new.estado = v_uf) then
      new.cidade := v_nome; new.estado := v_uf;
    else
      new.cidade := null;
    end if;
  elsif length(coalesce(new.cidade, '')) > 60 or new.cidade ~ '[/0-9:$]' then
    m := regexp_match(public.sem_acento(new.cidade), '(?:municipio de\s+)?([a-z][a-z'' .-]{1,50}?)\s*/\s*([a-z]{2})\M');
    if m is not null then
      m[1] := regexp_replace(trim(m[1]), '^.*\mmunicipio de\s+', '');
      select mn.nome, mn.uf into v_nome, v_uf from public.municipio_norm mn where mn.nome_norm = m[1] and mn.uf = upper(m[2]);
    end if;
    if v_nome is not null and (new.estado is null or new.estado !~ '^[A-Z]{2}$' or new.estado = v_uf) then
      new.cidade := v_nome; new.estado := v_uf;
    else
      new.cidade := null;  -- texto que não é município: o texto do lote decide abaixo
    end if;
  end if;
  if new.estado ~ '^[A-Z]{2}$' and coalesce(new.cidade, '') <> '' then return new; end if;
  select * into r from public.local_do_texto(new.titulo, new.descricao, new.url_lote);
  if r.uf is null then return new; end if;
  if coalesce(new.cidade, '') = '' then
    -- UF já válida que discorda do texto: não troca nada (a UF do parser vale mais que a inferência)
    if new.estado ~ '^[A-Z]{2}$' and new.estado <> r.uf then return new; end if;
    new.cidade := r.cidade; new.estado := r.uf;
  elsif (new.estado is null or new.estado !~ '^[A-Z]{2}$') and public.sem_acento(new.cidade) = public.sem_acento(r.cidade) then
    new.estado := r.uf;
  end if;
  return new;
end $function$;

drop trigger if exists trg_zx_local_do_texto on public.imoveis_leilao;
create trigger trg_zx_local_do_texto before insert or update on public.imoveis_leilao
  for each row when (new.estado is null or new.estado !~ '^[A-Z]{2}$' or coalesce(new.cidade, '') = ''
                     or length(new.cidade) > 60 or new.cidade ~ '[/0-9:$]')
  execute function public.trg_local_do_texto();

-- Backfill (rodado em 28/10, idempotente): reaplica o gatilho nos ativos sem localização ou com cidade suja.
update public.imoveis_leilao i set cidade = i.cidade
 where i.ativo and (i.estado is null or i.estado !~ '^[A-Z]{2}$' or coalesce(i.cidade, '') = ''
                    or length(i.cidade) > 60 or i.cidade ~ '[/0-9:$]');
