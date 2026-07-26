-- Material de apoio POR AULA (opcional): array de { nome, url, tipo }. O admin anexa
-- PDF/Excel/Word ou cola um link; no player aparece um botão por material. Vazio = sem
-- seção de material (nada de placeholder).
alter table public.aulas_admin add column if not exists materiais jsonb default '[]'::jsonb;
