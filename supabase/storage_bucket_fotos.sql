-- Cria bucket público para fotos de imóveis (execute no SQL Editor do Supabase)
INSERT INTO storage.buckets (id, name, public)
VALUES ('imoveis-fotos', 'imoveis-fotos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Política: leitura pública
CREATE POLICY "fotos publicas" ON storage.objects
  FOR SELECT USING (bucket_id = 'imoveis-fotos');

-- Política: escrita apenas via service key (server-side)
CREATE POLICY "fotos insert service" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'imoveis-fotos');
