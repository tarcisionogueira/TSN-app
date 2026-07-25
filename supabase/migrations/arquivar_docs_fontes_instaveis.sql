-- Arquivamento PROATIVO de documentos para fontes INSTÁVEIS.
-- Princípio do dono: leiloeiros confiáveis (nunca perdemos o contato) podem ficar só
-- com o LINK; os que "sempre têm quebra/falha" (pagos/atrás de anti-bot, ou de baixa
-- qualidade) precisam ter o PDF ARMAZENADO no bucket ANTES que a fonte quebre — assim
-- o relatório continua lendo o documento mesmo quando o link de origem morre.
--
-- Flag por leiloeiro (TUNÁVEL pelo dono via update): default false; ligada para
-- custo pago/misto (Bright Data/Cloudflare = links voláteis) e qualidade < 0.95.
-- Para arquivar mais uma fonte: update leiloeiro_conhecimento set arquivar_docs=true
-- where fonte='XPTO';  (e o contrário para parar).
alter table public.leiloeiro_conhecimento
  add column if not exists arquivar_docs boolean not null default false;

update public.leiloeiro_conhecimento
set arquivar_docs = true
where custo in ('pago','misto') or qualidade < 0.95;

-- Enfileira, na documentos_fila, imóveis de fontes flag=arquivar_docs que TÊM um link
-- de documento mas NENHUMA cópia no bucket. O job de captura genérico
-- (scripts/captura-documentos.mjs, a cada 15 min) drena a fila e, pelo CAMINHO 1
-- (fetch direto do link, GRÁTIS), baixa e guarda o PDF em imovel_anexos/Storage; só
-- cai em Puppeteer/Bright Data (com teto de custo) quando o link direto falha.
--
-- CEF fica de fora: tem pipeline próprio; a matrícula é URL ESTÁTICA derivável
-- (venda-imoveis.caixa.gov.br/editais/matricula/UF/num.pdf → confiável, não quebra) e
-- o edital é COLETIVO por leilão (mistura página/PDF, alguns mislabel) = follow-up
-- dedicado. A retenção (anexos_expirados) mantém o arquivo enquanto o leilão está ativo.
create or replace function public.enfileirar_docs_arquivar(p_limite integer default 1000)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_ins int;
begin
  -- Higiene da fila (mesma do enfileirar_docs_faltantes): tira o que já resolveu,
  -- esgotou tentativas, ficou inativo ou já ganhou uma cópia no bucket.
  delete from documentos_fila f
  where f.status = 'ok'
     or (f.status = 'erro' and coalesce(f.tentativas,0) >= 4)
     or exists (
       select 1 from imoveis_leilao il
       where il.id = f.imovel_id
         and (not il.ativo
              or exists (select 1 from imovel_anexos a where a.imovel_id = il.id and a.storage_path is not null)));

  with cand as (
    select il.id
    from imoveis_leilao il
    join leiloeiro_conhecimento lc on lc.fonte = il.fonte and lc.arquivar_docs
    where il.ativo
      and il.fonte <> 'CEF'
      and coalesce(lc.docs_status,'') <> 'esperado'   -- fonte que não publica o doc não tem o que arquivar
      and (il.link_matricula ~ '^https?://' or il.link_edital ~ '^https?://' or il.link_regras_venda ~ '^https?://'
           or (jsonb_typeof(il.anexos) = 'array' and jsonb_array_length(il.anexos) > 0))
      and not exists (select 1 from imovel_anexos a where a.imovel_id = il.id and a.storage_path is not null)
      and not exists (select 1 from documentos_fila f where f.imovel_id = il.id)
    order by il.desconto_percentual desc nulls last, il.id
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

-- Hardening: SECURITY DEFINER só p/ o backend (service_role). Revogar de PUBLIC
-- (não só anon/authenticated) senão o anon herda EXECUTE via PUBLIC (o auditor pega).
revoke all on function public.enfileirar_docs_arquivar(integer) from public;
grant execute on function public.enfileirar_docs_arquivar(integer) to service_role;
