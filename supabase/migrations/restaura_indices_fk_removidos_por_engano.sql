-- 23/09: correção da migração anterior (remove_indices_nunca_usados) — 14 dos 53 índices
-- removidos por terem idx_scan=0 eram, na verdade, a ÚNICA cobertura de uma foreign key
-- (nome não batia com a convenção idx_<tabela>_<coluna>, então não apareceram no cruzamento
-- contra a lista de FKs sem índice da 1ª rodada). O scan zero acontece quando nenhum
-- UPDATE/DELETE em cascata ou JOIN por essa FK rodou nos últimos 4 meses — não significa que
-- a cobertura seja dispensável. Confirmado pelo Advisor rodado de novo LOGO DEPOIS da remoção
-- (voltou a acusar `unindexed_foreign_keys` nestas 14). Recriando com nome padronizado.
create index if not exists idx_analises_veiculo_veiculo_id on public.analises_veiculo(veiculo_id);
create index if not exists idx_assessorado_designacao_membro_id on public.assessorado_designacao(membro_id);
create index if not exists idx_caso_emails_enviados_caso_id on public.caso_emails_enviados(caso_id);
create index if not exists idx_comissoes_cliente_id on public.comissoes(cliente_id);
create index if not exists idx_filtros_salvos_user_id on public.filtros_salvos(user_id);
create index if not exists idx_financeiro_fornecedor_conta_padrao on public.financeiro_fornecedor(conta_padrao);
create index if not exists idx_lancamentos_imovel_id on public.lancamentos(imovel_id);
create index if not exists idx_licoes_modulo_id on public.licoes(modulo_id);
create index if not exists idx_modulos_curso_id on public.modulos(curso_id);
create index if not exists idx_perguntas_licao_id on public.perguntas(licao_id);
create index if not exists idx_progresso_licao_id on public.progresso(licao_id);
create index if not exists idx_sdr_leads_produto_id on public.sdr_leads(produto_id);
create index if not exists idx_sdr_leads_promo_id on public.sdr_leads(promo_id);
create index if not exists idx_transcricoes_reuniao_solicitacao_id on public.transcricoes_reuniao(solicitacao_id);
