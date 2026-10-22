-- 22/10 (#278): SAÚDE POR TENANT nos clusters. VLANCE, GESTAOLEILOES, SUPORTE e LEILOTECH gravam UMA linha de
-- fonte_saude para vários domínios — a soma esconde o domínio que zerou (parser quebrado para um site só e o
-- cluster segue "ok"). A pergunta aqui vem do rastro no acervo, sem mexer em coletor nenhum: o tenant
-- (`leiloeiro`, estável nos quatro clusters — o prefixo do fonte_id não é) teve lote nos últimos 60 dias e não
-- foi tocado nas últimas `p_horas`, enquanto o resto do cluster foi.
--
-- Limite conhecido: tenant que NUNCA coletou não deixa rastro — esse só aparece no log do coletor (é falha de
-- integração, não regressão). Tenant vazio de propósito (leiloeiro sem imóvel agora) se cala gravando em
-- fonte_regressao_explicada com fonte = '<CLUSTER>:<leiloeiro>' (mesmo desenho de fonte_regressao_pendente).
create or replace function public.tenant_parado(p_horas int default 72)
 returns table(fonte text, tenant text, ultimo_lote_em timestamptz, horas_parado int, lotes_60d bigint, ativos bigint, explicacao text)
 language sql stable set search_path to 'public' as $function$
  with c as (
    select i.fonte, max(i.atualizado_em) ult_cluster
      from public.imoveis_leilao i
     where i.fonte in ('VLANCE', 'GESTAOLEILOES', 'SUPORTE', 'LEILOTECH')
     group by 1
  ),
  t as (
    select i.fonte, coalesce(i.leiloeiro, '?') tenant, max(i.atualizado_em) ult,
           count(*) filter (where i.atualizado_em > now() - interval '60 days') lotes_60d,
           count(*) filter (where i.ativo) ativos
      from public.imoveis_leilao i join c using (fonte)
     group by 1, 2
  )
  select t.fonte, t.tenant, t.ult, (extract(epoch from (c.ult_cluster - t.ult)) / 3600)::int, t.lotes_60d, t.ativos,
         (select e.explicacao from public.fonte_regressao_explicada e
           where e.fonte = t.fonte || ':' || t.tenant and e.explicado_ate >= current_date)
    from t join c using (fonte)
   where t.lotes_60d > 0
     and c.ult_cluster > now() - interval '3 days'          -- o cluster está rodando
     and c.ult_cluster - t.ult > make_interval(hours => p_horas)
   order by 4 desc;
$function$;

revoke execute on function public.tenant_parado(int) from public, anon, authenticated;
grant execute on function public.tenant_parado(int) to service_role;
