-- 23/09: achado pelo Supabase Advisor (unindexed_foreign_keys, PERFORMANCE) — 27 FKs sem
-- índice de cobertura. Baixo tráfego (tabelas de log/financeiro/designação), mas JOIN e
-- DELETE em cascata nelas fazem sequential scan sem isso. Aditivo, zero risco de comportamento.
create index if not exists idx_arrematado_lancamentos_anexo_id on public.arrematado_lancamentos(anexo_id);
create index if not exists idx_asaas_transferencias_pendentes_criado_por on public.asaas_transferencias_pendentes(criado_por);
create index if not exists idx_assessorado_designacao_designado_por on public.assessorado_designacao(designado_por);
create index if not exists idx_caso_emails_enviados_enviado_por on public.caso_emails_enviados(enviado_por);
create index if not exists idx_cobrancas_avulsas_criado_por on public.cobrancas_avulsas(criado_por);
create index if not exists idx_competencia_fechada_reaberta_por on public.competencia_fechada(reaberta_por);
create index if not exists idx_competencia_fechada_fechada_por on public.competencia_fechada(fechada_por);
create index if not exists idx_conciliacao_lancamento_conta on public.conciliacao_lancamento(conta);
create index if not exists idx_conciliacao_rateio_conta on public.conciliacao_rateio(conta);
create index if not exists idx_conciliacao_regra_conta on public.conciliacao_regra(conta);
create index if not exists idx_curso_acesso_curso_id on public.curso_acesso(curso_id);
create index if not exists idx_editais_leilao_duplicata_suspeita_de on public.editais_leilao(duplicata_suspeita_de);
create index if not exists idx_editais_leilao_imovel_id on public.editais_leilao(imovel_id);
create index if not exists idx_financeiro_fornecedor_mesclado_em on public.financeiro_fornecedor(mesclado_em);
create index if not exists idx_honorarios_recebimentos_registrado_por on public.honorarios_recebimentos(registrado_por);
create index if not exists idx_ig_mensagens_classe on public.ig_mensagens(classe);
create index if not exists idx_live_convite_envio_user_id on public.live_convite_envio(user_id);
create index if not exists idx_live_inscricoes_user_id on public.live_inscricoes(user_id);
create index if not exists idx_live_reforco_envio_user_id on public.live_reforco_envio(user_id);
create index if not exists idx_mensagens_grupo_log_gerado_por on public.mensagens_grupo_log(gerado_por);
create index if not exists idx_plano_contas_pai on public.plano_contas(pai);
create index if not exists idx_saque_nf_revisado_por on public.saque_nf(revisado_por);
create index if not exists idx_whatsapp_disparo_grupo_log_user_id on public.whatsapp_disparo_grupo_log(user_id);
create index if not exists idx_whatsapp_disparo_grupo_log_enviado_por on public.whatsapp_disparo_grupo_log(enviado_por);
create index if not exists idx_whatsapp_disparo_grupo_log_inscricao_id on public.whatsapp_disparo_grupo_log(inscricao_id);
create index if not exists idx_whatsapp_disparo_log_user_id on public.whatsapp_disparo_log(user_id);
create index if not exists idx_whatsapp_disparo_log_enviado_por on public.whatsapp_disparo_log(enviado_por);
