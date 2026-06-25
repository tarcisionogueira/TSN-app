-- Cria bucket público para armazenar fotos de imóveis em leilão.
-- Fotos são salvas pelo scraper durante a importação e servidas diretamente
-- via URL pública do Supabase Storage (sem expiração, sem depender do site original).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'imoveis-fotos',
  'imoveis-fotos',
  true,
  5242880,  -- 5 MB por arquivo
  ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif'];

-- Permite leitura pública (anon) — necessário para URLs públicas funcionarem
CREATE POLICY "Fotos imoveis leitura publica"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'imoveis-fotos');

-- Apenas service_role (scraper) pode fazer upload
CREATE POLICY "Fotos imoveis upload service role"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'imoveis-fotos');

CREATE POLICY "Fotos imoveis update service role"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'imoveis-fotos');
