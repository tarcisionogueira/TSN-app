-- Adiciona chave PIX ao perfil para saques de profissionais (consultor, analista, advogado, admin)
ALTER TABLE perfis ADD COLUMN IF NOT EXISTS chave_pix TEXT;

-- Garante que chamados suportem status aguardando_atendente
-- (sem alteração de constraint necessária se a coluna for TEXT sem CHECK)
