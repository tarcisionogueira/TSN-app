-- veiculo_cidade_fora_do_ibge 33 > 30 (16/10). 7 SUPERBID chegam como "Cuiabá - Mt" / "Paulista - Pe" /
-- "Americana - Sp": o gatilho só tirava a UF no formato "Cidade/UF", e "Cuiabá - Mt" não casava com
-- nenhum município. E "Alta Floresta Do Oeste" (LJUD) não casava com "Alta Floresta D'Oeste".
-- Agora: sufixo "/UF", "- UF", "– UF" ou "(UF)" sai do nome QUANDO é uma UF válida (e vira o estado,
-- se o lote não trouxe), e "do oeste" tem uma segunda tentativa como "d oeste".
CREATE OR REPLACE FUNCTION public.trg_veiculo_local()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare bruto text; limpa text; k text; v_uf text; m_nome text; m_uf text; n int; suf text[];
begin
  bruto := nullif(btrim(coalesce(new.cidade, '')), '');
  if bruto is null then new.local_ibge := null; return new; end if;
  if tg_op = 'INSERT' or new.cidade is distinct from old.cidade then
    new.cidade_origem := bruto;
  end if;
  if public.chave_nome(bruto) in ('sem informacao', 'nao informado', 'sem cidade', 'outros locais', 'outros') then
    new.cidade := null; new.patio := null; new.local_ibge := null; return new;
  end if;
  v_uf := upper(nullif(btrim(coalesce(new.estado, '')), ''));
  limpa := bruto;
  suf := regexp_match(bruto, '^(.*\S)\s*(?:/|\s-|\s–|\()\s*([A-Za-z]{2})\s*\)?\s*$');
  if suf is not null and upper(suf[2]) in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB',
                                            'PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO') then
    limpa := btrim(suf[1]);
    if v_uf is null then v_uf := upper(suf[2]); new.estado := v_uf; end if;
  end if;
  if public.chave_nome(limpa) = 'porto trombetas' then
    new.patio := limpa; limpa := 'Oriximiná'; new.estado := 'PA'; v_uf := 'PA';
  end if;
  if limpa ~* '\s+(i{1,3}|iv|vi{0,3})$' then
    new.patio := limpa;
    limpa := btrim(regexp_replace(limpa, '\s+(i{1,3}|iv|vi{0,3})$', '', 'i'));
  end if;
  k := public.chave_nome(limpa);

  for i in 1..2 loop
    select a.nome, a.uf into m_nome, m_uf from area_urbana_municipio a
     where public.chave_nome(a.nome) = k and a.uf = v_uf limit 1;
    if m_nome is null then
      select count(*) into n from area_urbana_municipio a where public.chave_nome(a.nome) = k;
      if n = 1 then
        select a.nome, a.uf into m_nome, m_uf from area_urbana_municipio a where public.chave_nome(a.nome) = k;
      end if;
    end if;
    exit when m_nome is not null or k !~ ' do oeste$';
    k := regexp_replace(k, ' do oeste$', ' d oeste');
  end loop;
  if m_nome is null and v_uf is not null and length(k) >= 5 then
    select count(*) into n from area_urbana_municipio a where a.uf = v_uf and public.chave_nome(a.nome) like '% ' || k;
    if n = 1 then
      select a.nome, a.uf into m_nome, m_uf from area_urbana_municipio a where a.uf = v_uf and public.chave_nome(a.nome) like '% ' || k;
    end if;
  end if;
  if m_nome is null and v_uf is not null then
    select a.nome, a.uf into m_nome, m_uf from area_urbana_municipio a
     where a.uf = v_uf and length(a.nome) >= 4 and k like '% ' || public.chave_nome(a.nome)
     order by length(a.nome) desc limit 1;
  end if;
  if m_nome is not null then
    new.cidade := m_nome; new.estado := m_uf; new.local_ibge := true;
  else
    new.cidade := initcap(limpa); new.local_ibge := false;
  end if;
  return new;
end $function$;

-- Reprocessa só os que estão fora do IBGE (o gatilho dispara em UPDATE OF cidade).
update public.veiculos_leilao set cidade = coalesce(cidade_origem, cidade)
 where ativo and local_ibge = false;
