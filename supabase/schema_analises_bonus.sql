-- Adiciona campo de análises bônus aos perfis
ALTER TABLE public.perfis
  ADD COLUMN IF NOT EXISTS analises_bonus integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bonus_exibido boolean DEFAULT false;

-- Dá 5 análises bônus para todos os exploradores existentes
UPDATE public.perfis
  SET analises_bonus = 5
  WHERE role = 'explorador' AND analises_bonus = 0;

-- Função para conceder bônus automaticamente ao novo explorador
CREATE OR REPLACE FUNCTION public.conceder_bonus_explorador()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role = 'explorador' AND (OLD IS NULL OR OLD.role <> 'explorador') THEN
    UPDATE public.perfis SET analises_bonus = 5, bonus_exibido = false WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bonus_explorador ON public.perfis;
CREATE TRIGGER trg_bonus_explorador
  AFTER INSERT OR UPDATE OF role ON public.perfis
  FOR EACH ROW EXECUTE FUNCTION public.conceder_bonus_explorador();
