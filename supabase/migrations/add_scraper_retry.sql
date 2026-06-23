-- Fila de retry do scraper: estados que falharam na primeira rodada da noite
CREATE TABLE IF NOT EXISTS scraper_retry (
  uf           char(2)     PRIMARY KEY,
  tentativas   int         NOT NULL DEFAULT 1,
  ultimo_erro  text,
  falhou_em    timestamptz NOT NULL DEFAULT now()
);
