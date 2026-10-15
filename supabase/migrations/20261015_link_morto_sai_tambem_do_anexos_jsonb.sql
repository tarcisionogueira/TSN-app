-- link_matricula_morto voltou pela 3ª vez (15/10: 53, todos GRUPOLANCE, leilão em aberto).
--
-- Causa raiz: o gatilho de 10/10 zerava link_matricula/link_edital quando o arquivo do anexo era
-- apagado, mas a MESMA URL continuava dentro de imoveis_leilao.anexos (jsonb) — o
-- captura-docs-grupolance grava a matrícula nos dois lugares. Na coleta seguinte, o merge do
-- scraper-puppeteer (enriquecerDocumentosLote, "DESALINHAMENTO anexos×link_*") deriva
-- link_matricula de anexos[tipo=matricula] e ressuscita o link morto: selo verde sobre o nada.
--
-- Agora o arquivo apagado sai também do jsonb `anexos`. Com o jsonb vazio, o
-- captura-docs-grupolance volta a ver o lote como pendente e baixa a matrícula de novo.

create or replace function public.trg_anexo_atualiza_tem_edital()
returns trigger
language plpgsql
as $function$
declare alvo uuid := coalesce(new.imovel_id, old.imovel_id);
declare novo_ed boolean; declare novo_mat boolean; declare sumiu text; declare padrao text;
begin
  sumiu := case
    when tg_op = 'UPDATE' and old.storage_path is not null and new.storage_path is null then old.storage_path
    when tg_op = 'DELETE' and old.storage_path is not null then old.storage_path
  end;
  if alvo is not null and sumiu is not null then
    padrao := '%/documentos/' || sumiu || '%';
    update public.imoveis_leilao i
       set link_matricula = case when i.link_matricula like padrao then null else i.link_matricula end,
           link_edital    = case when i.link_edital    like padrao then null else i.link_edital end,
           anexos = case when jsonb_typeof(i.anexos) = 'array' and i.anexos::text like padrao
                         then coalesce((select jsonb_agg(e) from jsonb_array_elements(i.anexos) e
                                         where coalesce(e->>'url', '') not like padrao), '[]'::jsonb)
                         else i.anexos end
     where i.id = alvo
       and (i.link_matricula like padrao or i.link_edital like padrao or i.anexos::text like padrao);
  end if;
  if alvo is not null and tg_op = 'UPDATE' and old.storage_path is not null and new.storage_path is not null
     and old.storage_path <> new.storage_path and new.url is not null then
    update public.imoveis_leilao i
       set link_matricula = case when i.link_matricula like '%/documentos/' || old.storage_path || '%' then new.url else i.link_matricula end,
           link_edital    = case when i.link_edital    like '%/documentos/' || old.storage_path || '%' then new.url else i.link_edital end
     where i.id = alvo
       and (i.link_matricula like '%/documentos/' || old.storage_path || '%' or i.link_edital like '%/documentos/' || old.storage_path || '%');
  end if;
  if alvo is not null then
    select public.calc_tem_edital_doc(i.id, i.link_edital, i.anexos),
           public.calc_tem_matricula_doc(i.id, i.link_matricula, i.anexos, i.fonte, i.estado, i.fonte_id)
      into novo_ed, novo_mat
      from public.imoveis_leilao i where i.id = alvo;
    update public.imoveis_leilao i
       set tem_edital_doc = novo_ed, tem_matricula_doc = novo_mat
     where i.id = alvo
       and (i.tem_edital_doc is distinct from novo_ed or i.tem_matricula_doc is distinct from novo_mat);
  end if;
  return null;
end;
$function$;

-- Reparo do passivo: lote ativo com link_matricula/link_edital ou entrada de `anexos` apontando para
-- arquivo do bucket `documentos` que não existe mais. Tira a entrada morta do jsonb e zera o link.
create or replace function pg_temp.reparar_links_mortos() returns jsonb language plpgsql as $$
declare n int;
begin
  with alvo as (
    select i.id from public.imoveis_leilao i
     where i.ativo and (
       (i.link_matricula like '%/storage/v1/object/%/documentos/%'
        and not exists (select 1 from storage.objects o where o.bucket_id = 'documentos'
              and o.name = substring(i.link_matricula from '/object/(?:sign|public)/documentos/([^?]+)')))
       or (i.link_edital like '%/storage/v1/object/%/documentos/%'
        and not exists (select 1 from storage.objects o where o.bucket_id = 'documentos'
              and o.name = substring(i.link_edital from '/object/(?:sign|public)/documentos/([^?]+)'))))
  )
  update public.imoveis_leilao i set
    link_matricula = case when i.link_matricula like '%/storage/v1/object/%/documentos/%'
        and not exists (select 1 from storage.objects o where o.bucket_id = 'documentos'
              and o.name = substring(i.link_matricula from '/object/(?:sign|public)/documentos/([^?]+)'))
      then null else i.link_matricula end,
    link_edital = case when i.link_edital like '%/storage/v1/object/%/documentos/%'
        and not exists (select 1 from storage.objects o where o.bucket_id = 'documentos'
              and o.name = substring(i.link_edital from '/object/(?:sign|public)/documentos/([^?]+)'))
      then null else i.link_edital end,
    anexos = case when jsonb_typeof(i.anexos) = 'array' then coalesce((
        select jsonb_agg(e) from jsonb_array_elements(i.anexos) e
         where not (coalesce(e->>'url', '') like '%/storage/v1/object/%/documentos/%'
           and not exists (select 1 from storage.objects o where o.bucket_id = 'documentos'
                 and o.name = substring(e->>'url' from '/object/(?:sign|public)/documentos/([^?]+)')))
      ), '[]'::jsonb) else i.anexos end
  from alvo where i.id = alvo.id;
  get diagnostics n = row_count;
  return jsonb_build_object('lotes_reparados', n);
end $$;
select pg_temp.reparar_links_mortos();
