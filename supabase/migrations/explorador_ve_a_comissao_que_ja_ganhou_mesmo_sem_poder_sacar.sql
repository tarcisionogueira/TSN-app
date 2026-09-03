-- ══════════════════════════════════════════════════════════════════════════════════════
-- EXPLORADOR VÊ O SALDO QUE JÁ GANHOU — mesmo não podendo sacar ainda.
-- ══════════════════════════════════════════════════════════════════════════════════════
-- Achado do dono (03/09): Jean (role='explorador') indicou o Airton, que virou 'top2' hoje —
-- gerou comissão de rede nível 1 real (R$ 12,48, `saldo_lancamentos.status='disponivel'`) —
-- e o painel do Jean não mostrava NADA. Causa: `saldo_usuarios` (criada em
-- saque_regra_unica_inclui_cliente_parceiro.sql) nunca incluiu 'explorador' na lista de
-- papéis — a view foi pensada para "equipe operacional + cliente pagante", de uma época em
-- que só quem pagava indicava.
--
-- A regra do dono JÁ MUDOU (08/08, `regra_negocio` "Explorador indica, mas só saca sendo
-- pagante" + `podeReceber()`/`naoGanhaNovas` em api/saque.js): explorador PODE ganhar
-- comissão de indicação, só não pode SACAR até virar pagante. `saque.js` já aplica essa
-- trava por conta própria (`podeReceber(role)`, independente desta view) — então incluir
-- 'explorador' aqui só destrava a VISIBILIDADE do saldo acumulado, não o saque.
--
-- Por que isso importa além de mostrar o número certo: é MARKETING. Ver "você já tem
-- R$ 12,48 disponíveis" é o gatilho que faz o explorador indicar mais gente — e é
-- exatamente o que alimenta `saldo_avisos_pendentes()` (aviso_de_saldo_disponivel...sql,
-- 03/09): sem o explorador nesta view, ele nunca seria nem CANDIDATO ao aviso por e-mail.
create or replace view public.saldo_usuarios as
  select p.id as user_id, p.nome, p.role, p.chave_pix,
    coalesce(sum(sl.valor) filter (where sl.status <> 'cancelado'), 0::numeric) as saldo_disponivel,
    coalesce(- sum(sl.valor) filter (where sl.status = 'sacado'), 0::numeric) as total_sacado,
    coalesce(- sum(sl.valor) filter (where sl.status = 'solicitado'), 0::numeric) as saque_pendente
  from public.perfis p
  left join public.saldo_lancamentos sl on sl.user_id = p.id
  where p.role = any (array[
    'admin','analista','advogado','consultor',
    'top2','top2_anual','assessorado','assessorado_anual','clube','clube_anual',
    'explorador'
  ])
  group by p.id, p.nome, p.role, p.chave_pix;
