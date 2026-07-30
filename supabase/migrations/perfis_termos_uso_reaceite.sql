-- Re-aceite de termos ATUALIZADOS (pedido do dono, 30/07): quando a versão vigente dos
-- termos muda (utils/termos.js TERMOS_VERSAO), todo usuário logado vê um popup para
-- aceitar; enquanto não aceitar, a geração de relatórios fica travada. O gate lê estas
-- colunas (1 select barato); a PROVA forte do re-aceite vai para aceites_plano via
-- /api/registrar-aceite (plano_key='termos_uso', com IP + hash por trigger).
alter table public.perfis
  add column if not exists termos_uso_versao text,
  add column if not exists termos_uso_aceito_em timestamptz;
