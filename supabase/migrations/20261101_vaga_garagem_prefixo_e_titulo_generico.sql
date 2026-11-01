-- 01/11 (#322) — espelho de ehVagaGaragem (scripts/lib/scraper-core.mjs; teste em scripts/testes/vaga-garagem.mjs).
-- (1) Prefixos "(CANOAS/RS) " e "DIREITOS E AÇÕES SOBRE O " antes do box (RAUPP 6597 escapava).
-- (2) Título genérico ("Imóvel", "Lote 3", "Mat. 2.636"): decide pelo começo da descrição (ALEMAO 14685: "BOX 02 do edifício…").
create or replace function public.vaga_garagem_barrada(p_titulo text, p_descricao text)
returns boolean language plpgsql immutable set search_path to 'public' as $function$
-- Aplica a regra acervo.vaga_garagem: lote que E so vaga/box de garagem nao entra no acervo.
declare
  tit text := coalesce(p_titulo, '');
  t text;
  seg text;
  re_inicio text := '^((uma?|01|02|03|04|duas|tr[eê]s|[0-9]{1,2})\s*(\([^)]*\)\s*)?)?(vagas?|box(es)?|garage(m|ns)|estacionamentos?)\M';
  re_unidade text := '(apartament|\mapto\M|\mcasa\M|sobrado|\msala\M|\mloja\M|terreno|pr[eé]dio|galp[aã]o|cobertura|kitnet|\mstudio\M|\mflat\M|conjunto\s+comercial)';
  re_desc_prefixo text := '^\s*(matr[ií]cula\s*:?\s*|bem\s*:?\s*|im[oó]vel\s*:?\s*|descri[cç][aã]o\s*:?\s*|(os\s+)?direitos\s+(aquisitivos\s+)?(sobre|do|da|de)\s+(o|a)?\s*|[0-9]+[.)]\s*|\(?[0-9]+\)?\s*(um|uma)?\s*\)?\s*)*';
  m text[];
  area numeric;
  d text;
begin
  d := regexp_replace(lower(left(coalesce(p_descricao, ''), 260)), re_desc_prefixo, '');
  if tit ~* '^\s*(im[oó]vel|lote\s*[0-9]*|mat(r[ií]cula)?\.?\s*(n[º°o.]*\s*)?[0-9.]+)\s*$' then
    return d ~ re_inicio and not (left(d, 120) ~* re_unidade);
  end if;
  t := regexp_replace(lower(tit), '^\s*(\(?\s*lote\s*[0-9]+\s*\)?\s*[-:]?\s*|oportunidade\s*:\s*|im[oó]vel\s*:\s*|\(\s*[a-zà-ú'' .-]{2,40}\s*/\s*[a-z]{2}\s*\)\s*|(os\s+)?direitos(\s+e\s+a[çc][õo]es)?\s+(aquisitivos\s+)?(sobre|do|da|de)\s+(o|a)?\s*|[-–:.\s]+|[0-9]+\s*[-–.)]\s+)*', '');
  seg := case when tit ~ '^[A-Z]{2}\s+-\s' and position('|' in tit) > 0 then btrim(lower(split_part(tit, '|', 2))) else '' end;
  if not (t ~ re_inicio or seg ~ re_inicio) then return false; end if;
  if tit ~* re_unidade then return false; end if;
  for m in select regexp_matches(tit, '([0-9]{1,3}(\.[0-9]{3})+(,[0-9]+)?|[0-9]+([.,][0-9]+)?)\s*m(²|2)', 'gi') loop
    area := nullif(replace(replace(m[1], '.', ''), ',', '.'), '')::numeric;
    if area >= 70 then return false; end if;
  end loop;
  if d ~ '^(o\s+|a\s+|um\s+|uma\s+)?(apartament|casa\M|sobrado|sala\M|loja\M|terreno|pr[eé]dio|galp[aã]o|cobertura|unidade\s+aut[oô]noma\s+residencial)' then return false; end if;
  return true;
end $function$;

-- Backfill: desde 20261101_gatilhos_imovel_pulam_o_que_nao_mudou a barreira não reprocessa lote ativo de texto igual —
-- regra nova vem com o desligamento junto. Medido em seco (01/11): 12 lotes, todos box/vaga (ALEMAO 14684/85/86/943/946,
-- MEGA 130541/551/552, GRANDESLEIL 9697/9698, TURANI 3248/5661); nenhum lote deixa de ser barrado.
update public.imoveis_leilao
   set ativo = false, suprimido_motivo = 'vaga_garagem'
 where ativo and public.vaga_garagem_barrada(titulo, descricao);
