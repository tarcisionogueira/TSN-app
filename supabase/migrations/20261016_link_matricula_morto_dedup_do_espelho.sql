-- link_matricula_morto voltou (16/10: 22, todos ZUK) — 4ª volta, causa nova e SEM contaminação.
--
-- Causa: a limpeza diária do espelho (api/_limpeza-espelho.js, motivo 'dup') junta arquivos de
-- CONTEÚDO IDÊNTICO (mesmo etag + tamanho): reaponta imovel_anexos.storage_path para a cópia
-- canônica e apaga a duplicata. Ela trocava SÓ o storage_path; a `url` do anexo continuava na
-- duplicata apagada. O gatilho trg_anexo_atualiza_tem_edital, ao ver o storage_path mudar,
-- regravava o link_matricula do imóvel com `new.url` — a URL MORTA. Resultado: selo verde de
-- matrícula sobre arquivo inexistente. O documento certo continua no bucket (é o mesmo PDF,
-- byte a byte, guardado em outro lote); só o link ficou para trás.
-- Na mesma medição: 1.272 anexos com `url` desencontrada do storage_path (1.061 de lote ativo).
-- As telas não sofrem com isso (re-assinam pelo storage_path via /api/doc-url), mas o gatilho usa.
--
-- Conserto:
--   1. gatilho: link novo = url VÁLIDA do arquivo novo (a do próprio anexo, se casar com o caminho,
--      senão a de outro anexo do mesmo arquivo); sem nenhuma, zera o link — nunca deixa morto;
--   2. espelho_reconciliar_ausentes (roda todo dia após a limpeza): conserta até 500 `url` de
--      anexo desencontradas por rodada e os link_matricula/link_edital mortos que tiverem conserto;
--   3. reparo agora dos 22 link_matricula mortos;
--   4. api/_limpeza-espelho.js passa a gravar a url assinada do canônico junto com o storage_path.

-- Índice que faltava: o gatilho, a reconciliação e a limpeza (PATCH por storage_path) varriam as
-- 74 mil linhas a cada busca. Sem ele, o reparo abaixo rodou 90 s e foi cancelado; com ele, 0,24 s.
create index if not exists idx_imovel_anexos_storage_path on public.imovel_anexos (storage_path) where storage_path is not null;

create or replace function public.trg_anexo_atualiza_tem_edital()
returns trigger
language plpgsql
as $function$
declare alvo uuid := coalesce(new.imovel_id, old.imovel_id);
declare novo_ed boolean; declare novo_mat boolean; declare sumiu text; declare padrao text;
declare v_url text;
begin
  sumiu := case
    when tg_op = 'UPDATE' and old.storage_path is not null and new.storage_path is null then old.storage_path
    -- remoção da linha (o gatilho só dispara em INSERT/UPDATE e na remoção)
    when tg_op not in ('INSERT', 'UPDATE') and old.storage_path is not null then old.storage_path
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
  -- Arquivo TROCADO (dedup do espelho, recaptura): o link do imóvel segue para o arquivo novo.
  -- 16/10: usar `new.url` às cegas regravava a URL da duplicata apagada. Agora só serve URL que
  -- aponte para o caminho NOVO; senão a de outro anexo do mesmo arquivo; senão o link é zerado.
  if alvo is not null and tg_op = 'UPDATE' and old.storage_path is not null and new.storage_path is not null
     and old.storage_path <> new.storage_path then
    v_url := case
      when substring(new.url from '/object/(?:sign|public)/documentos/([^?]+)') = new.storage_path then new.url
      else (select b.url from public.imovel_anexos b
             where b.storage_path = new.storage_path
               and substring(b.url from '/object/(?:sign|public)/documentos/([^?]+)') = new.storage_path
             order by b.criado_em desc limit 1)
    end;
    update public.imoveis_leilao i
       set link_matricula = case when i.link_matricula like '%/documentos/' || old.storage_path || '%' then v_url else i.link_matricula end,
           link_edital    = case when i.link_edital    like '%/documentos/' || old.storage_path || '%' then v_url else i.link_edital end
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

