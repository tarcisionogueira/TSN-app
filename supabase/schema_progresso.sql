-- Tabela de progresso de aulas por usuário
CREATE TABLE IF NOT EXISTS aula_progresso (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  aula_id     text NOT NULL,
  curso_id    text NOT NULL,
  concluida   boolean NOT NULL DEFAULT false,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, aula_id)
);

-- RLS
ALTER TABLE aula_progresso ENABLE ROW LEVEL SECURITY;

-- Usuário só pode ver e editar o próprio progresso
CREATE POLICY "user_select_own_progresso" ON aula_progresso
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "user_insert_own_progresso" ON aula_progresso
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_update_own_progresso" ON aula_progresso
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "user_delete_own_progresso" ON aula_progresso
  FOR DELETE USING (auth.uid() = user_id);
