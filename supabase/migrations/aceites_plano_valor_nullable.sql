-- O aceite de TERMOS atualizados (grátis, sem preço) grava prova em aceites_plano com
-- valor=null, mas a coluna era NOT NULL → o insert dava 502 a cada re-aceite (apenas ruído,
-- pois o gate no perfil, perfis.termos_uso_aceito_em, já é atualizado antes). Compras reais
-- sempre têm valor, então nunca foram afetadas. Tornando valor nullable, a prova do aceite de
-- termos (com IP + hash) passa a ser registrada e o 502 some.
ALTER TABLE public.aceites_plano ALTER COLUMN valor DROP NOT NULL;
