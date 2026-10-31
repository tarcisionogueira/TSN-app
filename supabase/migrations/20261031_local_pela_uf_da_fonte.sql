-- 31/10 — `estado_fora_do_padrao` = 217: NÃO era estado mal formatado, eram lotes SEM cidade e SEM UF (somem de
-- /leiloes). O `local_do_texto` só acha a cidade com UF explícita ("X/SC") ou depois de "em/de/cidade de" e única
-- no Brasil; o texto destes cita a cidade solta: "Gramado Termas Resort" (TURANI), "Dona Francisca, São Bento do
-- Sul" (HASTAPUBLICALEL), "Terreno Tramandaí" (BARTMANN).
-- Novo último recurso no trigger: procurar no texto os municípios das UFs onde a FONTE publica (≥ 5% dos lotes, no
-- máx. 4 UFs — portal nacional fica de fora: "Perdizes" é bairro de SP e município de MG). Guardas medidas em seco
-- sobre os 217 (1ª passada: rua/avenida/santo davam falso positivo — "avenida Bento Gonçalves", "rua Cícero Caldas",
-- "Nossa Senhora Aparecida", "Boa Vista da Aparecida PR" lida como Aparecida/SP):
--   • palavra de logradouro/empreendimento/título de pessoa/"santa|são|nova|boa" até 3 palavras antes, no MESMO trecho
--     (corta na última vírgula — não no ponto, que é de "Av.": "na Gal. Osório, Pelotas" vale);
--   • UF explícita logo depois e diferente → outro município;
--   • empate entre dois municípios do mesmo tamanho → nada;
--   • nomes que são palavra comum (quadra, registro, colina, jardim, central…) fora.
create or replace function public.local_pela_uf_da_fonte(p_titulo text, p_descricao text, p_url text, p_ufs text[],
  out cidade text, out uf text)
 returns record language plpgsql stable set search_path to 'public' as $$
declare
  ufs constant text := 'ac|al|ap|am|ba|ce|df|es|go|ma|mt|ms|mg|pa|pb|pr|pe|pi|rj|rn|rs|ro|rr|sc|sp|se|to';
  antes_proibido constant text := '\m(rua|r|av|avenida|travessa|tv|alameda|estrada|rodovia|praca|largo|loteamento|residencial|condominio|edificio|ed|jardim|jd|vila|vl|bairro|parque|conjunto|setor|upg|planta|riviera|profissional|senhora|senhor|santa|santo|sao|nova|novo|bom|boa|estado|gleba|fazenda|sitio|chacara|distrito|localidade|comarca|vara|foro|cri|cartorio|engenheiro|eng|doutor|dr|professor|prof|general|gal|coronel|cel|presidente|marechal|padre|jornalista|telegrafista|deputado|vereador|prefeito|governador|capitao|tenente|major|dom)\.?(\s+\S+){0,2}\s*$';
  stop constant text[] := array['quadra','registro','colina','colinas','central','paraiso','esperanca','bonito','prata','feliz','vitoria','campos','planalto','industrial','pedras','palmeira','palmeiras','ipiranga','progresso','alvorada','salvador','santana','pinheiro','pinheiros','cordeiro','olimpia','jardim','perdizes','centro','pontal','aurora','liberdade','uniao','tabocas'];
  txt text; mn record; pos int; q int; p int; antes text; depois text; ufd text; melhor_l int := 0; empate boolean := false;
begin
  if p_ufs is null or cardinality(p_ufs) = 0 or cardinality(p_ufs) > 4 then return; end if;
  txt := ' ' || public.sem_acento(coalesce(p_titulo, '') || ' | ' ||
         regexp_replace(coalesce((regexp_match(coalesce(p_url, ''), '/([^/?#]+)/?$'))[1], ''), '[-_]+', ' ', 'g') || ' | ' ||
         left(coalesce(p_descricao, ''), 3000)) || ' ';
  for mn in select m.nome, m.uf, m.nome_norm, length(m.nome_norm) l from public.municipio_norm m
             where m.uf = any(p_ufs) and length(m.nome_norm) >= 5 and not (m.nome_norm = any(stop))
               and strpos(txt, m.nome_norm) > 0
             order by length(m.nome_norm) desc loop
    exit when melhor_l > 0 and mn.l < melhor_l;
    pos := 0;
    loop
      q := strpos(substr(txt, pos + 1), mn.nome_norm);
      exit when q = 0;
      p := pos + q; pos := p;
      if substr(txt, p - 1, 1) ~ '[a-z0-9]' or substr(txt, p + mn.l, 1) ~ '[a-z0-9]' then continue; end if;
      antes := regexp_replace(substr(txt, greatest(1, p - 45), least(45, p - 1)), '^.*[,;:|()]', '');
      if antes ~ antes_proibido then continue; end if;
      depois := substr(txt, p + mn.l, 12);
      ufd := upper((regexp_match(depois, '^\s*(?:/|-|–|,|\()?\s*(' || ufs || ')\M'))[1]);
      if ufd is not null and ufd <> mn.uf then continue; end if;
      if melhor_l = 0 then cidade := mn.nome; uf := mn.uf; melhor_l := mn.l;
      elsif cidade is distinct from mn.nome or uf is distinct from mn.uf then empate := true; end if;
      exit;
    end loop;
  end loop;
  if empate then cidade := null; uf := null; end if;
