-- 20/10 — FOTO DE VEÍCULO SEM O CDN DO LEILOEIRO (dono: "faça o armazenamento").
-- A ressalva de 20261020_veiculos_publico_acesso.sql: a URL da foto (92% ms.sbwebservices.net) entregava
-- quem é o leiloeiro, que só o plano Veículos libera. Em vez de COPIAR 76 mil fotos para o storage
-- (custo de armazenamento + banda + job de espelho), a vitrine entrega `/api/img-proxy?veiculo=<id>&i=<n>`:
-- o servidor lê a URL original no banco (service key) e devolve a imagem com cache de 7 dias na CDN da
-- Vercel. Nada guardado, nenhuma URL do leiloeiro chega ao navegador do público.
-- `i` é a posição ORIGINAL no array (ordinality antes do filtro), então o filtro não desloca índice.
-- O filtro de "sem imagem" (mesmo de AnaliseVeiculo.fotosDoVeiculo) vem para cá porque o navegador
-- não vê mais o nome do arquivo.

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
         v.fipe_codigo, v.fipe_atualizado_em
    from public.veiculos_leilao v
   where v.status_patio = 'confirmado';
grant select on public.veiculos_vitrine to anon, authenticated;

-- Favoritos: a capa do veículo também pelo proxy (idempotente; falha se o trecho sumir).
do $$
declare d text; novo text;
begin
  select pg_get_functiondef('public.meus_favoritos'::regproc) into d;
  if position('img-proxy?veiculo=' in d) > 0 then return; end if;
  novo := replace(d, 'coalesce(i.link_foto, v.fotos->>0) foto',
    $q$coalesce(i.link_foto, case when v.fotos->>0 is not null then '/api/img-proxy?veiculo=' || v.id || '&i=0' end) foto$q$);
  if novo = d then raise exception 'meus_favoritos: trecho da foto não encontrado'; end if;
  execute novo;
end $$;
