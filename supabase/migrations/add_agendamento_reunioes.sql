-- Disponibilidade semanal do analista (templates recorrentes)
CREATE TABLE IF NOT EXISTS disponibilidade_analista (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  analista_id uuid NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
  dia_semana  smallint NOT NULL CHECK (dia_semana BETWEEN 0 AND 6), -- 0=Dom 1=Seg ... 6=Sab
  hora_inicio time NOT NULL,  -- ex: '09:00'
  hora_fim    time NOT NULL,  -- ex: '12:00'
  ativo       boolean NOT NULL DEFAULT true,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (analista_id, dia_semana, hora_inicio)
);

-- Slots de 30 min gerados a partir da disponibilidade
CREATE TABLE IF NOT EXISTS slots_reuniao (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  analista_id     uuid NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
  data_hora       timestamptz NOT NULL,
  duracao_min     smallint NOT NULL DEFAULT 30,
  disponivel      boolean NOT NULL DEFAULT true,
  reservado_por   uuid REFERENCES perfis(id),   -- cliente_id após reserva
  caso_id         uuid REFERENCES casos(id),
  reuniao_numero  smallint,                      -- 1 ou 2
  criado_em       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (analista_id, data_hora)
);

CREATE INDEX IF NOT EXISTS idx_slots_disponiveis
  ON slots_reuniao (data_hora, disponivel)
  WHERE disponivel = true;

-- Adiciona analista_id em casos se não existir
ALTER TABLE casos ADD COLUMN IF NOT EXISTS analista_id uuid REFERENCES perfis(id);

-- RLS: cliente vê apenas slots disponíveis; analista vê todos os seus
ALTER TABLE disponibilidade_analista ENABLE ROW LEVEL SECURITY;
ALTER TABLE slots_reuniao ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "analista_gerencia_disponibilidade"
  ON disponibilidade_analista FOR ALL
  USING (analista_id = auth.uid());

CREATE POLICY IF NOT EXISTS "slots_leitura_publica_autenticada"
  ON slots_reuniao FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY IF NOT EXISTS "slots_reserva_cliente"
  ON slots_reuniao FOR UPDATE
  USING (disponivel = true OR reservado_por = auth.uid());

CREATE POLICY IF NOT EXISTS "slots_analista_total"
  ON slots_reuniao FOR ALL
  USING (analista_id = auth.uid());
