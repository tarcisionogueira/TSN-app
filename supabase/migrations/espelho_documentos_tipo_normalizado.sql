-- Espelho de documentos: o `tipo` que vem do LEILOEIRO não pode entrar cru na tabela.
--
-- O QUE QUEBROU (achado na abertura de 14/08). `enfileirar_espelho_documentos` copiava
-- `anexos[].tipo` direto para `documento_espelho.tipo`, que tem CHECK restrito a
-- ('matricula','edital','regras','laudo','anexo','outro'). A MEGA passou a publicar 44 anexos
-- com `tipo: 'proposta'` — rótulo legítimo do site dela, desconhecido nosso. Como o INSERT é
-- UMA instrução para o lote inteiro (limite 500), UMA linha inválida derruba o lote TODO:
-- 23514, zero enfileirados. E como as 44 nunca entram, seguem "novas" e envenenam a rodada
-- seguinte, e a seguinte. Resultado: o espelhamento parou de enfileirar — 978 documentos
-- novos em 13/08, ZERO em 14/08, com o cron respondendo `ok: true` de 4 em 4 horas.
--
-- POR QUE PASSOU. O erro só aparecia no log da Vercel (`console.error`) e o contador de
-- enfileirados caía para 0 — o mesmo 0 de "não havia nada novo". Erro entregue como conteúdo
-- válido, a forma #5 do CLAUDE.md, num cron que existe justamente para proteger o documento
-- do cliente contra o leiloeiro tirar o PDF do ar.
--
-- A CORREÇÃO. Rótulo de terceiro é dado EXTERNO: normaliza-se na entrada. Os conhecidos
-- (com acento, maiúscula ou abreviados) mapeiam para a nossa taxonomia; rótulo novo cai em
-- 'outro' em vez de derrubar o lote. Um leiloeiro inventar categoria amanhã passa a ser um
-- documento a menos classificado, não a fila inteira parada.

-- Mapa rótulo-do-leiloeiro → taxonomia nossa. `translate` faz as vezes de unaccent (a
-- extensão não está instalada) só para o casamento: o valor GRAVADO é sempre o nosso.
create or replace function public.doc_tipo_normalizado(p_tipo text)
 returns text
 language sql
 immutable
 set search_path to 'public'
as $function$
  select case
    when t is null or t = ''            then 'anexo'
    when t ~ 'matricul'                 then 'matricula'
    when t ~ 'edital'                   then 'edital'
    when t ~ '(regra|condic)'           then 'regras'
    when t ~ '(laudo|avaliac|vistoria)' then 'laudo'
    when t = 'anexo'                    then 'anexo'
    else 'outro'
  end
  from (select translate(lower(btrim(coalesce(p_tipo, ''))),
                         'áàâãäéèêëíìîïóòôõöúùûüç',
                         'aaaaaeeeeiiiiooooouuuuc') as t) s;
$function$;

comment on function public.doc_tipo_normalizado(text) is
  'Normaliza o rótulo de documento publicado pelo leiloeiro para a taxonomia do CHECK de documento_espelho. Rótulo desconhecido vira "outro" — nunca derruba o INSERT do lote.';

create or replace function public.enfileirar_espelho_documentos(p_limite integer default 200)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
           end as urgencia
      from public.imoveis_leilao i
      left join inst on inst.fonte = i.fonte
     where i.ativo and i.fonte not in ('CEF','caixa')
  ),
  candidatos as (
    select b.id as imovel_id, b.fonte, 'matricula'::text as tipo, b.link_matricula as url, b.instab, b.urgencia
      from base b
     where b.link_matricula is not null
       and b.link_matricula not like '%supabase.co%'
       and b.link_matricula ~* '^https?://'
    union all
    select b.id, b.fonte, 'edital', b.link_edital, b.instab, b.urgencia
      from base b
     where b.link_edital is not null
       and b.link_edital not like '%supabase.co%'
       and b.link_edital ~* '^https?://.*\.pdf(\?|#|$)'
    union all
    select b.id, b.fonte,
           public.doc_tipo_normalizado(x->>'tipo'),
           x->>'url', b.instab, b.urgencia
      from base b, lateral jsonb_array_elements(b.anexos) x
     where jsonb_typeof(b.anexos) = 'array'
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

-- A função é chamada pelo cron com a service key; anon/authenticated não têm o que fazer com ela.
revoke execute on function public.doc_tipo_normalizado(text) from anon, public;
