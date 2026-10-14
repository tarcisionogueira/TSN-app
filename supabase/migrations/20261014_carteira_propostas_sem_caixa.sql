-- ─────────────────────────────────────────────────────────────────────────────────────────
-- CARTEIRA DE PROPOSTAS (tela do Admin, 14/10): oportunidades_proposta() sem a Caixa.
--
-- A venda online/direta da CEF é compra DIRETA no site da Caixa (não há leiloeiro para receber
-- proposta) e são ~3,3 mil linhas `sem_lance` por relistagem: com desconto alto, elas tomavam o
-- topo da lista e escondiam os ~940 lotes de leiloeiro que são o alvo da proposta pós-leilão.
-- Mesma assinatura (create or replace) — a tela chama com p_limite/p_estado.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.oportunidades_proposta(p_limite integer default 200, p_estado text default null)
returns table (
  id uuid, fonte text, titulo text, cidade text, estado text, tipo text, modalidade text,
  valor_minimo numeric, valor_avaliacao numeric, desconto_percentual integer,
  ultima_praca date, dias_restantes integer, relatorios integer, favoritos integer, url_lote text
)
language sql stable security definer set search_path = public as $$
  with base as (
    select i.*,
           greatest(i.data_leilao_2::date, i.data_fim,
                    case when i.data_leilao ~ '^\d{4}-\d{2}-\d{2}' then left(i.data_leilao, 10)::date end) as ult
      from imoveis_leilao i
     where i.ativo
       and i.resultado_leilao = 'sem_lance'
       and i.fonte <> 'CEF'
       and (p_estado is null or i.estado = p_estado)
       and public.is_equipe()
  )
  select b.id, b.fonte, b.titulo, b.cidade, b.estado, b.tipo, b.modalidade,
         b.valor_minimo, b.valor_avaliacao, b.desconto_percentual,
         b.ult,
         (b.ult + 15 - current_date),
         (select count(*)::int from analises_mercado a where a.imovel_id = b.id::text),
         (select count(*)::int from favoritos f where f.item_id = b.id),
         b.url_lote
    from base b
   order by 13 desc, 14 desc, b.desconto_percentual desc nulls last, 12 asc nulls last
   limit least(greatest(coalesce(p_limite, 200), 1), 1000);
$$;
