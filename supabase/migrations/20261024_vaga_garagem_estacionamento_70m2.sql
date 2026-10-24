-- 24/10 (dono reforçou: "descarte vagas de garagem"). Espelho de ehVagaGaragem (scripts/lib/scraper-core.mjs):
-- + `estacionamento` no início do título e guarda de área 45 → 70 m² (vaga com área total > 45 escapava).
-- Medido no acervo ativo: só gl_28966 e ljud_222819 mudam (box de loja e galpão "garagem/depósito" ficam).
create or replace function public.vaga_garagem_barrada(p_titulo text, p_descricao text)
 returns boolean
 language plpgsql
 immutable
 set search_path to 'public'
as $function$
-- Aplica a regra acervo.vaga_garagem: lote que E so vaga/box de garagem nao entra no acervo.
declare
  tit text := coalesce(p_titulo, '');
  t text;
  seg text;
  re_inicio text := '^((uma?|01|02|03|04|duas|tr[eê]s|[0-9]{1,2})\s*(\([^)]*\)\s*)?)?(vagas?|box(es)?|garage(m|ns)|estacionamentos?)\M';
  m text[];
  area numeric;
  d text;
begin
  t := regexp_replace(lower(tit), '^\s*(\(?\s*lote\s*[0-9]+\s*\)?\s*[-:]?\s*|oportunidade\s*:\s*|im[oó]vel\s*:\s*|[-–:.\s]+|[0-9]+\s*[-–.)]\s+)*', '');
  seg := case when tit ~ '^[A-Z]{2}\s+-\s' and position('|' in tit) > 0 then btrim(lower(split_part(tit, '|', 2))) else '' end;
  if not (t ~ re_inicio or seg ~ re_inicio) then return false; end if;
  if tit ~* '(apartament|\mapto\M|\mcasa\M|sobrado|\msala\M|\mloja\M|terreno|pr[eé]dio|galp[aã]o|cobertura|kitnet|\mstudio\M|\mflat\M|conjunto\s+comercial)' then return false; end if;
  for m in select regexp_matches(tit, '([0-9]{1,3}(\.[0-9]{3})+(,[0-9]+)?|[0-9]+([.,][0-9]+)?)\s*m(²|2)', 'gi') loop
    area := nullif(replace(replace(m[1], '.', ''), ',', '.'), '')::numeric;
    if area >= 70 then return false; end if;
  end loop;
  d := regexp_replace(lower(left(coalesce(p_descricao, ''), 260)), '^\s*(matr[ií]cula\s*:?\s*|bem\s*:?\s*|im[oó]vel\s*:?\s*|descri[cç][aã]o\s*:?\s*|(os\s+)?direitos\s+(aquisitivos\s+)?(sobre|do|da|de)\s+(o|a)?\s*|[0-9]+[.)]\s*|\(?[0-9]+\)?\s*(um|uma)?\s*\)?\s*)*', '');
  if d ~ '^(o\s+|a\s+|um\s+|uma\s+)?(apartament|casa\M|sobrado|sala\M|loja\M|terreno|pr[eé]dio|galp[aã]o|cobertura|unidade\s+aut[oô]noma\s+residencial)' then return false; end if;
  return true;
end $function$;
