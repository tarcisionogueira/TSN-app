-- Contramedida a erros de geocodificação cross-município (bairro homônimo em outra
-- cidade). Detecta imóveis cuja coordenada está a >30 km da MEDIANA da própria
-- cidade (outlier de cluster = quase sempre casou no município errado — ex.: casa
-- de "São Vicente" caindo perto de Barueri) e os corrige para a mediana da cidade,
-- marcando geocod_nivel='refazer' para o cron noturno re-geocodificar com o novo
-- guardrail apertado (validação por nível em api/_geo.js: bairro <= 25 km do centróide).
-- Idempotente: reexecutar só afeta quem ainda estiver fora do cluster.
WITH med AS (
  SELECT estado, cidade,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY latitude)  AS mlat,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY longitude) AS mlng,
    count(*) n
  FROM imoveis_leilao
  WHERE ativo = true AND latitude IS NOT NULL AND latitude <> 0 AND longitude IS NOT NULL AND longitude <> 0
  GROUP BY estado, cidade
), ruins AS (
  SELECT i.id, m.mlat, m.mlng
  FROM imoveis_leilao i JOIN med m ON m.estado = i.estado AND m.cidade = i.cidade
  WHERE i.ativo = true AND i.latitude IS NOT NULL AND i.latitude <> 0 AND m.n >= 4
    AND (6371*acos(least(1, cos(radians(m.mlat))*cos(radians(i.latitude))*cos(radians(i.longitude)-radians(m.mlng)) + sin(radians(m.mlat))*sin(radians(i.latitude))))) > 30
)
UPDATE imoveis_leilao i
SET latitude = r.mlat, longitude = r.mlng, geocod_nivel = 'refazer',
    pontos_proximos = NULL, proximidades_em = NULL
FROM ruins r WHERE r.id = i.id;
