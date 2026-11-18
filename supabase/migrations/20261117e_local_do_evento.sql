-- Pendência 371 (17/11): lote sem UF/cidade cujo LOCAL está no slug do EVENTO, não no do lote.
-- A plataforma Suporte (SUPORTE, 40 ativos sem UF em 17/11) escreve /eventos/leilao/<evento>/lote/<n>/<lote>, e o
-- lugar mora no <evento>: "leilao-judicial-de-gov-valadares-mg", "comarca-de-cerro-largo-rs", "leilao-prefeitura-de-
-- muliterno", "venda-direta-de-imovel-e-box-de-garagem-em-poa". local_do_texto() só lia o slug do LOTE.
--
-- Função separada (não mexe em local_do_texto, que tem precisão medida em 1.353 lotes) e conservadora:
--   * evento de FORO (comarca, tribunal, vara, juizado, judicial, TRT…) devolve SÓ a UF — a comarca diz o estado do
--     imóvel, mas a cidade-sede do foro pode não ser a do imóvel. Cidade fica nula (honesto) em vez de errada.
--   * UF que também é palavra (se, pe, es, to, am, al, ma, pa, ac, ap, ce) só vale como ÚLTIMA palavra do slug.
--   * só com UF explícita no slug (busca por nome único sem UF casava bairro: Olaria/MG, Ouro/SC).
create or replace function public.local_do_evento(p_url text, out cidade text, out uf text, out via text)
language plpgsql stable set search_path = public as $$
declare
  ufs constant text := 'ac|al|ap|am|ba|ce|df|es|go|ma|mt|ms|mg|pa|pb|pr|pe|pi|rj|rn|rs|ro|rr|sc|sp|se|to';
  ufs_palavra constant text[] := array['se','pe','ma','es','to','am','al','ce','ac','ap','pa'];
  ev text; foro boolean; m text[]; pal text[]; n int; i int; j int; c text; ac text; au text; ult text;
begin
  ev := (regexp_match(coalesce(p_url, ''), '/eventos/leilao/([^/?#]+)'))[1];
  if ev is null then return; end if;
  ev := regexp_replace(ev, '%[0-9a-fA-F]{2}', ' ', 'g');
  ev := public.sem_acento(ev);
  ev := regexp_replace(ev, '-\d{2}-\d{2}-\d{4}.*$', '');
  ev := trim(regexp_replace(ev, '[-_\s]+', ' ', 'g'));
  ev := regexp_replace(ev, '\mpoa\M', 'porto alegre rs', 'g');
  ev := regexp_replace(ev, '\mgov\M', 'governador', 'g');
  ev := regexp_replace(ev, '\mbh\M', 'belo horizonte mg', 'g');
  -- "estado de sao paulo", "mato grosso do sul" etc. são o ESTADO, não a cidade homônima (medido 18/11: "imoveis-estado-de-
  -- sao-paulo-edital" virava cidade São Paulo para lotes de Suzano/Carapicuíba; "...-de-mato-grosso-do-sul-..." virava
  -- a cidade Mato Grosso/PB).
  ev := regexp_replace(ev, '\mestado d[eo]s? (sao paulo|rio de janeiro|minas gerais|espirito santo|parana|santa catarina|rio grande do sul|goias|bahia|pernambuco|ceara|para|amazonas|mato grosso do sul|mato grosso)\M', '\1 estado', 'g');
  ev := regexp_replace(ev, '\mmato grosso do sul\M', 'ms', 'g');
  ev := regexp_replace(ev, '\mmato grosso\M', 'mt', 'g');
  ev := regexp_replace(ev, '\mrio grande do sul\M', 'rs', 'g');
  ev := regexp_replace(ev, '\msanta catarina\M', 'sc', 'g');
  ev := regexp_replace(ev, '\mminas gerais\M', 'mg', 'g');
  ev := regexp_replace(ev, '\mespirito santo\M', 'es', 'g');
  ev := regexp_replace(ev, '\m(sao paulo|rio de janeiro|parana|goias|bahia|pernambuco|ceara|amazonas) estado\M', 'estado', 'g');
  foro := ev ~ '\m(comarca|tribunal|trt|tjsp|tj|vara|varas|foro|forum|juizo|juizado|justica|judicial|judiciais|cri|ri|cartorio|oficio)\M';
  ult := (regexp_match(ev, '(\S+)$'))[1];

  -- 1) "<cidade> <uf>" com a UF explícita
  for m in select regexp_matches(ev, '([a-z][a-z'']*(?:\s+[a-z'']+){0,5}?)\s+(' || ufs || ')\M', 'g') loop
    if m[2] = any(ufs_palavra) and not ev ~ ('\m' || m[2] || '$') then continue; end if;
    pal := regexp_split_to_array(trim(m[1]), '\s+'); n := array_length(pal, 1);
    for i in 1..n loop
      ac := null;
      c := regexp_replace(array_to_string(pal[i:n], ' '), '^((de|do|da|dos|das|e|em|no|na|nos|nas)\s+)+', '');
      select mn.nome into ac from public.municipio_norm mn where mn.nome_norm = c and mn.uf = upper(m[2]);
      if found and c in ('sao paulo', 'rio de janeiro') and i > 1 then
        -- "<cidade> sao paulo sp": aqui "sao paulo" é o estado escrito por extenso; vale a cidade de antes
        for j in greatest(1, i - 3)..(i - 1) loop
          select mn.nome into au from public.municipio_norm mn where mn.nome_norm = array_to_string(pal[j:i-1], ' ') and mn.uf = upper(m[2]);
          if au is not null then ac := au; exit; end if;
        end loop;
        au := null;
      end if;
      if ac is not null then
        uf := upper(m[2]); cidade := case when foro then null else ac end;
        via := case when foro then 'uf_foro_evento' else 'uf_explicita_evento' end;
        return;
      end if;
    end loop;
  end loop;
  -- 1b) foro com UF explícita no FIM ("comarca-de-<grafia-errada>-rs"): a UF basta
  if foro and ult ~ ('^(' || ufs || ')$') then uf := upper(ult); via := 'uf_foro_evento_fim'; return; end if;

  -- (sem busca por nome único sem UF: no slug ela casava bairro — Olaria/MG, Ouro/SC — medido em 18/11)
