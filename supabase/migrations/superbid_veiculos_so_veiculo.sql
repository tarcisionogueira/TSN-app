-- 25/09 (print do dono: "Rodas de Land Rover" na busca de veículos). O coletor de veículos
-- SUPERBID aceitava qualquer "moto…" (Motobombas, Motores Elétricos, Motoniveladoras…) e as
-- peças de "Carros & Motos" (rodas, pneus, motores, acessórios). O coletor foi corrigido
-- (`ehVeiculoSuperbid` em scripts/scraper-puppeteer.mjs); aqui sai da vitrine o que já entrou
-- (seco: 453 de 7.224 ativos). Só desliga — a linha fica. Mesma regra do coletor.
update public.veiculos_leilao
   set ativo = false
 where fonte = 'SUPERBID' and ativo
   and not (
     coalesce(raw->'product'->'productType'->>'description', '') ~* '(carros?\s*&\s*motos|caminh[õo]es|[ôo]nibus|ve[ií]cul)'
     and coalesce(raw->'product'->'subCategory'->>'description', '') !~* '(pe[çc]as|rodas?\M|pneus?|motor(es)?\M|acess[óo]rios|ferramentas|bombas|redutor|turbina|som\M|equipamento)'
   );
