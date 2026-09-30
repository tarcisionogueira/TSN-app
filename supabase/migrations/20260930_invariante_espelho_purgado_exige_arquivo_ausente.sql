-- 30/09 — `anexo_de_espelho_purgado` acusava 2 anexos com o arquivo PRESENTE no bucket.
-- Imóvel gêmeo (mesma URL de edital/matrícula na DANIELGARCIA): a linha do espelho do gêmeo
-- expirado ficou `purgado` com o MESMO storage_path, e o arquivo foi recopiado para o imóvel
-- ativo (linha `copiado`, 04:42). O invariante media "existe linha purgada com este caminho" e
-- reportava como "ponteiro morto" (forma nº 10). Agora exige o que o nome diz: o anexo aponta
-- para o espelho E o objeto não existe no bucket.
create or replace function public.qa_invariante_anexo_de_espelho_purgado()
returns bigint language sql stable set search_path to 'public' as $$
  select count(*)::bigint
    from imovel_anexos a
   where a.storage_path like 'espelho/%'
     and exists (select 1 from documento_espelho e where e.storage_path = a.storage_path and e.status = 'purgado')
     and not exists (select 1 from storage.objects o where o.bucket_id = 'documentos' and o.name = a.storage_path);
$$;
