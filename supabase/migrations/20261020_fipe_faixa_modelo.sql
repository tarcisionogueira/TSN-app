-- 20/10 — VALOR DE MERCADO NUNCA EM BRANCO (dono: "não pode deixar de identificar o valor de mercado de um
-- veículo"). Medido: ~580 lotes ativos sem ano em lugar nenhum (título, descrição, edital; só 8 com placa
-- completa — consulta por placa não compensa). Com marca+modelo, a FIPE dá a FAIXA do modelo (ano mais
-- antigo × mais novo da tabela): `fipe_status = 'faixa_modelo'`, `valor_fipe` NULO de propósito (um número
-- só fingiria precisão que não existe e entraria no "% da FIPE"). A faixa também guarda o intervalo do
-- `aproximado` (várias versões no mesmo ano). Gravado por api/_fipe-garantir.js.
alter table public.veiculos_leilao add column if not exists fipe_faixa_min numeric;
alter table public.veiculos_leilao add column if not exists fipe_faixa_max numeric;

create or replace view public.veiculos_vitrine with (security_invoker = false) as
  select v.id, v.titulo, v.marca, v.marca_busca, v.modelo, v.ano_fabricacao, v.ano_modelo, v.km,
         v.valor_minimo, v.valor_avaliacao, v.valor_fipe, v.fipe_status, v.fipe_mes_referencia,
         v.desconto_percentual, v.desconto_fipe_percentual, v.modalidade, v.origem_venda, v.forma_pagamento,
         v.cidade, v.estado,
         (select coalesce(jsonb_agg(to_jsonb('/api/img-proxy?veiculo=' || v.id || '&i=' || (o.n - 1)) order by o.n), '[]'::jsonb)
            from jsonb_array_elements_text(case when jsonb_typeof(v.fotos) = 'array' then v.fotos else '[]'::jsonb end)
                 with ordinality o(u, n)
           where o.u ~ '^https?://' and o.u !~* 'no-image|nao-?disp|sem-?foto|placeholder') as fotos,
         v.data_leilao, v.sinistro, v.is_sucata, v.financiavel, v.combustivel, v.cambio, v.cor,
         v.opcionais, v.motor_alerta, v.motor_status, v.ipva_situacao, v.tipo_veiculo,
         v.resultado_leilao, v.valor_lance_vencedor, v.teve_lance, v.status_patio, v.ativo, v.criado_em, v.atualizado_em,
         v.fipe_codigo, v.fipe_atualizado_em, v.fipe_faixa_min, v.fipe_faixa_max
    from public.veiculos_leilao v
   where v.status_patio = 'confirmado';
grant select on public.veiculos_vitrine to anon, authenticated;
