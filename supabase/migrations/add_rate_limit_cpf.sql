-- Rate limit para /api/verificar-cpf: máximo 10 tentativas por IP por minuto
CREATE TABLE IF NOT EXISTS verificar_cpf_rate (
  id         bigserial   PRIMARY KEY,
  ip         text        NOT NULL,
  criado_em  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS verificar_cpf_rate_ip_criado ON verificar_cpf_rate (ip, criado_em);

-- Limpeza automática: remove registros com mais de 5 minutos
CREATE OR REPLACE FUNCTION limpar_rate_limit_cpf() RETURNS void LANGUAGE sql AS $$
  DELETE FROM verificar_cpf_rate WHERE criado_em < now() - interval '5 minutes';
$$;
