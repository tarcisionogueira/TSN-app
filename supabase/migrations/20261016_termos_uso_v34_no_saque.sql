-- Termos de Uso 3.4 (16/10): cláusula 8.3 — nota fiscal em TODO saque, repasse pelo bruto.
-- Sobe junto com VERSAO_FAMILIA.termos_uso = '3.4' em src/utils/termos.js. Aplicada DEPOIS do deploy
-- do front estar no ar: antes disso, quem aceitasse gravaria 'termos_uso-v3.3' e teria de aceitar de novo.
-- Efeito: o parceiro aceita a versão nova (modal na tela de saque) antes do próximo saque.
update public.regra_negocio
   set valor = valor || '{"versao": "termos_uso-v3.4"}'::jsonb
 where chave = 'saque.exige_termos_vigentes';
