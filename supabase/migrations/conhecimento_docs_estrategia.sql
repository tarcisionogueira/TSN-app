-- O agente que aprende com as integrações passa a guardar também a ESTRATÉGIA DE
-- DOCUMENTOS por plataforma: como obter matrícula/edital, se a fonte publica ou não,
-- a causa da lacuna e a contramedida. Vira conhecimento first-class (o monitoramento e
-- a próxima integração consultam isto), em vez de só uma observação solta.
alter table public.leiloeiro_conhecimento add column if not exists docs_estrategia text;
-- Situação atual da lacuna: 'ok' (coberto), 'esperado' (fonte não publica) ou
-- 'corrigivel' (dá para capturar; contramedida na docs_estrategia). Facilita o monitor.
alter table public.leiloeiro_conhecimento add column if not exists docs_status text;
