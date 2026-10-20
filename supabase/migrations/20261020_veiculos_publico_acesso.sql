-- 20/10 — VEÍCULOS PARA O PÚBLICO, LEILOEIRO SÓ COM PLANO (decisão do dono).
-- Grátis: localizar o carro com o que temos (fotos, preço, FIPE, local, sinais do lote). Plano Veículos
-- (R$ 29,90) ou Combo (R$ 99,90): quem é o leiloeiro, link do lote, relatório por IA (10/mês). Sem amostra
-- grátis de relatório (decisão do dono). Assessoria não vale para veículos.
--
-- POR QUE NO BANCO E NÃO NA TELA: `veiculos_leilao` tinha SELECT `using (... OR true)` — a chave pública
-- do site lia leiloeiro, link_lote, descrição e anexos de qualquer lote. Esconder na tela não protegeria nada.
--   • A leitura direta da tabela fica para a EQUIPE (service_role continua passando por cima de RLS).
--   • O público lê `veiculos_vitrine`: só colunas que não levam ao leiloeiro (fora: fonte, fonte_id,
--     leiloeiro, link_lote, descricao, anexos, raw, placa, chassi, renavam, pátio, edital/comitente).
--     Ressalva conhecida: as URLs das FOTOS apontam para o CDN do leiloeiro — espelhar as fotos é a
--     próxima etapa se isso virar problema.
--   • Quem tem acesso recebe o resto por `veiculo_leiloeiro(ids)`, que confere o acesso no servidor.
-- ACESSO = equipe OU `perfis.acesso_veiculos_ate > now()`. A data é estendida a cada cobrança confirmada do
-- plano Veículos/Combo; cancelou ou não pagou, o acesso vence sozinho (não depende de rebaixar ninguém).

alter table public.perfis add column if not exists acesso_veiculos_ate timestamptz;

create or replace function public.tem_acesso_veiculos(p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis p where p.id = p_user_id
                   and (p.role in ('admin','analista','consultor','advogado') or p.acesso_veiculos_ate > now()))
$$;
revoke all on function public.tem_acesso_veiculos(uuid) from public, anon;
grant execute on function public.tem_acesso_veiculos(uuid) to authenticated;

-- Vitrine pública (definer de propósito: é ela que passa por cima da RLS restrita da tabela).
create or replace view public.veiculos_vitrine with (security_invoker = false) as
  select id, titulo, marca, marca_busca, modelo, ano_fabricacao, ano_modelo, km,
         valor_minimo, valor_avaliacao, valor_fipe, fipe_status, fipe_mes_referencia,
         desconto_percentual, desconto_fipe_percentual, modalidade, origem_venda, forma_pagamento,
         cidade, estado, fotos, data_leilao, sinistro, is_sucata, financiavel, combustivel, cambio, cor,
         opcionais, motor_alerta, motor_status, ipva_situacao, tipo_veiculo,
         resultado_leilao, valor_lance_vencedor, teve_lance, status_patio, ativo, criado_em, atualizado_em,
         fipe_codigo, fipe_atualizado_em
    from public.veiculos_leilao
   where status_patio = 'confirmado';
grant select on public.veiculos_vitrine to anon, authenticated;

-- O que leva ao leiloeiro, só para quem tem acesso (lista vazia para os demais — a tela mostra o cadeado).
create or replace function public.veiculo_leiloeiro(p_ids uuid[])
returns table (id uuid, fonte text, leiloeiro text, link_lote text, descricao text, anexos jsonb, placa text, patio text)
language sql stable security definer set search_path = public as $$
  select v.id, v.fonte, v.leiloeiro, v.link_lote, v.descricao, v.anexos, v.placa, v.patio
    from public.veiculos_leilao v
   where public.tem_acesso_veiculos() and v.id = any(p_ids[1:60])
$$;
revoke all on function public.veiculo_leiloeiro(uuid[]) from public, anon;
grant execute on function public.veiculo_leiloeiro(uuid[]) to authenticated;

-- Leitura direta da tabela: só equipe (antes: `OR true`).
-- `to authenticated`: com `public`, o anônimo tomava "permission denied for function eh_equipe" em vez de 0 linhas.
alter policy veiculos_leilao_select_consolidada on public.veiculos_leilao to authenticated
  using (((select auth.role()) = 'service_role') or public.eh_equipe());

