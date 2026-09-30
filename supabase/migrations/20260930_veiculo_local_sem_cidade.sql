-- 30/09: invariante veiculo_cidade_fora_do_ibge em 82 (limite 30). Além dos 27 da LJUD corrigidos pelo
-- título e dos 17 "Campo Grande" da SUPERBID sem UF (coordenada = MS), dois casos de REGRA:
--  • SODRÉ "Outros Locais" (12): não é cidade. Vira "sem cidade" (local_ibge NULL = não informado),
--    não "cidade que não casa com o IBGE" (false = formato novo a investigar) — os dois não se somam.
--  • "Porto Trombetas"/PA (12, SUPERBID): distrito de Oriximiná/PA. O pátio guarda o nome do distrito.
create or replace function public.trg_veiculo_local() returns trigger
language plpgsql set search_path = public as $f$
declare bruto text; limpa text; k text; v_uf text; m_nome text; m_uf text; n int;
begin
  bruto := nullif(btrim(coalesce(new.cidade, '')), '');
  if bruto is null then new.local_ibge := null; return new; end if;
  if tg_op = 'INSERT' or new.cidade is distinct from old.cidade then
    new.cidade_origem := bruto;
  end if;
  if public.chave_nome(bruto) in ('sem informacao', 'nao informado', 'sem cidade', 'outros locais', 'outros') then
    new.cidade := null; new.patio := null; new.local_ibge := null; return new;
  end if;
  limpa := btrim(regexp_replace(bruto, '\s*/\s*[A-Za-z]{2}\s*$', ''));
  if public.chave_nome(limpa) = 'porto trombetas' then
    new.patio := limpa; limpa := 'Oriximiná'; new.estado := 'PA';
  end if;
  if limpa ~* '\s+(i{1,3}|iv|vi{0,3})$' then
    new.patio := limpa;
    limpa := btrim(regexp_replace(limpa, '\s+(i{1,3}|iv|vi{0,3})$', '', 'i'));
  end if;
  k := public.chave_nome(limpa);
  v_uf := upper(nullif(btrim(coalesce(new.estado, '')), ''));

  select a.nome, a.uf into m_nome, m_uf from area_urbana_municipio a
   where public.chave_nome(a.nome) = k and a.uf = v_uf limit 1;
  if m_nome is null then
    select count(*) into n from area_urbana_municipio a where public.chave_nome(a.nome) = k;
    if n = 1 then
      select a.nome, a.uf into m_nome, m_uf from area_urbana_municipio a where public.chave_nome(a.nome) = k;
    end if;
  end if;
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
end $f$;

-- reaplica nos dois grupos (o gatilho roda em update de cidade)
update public.veiculos_leilao set cidade = coalesce(cidade_origem, cidade)
 where ativo and local_ibge = false and public.chave_nome(coalesce(cidade_origem, cidade)) in ('outros locais', 'porto trombetas');
