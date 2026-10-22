-- 22/10 (dono): desativa os links de indicação antigos sem finalidade — 22, todos do admin, 0 usos.
-- Desativar (não apagar): o código continua no histórico e pode ser reativado na tela.
update public.links_convite set ativo = false where finalidade is null and ativo;
