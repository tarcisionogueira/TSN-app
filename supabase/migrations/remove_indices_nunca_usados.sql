-- 23/09: achado pelo Supabase Advisor (unused_index, PERFORMANCE) — 53 índices com idx_scan=0
-- desde o último reset de estatísticas (2026-05-22, ~4 meses de tráfego real, janela
-- representativa). Índice não-usado só custa: espaço em disco + trabalho extra em todo
-- INSERT/UPDATE/DELETE da tabela, sem nunca acelerar uma leitura. Reversível (basta recriar)
-- se algum uso raro que não apareceu nesses 4 meses precisar dele de volta.
--
-- CORREÇÃO NO MESMO DIA (ver restaura_indices_fk_removidos_por_engano.sql): 14 destes 53
-- eram, sem que o nome deixasse óbvio, a ÚNICA cobertura de uma foreign key — o cruzamento
-- inicial comparou só contra a lista de FKs sem índice já conhecida antes desta limpeza, não
-- percebeu que remover ESTES reabriria o mesmo problema sob um nome de índice diferente.
-- Recriados na migração seguinte assim que o Advisor confirmou a regressão.
drop index if exists public.idx_arremate_aprend_seg;
drop index if exists public.modulos_curso_id_idx;
drop index if exists public.licoes_modulo_id_idx;
drop index if exists public.perguntas_licao_id_idx;
drop index if exists public.lancamentos_imovel_id_idx;
drop index if exists public.idx_comissoes_status;
drop index if exists public.idx_contratos_status;
drop index if exists public.idx_anexo_auditoria_imovel;
drop index if exists public.idx_anexo_auditoria_anexo;
drop index if exists public.idx_aceites_email;
drop index if exists public.idx_uso_acao;
drop index if exists public.idx_reembolsos_garantia_cpf_hash;
drop index if exists public.idx_relatorios_status;
drop index if exists public.idx_relatorios_expira;
drop index if exists public.idx_solicitacoes_tipo;
drop index if exists public.idx_solicitacoes_prazo;
drop index if exists public.idx_contratos_kyc;
drop index if exists public.idx_solicitacoes_reuniao_em;
drop index if exists public.idx_msgs_diretas_lido;
drop index if exists public.idx_indice_amostras_geocod_fila;
drop index if exists public.idx_juridica_prazo;
drop index if exists public.idx_onr_protocolos_imovel;
drop index if exists public.idx_imoveis_leiloeiro_ext;
drop index if exists public.idx_imoveis_leiloeiro_data;
drop index if exists public.idx_imoveis_leiloeiro_uf;
drop index if exists public.veiculos_leilao_ativo_idx;
drop index if exists public.idx_leiloeiros_token;
drop index if exists public.idx_sancoes_federais_fonte;
drop index if exists public.idx_financiamentos_datas;
drop index if exists public.idx_captura_handoff_expira;
drop index if exists public.idx_fk_progresso_licao_id;
drop index if exists public.idx_fk_filtros_salvos_user_id;
drop index if exists public.idx_fk_comissoes_cliente_id;
drop index if exists public.idx_fk_sdr_leads_produto_id;
drop index if exists public.idx_fk_transcricoes_reuniao_solicitacao_id;
drop index if exists public.idx_chargebacks_status;
drop index if exists public.idx_proc_monit_ativo;
drop index if exists public.processo_movimentos_num_data;
drop index if exists public.idx_mp_assin_renovacao;
drop index if exists public.idx_conc_lanc_pendente;
drop index if exists public.idx_fornecedor_conta;
drop index if exists public.idx_documental_pedidos_leiloeiro_imovel;
drop index if exists public.idx_documental_pedidos_leiloeiro_user;
drop index if exists public.idx_sdr_leads_promo;
drop index if exists public.imoveis_leilao_proximidades_vazio_em_idx;
drop index if exists public.idx_indice_amostra_geo;
drop index if exists public.alerta_publico_match;
drop index if exists public.idx_visita_origem_oppref;
drop index if exists public.idx_veiculo_propostas_leiloeiro_veiculo;
drop index if exists public.idx_veiculo_propostas_leiloeiro_user;
drop index if exists public.idx_caso_emails_enviados_caso;
drop index if exists public.analises_veiculo_veiculo_idx;
drop index if exists public.assessorado_designacao_membro;
