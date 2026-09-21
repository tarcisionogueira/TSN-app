-- Achado ao vivo do dono (21/09): "Fiat Fiorino 2008" apareceu misturado nos resultados de
-- imóveis (leiloeiro IRANI FLORES/LEILAOBRASIL). `bem_movel_barrado()` já existe pra bloquear
-- exatamente isso, mas só olhava o TÍTULO (`t`) pros padrões positivos de veículo — a
-- descrição ("Veículo da marca Fiat, modelo Fiorino Flex... chassi 9BD25504988826533,
-- RENAVAM...") nunca era lida pra decidir. Título sozinho não bate em nenhum padrão
-- (não é "FIAT/algo", não é "AAAA/AAAA", não começa com "veiculo") — a regra tinha o dado
-- certo do lado errado da checagem.
--
-- Adiciona 2 padrões novos, agora contra `td` (título+descrição), que são praticamente
-- exclusivos de veículo — nunca aparecem em descrição de imóvel de verdade:
--   - "veiculo" em qualquer lugar do texto (antes só valia se fosse a 1ª palavra do TÍTULO)
--   - "chassi" / "renavam" — identificadores que só existem pra veículo
-- A mesma exclusão por palavra de imóvel (apartamento/casa/terreno/...) continua valendo
-- depois, então uma vaga de garagem num apartamento ("vaga para veículo") não é bloqueada.
--
-- Medido ANTES de aplicar (não suposição): 15 imóveis ativos passam a ser barrados com a
-- correção — todos os 15 conferidos manualmente são veículo de verdade (carros, motos,
-- caminhão), incluindo um caso via EDITAL_DJEN cujo "título" virou o ENDEREÇO onde a moto
-- estava parada (a extração pegou o endereço do edital, não percebeu que o bem descrito era
-- uma motocicleta). Esses 15 são desativados nesta mesma migração — a correção da função
-- sozinha não teria efeito neles, porque `ativo=true` já estava gravado antes da correção.
create or replace function public.bem_movel_barrado(p_titulo text, p_descricao text)
returns boolean
language sql
immutable
set search_path to 'public', 'pg_temp'
as $function$
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
     -- 21/09: os dois de baixo checam `td` (titulo+descricao), nao so o titulo — a lacuna
     -- que deixou "Fiat Fiorino 2008" passar (a descricao dizia "Veiculo da marca Fiat...
     -- chassi... RENAVAM", so nao era o titulo).
     or td ~ '\mveiculo\M'
     or td ~ '\m(chassi|renavam)\M')
    and not (td ~ '\m(apartamento|casa|terreno|lote|gleba|sala|loja|galp[ao]|chacara|sitio|fazenda|predio|edificio|garagem|vaga|imovel|matricula|area (construida|privativa|total|do terreno)|m2|m²|quadra)')
  from n;
$function$;

-- ⚠️ ARMADILHA REAL, pega na hora de aplicar esta própria migração: existe um índice parcial
-- `idx_imoveis_bem_movel_barrado` sobre `WHERE (ativo AND bem_movel_barrado(titulo,
-- descricao))`. Trocar o CORPO de uma função IMMUTABLE via CREATE OR REPLACE NÃO recalcula
-- índices que dependem dela — o Postgres não sabe que o resultado mudou. Sem o REINDEX
-- abaixo, o UPDATE seguinte usaria o índice ANTIGO no plano de consulta e afetaria 0 linhas,
-- SILENCIOSAMENTE — a função corrigida diria `true` se chamada direto numa linha, mas a busca
-- via índice continuaria dizendo `false` pras mesmas linhas. Sem o REINDEX, esta migração
-- pareceria ter funcionado (sem erro) e não teria feito nada.
reindex index idx_imoveis_bem_movel_barrado;

-- Desativa os que a lacuna já tinha deixado entrar (medido: 15, todos confirmados veiculo).
update imoveis_leilao
set ativo = false, suprimido_motivo = 'bem_movel_barrado (correção 21/09 — bem móvel detectado só pela descrição)'
where ativo and public.bem_movel_barrado(titulo, descricao);
