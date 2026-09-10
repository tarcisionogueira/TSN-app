-- Aviso de conversao para quem ganhou plano de cortesia (curso -> N meses de Investidor Pro).
-- Ver api/aviso-cortesia-vencendo-cron.js para o mecanismo completo.
insert into regra_negocio (chave, valor, descricao, aplicada_por, ativo)
values (
  'produto.aviso_cortesia_vencendo',
  jsonb_build_object(
    'janela_dias_min', 5,
    'janela_dias_max', 7,
    'dedup_por', 'user_id + data_vencimento',
    'desligado_por_padrao', true,
    'interruptor', 'app_config.aviso_cortesia_ativo'
  ),
  'Quem ganhou plano por bonus de produto (plano_ciclo=cortesia, ex.: curso concede N meses de Investidor Pro) recebe e-mail de conversao 5-7 dias antes do plano_vencimento, convidando a assinar antes de voltar a Explorador. Fecha a lacuna que renovacao-avisos-cron nao cobre (aquele so varre preapprovals do Mercado Pago -- cortesia nao tem cartao cadastrado, entao nunca aparecia la). Desligado por padrao (app_config.aviso_cortesia_ativo) ate autorizacao explicita, mesmo padrao do ativacao_nudge.',
  array['aviso_cortesia_vencendo_cron'],
  true
)
on conflict (chave) do update set
  valor = excluded.valor, descricao = excluded.descricao,
  aplicada_por = excluded.aplicada_por, ativo = excluded.ativo,
  atualizado_em = now();
