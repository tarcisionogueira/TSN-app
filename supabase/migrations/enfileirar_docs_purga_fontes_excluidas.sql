-- Fila de documentos: purgar o que a REGRA ATUAL não enfileiraria mais.
--
-- Desde 24/07 o enfileirador pula fontes PAGAS (custo='pago' → captura na próxima coleta paga),
-- não-publicadoras (docs_status='esperado') e as login-gated (ZUK/GRUPOLANCE, pipeline próprio).
-- Mas o purge do `enfileirar_docs_faltantes` só removia linha processada/resolvida — as linhas
-- enfileiradas ANTES da regra continuaram na fila e o drenador genérico as tenta até esgotar as
-- 4 tentativas. Medição em 02/08: 185 GESTAOLEILOES + 19 PECINI pendentes, todas batendo em
-- Cloudflare ("Just a moment…") — ~800 visitas de navegador desperdiçadas, ocupando slots de
-- lotes que o drenador CONSEGUE resolver (o run processa 40 por vez).
--
-- Correção na raiz: o purge passa a usar o MESMO critério da seleção. Fila = trabalho; se a
-- regra não enfileiraria hoje, não há trabalho a fazer. Idempotente e auto-corretivo — quando
-- uma fonte mudar de custo/docs_status, a fila se ajusta sozinha no próximo run.
create or replace function public.enfileirar_docs_faltantes(p_limite integer DEFAULT 3000)
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
              or exists (select 1 from imovel_anexos a where a.imovel_id = il.id and a.tipo = 'matricula')))
     -- NOVO: linha cuja FONTE a regra atual não enfileiraria (herança de antes de 24/07).
     or exists (
       select 1 from imoveis_leilao il
       left join leiloeiro_conhecimento lc on lc.fonte = il.fonte
       where il.id = f.imovel_id
         and (il.fonte in ('CEF','SUPORTE','ZUK','GRUPOLANCE')
              or coalesce(lc.custo,'gratis') = 'pago'
              or coalesce(lc.docs_status,'') = 'esperado'
              or il.url_lote is null
              or il.url_lote !~ '^https?://'));

  with cand as (
    select il.id
    from imoveis_leilao il
    left join leiloeiro_conhecimento lc on lc.fonte = il.fonte
    where il.ativo
      and il.fonte not in ('CEF','SUPORTE')
      and il.fonte not in ('ZUK','GRUPOLANCE')
      and coalesce(lc.custo,'gratis') <> 'pago'
      and coalesce(lc.docs_status,'') <> 'esperado'
      and il.url_lote ~ '^https?://'
      and (il.link_matricula is null or il.link_matricula = '')
      and il.numero_matricula is null
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

comment on function public.enfileirar_docs_faltantes(integer) is
  'Enfileira lotes ATIVOS sem matrícula na documentos_fila para o drenador (captura-documentos.mjs). Fila = trabalho: purga processados/resolvidos E o que a regra atual não enfileiraria (fonte paga, não-publicadora, login-gated, sem url_lote). Respeita cooldown de 30d do negative-cache matricula_checada_em.';
