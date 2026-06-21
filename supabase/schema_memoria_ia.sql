-- Memória de conversa persistente por usuário (Item 6)
ALTER TABLE public.perfis
  ADD COLUMN IF NOT EXISTS memoria_ia text;