-- Contagem por cidade dos filtros: lê a VITRINE (invoker — definer executável por anônimo é achado do auditor).
create or replace function public.veiculos_cidades(p_ufs text[] default null::text[])
 returns table(cidade text, estado text, n bigint)
 language sql stable security invoker set search_path to 'public' as $function$
  select cidade, estado, count(*) from veiculos_vitrine
   where ativo and cidade is not null and estado is not null
     and (p_ufs is null or cardinality(p_ufs) = 0 or estado = any(p_ufs))
   group by 1, 2 order by 2, 1
$function$;

-- Favoritos: o link do lote de VEÍCULO só sai para quem tem acesso (troca pontual no corpo; se o trecho
-- não existir mais, a migração FALHA em vez de passar calada).
do $$
declare d text; novo text;
begin
  select pg_get_functiondef('public.meus_favoritos'::regproc) into d;
  novo := replace(d, 'coalesce(i.url_lote, v.link_lote) link_lote',
                     'coalesce(i.url_lote, case when public.tem_acesso_veiculos() then v.link_lote end) link_lote');
  if novo = d then raise exception 'meus_favoritos: trecho do link_lote não encontrado'; end if;
  execute novo;
end $$;

-- Cota de relatório de veículo: sem acesso = 0 (sem amostra); com plano = 10/mês; equipe como antes.
create or replace function public.limite_ia_efetivo(p_user_id uuid, p_tipo text)
 returns integer language sql stable security definer set search_path to 'public' as $function$
  select case
    when p.role = 'admin' then null::int
    when p_tipo = 'veiculo' and p.role in ('analista','advogado','consultor') then public.limite_ia(p.role, p_tipo)
    when p_tipo = 'veiculo' then case when p.acesso_veiculos_ate > now() then 10 else 0 end
    when p.plano_legado
         and p.role in ('top2','top2_anual','assessorado','assessorado_anual','clube','clube_anual')
      then case p_tipo when 'indice' then 5 else 15 end
    else public.limite_ia(p.role, p_tipo)
  end
  from public.perfis p where p.id = p_user_id
$function$;

-- Explorador COM plano Veículos conta por MÊS (o ramo de amostra vitalícia é de quem não tem acesso).
do $$
declare d text; novo text;
begin
  select pg_get_functiondef('public.consumir_veiculo_por'::regproc) into d;
  novo := replace(d, $q$IF v_role = 'explorador' THEN$q$,
    $q$IF v_role = 'explorador' AND NOT coalesce((SELECT acesso_veiculos_ate > now() FROM perfis WHERE id = p_user_id), false) THEN$q$);
  if novo = d then raise exception 'consumir_veiculo_por: ramo do explorador não encontrado'; end if;
  execute novo;
end $$;

-- O cliente não estende o próprio acesso (mesma trava de role/plano_pago_em).
do $$
declare d text; novo text;
begin
  select pg_get_functiondef('public.proteger_campos_sensiveis_perfil'::regproc) into d;
  if position('acesso_veiculos_ate' in d) > 0 then return; end if;
  novo := replace(d, 'new.plano_vencimento := old.plano_vencimento;',
                     'new.plano_vencimento := old.plano_vencimento;' || chr(10) || '    new.acesso_veiculos_ate := old.acesso_veiculos_ate;');
  if novo = d then raise exception 'proteger_campos_sensiveis_perfil: âncora não encontrada'; end if;
  execute novo;
end $$;

-- Local do pátio (raw do leiloeiro reduzido às chaves de localização) só para quem tem acesso — o
-- endereço do pátio costuma identificar o leiloeiro. Função à parte de veiculo_leiloeiro porque mudar o
-- retorno de lá exigiria DROP (trava no conector do Supabase).
create or replace function public.veiculo_local_patio(p_ids uuid[])
returns table (id uuid, raw jsonb)
language sql stable security definer set search_path = public as $$
  select v.id, jsonb_strip_nulls(jsonb_build_object(
           'lot_location_address', v.raw->'lot_location_address', 'offerDescription', v.raw->'offerDescription',
           'addr', v.raw->'addr', 'product', jsonb_build_object('location', v.raw->'product'->'location'),
           'localidade', v.raw->'localidade', 'local', v.raw->'local', 'lot_location', v.raw->'lot_location'))
    from public.veiculos_leilao v
   where public.tem_acesso_veiculos() and v.id = any(p_ids[1:60])
$$;
revoke all on function public.veiculo_local_patio(uuid[]) from public, anon;
grant execute on function public.veiculo_local_patio(uuid[]) to authenticated;
