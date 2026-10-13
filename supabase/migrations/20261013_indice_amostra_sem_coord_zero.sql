-- 13/10: imóvel sem latitude/longitude virava o ponto 0,0 em gravarAmostrasIndice (`Number(null)` = 0
-- passa no isFinite). 54 amostras de Santana de Parnaíba ficaram com lat=0, lng=0, geo_grid '0.00,0.00'
-- — invisíveis a qualquer recorte por raio. O código foi corrigido (coordNum em api/gerar-analise.js);
-- aqui a amostra volta a ser "sem coordenada", que é o que ela é (continua valendo pelo bairro).
update public.indice_amostra
   set lat = null, lng = null, geo_grid = ''
 where lat = 0 and lng = 0;