end $$;

-- Medido em 18/11 sobre 1.080 lotes ativos com UF conhecida e URL de evento: UF certa 192/192, cidade certa 145/145.
-- Nos 41 sem UF: resolve a UF de 10 (cidade de 1). Liga no gatilho como camada entre local_do_texto() e o último
-- recurso por UF da fonte (que passa a ficar restrito à UF achada no evento).
create or replace function public.trg_local_do_texto() returns trigger
language plpgsql set search_path = public as $$
declare r record; e record; m text[]; v_nome text; v_uf text; f record;
begin
  if not public.uf_valida(new.estado) then
    new.estado := null;
    if coalesce(new.cidade, '') <> '' and new.cidade !~ '[/0-9:$]' and length(new.cidade) <= 60
       and not exists (select 1 from public.municipio_norm mn where mn.nome_norm = public.sem_acento(new.cidade)) then
      new.cidade := null;
    end if;
  end if;
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
    -- 18/11 (#371): o lugar no slug do EVENTO (plataforma Suporte). Evento de foro devolve só a UF.
    select * into e from public.local_do_evento(new.url_lote);
    if e.uf is not null and (new.estado is null or new.estado = e.uf) then
      new.estado := e.uf;
      if coalesce(new.cidade, '') = '' and e.cidade is not null then new.cidade := e.cidade; end if;
      if coalesce(new.cidade, '') <> '' then return new; end if;
    end if;
    if coalesce(new.cidade, '') = '' then
      select * into f from public.local_pela_uf_da_fonte(new.titulo, new.descricao, new.url_lote, public.ufs_da_fonte(new.fonte));
      if f.uf is not null and (new.estado is null or new.estado = f.uf) then
        new.cidade := f.cidade; new.estado := f.uf;
      end if;
      if coalesce(new.cidade, '') = '' and (new.estado is null or new.estado = 'RJ')
         and public.bairro_carioca(new.titulo, new.descricao, public.ufs_da_fonte(new.fonte)) then
        new.cidade := 'Rio de Janeiro'; new.estado := 'RJ';
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
end $$;
