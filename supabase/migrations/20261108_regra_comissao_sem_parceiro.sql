-- 08/11 (dono): venda sem parceiro indicando fica com a conta-empresa, que é a do dono. A regra já era aplicada pela função,
-- mas só existia no código; registrada aqui para o planejamento e para a auditoria de regras de negócio.
insert into public.regra_negocio (chave, valor, descricao, aplicada_por, ativo)
values (
  'comissao.sem_parceiro_vai_para_empresa',
  '{"beneficiario":"rank_config.empresa_uid","vale_para":"venda sem parceiro indicando"}'::jsonb,
  'Toda venda sem parceiro indicando credita a comissão na conta-empresa (a do dono): o comprador sem indicador é ligado a ela. Lançamento interno: só vira saída se o saldo for sacado. Confirmado pelo dono em 08/11.',
  array['distribuir_comissao_rede'],
  true
)
on conflict (chave) do update
  set valor = excluded.valor, descricao = excluded.descricao, aplicada_por = excluded.aplicada_por, ativo = true, atualizado_em = now();

-- A auditoria de regras exige a menção na função. Só acrescenta o comentário; o corpo não muda.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.distribuir_comissao_rede'::regproc);
  if position('comissao.sem_parceiro_vai_para_empresa' in d) = 0 then
    d := replace(d, $r$-- Regra 'comissao.rede_escopo'$r$,
      $r$-- Regra de negócio aplicada aqui: comissao.sem_parceiro_vai_para_empresa
-- Regra 'comissao.rede_escopo'$r$);
    if position('comissao.sem_parceiro_vai_para_empresa' in d) = 0 then raise exception 'comentário não encontrado'; end if;
    execute d;
  end if;
end $$;
