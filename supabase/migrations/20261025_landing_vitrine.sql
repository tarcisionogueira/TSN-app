-- 25/10 — VITRINE "EM LEILÃO AGORA" NA LANDING (arena das páginas pré-login, passo 6).
--
-- A landing não mostrava NENHUM lote real (só o exemplo "Bid Score 9,4"); o lote público já existe em
-- /leilao/:id, renderizado a partir da view mascarada. A vitrine é um RETRATO DIÁRIO gravado pela mesma
-- passada que já calcula os números do acervo (monitor-fontes-cron → landing_numeros_atualizar), e sai pelo
-- MESMO RPC que a landing já chama uma vez por visita (landing_numeros devolve app_config inteiro). Zero
-- consulta nova por visita, zero RPC nova (função nova nasceria executável por anon).
--
-- REGRAS DA SELEÇÃO (verdict passo 6):
--  • lida SÓ de imoveis_leilao_mascarado, e o JSON leva SÓ id, tipo, cidade, uf, lance_minimo, avaliacao,
--    desconto_pct, data_leilao e foto. Nada de fonte, leiloeiro, link, edital, matrícula ou processo
--    (conferido em seco antes de gravar, 25/10). `fonte` é lida só para o teto da Caixa e não sai.
--  • foto SEMPRE pelo proxy por id (foto_imovel_publica) — mesmo que o cron rode com permissão de ver o
--    leiloeiro, a URL do CDN não vaza.
--  • data_leilao entre hoje+2 e hoje+10 (a string é validada por regex antes do cast — texto solto não quebra
--    a função), no máx. 1 por cidade, no máx. 2 da Caixa. Lotes com foto espelhada vêm primeiro.
--    ⚠️ "foto espelhada obrigatória" (texto do verdict) virou PREFERÊNCIA: medido em 25/10, só 17 lotes ativos
--    têm foto_espelhada_em e 8 caem na janela → 4 cidades distintas, abaixo do mínimo de 4 com folga zero.
--    Os demais saem com foto pelo img-proxy (que lê o link_foto https do leiloeiro); a landing esconde a foto
--    que falhar ao carregar.
--  • desconto entre 20% e 75% e lance >= R$ 30 mil: acima de 75% é quase sempre dado errado da fonte, e a
--    vitrine é a primeira impressão — um lote absurdo ali custa mais que um a menos.
--  • veículos NÃO entram (o verdict pedia "idealmente 2"): a regra é ler só da view mascarada de imóveis, e o
--    card leva a /leilao/:id, que é página de imóvel.
--  • isolada num begin/exception próprio: se a seleção quebrar, os números do acervo continuam sendo gravados
--    e a vitrine ANTERIOR é mantida com o carimbo antigo (vitrine_em) + o motivo em vitrine_erro. Como a
--    landing esconde vitrine com mais de 48 h e o health-check acusa (landing_cache), o sumiço deixa rastro.
create or replace function public.landing_numeros_atualizar()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v jsonb; vit jsonb; ant jsonb;
begin
  select jsonb_build_object(
    'imoveis', (select count(*) from imoveis_leilao where ativo),
    'veiculos', (select count(*) from veiculos_leilao where ativo),
    'leiloeiros', (select count(distinct lower(trim(l))) from (
        select leiloeiro l from imoveis_leilao where ativo
        union all select leiloeiro from veiculos_leilao where ativo) x where l is not null and trim(l) <> ''),
    'em', now())
    into v;

  -- VITRINE (25/10) — bloco isolado: falha aqui não derruba os números.
  begin
    with base as (
      select m.id, m.tipo, m.cidade, upper(m.estado) as uf, m.valor_minimo, m.valor_avaliacao,
             m.desconto_percentual, left(m.data_leilao, 10)::date as dl, m.link_foto,
             coalesce(m.fonte in ('CEF', 'caixa'), false) as caixa,
             (m.foto_espelhada_em is not null) as esp,
             coalesce(nullif(m.cidade_norm, ''), lower(m.cidade)) as ck
        from public.imoveis_leilao_mascarado m
       where m.ativo
         and coalesce(m.link_foto, '') <> ''
         and m.data_leilao ~ '^\d{4}-\d{2}-\d{2}($|[T ])'
         and left(m.data_leilao, 10)::date between current_date + 2 and current_date + 10
         and m.valor_minimo >= 30000
         and m.valor_avaliacao > m.valor_minimo
         and m.desconto_percentual between 20 and 75
         and m.tipo in ('apartamento', 'casa', 'terreno', 'comercial', 'rural')
         and coalesce(m.cidade, '') <> '' and coalesce(m.estado, '') <> ''
         and m.suprimido_motivo is null
    ), por_cidade as (
      select b.*, row_number() over (partition by ck, uf order by esp desc, desconto_percentual desc, id) as rc from base b
    ), por_caixa as (
      select c.*, row_number() over (partition by caixa order by esp desc, desconto_percentual desc, id) as rx
        from por_cidade c where rc = 1
    ), escolhidos as (
      select * from por_caixa where not caixa or rx <= 2
       order by esp desc, desconto_percentual desc, id limit 6
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', id, 'tipo', tipo, 'cidade', cidade, 'uf', uf,
             'lance_minimo', valor_minimo, 'avaliacao', valor_avaliacao,
             'desconto_pct', desconto_percentual, 'data_leilao', dl,
             'foto', public.foto_imovel_publica(id, link_foto, null))
             order by esp desc, desconto_percentual desc, id), '[]'::jsonb)
      into vit from escolhidos;
    v := v || jsonb_build_object('vitrine', vit, 'vitrine_em', now());
  exception when others then
    select value::jsonb into ant from app_config where key = 'landing_numeros';
    v := v || jsonb_build_object(
      'vitrine', coalesce(ant -> 'vitrine', '[]'::jsonb),
      'vitrine_em', ant -> 'vitrine_em',
      'vitrine_erro', left(sqlerrm, 200));
  end;

  insert into app_config (key, value, updated_at) values ('landing_numeros', v::text, now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  -- 24/10: a lista de cidades da busca pública sai na mesma passada diária (dentro desta função, que já é
  -- só do service_role — uma função nova nasceria executável por anon).
  insert into app_config (key, value, updated_at)
  select 'acervo_cidades', coalesce(jsonb_agg(jsonb_build_object('k', cidade_norm, 'u', uf, 'c', cidade, 'n', n)), '[]'::jsonb)::text, now()
    from (select i.cidade_norm, upper(i.estado) as uf, i.cidade, count(*) as n
            from public.imoveis_leilao i where i.ativo group by 1, 2, 3) x
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return v;
end $function$;

-- `landing_numeros()` não muda: ela já devolve app_config['landing_numeros'] inteiro, então a chave
-- `vitrine` (e `vitrine_em`) sai junto com os números. Grants preservados pelo create or replace
-- (landing_numeros_atualizar segue só do service_role).
