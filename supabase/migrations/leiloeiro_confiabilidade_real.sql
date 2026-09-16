-- CONFIABILIDADE DO LEILOEIRO A PARTIR DE RESULTADO REAL (18/09, pedido do dono: "um leiloeiro
-- cujos imóveis geram mais risco jurídico confirmado depois não fica mais 'caro' na próxima
-- triagem" — leiloeiro_conhecimento era atualizado por operação/contato, nunca por DESFECHO).
--
-- Dois sinais, os dois já existem no banco, ninguém os cruzava por fonte:
--   1. risco_confirmado_pct — de todo documental concluído desta fonte, quantos % têm um
--      risco REALMENTE confirmado no documento (severidade bloqueante/alerta, constaNaDoc=true,
--      não diligência pendente). Fonte alta aqui é fonte cujos lotes escondem mais problema.
--   2. divergencia_juridica_pct — de todo imóvel desta fonte com devolutiva de advogado
--      (juridico_aprendizado), quantos % tiveram divergência real entre o que a IA leu e o
--      que o advogado achou. Fonte alta aqui é fonte cuja documentação engana mais a leitura
--      automática (documento incompleto, mal publicado, contraditório).
-- Amostra mínima de 5 documentais por fonte — abaixo disso o número é ruído, não sinal
-- (mesmo princípio de "AMOSTRA INSUFICIENTE" já usado em documental_distribuicao()).
alter table public.leiloeiro_conhecimento
  add column if not exists risco_confirmado_pct numeric,
  add column if not exists divergencia_juridica_pct numeric,
  add column if not exists amostra_docs int,
  add column if not exists confiabilidade_calculada_em timestamptz;

comment on column public.leiloeiro_conhecimento.risco_confirmado_pct is
  '% de relatórios documentais concluídos desta fonte com risco jurídico REALMENTE confirmado (não diligência pendente). Calculado por atualizar_confiabilidade_leiloeiro(), amostra mínima 5.';
comment on column public.leiloeiro_conhecimento.divergencia_juridica_pct is
  '% de imóveis desta fonte, entre os que tiveram devolutiva de advogado, com divergência real entre a leitura da IA e o que o advogado encontrou.';

create or replace function public.atualizar_confiabilidade_leiloeiro()
returns int language plpgsql security definer set search_path to 'public' as $$
declare v_atualizados int := 0;
begin
  with docs as (
    select i.fonte, d.imovel_id,
           exists (
             select 1 from jsonb_array_elements(coalesce(d.result->'riscos','[]'::jsonb)) r
              where r->>'severidade' in ('bloqueante','alerta') and (r->>'constaNaDoc')::boolean is true
           ) as risco_confirmado
      from public.analises_documental d
      join public.imoveis_leilao i on i.id::text = d.imovel_id
     where d.status = 'concluida'
  ), agg as (
    select fonte, count(*) as amostra,
           round(100.0 * count(*) filter (where risco_confirmado) / count(*), 1) as risco_pct
      from docs group by fonte having count(*) >= 5
  ), jur as (
    select i.fonte, count(distinct ja.imovel_id) as com_divergencia
      from public.juridico_aprendizado ja
      join public.imoveis_leilao i on i.id::text = ja.imovel_id
     group by i.fonte
  ), divg as (
    select a.fonte, a.amostra, a.risco_pct,
           round(100.0 * coalesce(j.com_divergencia, 0) / a.amostra, 1) as divergencia_pct
      from agg a left join jur j on j.fonte = a.fonte
  ), u as (
    update public.leiloeiro_conhecimento lc
       set risco_confirmado_pct = d.risco_pct,
           divergencia_juridica_pct = d.divergencia_pct,
           amostra_docs = d.amostra,
           confiabilidade_calculada_em = now()
      from divg d
     where lc.fonte = d.fonte
    returning 1
  )
  select count(*) into v_atualizados from u;
  return v_atualizados;
end $$;

comment on function public.atualizar_confiabilidade_leiloeiro is
  'Calibra leiloeiro_conhecimento com DESFECHO real (risco confirmado no documental + divergência real do advogado), não com dado operacional. Determinística, sem IA. Chamada semanal pelo moderador-cron.';

revoke all on function public.atualizar_confiabilidade_leiloeiro() from public, anon, authenticated;
