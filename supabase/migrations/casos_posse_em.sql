-- Marcador de POSSE do imóvel no caso de assessoria. Não é um campo que o usuário
-- digita: é setado pelo botão "Tomei posse" (ver api/marcar-posse.js). Quando
-- marcado, a assessoria daquele imóvel é considerada CONCLUÍDA e o role do cliente
-- é reavaliado (assessorado → explorador; clube/investidor pro mantêm).
ALTER TABLE casos ADD COLUMN IF NOT EXISTS posse_em timestamptz;
