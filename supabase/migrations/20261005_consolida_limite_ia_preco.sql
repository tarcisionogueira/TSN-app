-- 05/10 — pendência 80: CONSOLIDA no repositório o corpo VIVO de duas funções que
-- divergiam das migrações (forma 7b do CLAUDE.md: mudança aplicada direto no banco que nunca
-- voltou para supabase/migrations/). Recriar o banco a partir do repo trazia versões velhas.
--
-- Fonte: pg_get_functiondef() em produção (zuwfiwokkdytvjixiwac), lido em 05/10.
-- NÃO ALTERA COMPORTAMENTO: é o mesmo corpo, byte a byte. `create or replace` preserva os
-- GRANTs atuais, que ficam registrados aqui só como referência (lidos de proacl em 05/10):
--   • limite_ia(text,text):                  EXECUTE para PUBLIC, anon, authenticated, service_role, postgres
--   • registrar_preco_contratado(uuid,text): EXECUTE só para service_role e postgres
--     (num banco recriado do zero, o default do Postgres daria EXECUTE a PUBLIC — conferir
--      com auditoria_seguranca() depois de aplicar num ambiente novo).
--
-- Ao mudar qualquer uma das duas daqui em diante: migração no MESMO commit (regra 7b).

-- ─── limite_ia ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.limite_ia(p_role text, p_tipo text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when p_role = 'admin' then null::int
    when p_tipo = 'indice' then case p_role
      when 'top2' then 3 when 'top2_anual' then 3
      when 'assessorado' then 3 when 'assessorado_anual' then 3
      when 'clube' then 3 when 'clube_anual' then 3
      when 'analista' then 100 when 'advogado' then 100
      else 0 end
    when p_tipo = 'documental' then case p_role
      when 'top2' then 10 when 'top2_anual' then 10
      when 'assessorado' then 10 when 'assessorado_anual' then 10
      when 'clube' then 10 when 'clube_anual' then 10
      when 'analista' then 100 when 'advogado' then 100
      else 0 end
    when p_tipo = 'veiculo' then case p_role
      when 'explorador' then 3 when 'consultor' then 5
      when 'top2' then 10 when 'top2_anual' then 10
      when 'assessorado' then 10 when 'assessorado_anual' then 10
      when 'clube' then 10 when 'clube_anual' then 10
      when 'analista' then 100 when 'advogado' then 100
      else 3 end
    else case p_role
      when 'explorador' then 3 when 'consultor' then 5
      when 'top2' then 10 when 'top2_anual' then 10
      when 'assessorado' then 10 when 'assessorado_anual' then 10
      when 'clube' then 10 when 'clube_anual' then 10
      when 'analista' then 100 when 'advogado' then 100
      else 3 end
  end
$function$;

-- ─── registrar_preco_contratado ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.registrar_preco_contratado(p_user_id uuid, p_plano_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_preco numeric;
BEGIN
  IF current_user IN ('authenticated','anon') AND p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'não autorizado';
  END IF;
  IF p_plano_key NOT IN ('top2', 'clube') THEN RETURN; END IF;
  SELECT preco INTO v_preco FROM planos_config WHERE plano_key = p_plano_key;
  IF v_preco IS NULL THEN RETURN; END IF;
  UPDATE public.preco_contratado SET ativo = false
    WHERE user_id = p_user_id AND plano_key = p_plano_key AND ativo = true;
  INSERT INTO public.preco_contratado (user_id, plano_key, preco_mensal, contratado_em, valido_ate)
    VALUES (p_user_id, p_plano_key, v_preco, now(), now() + interval '12 months');
END;
$function$;
