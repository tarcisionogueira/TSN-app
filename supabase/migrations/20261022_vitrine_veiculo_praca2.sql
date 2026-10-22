-- 22/10: a 2ª praça do veículo (valor_minimo_2/data_leilao_2, preenchidos por reconciliar_gemeos_veiculos) na
-- vitrine pública — o gêmeo da 2ª praça saiu da busca e o preço dele precisa continuar visível no card.
-- Definição = a viva em produção (inclui fipe_faixa_*) + as duas colunas no FIM (create or replace view só
-- aceita coluna nova no final).
create or replace view public.veiculos_vitrine with (security_invoker = false) as
 select v.id, v.titulo, v.marca, v.marca_busca, v.modelo, v.ano_fabricacao, v.ano_modelo, v.km,
        v.valor_minimo, v.valor_avaliacao, v.valor_fipe, v.fipe_status, v.fipe_mes_referencia,
        v.desconto_percentual, v.desconto_fipe_percentual, v.modalidade, v.origem_venda, v.forma_pagamento,
        v.cidade, v.estado,
        (select coalesce(jsonb_agg(to_jsonb(('/api/img-proxy?veiculo='::text || v.id) || '&i='::text || (o.n - 1)) order by o.n), '[]'::jsonb)
           from jsonb_array_elements_text(case when jsonb_typeof(v.fotos) = 'array' then v.fotos else '[]'::jsonb end) with ordinality o(u, n)
          where o.u ~ '^https?://' and o.u !~* 'no-image|nao-?disp|sem-?foto|placeholder') as fotos,
        v.data_leilao, v.sinistro, v.is_sucata, v.financiavel, v.combustivel, v.cambio, v.cor, v.opcionais,
        v.motor_alerta, v.motor_status, v.ipva_situacao, v.tipo_veiculo, v.resultado_leilao, v.valor_lance_vencedor,
        v.teve_lance, v.status_patio, v.ativo, v.criado_em, v.atualizado_em, v.fipe_codigo, v.fipe_atualizado_em,
        v.fipe_faixa_min, v.fipe_faixa_max,
        v.valor_minimo_2, v.data_leilao_2
   from public.veiculos_leilao v
  where v.status_patio = 'confirmado';

grant select on public.veiculos_vitrine to anon, authenticated;
