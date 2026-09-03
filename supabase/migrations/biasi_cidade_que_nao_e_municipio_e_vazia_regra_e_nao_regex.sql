-- 01/09 — fecha o backfill do BIASI pela MESMA regra do parser, e não por regex.
--
-- O `update ... from` da migração anterior só alcança quem CASOU no join, então as linhas
-- sem município reconhecido ficaram com o lixo antigo. Isso importa por dois motivos, e o
-- segundo é o pior: (a) a cidade errada continuaria visível na Busca; (b) o scraper, ao
-- passar de novo, gravaria '' nessas mesmas linhas — banco e coletor discordando sobre o
-- mesmo lote, divergência CRIADA por este backfill, não herdada da fonte.
--
-- A primeira tentativa limpou por assinatura ("tem ' - '", "começa com tipo de imóvel") e
-- sobrou uma: cidade = "Rdim Das Acácias Em Paraíso De Tocantins" — sem hífen e começando
-- com "Rdim", que não é palavra nenhuma. É o regex antigo cortando no MEIO de "Jardim" ao
-- bater no teto de 40 caracteres da classe `{2,40}`.
--
-- Perseguir isso com mais regex é repetir o erro que gerou o defeito. A regra correta é a
-- mesma que `api/_cidade-do-titulo.js` passou a aplicar: **cidade que não é município
-- daquela UF não é cidade.** Vale para esta linha e para qualquer forma futura de lixo.
--
-- Sobram 4, todos erro DA FONTE, e VAZIO é a resposta certa para os quatro:
--   "Apartamento - Vila Tupi - Várzea Grande/SP" — Várzea Grande é MT, não SP
--   "Imóvel em São José - Encantando/RS"         — o município é Encantado
--   "…Messejana - Messejana/CE"                  — Messejana é bairro de Fortaleza
--   "06 Terrenos … em Paraíso de Tocantins/TO"   — o município é Paraíso DO Tocantins
-- Cidade vazia o invariante `sem_cidade` enxerga e cobra. Cidade errada é invisível.
--
-- A exceção 'São Caetano' (PE) é a mesma da migração anterior: o município existe no IBGE
-- e falta em `cidade_socio`. Sem preservá-la aqui, esta limpeza apagaria a cidade correta
-- que a migração anterior acabou de gravar.
update public.imoveis_leilao i
   set cidade = ''
 where i.ativo and i.fonte = 'BIASI'
   and coalesce(i.cidade, '') <> ''
   and i.cidade <> 'São Caetano'
   and not exists (
     select 1 from public.cidade_socio cs
      where cs.nivel = 'cidade' and cs.uf = i.estado
        and cs.cidade_norm = regexp_replace(lower(translate(i.cidade,
              'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
              'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '[^a-z0-9]', '', 'g'));
