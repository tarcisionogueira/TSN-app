-- 05/10 — Pendência 49: o espelho de documentos registra em imovel_anexos o arquivo copiado para o
-- NOSSO Storage com `storage_path` preenchido e `url` NULA — e os selos só olhavam `doc_arquivo(url)`.
-- Medido: 327 lotes ativos com matrícula em PDF guardada conosco e tem_matricula_doc=false (PESTANA
-- 294, CALIL 26…). Arquivo no nosso Storage É arquivo: entra no selo.
create or replace function public.calc_tem_edital_doc(p_id uuid, p_link text, p_anexos jsonb)
 returns boolean
 language sql
 stable
 set search_path to 'public'
as $function$
  select public.doc_arquivo(p_link)
      or exists (select 1 from jsonb_array_elements(coalesce(p_anexos, '[]'::jsonb)) x
                  where (x->>'tipo' ilike '%edital%' or x->>'nome' ilike '%edital%')
                    and public.doc_arquivo(x->>'url'))
      or exists (select 1 from public.imovel_anexos a
                  where a.imovel_id = p_id
                    and (a.tipo ilike '%edital%' or a.nome ilike '%edital%')
                    and (public.doc_arquivo(a.url) or a.storage_path is not null));
$function$;

create or replace function public.calc_tem_matricula_doc(p_id uuid, p_link text, p_anexos jsonb, p_fonte text, p_estado text, p_fonte_id text)
 returns boolean
 language sql
 stable
 set search_path to 'public'
as $function$
  select
     -- PDF estatico da Caixa: espelha caixaMatriculaUrl() em src/utils/caixa.js
     (p_fonte ~* 'caixa|cef'
        and regexp_replace(coalesce(p_fonte_id,''), '\D', '', 'g') <> ''
        and length(trim(coalesce(p_estado,''))) = 2)
  or (public.doc_arquivo(p_link) and p_link !~* 'matricula\.asp')
  or exists (select 1 from jsonb_array_elements(coalesce(p_anexos, '[]'::jsonb)) x
              where (x->>'tipo' ilike '%matricula%' or x->>'nome' ilike '%matr%')
                and public.doc_arquivo(x->>'url'))
  or exists (select 1 from public.imovel_anexos a
              where a.imovel_id = p_id
                and (a.tipo ilike '%matricula%' or a.nome ilike '%matr%')
                and (public.doc_arquivo(a.url) or a.storage_path is not null));
$function$;
