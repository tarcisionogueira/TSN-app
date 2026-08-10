-- KYC DO SAQUE — escopo PARCEIRO, e o escopo passa a existir de verdade.
--
-- Dono, 09/08: "a selfie e documento é para validação do PARCEIRO e não de qualquer saque.
-- Valida somente 1x, mas checa se ainda é sócio periodicamente."
--
-- ACHADO AO IR MEXER (este é o ponto importante): a regra `saque.exige_kyc` já carregava um
-- campo `escopo`, mas `saque_avaliar` NUNCA o lia — a exigência era aplicada a todo mundo em
-- hardcode. Mudar o dado não mudaria comportamento nenhum. É a mesma divergência "a regra que
-- o planejamento cita não é a que o código aplica" que originou a `auditoria_regras_negocio`,
-- só que dentro de uma regra que a auditoria dava como aplicada (o `aplicada_por` apontava
-- para saque_avaliar, e apontava certo — a função lê a regra, só ignorava um campo dela).
-- Fica o aprendizado: `aplicada_por` prova que a função CONSULTA a regra, não que ela respeita
-- todos os campos. Campo novo em regra exige conferir o consumidor.
--
-- EFEITO PRÁTICO: nenhum para comissão. Todos podem virar parceiro e só parceiro indica e
-- ganha, então quem saca comissão é parceiro e continua precisando de KYC. Sai da exigência
-- só o HONORÁRIO POR FUNÇÃO da equipe (analista/advogado pagos por trabalho prestado).
-- Para trazer a equipe de volta, uma linha e sem deploy:
--   update regra_negocio set valor = jsonb_set(valor,'{escopo}','"todos"')
--    where chave = 'saque.exige_kyc';
--
-- "VALIDA 1x" já era o comportamento: `perfis.identidade_validada` é um sinalizador que, uma
-- vez verdadeiro, nunca mais é pedido. A recorrência que existe é OUTRA e segue de pé — a
-- reconferência do QUADRO SOCIETÁRIO (pj-revalidacao-cron, mensal), que marca
-- `pj_revalidacao_pendente` e retém o repasse quando o CPF deixa de constar no CNPJ.
-- Distinção deliberada: identidade se prova uma vez; sociedade muda com o tempo.

begin;

update public.regra_negocio
   set valor = jsonb_build_object('ativo', true, 'escopo', 'parceiro'),
       descricao = 'Identidade validada (selfie + documento) é a validação do PARCEIRO e pré-requisito do saque dele, em qualquer valor. Prova-se UMA vez (perfis.identidade_validada nunca é pedido de novo). ESCOPO: parceiro — como só parceiro indica e ganha, isso alcança todo saque de comissão; o honorário por função da equipe fica de fora (dono, 09/08). O que é reconferido periodicamente NÃO é a identidade e sim a SOCIEDADE: pj-revalidacao-cron confere o quadro societário todo mês e trava o repasse se o CPF deixar de constar no CNPJ.'
 where chave = 'saque.exige_kyc';

commit;

-- O corpo novo de saque_avaliar() foi aplicado junto (migração
-- `saque_kyc_escopo_parceiro_e_ligado_ao_codigo` no Supabase). A mudança é o gate do KYC:
--
--   v_kyc_escopo text := coalesce(regra('saque.exige_kyc')->>'escopo', 'todos');
--   ...
--   if v_exige_kyc and (v_kyc_escopo = 'todos' or not v_equipe)
--      and not coalesce(v_p.identidade_validada, false) then ...
--
-- Conferência (sem mexer em dinheiro nenhum):
--   select role, saque_avaliar(id,100)->'faltando', saque_avaliar(id,3000)->>'precisa_assinar'
--     from perfis where role in ('admin','explorador');
--   -- admin  → faltando SEM identidade · precisa_assinar = true (plano pago segue absoluto)
--   -- explor.→ faltando COM identidade
