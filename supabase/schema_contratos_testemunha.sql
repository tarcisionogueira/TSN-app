-- ============================================================
-- Extensão da tabela contratos:
-- geolocalização + testemunha opcional
-- Execute no SQL Editor do Supabase após schema_contratos.sql
-- ============================================================

alter table public.contratos
  add column if not exists latitude          numeric(10,7),
  add column if not exists longitude         numeric(10,7),
  add column if not exists geolocalizacao    text,          -- endereço reverso (opcional)
  add column if not exists nome_testemunha   text,
  add column if not exists cpf_testemunha    text,
  add column if not exists assinatura_testemunha text,      -- PNG base64
  add column if not exists testemunha_em     timestamptz;
