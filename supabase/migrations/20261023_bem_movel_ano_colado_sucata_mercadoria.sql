-- 23/10 — invariante `estado_fora_do_padrao` em 33 → 0. Medido: 23 dos 33 NEM ERAM IMÓVEL, e passaram pelo
-- filtro `bem_movel_barrado` (regra_negocio 'acervo.bem_movel') por três formas que ele não conhecia:
--   • ano/modelo COLADO, sem barra: ALFA monta o título pelo slug da URL — "Boituva Sp Volkswagen Novo Fox
--     Cl Ma 20142015" (5 motos/carros);
--   • "SUCATA - AUTOMÓVEL CHEVROLET CORSA" (LEILOTECH/Topo, 1);
--   • mercadoria por quantidade: "APROX. 833 CAPAS DE DIVERSAS MARCAS" (FRAZAO, 17).
-- Teste em seco sobre o acervo ativo: os 3 sinais novos pegam exatamente esses 23 e nenhum outro. O
-- contra-sinal imobiliário (casa, terreno, lote, m², matrícula…) continua protegendo, como antes.
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
           coalesce(p_titulo,'') || ' ' || coalesce(p_descricao,'') as bruto
  ), s as (
    select t, bruto,
           (   t ~ '^\s*veiculo\M'
            or t ~ '\m(aeronave|helicoptero|embarcacao|jet ?ski|motocicleta|motoneta|semirreboque|retroescavadeira|empilhadeira)'
            or t ~ '\m(vw|gm|chevrolet|volkswagen|fiat|ford|renault|toyota|honda|hyundai|nissan|peugeot|citroen|scania|iveco|volvo|mercedes)/'
            or t ~ '\m(19|20)\d{2}/(19|20)\d{2}\M'
            -- 23/10: ano/modelo colado (título vindo de slug), sucata/automóvel, mercadoria por quantidade
            or t ~ '\m(19|20)\d{2}(19|20)\d{2}\M'
            or t ~ '^\s*sucata\M' or t ~ '\mautomovel\M'
            or t ~ '^\s*(aprox\.?|aproximadamente)\s+[\d.]+\s+[a-z]') as sinal_titulo
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

-- ⚠️ ÍNDICE PARCIAL DEPENDE DESTA FUNÇÃO: idx_imoveis_bem_movel_barrado (WHERE ativo AND bem_movel_barrado(...)).
-- Trocar o corpo de uma função IMMUTABLE NÃO atualiza o índice: o planner usou o índice velho e
-- `where ativo and bem_movel_barrado(...)` achou ZERO linhas — o reprocessamento "rodou" sem desativar
-- nada (23/10). Ao mudar esta função: REINDEX no mesmo commit, ANTES de qualquer consulta que filtre por ela.
reindex index public.idx_imoveis_bem_movel_barrado;

-- Reprocessa e corrige o dado dos que dizem a cidade no próprio texto ("Casa em Itanhaém SP"; "Vila
-- Andrade/SP" e "Perdizes", distritos de São Paulo; "CORUMBA- GO" = Corumbá de Goiás) — o parser não leu.
do $$
begin
  update public.imoveis_leilao set ativo = false
   where ativo and public.bem_movel_barrado(titulo, descricao);
  update public.imoveis_leilao set cidade = 'Itanhaém', estado = 'SP'
   where fonte_id = 'sbid_5057494' and coalesce(estado, '') = '';
  update public.imoveis_leilao set cidade = 'São Paulo', estado = 'SP'
   where fonte_id in ('sbid_5024394', 'sbid_5065665') and coalesce(estado, '') = '';
  update public.imoveis_leilao set cidade = 'Corumbá de Goiás', estado = 'GO'
   where fonte_id = 'sl_vecchileiloes_2439' and coalesce(estado, '') = '';
end $$;

-- Os 6 restantes: a fonte não publica cidade no que o parser lê. Explicados por 30 dias (pendência 310).
insert into public.qa_invariante_explicada (chave, imovel_id, explicacao, explicado_ate)
select 'estado_fora_do_padrao', i.id,
  '23/10: a fonte não publica cidade/UF no que o parser lê (título "Imóvel" no MILAN e RIGOLON; "nesta cidade" no CASSIANO; loteamento sem município no NAKAKOGUE). Inventar seria pior. Revisar parser: pendência aberta em 23/10.',
  now() + interval '30 days'
from public.imoveis_leilao i
where i.ativo and (i.estado is null or i.estado !~ '^[A-Z]{2}$')
  and i.fonte in ('MILAN','RIGOLONLEILOES','CASSIANO','NAKAKOGUELEILOES')
on conflict do nothing;
