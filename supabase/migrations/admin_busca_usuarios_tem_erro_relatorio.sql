-- Cliente 360 (P0-3): admin_busca_usuarios (5-arg) marca tem_erro=true também quando o usuário
-- teve FALHA DE RELATÓRIO (atividade_log evento *_vazio/_erro nos últimos 7 dias), não só erro de
-- JS (erros_cliente). + índice idx_atividade_log_user_criado para escalar. Aplicada via MCP em prod.
create index if not exists idx_atividade_log_user_criado on public.atividade_log(user_id, criado_em desc);
-- (função completa aplicada em prod; ver definição vigente com pg_get_functiondef.)
