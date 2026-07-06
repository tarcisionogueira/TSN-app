-- Proteção de escalonamento de privilégio em `perfis` (VERSIONAMENTO).
--
-- A policy RLS de UPDATE de `perfis` (auth.uid() = id) não tem WITH CHECK por
-- coluna, então, sozinha, ela permitiria ao próprio usuário fazer
-- `update({ role: 'admin' })` na sua linha. A ÚNICA barreira contra isso é este
-- trigger BEFORE UPDATE, que reverte campos sensíveis (role, ativo, débito,
-- carteira, cotas) para o valor antigo quando quem edita é `authenticated`/`anon`
-- e NÃO é admin. O admin (SECURITY DEFINER / is_admin()) segue livre.
--
-- Este trigger JÁ EXISTE em produção, mas não estava versionado no repositório
-- (foi aplicado via MCP). Sem este arquivo, um reprovisionamento do banco só a
-- partir dos .sql do repo perderia a proteção e a auto-escalada de role voltaria a
-- ser possível. Idempotente: seguro re-aplicar. (Fonte: auditoria de segurança.)

CREATE OR REPLACE FUNCTION public.proteger_campos_sensiveis_perfil()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('authenticated','anon') AND NOT public.is_admin() THEN
    NEW.role := OLD.role;
    NEW.role_anterior := OLD.role_anterior;
    NEW.ativo := OLD.ativo;
    NEW.inadimplente_desde := OLD.inadimplente_desde;
    NEW.indicado_por := OLD.indicado_por;
    NEW.bonus_mercado := OLD.bonus_mercado;
    NEW.analises_count := OLD.analises_count;
    NEW.analises_mes := OLD.analises_mes;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_proteger_perfil ON public.perfis;
CREATE TRIGGER trg_proteger_perfil
  BEFORE UPDATE ON public.perfis
  FOR EACH ROW EXECUTE FUNCTION public.proteger_campos_sensiveis_perfil();
