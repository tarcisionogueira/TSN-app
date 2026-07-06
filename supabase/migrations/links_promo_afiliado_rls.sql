-- Afiliado também cria os próprios links de venda (igual ao consultor). A policy de
-- INSERT de links_promo só permitia consultor; inclui afiliado. As de SELECT/UPDATE
-- dos próprios links (por criado_por) já valem para qualquer dono.
DROP POLICY IF EXISTS "Consultor cria links" ON public.links_promo;
CREATE POLICY "Consultor/afiliado cria links" ON public.links_promo
  FOR INSERT WITH CHECK (
    auth.uid() = criado_por
    AND EXISTS (SELECT 1 FROM public.perfis WHERE id = auth.uid() AND role IN ('consultor', 'afiliado'))
  );
