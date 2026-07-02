-- Override individual do % de êxito por membro da equipe.
-- NULL = usa o padrão do papel em config_honorarios.
-- Lido no momento da distribuição (finalização da arrematação), então só afeta
-- vendas finalizadas DEPOIS da configuração — nunca retroage a arremates já distribuídos.
ALTER TABLE perfis ADD COLUMN IF NOT EXISTS honorario_exito_pct numeric;
COMMENT ON COLUMN perfis.honorario_exito_pct IS 'Override individual do % de exito de honorarios deste membro da equipe (advogado/analista/consultor). NULL usa o padrao do papel em config_honorarios. O admin sempre equilibra: admin = total - soma dos envolvidos. Aplica so a vendas finalizadas apos a configuracao.';
