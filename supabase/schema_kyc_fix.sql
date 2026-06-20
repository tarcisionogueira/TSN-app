-- Corrige bug: novo membro não tem permissão RLS para salvar fotos KYC
-- na tabela convites_equipe após o cadastro (apenas admins têm UPDATE).
-- Solução: função SECURITY DEFINER que roda como postgres, bypassa RLS.

CREATE OR REPLACE FUNCTION public.salvar_kyc_equipe(p_token text, p_fotos jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.convites_equipe
     SET kyc_fotos = p_fotos
   WHERE token = p_token;
  RETURN FOUND;
END;
$$;

-- Qualquer usuário autenticado pode chamar (a validação do token é suficiente)
GRANT EXECUTE ON FUNCTION public.salvar_kyc_equipe(text, jsonb) TO authenticated;
-- Usuário anônimo também pode chamar (necessário se email confirmation ativo no Supabase)
GRANT EXECUTE ON FUNCTION public.salvar_kyc_equipe(text, jsonb) TO anon;