-- ── Autocorreção diária (após a limpeza do espelho) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.espelho_reconciliar_ausentes()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '120s'
AS $function$
declare v_fila int := 0; v_purg int := 0; v_anexo int := 0; v_url int := 0; v_link int := 0;
begin
  with aus as (
    select e.id, e.imovel_id
      from documento_espelho e
     where e.status = 'copiado' and e.storage_path is not null
       and not exists (select 1 from storage.objects o where o.bucket_id = 'documentos' and o.name = e.storage_path)
  ), cls as (
    select aus.id,
           (exists (select 1 from imoveis_leilao i where i.id = aus.imovel_id and i.ativo)
            or exists (select 1 from analises_mercado    a where a.imovel_id = aus.imovel_id::text)
            or exists (select 1 from analises_documental a where a.imovel_id = aus.imovel_id::text)
            or exists (select 1 from analises_laudo      a where a.imovel_id = aus.imovel_id::text)
            or exists (select 1 from casos c where c.imovel_id::text = aus.imovel_id::text)
            or exists (select 1 from arrematados r where r.imovel_id = aus.imovel_id::text)) as vivo
      from aus
  ), f as (
    update documento_espelho e set status = 'pendente', storage_path = null, tentativas = 0,
           motivo = 'arquivo ausente no bucket — recopiar', atualizado_em = now()
      from cls where e.id = cls.id and cls.vivo
    returning 1
  ), p as (
    update documento_espelho e set status = 'purgado', motivo = 'arquivo ausente no bucket (retencao)', atualizado_em = now()
      from cls where e.id = cls.id and not cls.vivo
    returning 1
  )
  select (select count(*) from f), (select count(*) from p) into v_fila, v_purg;

  with z as (
    update imovel_anexos a set storage_path = null
     where a.storage_path is not null
       and not exists (select 1 from storage.objects o where o.bucket_id = 'documentos' and o.name = a.storage_path)
    returning 1
  ) select count(*) into v_anexo from z;

  -- 16/10: `url` do anexo desencontrada do storage_path (sobra da junção de duplicatas). Copia a
  -- URL válida de outro anexo do MESMO arquivo. Lote limitado: corre junto com o app.
  with alvo as (
    select a.id, (select b.url from imovel_anexos b
                   where b.storage_path = a.storage_path
                     and substring(b.url from '/object/(?:sign|public)/documentos/([^?]+)') = b.storage_path
                   order by b.criado_em desc limit 1) as boa
      from imovel_anexos a
     where a.storage_path is not null and a.url like '%/object/%/documentos/%'
       and substring(a.url from '/object/(?:sign|public)/documentos/([^?]+)') is distinct from a.storage_path
     limit 500
  ), u as (
    update imovel_anexos a set url = alvo.boa from alvo where a.id = alvo.id and alvo.boa is not null
    returning 1
  ) select count(*) into v_url from u;

  -- Link do imóvel morto com conserto: aponta para a URL válida do anexo do mesmo tipo.
  with mortos as (
    select i.id,
           (select a.url from imovel_anexos a
             where a.imovel_id = i.id and a.tipo = 'matricula' and a.storage_path is not null
               and substring(a.url from '/object/(?:sign|public)/documentos/([^?]+)') = a.storage_path
             order by a.criado_em desc limit 1) as boa
      from imoveis_leilao i
     where i.ativo and i.link_matricula like '%/storage/v1/object/%/documentos/%'
       and not exists (select 1 from storage.objects o where o.bucket_id = 'documentos'
             and o.name = substring(i.link_matricula from '/object/(?:sign|public)/documentos/([^?]+)'))
     limit 200
  ), l as (
    update imoveis_leilao i set link_matricula = mortos.boa from mortos where i.id = mortos.id and mortos.boa is not null
    returning 1
  ) select count(*) into v_link from l;

  return jsonb_build_object('recopiar', v_fila, 'purgados', v_purg, 'anexos_zerados', v_anexo,
                            'urls_reconciliadas', v_url, 'links_matricula_reparados', v_link, 'em', now());
end $function$;

-- ── Reparo agora: os 22 link_matricula mortos ─────────────────────────────────────────────────
with mortos as (
  select i.id,
         (select b.url from imovel_anexos a
            join imovel_anexos b on b.storage_path = a.storage_path
                and substring(b.url from '/object/(?:sign|public)/documentos/([^?]+)') = b.storage_path
           where a.imovel_id = i.id and a.tipo = 'matricula' and a.storage_path is not null
           order by b.criado_em desc limit 1) as boa
    from imoveis_leilao i
   where i.ativo and i.link_matricula like '%/storage/v1/object/%/documentos/%'
     and not exists (select 1 from storage.objects o where o.bucket_id = 'documentos'
           and o.name = substring(i.link_matricula from '/object/(?:sign|public)/documentos/([^?]+)'))
)
update imoveis_leilao i set link_matricula = mortos.boa from mortos where i.id = mortos.id and mortos.boa is not null;
