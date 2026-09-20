-- Achado ao vivo, 21/09 (print do dono: lote SODRE "HONDA CG 160 CARGO" mostrando VENDIDO/
-- R$9.000 claramente na página, nosso sistema apurou 'indeterminado'). Investigação confirmou:
-- SODRE é um app Nuxt renderizado no cliente — o HTML estático que buscamos não contém a
-- palavra "vendido" em lugar nenhum (nem no texto visível, nem em atributo/JSON de topo); o
-- resultado só existe depois de hidratação JS (ou numa chamada de API que só o navegador faz).
-- Não é bug de regex — é limite do método (fetch de texto, sem headless browser).
--
-- Adicionada a FONTES_APURACAO_NAO_CONFIAVEL em api/apurar-resultado-leilao-cron.js (junto com
-- PESTANA/EDITAL_DJEN, por outro motivo). SODRE nunca teve falso 'vendido' (todas as 44
-- tentativas — 1 imóvel + 43 veículos — deram 'indeterminado', nunca inventou um resultado),
-- mas como o filtro "Sem lance" agora agrupa 'indeterminado' junto (pedido do dono, mesma
-- sessão), deixar essas linhas em 'indeterminado' faria SODRE inundar aquele filtro de ruído
-- pra sempre, já que nunca seria reapurado com sucesso. Reset pra NULL: cai em "ainda não
-- apurado" (honesto — não tentamos mais, não fingimos uma tentativa que não resolve) em vez de
-- "indeterminado" (que soa como "tentamos e a página não disse", quando na verdade a página
-- nunca teria como dizer pelo nosso método).
update public.imoveis_leilao
set resultado_leilao = null, valor_lance_vencedor = null, resultado_apurado_em = null, resultado_apuracao_tentativas = 0
where fonte = 'SODRE' and resultado_leilao is not null;

update public.veiculos_leilao
set resultado_leilao = null, valor_lance_vencedor = null, resultado_apurado_em = null, resultado_apuracao_tentativas = 0
where fonte = 'SODRE' and resultado_leilao is not null;
