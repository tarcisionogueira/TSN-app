-- Adiciona controle de gateway ativo na config_financeira
ALTER TABLE config_financeira ADD COLUMN IF NOT EXISTS ativo boolean DEFAULT true;

-- Garante que gateway seja único para upsert funcionar
ALTER TABLE config_financeira DROP CONSTRAINT IF EXISTS config_financeira_gateway_key;
ALTER TABLE config_financeira ADD CONSTRAINT config_financeira_gateway_key UNIQUE (gateway);

-- Inicializa MP como gateway principal, Asaas como backup
INSERT INTO config_financeira (gateway, ativo) VALUES ('mp', true)
  ON CONFLICT (gateway) DO UPDATE SET ativo = true;

INSERT INTO config_financeira (gateway, ativo) VALUES ('asaas', false)
  ON CONFLICT (gateway) DO UPDATE SET ativo = false;
