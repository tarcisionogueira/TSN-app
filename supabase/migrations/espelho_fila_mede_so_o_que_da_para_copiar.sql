-- FILA DO ESPELHO QUE NÃO MEDIA FILA (25/09). "30.837 pendentes" e ZERO trabalho possível:
-- `proximos_espelho_documentos` só pega tentativas < 3 e lote ativo, e o contador somava
--   · 24.536 matrículas da CEF — o site da Caixa responde 403 a toda tentativa; em toda a história
--     NENHUMA foi copiada (edital e anexo da CEF já estavam fora da fila; a matrícula não);
--   · documentos que já esgotaram as 3 tentativas (SUPERBID 1.974, BAYIT 696, ALFA 670, HASTA 579…).
-- (1) a CEF deixa de ser enfileirada também na matrícula; (2) o que esgotou vira `ignorado` com o
-- motivo preservado — a linha fica (é o registro de que tentamos), mas sai da contagem de pendente.
-- Com isso "pendente" volta a significar "ainda dá para copiar" (forma nº 10 do CLAUDE.md).

CREATE OR REPLACE FUNCTION public.enfileirar_espelho_documentos(p_limite integer DEFAULT 200)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_n integer;
begin
  with inst as (select * from public.fonte_instabilidade()),
  base as (
    select i.id, i.fonte, i.link_matricula, i.link_edital, i.anexos, i.data_leilao,
           coalesce(inst.pct_instavel, 0) as instab,
           case
             when i.data_leilao ~ '^\d{4}-\d{2}-\d{2}'
                  and i.data_leilao::date between current_date and current_date + 30 then 0
             when i.data_leilao ~ '^\d{4}-\d{2}-\d{2}'
                  and i.data_leilao::date between current_date + 31 and current_date + 90 then 1
             when i.data_leilao is null or i.data_leilao !~ '^\d{4}-\d{2}-\d{2}' then 2
             when i.data_leilao::date > current_date + 90 then 3
             else 4
           end as urgencia,
           i.fonte in ('CEF','caixa') as eh_cef
      from public.imoveis_leilao i
      left join inst on inst.fonte = i.fonte
     where i.ativo
  ),
  candidatos as (
    select b.id as imovel_id, b.fonte, 'matricula'::text as tipo, b.link_matricula as url, b.instab, b.urgencia
      from base b
     where not b.eh_cef                      -- 25/09: CEF responde 403 sempre (0 cópias em 24.536)
       and b.link_matricula is not null
       and b.link_matricula not like '%supabase.co%'
       and b.link_matricula ~* '^https?://'
    union all
    select b.id, b.fonte, 'edital', b.link_edital, b.instab, b.urgencia
      from base b
     where not b.eh_cef
       and b.link_edital is not null
       and b.link_edital not like '%supabase.co%'
       and b.link_edital ~* '^https?://.*\.pdf(\?|#|$)'
    union all
    select b.id, b.fonte,
           public.doc_tipo_normalizado(x->>'tipo'),
           x->>'url', b.instab, b.urgencia
      from base b, lateral jsonb_array_elements(b.anexos) x
     where not b.eh_cef
       and jsonb_typeof(b.anexos) = 'array'
       and (x->>'url') is not null
       and (x->>'url') not like '%supabase.co%'
       and (x->>'url') ~* '^https?://.*\.pdf(\?|#|$)'
  ),
  novos as (
    select c.* from candidatos c
     where not exists (select 1 from public.documento_espelho e
                        where e.imovel_id = c.imovel_id and e.tipo = c.tipo and e.url_origem = c.url)
     order by c.urgencia, c.instab desc, c.imovel_id
     limit p_limite
  )
  insert into public.documento_espelho (imovel_id, fonte, tipo, url_origem)
  select imovel_id, fonte, tipo, url from novos
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

update public.documento_espelho
   set status = 'ignorado',
       motivo = left('esgotado (3 tentativas): ' || coalesce(motivo, 'sem motivo'), 200),
       atualizado_em = now()
 where status = 'pendente' and coalesce(tentativas, 0) >= 3;

update public.documento_espelho
   set status = 'ignorado', motivo = 'CEF: site da Caixa bloqueia a cópia (403)', atualizado_em = now()
 where status = 'pendente' and fonte in ('CEF','caixa');
