-- 29/08 — A CEF ENTRA NO ESPELHO, E SÓ COM A MATRÍCULA
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- A exclusão `fonte not in ('CEF','caixa')` existia porque a CEF tinha pipeline próprio
-- (`cef_matricula_fila` + Puppeteer). Medido em 29/08 (amostra real de 60 links, só cabeçalho):
-- as 23.484 matrículas são **PDF DIRETO** (`venda-imoveis.caixa.gov.br/editais/matricula/…`),
-- média **1,76 MB**, mediana 1,84, p90 3,42, máx 4,58. Navegador nunca foi necessário — o
-- espelho (fetch + bucket) é o caminho certo, e é ~10× mais rápido que a fila de 25/rodada.
--
-- Projeção: **40,3 GB** → storage de 62,3 para ~102,6 GB. No plano Pro são 100 GB incluídos e
-- US$ 0,021/GB depois: o excedente custa **US$ 0,055/mês**. E é PLATÔ, não rampa — a retenção
-- em camadas apaga a matrícula de venda direta quando a CEF retira o imóvel do acervo.
--
-- ⚠️ O EDITAL DA CEF FICA DE FORA, DE PROPÓSITO. Os 7.655 links de edital apontam para apenas
-- **19 arquivos distintos**. O espelho grava por imóvel, então baixaria 7.655 cópias do mesmo
-- PDF — **6,9 GB de duplicata pura**. E a alternativa "uma cópia, N ponteiros" é PIOR: a
-- retenção apaga por imóvel, e o primeiro lote a expirar levaria embora o arquivo dos outros
-- 7.654 — a mesma família de ponteiro-morto que fechamos hoje, só que em escala. Edital
-- compartilhado se resolve sob demanda (a captura síncrona em `gerar-documental`), não por
-- cópia. Pela mesma razão os anexos genéricos da CEF também ficam fora.
create or replace function public.enfileirar_espelho_documentos(p_limite integer default 200)
returns integer language plpgsql security definer set search_path to 'public' as $function$
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
     where b.link_matricula is not null
       and b.link_matricula not like '%supabase.co%'
       and b.link_matricula ~* '^https?://'
    union all
    select b.id, b.fonte, 'edital', b.link_edital, b.instab, b.urgencia
      from base b
     where not b.eh_cef                      -- ver o aviso do cabeçalho: 7.655 links, 19 arquivos
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
