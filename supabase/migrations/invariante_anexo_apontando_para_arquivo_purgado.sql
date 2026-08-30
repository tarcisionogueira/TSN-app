-- 29/08 — A REDE QUE PEGA A "RESSURREIÇÃO DE ARQUIVO APAGADO"
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- Defeito introduzido HOJE e fechado no mesmo dia. A publicação do espelho
-- (`registrar_anexos_do_espelho`) preenche o `storage_path` de todo `imovel_anexos` que está
-- nulo — e a retenção em camadas (`limpar-documentos-cron`) faz exatamente o contrário: apaga
-- o arquivo do bucket e **anula o storage_path**. Sem aviso entre os dois:
--
--   limpeza apaga `espelho/FONTE/<id>/matricula-x.pdf` e anula a linha
--     → 4h depois o cron republica a MESMA linha com o MESMO caminho
--       → o relatório tenta assinar um objeto que não existe mais
--
-- A retenção continuaria funcionando e o efeito dela seria desfeito sozinho, deixando um
-- ponteiro para arquivo inexistente — **pior que não ter apagado**, porque parece que o
-- documento está lá (a mesma família do "63 KB de tela impressa" de 04/08).
--
-- O conserto na origem é o cron marcar `documento_espelho.status = 'purgado'`, e a publicação
-- só considerar `'copiado'`. Mas esse aviso é best-effort de propósito — falhar nele não pode
-- derrubar a limpeza, que é o que protege o custo de storage. Então o estado precisa de quem
-- o vigie, e é isto: se o aviso falhar, o invariante acusa em vez de o cliente descobrir.
create or replace function public.qa_invariante_anexo_de_espelho_purgado()
returns bigint language sql stable set search_path to 'public' as $$
  select count(*)::bigint
    from imovel_anexos a
    join documento_espelho e on e.storage_path = a.storage_path
   where a.storage_path like 'espelho/%'
     and e.status = 'purgado';
$$;

do $do$
declare d text; alvo text; novo text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'qa_invariantes';
  alvo := E'where i.ativo and not exists (select 1 from fonte_saude s where s.fonte = i.fonte)) c), 0)';
  if position(alvo in d) = 0 then raise exception 'ancora nao encontrada em qa_invariantes()'; end if;
  if position('anexo_de_espelho_purgado' in d) > 0 then raise notice 'ja registrado'; return; end if;
  novo := alvo || E',\n     (''anexo_de_espelho_purgado'',''Anexo publicado aponta para arquivo do espelho que a retencao ja apagou (ponteiro morto que parece documento)'',''Documentos'',''bug'',\n       public.qa_invariante_anexo_de_espelho_purgado(), 0)';
  execute replace(d, alvo, novo);
end $do$;
