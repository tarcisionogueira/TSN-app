-- ─────────────────────────────────────────────────────────────────────────────────────────
-- #237 (20/10): qa_invariantes() levava 13-18 s, e 12 s eram desta função no invariante bem_movel_no_acervo.
-- O custo era o lower(translate(...)) sobre título + DESCRIÇÃO inteira de cada lote ativo (19,5 mi de caracteres
-- em 29,5 mil lotes; translate multibyte ≈ 5 s por passada) — e o `td` aparecia 3× no corpo.
-- Mesma regra, mesma resposta: o resultado só pode ser true se o TÍTULO bater (barato) ou se o texto tiver
-- veiculo/chassi/renavam. O pré-filtro procura essas três palavras no texto CRU com cada letra na classe de todas
-- as formas que o translate/lower levariam a ela (maiúscula, minúscula e acentos da lista). Isso é um SUPERCONJUNTO
-- exato do teste original sobre `td`, sem fronteira de palavra. Só quando ele passa a função paga o translate.
-- Equivalência conferida no acervo ativo inteiro contra a versão anterior antes de aplicar.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.bem_movel_barrado(p_titulo text, p_descricao text)
 returns boolean
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
  -- Aplica a regra de negócio "acervo.bem_movel" (ver tabela regra_negocio): bem MÓVEL
  -- (veículo/aeronave/embarcação/máquina) com sinal no TÍTULO é barrado, exceto quando o
  -- texto também tem sinal imobiliário (vaga de garagem, "Iate Clube" etc.).
  with n as (
    select lower(translate(coalesce(p_titulo,''),
             'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
             'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) as t,
           coalesce(p_titulo,'') || ' ' || coalesce(p_descricao,'') as bruto
  ), s as (
    select t, bruto,
           (   t ~ '^\s*veiculo\M'
            or t ~ '\m(aeronave|helicoptero|embarcacao|jet ?ski|motocicleta|motoneta|semirreboque|retroescavadeira|empilhadeira)'
            or t ~ '\m(vw|gm|chevrolet|volkswagen|fiat|ford|renault|toyota|honda|hyundai|nissan|peugeot|citroen|scania|iveco|volvo|mercedes)/'
            or t ~ '\m(19|20)\d{2}/(19|20)\d{2}\M') as sinal_titulo
      from n
  )
  select case
    when not sinal_titulo
         and bruto !~ ('[Vv][EeéèêëÉÈÊË][IiíìîïÍÌÎÏ][CcçÇ][UuúùûüÚÙÛÜ][Ll][OoóòôõöÓÒÔÕÖ]'
                    || '|[CcçÇ][Hh][AaáàâãäÁÀÂÃÄ][Ss][Ss][IiíìîïÍÌÎÏ]'
                    || '|[Rr][EeéèêëÉÈÊË][Nn][AaáàâãäÁÀÂÃÄ][Vv][AaáàâãäÁÀÂÃÄ][Mm]')
      then false
    else (
      select (sinal_titulo or td ~ '\mveiculo\M' or td ~ '\m(chassi|renavam)\M')
         and not (td ~ '\m(apartamento|casa|terreno|lote|gleba|sala|loja|galp[ao]|chacara|sitio|fazenda|predio|edificio|garagem|vaga|imovel|matricula|area (construida|privativa|total|do terreno)|m2|m²|quadra)')
        from (select lower(translate(bruto,
               'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
               'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) as td) d)
  end
  from s;
$function$;
