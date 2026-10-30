-- 30/10 — auditoria_regras_negocio() acusou 2 críticos: a função aplicadora precisa CITAR a chave da regra no próprio
-- corpo (é o vínculo que a auditoria confere). Só comentários entram; o comportamento das duas funções não muda.
--   acervo.fracao_ideal          → fracao_ideal_barrada (já não citava antes de 20261030_fracao_sala_do_edificio)
--   oportunidade.veiculo_sucata  → veiculo_barrar_fora_do_acervo (nova em 20261030_veiculo_sucata_fora_do_acervo)
CREATE OR REPLACE FUNCTION public.fracao_ideal_barrada(p_titulo text, p_descricao text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- regra acervo.fracao_ideal (regra_negocio): fração/parte ideal fica fora do acervo; cota de condomínio não é fração.
  with t as (select
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(p_titulo,'') || ' ' || coalesce(p_descricao,''),
      'parte\s+ideal\s+de\s+[0-9][0-9.,]*\s*m[²2]\s*,?\s*(n[oa]s?|sobre\s+[oa]s?)\s+([áa]reas?\s+(de\s+uso\s+)?comu(m|ns)|terreno|solo|coisas\s+comuns)', ' fração ideal do terreno ', 'gi'),
      'fundos?\s+de\s+investimentos?\s+em\s+direitos\s+credit[óo]rios(\s+n[ãa]o[\s-]padronizados?)?', ' ', 'gi'),
      '(respectiv[ao]s?|correspondentes?)\s+fra[çc](ão|ao|ões|oes)\s+idea(l|is)', ' fração ideal do terreno ', 'gi'),
      'fra[çc](ões|oes)\s+ideais\s+(de\s+)?([0-9])', 'fração ideal de \3', 'gi') as txt)
  select
    coalesce(p_titulo,'') ~* '(parte\s+ideal|fra[çc][ãa]o\s+ideal|fra[çc][õo]es\s+ideais|direitos?\s+credit[óo]rio|nua[\s-]propriedade)'
    or coalesce(p_titulo,'') ~* '(^|[^0-9/])[0-9]{1,3}\s*/\s*[0-9]{1,3}\s*(\([^)]{0,20}\)\s*)?(avos\s+)?(d[oa]s?|de(\s+uma?)?|sobre\s+[oa])\s+(im[oó]vel|bem|pr[eé]dio|casa|apartamento|lote)\M'
    or coalesce(p_titulo,'') ~* '(^|[^0-9,.])[0-9]{1,2}([.,][0-9]+)?\s*%\s*(\([^)]{0,20}\)\s*)?(d[oa]s?|de(\s+uma?)?|sobre\s+[oa])\s+(im[oó]ve(l|is)|bem|pr[eé]dio|casa|apartamento|lote|terreno|gleba|fazenda|s[íi]tio|ch[áa]cara|sala|loja|galp)'
    or (select txt from t) ~* '(parte\s+ideal|fra[çc][õo]es\s+ideais|direitos?\s+credit[óo]rio|nua[\s-]propriedade)'
    or (select txt from t) ~* 'fra[çc][ãa]o\s+ideal\s+(de\s+)?[0-9][0-9.,/]*\s*%?\s*(sobre|d[oa])[\])]?\s+(o\s+|a\s+|um\s+|uma\s+)?(im[óo]ve(l|is)|casa|bem|bens|sorte|gleba|fazenda|s[íi]tio|ch[áa]cara|pr[ée]dio|terra|[áa]rea\s+rural)'
    or (select txt from t) ~* '[0-9][0-9.,]*\s*%\s+d[ao]s?\s+(cota|fra[çc][ãa]o)\s+ideal'
    or (
      (select txt from t) ~* 'fra[çc][ãa]o\s+ideal'
      and not (
        (
          (select txt from t) ~* 'fra[çc][ãa]o\s+ideal\s+de\s+[0-9][0-9./,]*\s*%?\s*(no|do|na|da|nas|das|em|sobre)\s+(o\s+|a\s+|os\s+|as\s+)?([áa]rea|terreno|solo)'
          or (select txt from t) ~* 'fra[çc][ãa]o\s+ideal\s+(de\s+|do\s+|no\s+|na\s+|em\s+|sobre\s+)?(o\s+|a\s+)?(terreno|solo|[áa]rea\s+comum)\s*(condominial\s*)?(e\s+[^,;.]{0,40})?\s*(de\s+|em\s+)?[0-9]'
          or (select txt from t) ~* '(no|do|ao)\s+(terreno|solo)\s+(uma\s+|a\s+)?fra[çc][ãa]o\s+ideal\s+de\s+[0-9]'
          or (select txt from t) ~* 'fra[çc][ãa]o\s+ideal[^.;]{0,60}?\m(terreno|solo|[áa]rea\s+comum|dom[íi]nio\s+[úu]til)'
          or (select txt from t) ~* 'fra[çc][ãa]o\s+ideal\s*(\([^)]{0,20}\))?\s*:?\s*(de\s+)?[0-9]'
          or (select txt from t) ~* '[0-9][0-9.,]*\s*%\s+de\s+fra[çc][ãa]o\s+ideal'
          or (select txt from t) ~* '(terreno|privativa)\s*/?\s*\(?\s*fra[çc][ãa]o\s+ideal'
          or (select txt from t) ~* 'terreno\s*:?\s*[0-9][0-9.,]*\s*m[²2]\s*\(\s*fra[çc][ãa]o\s+ideal\s*\)'
        )
        and (select txt from t) ~* '(condom[íi]nio|[áa]rea\s+privativa|[áa]rea\s+[úu]til|[áa]rea\s+real|unidade\s+aut[ôo]noma|coisas\s+comuns|[áa]reas\s+comuns|coisas\s+de\s+uso\s+comum|apartamento|\mcasa\M|sobrado|\mloja\M|\msalas?\s+(comercia(l|is)\s+)?(n[º°o.]*\s*)?[0-9]+[^.;]{0,40}?\medif[íi]cio|[áa]rea\s+(total\s+)?constru[íi]da|[áa]rea\s+edificada|vagas?\s+(de\s+|na\s+)?garagem)'
      )
    );
$function$;

create or replace function public.veiculo_barrar_fora_do_acervo()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  -- regra oportunidade.veiculo_sucata (regra_negocio): sucata e bem em posse do executado ficam fora do acervo.
  if new.ativo and coalesce(new.is_sucata, false) then
    new.ativo := false;
    new.suprimido_motivo := 'sucata';
  elsif new.ativo and new.status_patio = 'excluido' then
    new.ativo := false;
    new.suprimido_motivo := 'posse_do_executado';
  end if;
  return new;
end;
$function$;