end $$;

create or replace function public.ufs_da_fonte(p_fonte text) returns text[] language sql stable set search_path to 'public' as $$
  -- UFs em que a fonte publica (≥ 5% dos lotes com UF, mín. 3 lotes): o universo onde o nome solto de cidade é procurado
  select array_agg(estado) from (
    select estado, count(*) n, sum(count(*)) over () tot from public.imoveis_leilao
     where fonte = p_fonte and estado ~ '^[A-Z]{2}$' group by 1) z
   where n >= 0.05 * tot and tot >= 3
$$;

-- trigger: o fallback entra só quando local_do_texto não achou nada (o resto do corpo é o vigente desde 28/10)
create or replace function public.trg_local_do_texto()
 returns trigger language plpgsql set search_path to 'public' as $function$
declare r record; m text[]; v_nome text; v_uf text; f record;
begin
  if not public.uf_valida(new.estado) then
    new.estado := null;
    -- sem UF válida, "cidade" que não é município em lugar nenhum ("Item", "Leilão Presencial", "Cpf") é lixo do parser
    if coalesce(new.cidade, '') <> '' and new.cidade !~ '[/0-9:$]' and length(new.cidade) <= 60
       and not exists (select 1 from public.municipio_norm mn where mn.nome_norm = public.sem_acento(new.cidade)) then
      new.cidade := null;
    end if;
  end if;
  -- CIDADE SUJA, consertada antes de qualquer inferência (28/10) — NUNCA apagada se dá para limpar:
  --   "Betim/mg", "Recife/pe" (SUPORTE): parte antes da barra, se é município daquela UF;
  --   "Serra Do Cipó (antigo…), Município De Santana Do Riacho/mg": o "município de X" vence;
  --   "1506138" (LJUD): código IBGE — só se a UF dele bate com a UF gravada (o LJUD mandou 1506138 = Redenção/PA
  --     num apartamento em Recife/PE; aí o código é descartado e o título decide);
  --   "São José do Rio Preto/SP Avaliação: R$425.000,00 …" (GESTAOLEILOES): o "<cidade>/<UF>" do começo.
  if new.cidade ~ '^\d{7}$' then
    select a.nome, a.uf into v_nome, v_uf from public.area_urbana_municipio a where a.cd_mun = new.cidade;
    if v_nome is not null and (new.estado is null or new.estado = v_uf) then
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
    if v_nome is not null and (new.estado is null or new.estado = v_uf) then
      new.cidade := v_nome; new.estado := v_uf;
    else
      new.cidade := null;
    end if;
  end if;
  if public.uf_valida(new.estado) and coalesce(new.cidade, '') <> '' then return new; end if;
  select * into r from public.local_do_texto(new.titulo, new.descricao, new.url_lote);
  if r.uf is null then
    -- 31/10: último recurso — município solto no texto, dentro das UFs onde a fonte publica
    if coalesce(new.cidade, '') = '' then
      select * into f from public.local_pela_uf_da_fonte(new.titulo, new.descricao, new.url_lote, public.ufs_da_fonte(new.fonte));
      if f.uf is not null and (new.estado is null or new.estado = f.uf) then
        new.cidade := f.cidade; new.estado := f.uf;
      end if;
    end if;
    return new;
  end if;
  if coalesce(new.cidade, '') = '' then
    if public.uf_valida(new.estado) and new.estado <> r.uf then return new; end if;
    new.cidade := r.cidade; new.estado := r.uf;
  elsif new.estado is null and public.sem_acento(new.cidade) = public.sem_acento(r.cidade) then
    new.estado := r.uf;
  end if;
  return new;
end $function$;

-- dado já gravado: reaplica o trigger nos ativos sem UF (mesmo resultado que a próxima coleta daria)
update public.imoveis_leilao set cidade = cidade
 where ativo and (estado is null or estado !~ '^[A-Za-z]{2}$');
