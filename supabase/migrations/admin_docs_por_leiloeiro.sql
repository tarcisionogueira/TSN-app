-- Auditoria de DOCUMENTOS por leiloeiro para o Dashboard admin: contagem de imóveis, fotos,
-- matrículas, editais, regras de venda online e anexos POR fonte, MAIS sinalizadores de
-- CONFUSÃO de documento (edital = matrícula, edital = página do lote, matrícula = página,
-- matrícula que não é arquivo). Motivada pelo caso "botão Edital abria a Matrícula" e pela
-- "matrícula" auto-derivada do Grupo Lance. SECURITY DEFINER com CHECK de admin interno;
-- exposta só a authenticated (nunca anon) — não é flagrada pelo auditoria_seguranca.
create or replace function public.admin_docs_por_leiloeiro()
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_role text;
begin
  select role into v_role from public.perfis where id = auth.uid();
  if v_role is distinct from 'admin' then raise exception 'apenas admin'; end if;

  return (
    with base as (
      select
        coalesce(nullif(fonte,''),'—') as fonte,
        link_foto, link_matricula, link_edital, link_regras_venda, url_lote,
        coalesce(jsonb_array_length(case when jsonb_typeof(anexos)='array' then anexos else '[]'::jsonb end),0) as n_anexos
      from public.imoveis_leilao
      where ativo = true
    ),
    por_fonte as (
      select
        fonte,
        count(*) as imoveis,
        count(*) filter (where link_foto is not null and link_foto <> '') as com_foto,
        count(*) filter (where link_matricula is not null and link_matricula <> '') as com_matricula,
        count(*) filter (where link_edital is not null and link_edital <> '') as com_edital,
        count(*) filter (where link_regras_venda is not null and link_regras_venda <> '') as com_regras,
        count(*) filter (where n_anexos > 0) as com_anexos,
        -- CONFUSÕES de documento:
        count(*) filter (where link_edital is not null and link_edital = link_matricula) as edital_eq_matricula,
        count(*) filter (where link_edital is not null and link_edital = url_lote) as edital_eq_lote,
        count(*) filter (where link_matricula is not null and link_matricula = url_lote) as matricula_eq_lote,
        -- matrícula que NÃO é arquivo (nem PDF, nem objeto do nosso Storage) = aponta p/ página:
        count(*) filter (
          where link_matricula is not null
            and link_matricula !~* '\.pdf(\?|#|$)'
            and link_matricula not ilike '%/object/sign/%'
            and link_matricula not ilike '%/object/public/%'
        ) as matricula_nao_arquivo
      from base
      group by fonte
    )
    select jsonb_build_object(
      'gerado_em', now(),
      'total_imoveis', (select count(*) from base),
      'fontes', coalesce((
        select jsonb_agg(to_jsonb(por_fonte.*) order by imoveis desc) from por_fonte
      ), '[]'::jsonb)
    )
  );
end;
$fn$;
revoke execute on function public.admin_docs_por_leiloeiro() from public, anon;
grant execute on function public.admin_docs_por_leiloeiro() to authenticated;
