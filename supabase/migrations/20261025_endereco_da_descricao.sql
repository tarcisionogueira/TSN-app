-- ENDEREÇO PELA DESCRIÇÃO (25/10, dono: "se temos o endereço completo do imóvel, por que não localizou no mapa?").
--
-- Caso: LJUD Feira de Santana — a descrição diz "Rua Visconde do Rio Branco, 920, Tanque da Nação, Feira de
-- Santana/BA", mas `endereco` vinha vazio (o coletor do LJUD grava ''), e o mapa caía no nível bairro. Medido no
-- acervo ativo sem endereço: ~280 lotes têm o endereço nesta forma (SUPERBID 125, LJUD 114, DJEN 13, VLANCE 11…).
--
-- Regra ESTRITA, porque descrição costuma ser texto de matrícula e a 1ª rua achada ali pode ser o CONFRONTANTE
-- (scripts/lib/endereco-pagina.mjs): só vale "<Rua|Av…> X, <nº>, <bairro>, <Cidade>/<UF>" com a Cidade igual à do
-- PRÓPRIO lote, e nunca logo depois de "confronta/limita/divisa/lado/fundos/frente para/esquina".
-- Segunda opção do gatilho preservar_e_derivar_endereco (a 1ª é o título). Ganhou endereço → geocod_nivel
-- 'refazer' quando o ponto atual é cidade/bairro/falhou, e a fila de geocode refaz. Sem backfill manual: a próxima
-- escrita de cada coletor passa pelo gatilho.
create or replace function public.endereco_da_descricao(p_desc text, p_cidade text)
 returns text[]
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
  with m as (
    select regexp_match(coalesce(p_desc,''),
      '(((?:Rua|R\.|Avenida|Av\.|Travessa|Estrada|Alameda|Pra[çc]a|Rodovia|Largo|Rod\.)\s+[^,;:()]{3,70}?),\s*(?:n[º°o.]?\s*)?(\d{1,5}[A-Za-z]?)\s*,\s*([^,;/]{2,50}?)\s*,\s*([^,;/]{2,60}?)\s*/\s*([A-Z]{2})\y)', 'i') as g
  )
  select case
    when g is null then null
    when right(left(p_desc, strpos(p_desc, g[1]) - 1), 60) ~* '(confront|limit|divis|lado|fundos|frente para|esquina)' then null
    when lower(translate(btrim(g[5]),'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ','aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
       <> lower(translate(btrim(coalesce(p_cidade,'')),'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ','aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) then null
    else array[
      left(btrim(g[2]) || ', ' || g[3], 150),
      left(btrim(regexp_replace(btrim(g[4]), '^(?:(?:no|na|em)\s+)?(?:bairro\s+)?', '', 'i')), 80)
    ]
  end from m;
$function$;

create or replace function public.preservar_e_derivar_endereco()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare v_novo text; v_desc text[];
begin
  if tg_op <> 'INSERT' then
    if coalesce(btrim(new.endereco),'') = '' and coalesce(btrim(old.endereco),'') <> '' then
      new.endereco := old.endereco;
    end if;
    if coalesce(btrim(new.bairro),'') = '' and coalesce(btrim(old.bairro),'') <> '' then
      new.bairro := old.bairro;
    end if;
    if coalesce(btrim(new.cidade),'') = '' and coalesce(btrim(old.cidade),'') <> '' then
      new.cidade := old.cidade;
    end if;
    if coalesce(new.estado,'') !~ '^[A-Za-z]{2}$' and coalesce(old.estado,'') ~ '^[A-Za-z]{2}$' then
      new.estado := old.estado;
    end if;
    -- Ganhou cidade ou UF válida agora: a coordenada atual (ou a falta dela) foi decidida sem isso.
    if ((coalesce(btrim(old.cidade),'') = '' and coalesce(btrim(new.cidade),'') <> '')
        or (coalesce(old.estado,'') !~ '^[A-Z]{2}$' and coalesce(new.estado,'') ~ '^[A-Z]{2}$'))
       and coalesce(new.geocod_nivel,'') in ('', 'cidade', 'falhou') then
      new.geocod_nivel := 'refazer';
    end if;
  end if;

  if coalesce(btrim(new.endereco),'') = '' then
    v_novo := public.endereco_do_titulo(new.titulo, new.cidade);
    if v_novo is not null then
      new.endereco := v_novo;
      -- Pede regeocode: a coordenada atual é fallback de cidade. Sem isto o endereço fica
      -- certo e o PONTO continua errado, que é metade do defeito.
      if coalesce(new.geocod_nivel,'') in ('', 'cidade', 'falhou') then
        new.geocod_nivel := 'refazer';
      end if;
    end if;
  end if;

  -- 25/10: 2ª opção, a descrição (regra estrita em endereco_da_descricao). Bairro só se vazio.
  if coalesce(btrim(new.endereco),'') = '' then
    v_desc := public.endereco_da_descricao(new.descricao, new.cidade);
    if v_desc is not null then
      new.endereco := v_desc[1];
      if coalesce(btrim(new.bairro),'') = '' and coalesce(v_desc[2],'') <> '' then new.bairro := v_desc[2]; end if;
      if coalesce(new.geocod_nivel,'') in ('', 'cidade', 'bairro', 'falhou') then
        new.geocod_nivel := 'refazer';
      end if;
    end if;
  end if;
  return new;
end $function$;
