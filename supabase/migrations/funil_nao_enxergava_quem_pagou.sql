-- ─────────────────────────────────────────────────────────────────────────────────────────
-- O FUNIL DE CAPTAÇÃO NÃO ENXERGAVA QUEM PAGOU — 24/08/2026
--
-- O QUE ACONTECEU. O painel "Captação por origem" mostrava, no mesmo período:
--   44 cadastros · 26 engajados · 0 CONTRATARAM · R$ 0,00 de receita · ROAS 0.00×
-- e, na linha do Google Ads, "CAC/assinante: sem assinante" ao lado de R$ 658,63 gastos.
--
-- O banco, na mesma janela, tinha 4 assinantes `top2` ATIVOS com cobrança recorrente
-- aprovada no Mercado Pago, somando R$ 299,40. Não era "ninguém contratou": era a consulta
-- olhando para o lugar errado e devolvendo zero com cara de resposta.
--
-- A CAUSA. `admin_funil_captacao` contava contratação SÓ por `aceites_plano.valor > 0`.
-- O fluxo de assinatura recorrente do Mercado Pago grava em `mp_pagamentos` /
-- `mp_assinaturas` e NÃO cria aceite com valor — dos 4 assinantes, apenas um (de 01/07,
-- fluxo antigo do Asaas) tinha aceite com valor. Os outros três só tinham `termos_uso`.
-- Ou seja: quem paga por cartão recorrente era invisível para o funil.
--
-- POR QUE ISSO É O PIOR LUGAR PARA ESSE DEFEITO. Este painel é o denominador de toda
-- decisão de verba: CAC por assinante e ROAS por canal saem daqui. Com contratantes = 0,
-- o ROAS é estruturalmente 0.00× em qualquer canal, para sempre — e a leitura natural
-- ("o anúncio não converte") é uma conclusão sobre o negócio tirada de uma consulta
-- incompleta. É a forma da casa (ausência entregue como medição) no lugar mais caro.
--
-- AS TRÊS DECISÕES DESTA MIGRAÇÃO (o dono delegou o critério; ficam explícitas para poderem
-- ser contestadas depois com o número na mão):
--
-- 1. CONTRATANTE = usuário com pagamento `approved`/`authorized` no gateway dentro do
--    período. É dinheiro que entrou, não intenção declarada. `aceites_plano` continua
--    valendo como caminho LEGADO (Asaas), mas só para quem não tem pagamento no período —
--    senão o mesmo assinante contaria duas vezes e a receita sairia inflada (o usuário de
--    01/07 tem 2 cobranças de R$ 49,90 no MP e 4 aceites do mesmo valor: somar os dois
--    daria R$ 299,40 para uma pessoa só).
--
-- 2. PAGAMENTO SEM `user_id` NÃO ENTRA. Há 47 pagamentos "avulso" (pix e saldo MP)
--    somando R$ 5.047,49 sem perfil vinculado. Sem usuário não há canal de aquisição, e
--    portanto não há como atribuí-los a nada — entrariam no total inflando o ROAS de
--    todos os canais igualmente, que é pior que não contar. Além disso não está
--    verificado que sejam venda do produto (podem ser movimentações da conta Mercado
--    Pago capturadas pela conciliação).
--
-- 3. CONTA INTERNA NÃO É CLIENTE. `role = 'admin'` fica fora, mesmo pagamento real. É a
--    mesma regra já aplicada no alarme de reunião parada e na retenção — teste do dono
--    não pode virar conversão no relatório que decide investimento.
--
-- CONFERÊNCIA ANTES DE APLICAR (ensaio em SELECT puro, mesma janela de 30 dias):
--   4 contratantes · R$ 299,40 · nenhum usuário contado duas vezes.
-- ─────────────────────────────────────────────────────────────────────────────────────────

