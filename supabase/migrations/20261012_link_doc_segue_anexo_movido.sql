-- #190 (12/10): link_matricula_morto voltou com 60 (57 GRUPOLANCE + 3 ZUK), todos com a matrícula
-- VIVA em imovel_anexos sob outro nome.
--
-- Causa: captura-documentos.mjs (CAMINHO 1) baixa o próprio link_matricula (`matricula_<fonte>_auto.pdf`),
-- regrava como `matricula_<hash>.pdf` e ATUALIZA a linha do anexo (storage_path antigo -> novo). O gatilho
-- só tratava storage_path virando NULL (arquivo apagado); arquivo MOVIDO deixava link_matricula no nome
-- antigo, que virava órfão e era apagado pela limpeza — selo verde sobre o nada.
--
-- Agora: storage_path trocado (ambos não nulos) -> link_matricula/link_edital que apontavam para o
-- caminho antigo passam a apontar para a URL nova do anexo.

create or replace function public.trg_anexo_atualiza_tem_edital()
returns trigger
language plpgsql
as $function$
declare alvo uuid := coalesce(new.imovel_id, old.imovel_id);
declare novo_ed boolean; declare novo_mat boolean; declare sumiu text;
begin
  -- Arquivo do anexo apagado (limpeza zera storage_path, ou a linha some): o link do imóvel que
  -- apontava para ele morre junto — senão o selo continua verde sobre documento inexistente (10/10).
  sumiu := case
    when tg_op = 'UPDATE' and old.storage_path is not null and new.storage_path is null then old.storage_path
    when tg_op = 'DELETE' and old.storage_path is not null then old.storage_path
  end;
  if alvo is not null and sumiu is not null then
    update public.imoveis_leilao i
       set link_matricula = case when i.link_matricula like '%/documentos/' || sumiu || '%' then null else i.link_matricula end,
           link_edital    = case when i.link_edital    like '%/documentos/' || sumiu || '%' then null else i.link_edital end
     where i.id = alvo
       and (i.link_matricula like '%/documentos/' || sumiu || '%' or i.link_edital like '%/documentos/' || sumiu || '%');
  end if;
  -- Arquivo MOVIDO (recaptura regrava por hash): o link segue o anexo para o caminho novo (12/10, #190).
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

-- Reparo dos já quebrados: link para arquivo inexistente no nosso Storage -> URL da matrícula viva do
-- mesmo imóvel (anexo tipo 'matricula' com arquivo existente); sem matrícula viva -> NULL (o selo cai).
create or replace function pg_temp.reparar_link_matricula_morto() returns jsonb language plpgsql as $$
declare repontados int; zerados int;
begin
  with mortos as (
    select i.id from public.imoveis_leilao i
     where i.ativo and i.link_matricula like '%/storage/v1/object/%/documentos/%'
       and not exists (select 1 from storage.objects o where o.bucket_id = 'documentos'
             and o.name = substring(i.link_matricula from '/object/(?:sign|public)/documentos/([^?]+)'))
  ), viva as (
    select distinct on (a.imovel_id) a.imovel_id, a.url
      from public.imovel_anexos a join mortos m on m.id = a.imovel_id
     where a.tipo = 'matricula' and a.url is not null
       and exists (select 1 from storage.objects o where o.bucket_id = 'documentos' and o.name = a.storage_path)
     order by a.imovel_id, a.criado_em desc
  )
  update public.imoveis_leilao i set link_matricula = v.url from viva v where i.id = v.imovel_id;
  get diagnostics repontados = row_count;

  update public.imoveis_leilao i set link_matricula = null
   where i.ativo and i.link_matricula like '%/storage/v1/object/%/documentos/%'
     and not exists (select 1 from storage.objects o where o.bucket_id = 'documentos'
           and o.name = substring(i.link_matricula from '/object/(?:sign|public)/documentos/([^?]+)'));
  get diagnostics zerados = row_count;
  return jsonb_build_object('repontados', repontados, 'zerados', zerados);
end $$;
select pg_temp.reparar_link_matricula_morto();
