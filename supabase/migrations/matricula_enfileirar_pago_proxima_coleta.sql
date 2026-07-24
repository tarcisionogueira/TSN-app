-- Refino do enfileirador de matrícula (segue a regra do dono: "pago = próxima coleta,
-- grátis = agora"). Dois ajustes sobre matricula_resolucao_generalizada:
--   1) NÃO enfileira fontes PAGAS (custo='pago': PECINI, RJLEILOES, GESTAOLEILOES) na
--      fila proativa — a captura genérica usa Bright Data (custo) e enfileirar tudo
--      seria "resolver agora" no pago. O pago resolve na PRÓXIMA COLETA (scraper
--      dedicado, Bright Data em lote) e ON-DEMAND quando um relatório é gerado
--      (gerar-documental já baixa a matrícula paga sob demanda). 'misto'/'gratis' seguem.
--   2) NÃO enfileira lotes que JÁ têm numero_matricula extraído — o número já identifica
--      a matrícula; buscar o PDF proativamente (às vezes via proxy pago) não compensa.
--      O PDF é baixado sob demanda no relatório, se preciso.
create or replace function public.enfileirar_docs_faltantes(p_limite integer default 3000)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_ins int;
begin
  delete from documentos_fila f
  where f.status = 'ok'
     or (f.status = 'erro' and coalesce(f.tentativas,0) >= 4)
     or exists (
       select 1 from imoveis_leilao il
       where il.id = f.imovel_id
         and (not il.ativo
              or (il.link_matricula is not null and il.link_matricula <> '')
              or il.numero_matricula is not null
              or exists (select 1 from imovel_anexos a where a.imovel_id = il.id and a.tipo = 'matricula')));

  with cand as (
    select il.id
    from imoveis_leilao il
    left join leiloeiro_conhecimento lc on lc.fonte = il.fonte
    where il.ativo
      and il.fonte not in ('CEF','SUPORTE')
      and il.fonte not in ('ZUK','GRUPOLANCE')                    -- login-gated: pipeline próprio
      and coalesce(lc.custo,'gratis') <> 'pago'                   -- PAGO: próxima coleta / on-demand
      and coalesce(lc.docs_status,'') <> 'esperado'               -- não publica matrícula no lote
      and il.url_lote ~ '^https?://'
      and (il.link_matricula is null or il.link_matricula = '')
      and il.numero_matricula is null                            -- já identificou o nº → não gasta captura
      and (il.matricula_checada_em is null or il.matricula_checada_em < now() - interval '30 days')
      and not exists (select 1 from imovel_anexos a where a.imovel_id = il.id and a.tipo = 'matricula')
      and not exists (select 1 from documentos_fila f where f.imovel_id = il.id)
    order by (il.matricula_checada_em is null) desc, il.desconto_percentual desc nulls last, il.id
    limit p_limite
  ), ins as (
    insert into documentos_fila (imovel_id)
    select id from cand
    on conflict (imovel_id) do nothing
    returning imovel_id
  )
  select count(*)::int into v_ins from ins;
  return v_ins;
end
$function$;

-- Limpa da fila o que o novo critério NÃO enfileiraria (pago OU já com numero_matricula),
-- para o backlog atual refletir só o GRÁTIS a resolver agora.
delete from documentos_fila f
using imoveis_leilao il
left join leiloeiro_conhecimento lc on lc.fonte = il.fonte
where f.imovel_id = il.id
  and f.status = 'pendente'
  and (coalesce(lc.custo,'gratis') = 'pago' or il.numero_matricula is not null);
