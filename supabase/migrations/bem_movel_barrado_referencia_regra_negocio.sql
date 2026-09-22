-- Achado pela própria auditoria_regras_negocio() (22/09): a regra `regra_negocio.acervo.bem_movel`
-- já tinha `aplicada_por = ['bem_movel_barrado']` corretamente preenchido, mas o auditor confere
-- se a CHAVE aparece literalmente no CÓDIGO da função (texto, não só metadado) — sem isso, uma
-- função podia trocar de comportamento sem ninguém saber que ainda representa aquela regra.
-- Puramente um comentário — nenhuma mudança de lógica/comportamento (testado antes/depois:
-- mesmo resultado nos casos conhecidos de veículo e imóvel).
CREATE OR REPLACE FUNCTION public.bem_movel_barrado(p_titulo text, p_descricao text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Aplica a regra de negócio "acervo.bem_movel" (ver tabela regra_negocio): bem MÓVEL
  -- (veículo/aeronave/embarcação/máquina) com sinal no TÍTULO é barrado, exceto quando o
  -- texto também tem sinal imobiliário (vaga de garagem, "Iate Clube" etc.).
  with n as (
    select lower(translate(coalesce(p_titulo,''),
             'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
             'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) as t,
           lower(translate(coalesce(p_titulo,'') || ' ' || coalesce(p_descricao,''),
             'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
             'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) as td
  )
  select
    (   t ~ '^\s*veiculo\M'
     or t ~ '\m(aeronave|helicoptero|embarcacao|jet ?ski|motocicleta|motoneta|semirreboque|retroescavadeira|empilhadeira)'
     or t ~ '\m(vw|gm|chevrolet|volkswagen|fiat|ford|renault|toyota|honda|hyundai|nissan|peugeot|citroen|scania|iveco|volvo|mercedes)/'
     or t ~ '\m(19|20)\d{2}/(19|20)\d{2}\M'
     or td ~ '\mveiculo\M'
     or td ~ '\m(chassi|renavam)\M')
    and not (td ~ '\m(apartamento|casa|terreno|lote|gleba|sala|loja|galp[ao]|chacara|sitio|fazenda|predio|edificio|garagem|vaga|imovel|matricula|area (construida|privativa|total|do terreno)|m2|m²|quadra)')
  from n;
$function$;
