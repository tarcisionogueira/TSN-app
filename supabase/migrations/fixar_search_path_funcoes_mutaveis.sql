-- 15/09: `mcp__Supabase__get_advisors` (lint de segurança) achou 16 funções sem `search_path`
-- fixo (`function_search_path_mutable`) — nenhuma é SECURITY DEFINER (todas SECURITY INVOKER,
-- prosecdef=false, confirmado via pg_proc antes de escrever esta migração), então o risco de
-- escalonamento de privilégio é baixo, mas a maioria são funções de TRIGGER que rodam em toda
-- escrita em `imoveis_leilao`/`perfis` (trg_anexo_atualiza_tem_edital, trg_normaliza_nome_perfil,
-- trg_promove_saudacao, trg_set_tem_edital_doc, preservar_area_e_avaliacao,
-- preservar_supressao_gemeo, imovel_barrar_fracao_ideal) — deixar o search_path herdar da sessão
-- é a mesma classe de vulnerabilidade que o Postgres/Supabase recomenda fechar por padrão: um
-- schema malicioso mais cedo no search_path da sessão poderia sombrear uma tabela/função que a
-- trigger chama sem qualificar. `SET search_path = 'public'` (não vazio) porque nenhuma das 16
-- qualifica as próprias chamadas com `public.` — travar em `''` quebraria todas; travar num
-- valor FIXO (em vez de deixar mutável) já fecha a lacuna que o advisor aponta.
ALTER FUNCTION public.preservar_area_e_avaliacao() SET search_path = 'public';
ALTER FUNCTION public.norm_cidade(p text) SET search_path = 'public';
ALTER FUNCTION public.preservar_supressao_gemeo() SET search_path = 'public';
ALTER FUNCTION public.imovel_barrar_fracao_ideal() SET search_path = 'public';
ALTER FUNCTION public.fracao_ideal_barrada(p_titulo text, p_descricao text) SET search_path = 'public';
ALTER FUNCTION public.registrar_uso_brightdata(p_teto integer, p_proposito text) SET search_path = 'public';
ALTER FUNCTION public.mp_motivo_recusa(p_code text) SET search_path = 'public';
ALTER FUNCTION public.doc_arquivo(url text) SET search_path = 'public';
ALTER FUNCTION public.calc_tem_edital_doc(p_id uuid, p_link text, p_anexos jsonb) SET search_path = 'public';
ALTER FUNCTION public.trg_set_tem_edital_doc() SET search_path = 'public';
ALTER FUNCTION public.calc_tem_matricula_doc(p_id uuid, p_link text, p_anexos jsonb, p_fonte text, p_estado text, p_fonte_id text) SET search_path = 'public';
ALTER FUNCTION public.trg_anexo_atualiza_tem_edital() SET search_path = 'public';
ALTER FUNCTION public.trg_normaliza_nome_perfil() SET search_path = 'public';
ALTER FUNCTION public.registrar_resultado_brightdata(p_proposito text, p_ok boolean, p_devolver boolean) SET search_path = 'public';
ALTER FUNCTION public.normalizar_nome(s text) SET search_path = 'public';
ALTER FUNCTION public.trg_promove_saudacao() SET search_path = 'public';
