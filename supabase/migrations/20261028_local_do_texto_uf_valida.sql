-- 28/10: "duas letras maiúsculas" não é UF. GESTAOLEILOES gravava "Item/NS" (52 ativos), MACHADORS "Leilão Presencial/ON",
-- ROCHA "Cpf/MF" — passavam por `^[A-Z]{2}$` e sumiam do filtro de UF. A rede de segurança (20261028_local_do_texto) passa a
-- validar a lista real e, com UF inválida, descarta "cidade" que não é município em lugar nenhum. Resultado: UF inválida
-- 54 → 0 (37 recuperados pela descrição do próprio lote, os demais ficam sem UF em vez de "NS").
-- Substitui trg_local_do_texto e o gatilho trg_zx_local_do_texto de 20261028_local_do_texto.sql.
create or replace function public.uf_valida(p text) returns boolean language sql immutable
as $$ select coalesce(p, '') ~ '^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$' $$;

create or replace function public.trg_local_do_texto()
 returns trigger language plpgsql set search_path to 'public'
as $function$
declare r record; m text[]; v_nome text; v_uf text;
begin
  if not public.uf_valida(new.estado) then
    new.estado := null;
    -- sem UF válida, "cidade" que não é município em lugar nenhum ("Item", "Leilão Presencial", "Cpf") é lixo do parser
    if coalesce(new.cidade, '') <> '' and new.cidade !~ '[/0-9:$]' and length(new.cidade) <= 60
       and not exists (select 1 from public.municipio_norm mn where mn.nome_norm = public.sem_acento(new.cidade)) then
      new.cidade := null;
    end if;
  end if;
  -- CIDADE SUJA (ver 20261028_local_do_texto.sql): "Betim/mg", "município de X", código IBGE, texto inteiro do lote.
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
  if r.uf is null then return new; end if;
  if coalesce(new.cidade, '') = '' then
    if public.uf_valida(new.estado) and new.estado <> r.uf then return new; end if;
    new.cidade := r.cidade; new.estado := r.uf;
  elsif new.estado is null and public.sem_acento(new.cidade) = public.sem_acento(r.cidade) then
    new.estado := r.uf;
  end if;
  return new;
end $function$;

drop trigger if exists trg_zx_local_do_texto on public.imoveis_leilao;
create trigger trg_zx_local_do_texto before insert or update on public.imoveis_leilao
  for each row when (not public.uf_valida(new.estado) or coalesce(new.cidade, '') = ''
                     or length(new.cidade) > 60 or new.cidade ~ '[/0-9:$]')
  execute function public.trg_local_do_texto();

update public.imoveis_leilao i set cidade = i.cidade where i.ativo and not public.uf_valida(i.estado);
