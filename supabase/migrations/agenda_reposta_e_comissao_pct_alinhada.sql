-- AGENDA REPOSTA + `planos_config.comissao_pct` ALINHADA (28/08)
--
-- 1) A AGENDA IA ACABAR EM 31/08. `api/gerar-slots.js` roda todo dia às 01:00 e gera os
--    próximos 21 dias, mas o INSERT usava `resolution=ignore-duplicates` SEM `on_conflict`.
--    Sem alvo declarado o PostgREST resolve pela PRIMARY KEY — e o `id` é gerado, então nunca
--    há conflito de PK; o lote seguia até bater na UNIQUE real (analista_id, data_hora), que
--    derruba o INSERT INTEIRO com 409. Como o cron gera SEMPRE os próximos 21 dias, todo lote
--    contém dias já existentes: todo lote falhava. Resultado medido — 126 slots no banco,
--    criados em 01/07, 20/07 e 10/08, e só 6 ainda no futuro, todos em 31/08.
--    Pior: o endpoint devolvia HTTP 200 com `ok: false` no corpo. Para o cron da Vercel isso é
--    sucesso, então 18 dias sem gerar agenda não produziram um único alerta.
--    O código foi corrigido (on_conflict + falha alto com 500). Esta migração REPÕE o que
--    ficou faltando, para não esperar a próxima 01:00 com a agenda a dois dias do fim.
insert into public.slots_reuniao (analista_id, data_hora, duracao_min, disponivel)
select g.analista_id,
       ((g.d + g.hora_inicio) + (n || ' minutes')::interval) at time zone 'America/Bahia',
       30, true
  from (
    select da.analista_id, (current_date + i) as d, da.hora_inicio, da.hora_fim
      from generate_series(1, 21) i
      join public.disponibilidade_analista da
        on da.ativo and da.dia_semana = extract(dow from (current_date + i))
  ) g,
  generate_series(0, (extract(epoch from (g.hora_fim - g.hora_inicio))/60)::int - 30, 30) n
on conflict (analista_id, data_hora) do nothing;

-- 2) `planos_config.comissao_pct` dizia 10% para o Investidor Pro, enquanto a regra vigente
--    (`comissao_regras.assinatura` nível 1) é 25%. Nada VIVO lê essa coluna — o único consumidor
--    é `Consultor.jsx`, a página aposentada —, mas é a TERCEIRA coluna-fóssil encontrada em
--    28/08, depois de `perfis.plano` e `config_honorarios.advogado_pct`. Fóssil que mente sobre
--    dinheiro é o pior tipo: quem abrir a tabela para conferir o repasse lê o número errado.
--    Alinhada ao trilho que cada plano usa de verdade (top2 → assinatura; assessorado e clube
--    → venda_direta).
update public.planos_config set comissao_pct = 25 where plano_key = 'top2';
update public.planos_config set comissao_pct = 10 where plano_key in ('assessorado', 'clube');
