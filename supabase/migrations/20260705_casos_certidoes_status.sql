-- Estado do checklist interativo de CERTIDÕES no acompanhamento do caso (Fase 2).
-- Mapeia slug da certidão → true/false (obtida). A lista de certidões vem do
-- raio-X jurídico do laudo documental; aqui guardamos só o que já foi providenciado.
alter table casos add column if not exists certidoes_status jsonb;
