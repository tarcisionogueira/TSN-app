CREATE TABLE IF NOT EXISTS public.transcricoes_reuniao (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  solicitacao_id uuid REFERENCES public.solicitacoes(id) ON DELETE CASCADE,
  transcricao    text,
  duracao_seg    integer,
  daily_room_name text,
  created_at     timestamptz DEFAULT now()
);

ALTER TABLE public.transcricoes_reuniao ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Analista e admin leem transcrições"
  ON public.transcricoes_reuniao FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.perfis
      WHERE id = auth.uid() AND role IN ('admin','analista','advogado')
    )
  );
