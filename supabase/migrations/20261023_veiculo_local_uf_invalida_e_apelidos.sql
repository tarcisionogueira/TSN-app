-- 23/10 — invariantes `veiculo_uf_invalida` (26, bug) e `veiculo_cidade_fora_do_ibge` (59, acima do piso 30).
-- Medido por fonte:
--   (1) MARCA/MODELO lido como Cidade/UF: FREITAS e JOAOEMILIO — "FORD/KA" → Ford/KA, "HONDA/CG" → Honda/CG,
--       "VOLVO/FH" → Volvo/FH (26 lotes). UF que não existe = o par inteiro veio do título: descarta os DOIS
--       (localização vazia é melhor que errada; o filtro por estado/cidade já não os achava).
--   (2) Grafia: "Santana do Livramento" × IBGE "Sant'Ana do Livramento"; "São Matheus do Sul" × "São Mateus do
--       Sul". A comparação passa a ignorar espaço/apóstrofo e o "th" → "t" (só como último recurso, com a UF).
--   (3) Lugar que não é município: regiões administrativas do DF (Ceilândia, São Sebastião…) → Brasília; Indápolis
--       (distrito de Dourados/MS, 18 lotes LJUD) → Dourados. O nome original vai para `patio`.
-- Fica de fora, de propósito: "Jitocara" (não é município; chutar Itaocara seria inventar) e SUPERBID com cidade
-- sem UF (Campo Grande, Santo André… são ambíguos sem o estado).
CREATE OR REPLACE FUNCTION public.trg_veiculo_local()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare bruto text; limpa text; k text; kc text; v_uf text; m_nome text; m_uf text; n int; suf text[];
  ufs constant text[] := array['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB',
                               'PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
  ras_df constant text[] := array['ceilandia','sao sebastiao','taguatinga','gama','samambaia','sobradinho','sobradinho ii',
    'planaltina','guara','aguas claras','recanto das emas','santa maria','brazlandia','paranoa','riacho fundo',
    'riacho fundo ii','nucleo bandeirante','lago sul','lago norte','cruzeiro','sudoeste','vicente pires','itapoa',
    'estrutural','scia','jardim botanico','park way','varjao','fercal','sol nascente','arniqueira','candangolandia',
    'plano piloto','asa sul','asa norte'];
begin
  bruto := nullif(btrim(coalesce(new.cidade, '')), '');
  if bruto is null then new.local_ibge := null; return new; end if;
  if tg_op = 'INSERT' or new.cidade is distinct from old.cidade then
    new.cidade_origem := bruto;
  end if;
  if public.chave_nome(bruto) in ('sem informacao', 'nao informado', 'nao informando', 'sem cidade', 'outros locais', 'outros') then
    new.cidade := null; new.patio := null; new.local_ibge := null; return new;
  end if;
  v_uf := upper(nullif(btrim(coalesce(new.estado, '')), ''));
  -- (1) UF inexistente: o par cidade/UF não é localização (título MARCA/MODELO). Descarta os dois.
  if v_uf is not null and not (v_uf = any(ufs)) then
    new.cidade := null; new.estado := null; new.patio := null; new.local_ibge := null; return new;
  end if;
  limpa := bruto;
  suf := regexp_match(bruto, '^(.*\S)\s*(?:/|\s-|\s–|\()\s*([A-Za-z]{2})\s*\)?\s*$');
  if suf is not null and upper(suf[2]) = any(ufs) then
    limpa := btrim(suf[1]);
    if v_uf is null then v_uf := upper(suf[2]); new.estado := v_uf; end if;
  end if;
  if public.chave_nome(limpa) = 'porto trombetas' then
    new.patio := limpa; limpa := 'Oriximiná'; new.estado := 'PA'; v_uf := 'PA';
  end if;
  -- (3) Distrito / região administrativa → município (o nome dado vira o pátio).
  -- UF DF obrigatória: "São Sebastião", "Santa Maria", "Gama" também são municípios de outros estados.
  if v_uf = 'DF' and public.chave_nome(limpa) = any(ras_df) then
    new.patio := limpa; limpa := 'Brasília'; new.estado := 'DF'; v_uf := 'DF';
  elsif coalesce(v_uf, 'MS') = 'MS' and public.chave_nome(limpa) = 'indapolis' then
    new.patio := limpa; limpa := 'Dourados'; new.estado := 'MS'; v_uf := 'MS';
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
  -- (2) Último recurso, só com UF: compara sem espaço/apóstrofo e com "th" = "t" (Sant'Ana, Matheus).
  if m_nome is null and v_uf is not null then
    kc := regexp_replace(replace(k, 'th', 't'), '[^a-z]', '', 'g');
    select a.nome, a.uf into m_nome, m_uf from area_urbana_municipio a
     where a.uf = v_uf and regexp_replace(replace(public.chave_nome(a.nome), 'th', 't'), '[^a-z]', '', 'g') = kc limit 1;
  end if;
  if m_nome is not null then
    new.cidade := m_nome; new.estado := m_uf; new.local_ibge := true;
  else
    new.cidade := initcap(limpa); new.local_ibge := false;
  end if;
  return new;
end $function$;

-- Reprocessa os ativos afetados pelo texto ORIGINAL (o gatilho dispara em UPDATE OF cidade).
do $$
begin
  update public.veiculos_leilao
     set cidade = coalesce(cidade_origem, cidade)
   where ativo and (local_ibge = false
     or (estado is not null and estado !~ '^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$'));
end $$;
