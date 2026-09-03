-- Bug bounty 03/09 (P0): o PATCH que rebaixa perfis.role para 'explorador' na garantia de 7
-- dias (api/garantia-cancelar.js) era feito com `.catch(() => {})`, sem checar sucesso — se
-- falhasse, o cliente recebia 100% de reembolso e continuava com role pago PARA SEMPRE, sem
-- nada detectar (nenhum job cruza role pagante × linha em reembolsos_garantia). Corrigido no
-- código para checar `resp.ok`, alertar (api/_error-alert.js) e gravar o resultado aqui.
--
-- Default TRUE: linhas existentes/futuras de outros caminhos assumem confirmado (o código só
-- grava FALSE explicitamente quando o PATCH de fato falhou).
alter table public.reembolsos_garantia add column if not exists rebaixamento_confirmado boolean not null default true;
