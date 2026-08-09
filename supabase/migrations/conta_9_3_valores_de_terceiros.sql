-- VALORES DE TERCEIROS / USO PESSOAL (08/08)
--
-- O dono confirmou: "Padaria / Festa da Colheita" foi um link de cobrança AVULSO, de uso
-- pessoal, que passou pela conta do Mercado Pago da empresa. Não é receita da BidPro.
--
-- Estava em 3.9 Outras receitas, ou seja, dentro da RECEITA BRUTA — inflando o faturamento
-- com dinheiro que não é da operação. É o tipo de coisa que o contador encontra depois e
-- obriga a refazer a competência.
--
-- Não havia conta adequada: 9.1 é transferência entre contas próprias e 9.2 é aporte de
-- sócio; nenhuma descreve "dinheiro de terceiro que passou pela nossa conta". Com a conta
-- certa, o lançamento fica visível, fora da receita, e o contador sabe o que fazer com ele.
insert into public.plano_contas (codigo, nome, natureza, grupo_dre, pai, ativo, ordem)
values ('9.3', 'Valores de terceiros / uso pessoal', 'nao_operacional', 'Não operacional', '9', true, 83)
on conflict (codigo) do update set nome = excluded.nome, ativo = true;

update public.conciliacao_lancamento
   set conta = '9.3', classificado_por = 'manual'
 where conta = '3.9'
   and (descricao ilike '%padaria%' or descricao ilike '%festa da colheita%');

insert into public.conciliacao_regra (padrao, conta, direcao, origem, ativo)
values ('festa da colheita', '9.3', 'entrada', 'manual', true),
       ('padaria mascote',   '9.3', 'entrada', 'manual', true)
on conflict do nothing;