create or replace function public.admin_funil_captacao(p_inicio timestamp with time zone, p_fim timestamp with time zone)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_role text;
begin
  select role into v_role from public.perfis where id = auth.uid();
  if v_role is distinct from 'admin' then raise exception 'apenas admin'; end if;

  return (
    with canal_perfil as (
      select p.id, p.nome, p.created_at, p.indicado_por, p.role,
        case
          when p.mkt_gclid is not null then 'Google Ads'
          when p.mkt_fbclid is not null then 'Meta Ads'
          when p.mkt_utm_source is not null then 'UTM: ' || p.mkt_utm_source
          when p.indicado_por is not null and exists (
            select 1 from public.perfis ind
            where ind.id = p.indicado_por and ind.role is distinct from 'admin'
          ) then 'Indicação (parceiro)'
          else 'Orgânico / Direto'
        end as canal
      from public.perfis p
    ),
    cad as (
      select * from canal_perfil where created_at >= p_inicio and created_at <= p_fim
    ),
    cad_agg as (
      select canal,
        count(*)::int as cadastros,
        count(*) filter (where exists (select 1 from public.imovel_visto v where v.user_id = cad.id))::int as engajados
      from cad group by canal
    ),
    -- (1) DINHEIRO QUE ENTROU no gateway, vinculado a perfil e fora de conta interna.
    pago as (
      select m.user_id,
        min(m.criado_em) as primeira,
        sum(m.valor)::numeric as receita,
        (array_agg(m.plano_key order by m.criado_em desc))[1] as plano
      from public.mp_pagamentos m
      join public.perfis pf on pf.id = m.user_id
      where m.status in ('approved','authorized')
        and m.user_id is not null
        and coalesce(m.valor, 0) > 0
        and pf.role is distinct from 'admin'
        and m.criado_em >= p_inicio and m.criado_em <= p_fim
      group by m.user_id
    ),
    -- (2) CAMINHO LEGADO (aceite com valor, Asaas). Só para quem NÃO tem pagamento no
    -- período — o `not exists` é o que impede o mesmo assinante de contar duas vezes.
    aceito as (
      select a.user_id,
        min(a.aceito_em) as primeira,
        sum(a.valor)::numeric as receita,
        (array_agg(a.plano_key order by a.aceito_em desc))[1] as plano
      from public.aceites_plano a
      join public.perfis pf on pf.id = a.user_id
      where a.user_id is not null
        and a.valor > 0
        and pf.role is distinct from 'admin'
        and a.aceito_em >= p_inicio and a.aceito_em <= p_fim
        and not exists (select 1 from pago where pago.user_id = a.user_id)
      group by a.user_id
    ),
    contr as (
      select * from pago union all select * from aceito
    ),
    con_canal as (
      select c.user_id, c.primeira, c.receita, c.plano,
        coalesce(cp.canal, 'Orgânico / Direto') as canal, cp.nome
      from contr c left join canal_perfil cp on cp.id = c.user_id
    ),
    con_agg as (
      select canal, count(*)::int as contratantes, sum(receita)::numeric as receita
      from con_canal group by canal
    ),
    canais as (
      select coalesce(ca.canal, co.canal) as canal,
        coalesce(ca.cadastros, 0) as cadastros,
        coalesce(ca.engajados, 0) as engajados,
        coalesce(co.contratantes, 0) as contratantes,
        coalesce(co.receita, 0) as receita
      from cad_agg ca full outer join con_agg co on co.canal = ca.canal
    )
    select jsonb_build_object(
      'canais', (select coalesce(jsonb_agg(to_jsonb(c) order by c.cadastros desc, c.receita desc), '[]'::jsonb) from canais c),
      'totais', jsonb_build_object(
        'cadastros', (select coalesce(sum(cadastros), 0) from canais),
        'engajados', (select coalesce(sum(engajados), 0) from canais),
        'contratantes', (select coalesce(sum(contratantes), 0) from canais),
        'receita', (select coalesce(sum(receita), 0) from canais)
      ),
      'recentes', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'nome', coalesce(nullif(trim(nome), ''), 'Sem nome'),
          'plano', plano, 'valor', receita, 'canal', canal, 'data', primeira
        ) order by primeira desc), '[]'::jsonb)
        from (select * from con_canal order by primeira desc limit 10) r
      )
    )
  );
end $function$;
