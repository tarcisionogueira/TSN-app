-- ══════════════════════════════════════════════════════════════════════════════════════
-- TODO USUÁRIO COM VALORES A RESGATAR É NOTIFICADO — pedido do dono (03/09).
-- ══════════════════════════════════════════════════════════════════════════════════════
-- "valores a resgatar" = `saldo_usuarios.saldo_disponivel` (a mesma view que `/api/saque`
-- já usa para mostrar o saldo do próprio usuário — soma de `saldo_lancamentos` não
-- cancelados, já líquida de saque solicitado/pago). Sem teto mínimo: o pedido foi "todo
-- usuário que tiver", ao pé da letra.
--
-- ── A ARMADILHA DO "PICO", achada no ensaio antes de aplicar ───────────────────────────
-- A primeira versão comparava `saldo_disponivel` contra um snapshot gravado só quando o
-- e-mail SAÍA. Fica errado assim que existe um SAQUE PARCIAL: o snapshot fica no PICO
-- antigo e nunca desce, então uma comissão nova que chegue *abaixo* desse pico nunca mais
-- dispara aviso — dinheiro genuinamente novo, e não escondido em silêncio. Ensaiado com o
-- caso exato (saldo 99,84 → aviso → saque de 50 → +10 de comissão nova = 59,84, abaixo dos
-- 99,84 do pico): a primeira versão devolvia vazio; a corrigida devolve a linha.
--
-- A CORREÇÃO: duas funções, não uma. `saldo_avisos_pendentes()` só LÊ (stable, sem efeito
-- colateral — dá para rodar em `seco` sem risco, mesmo padrão de `dispararConvite(seco:true)`
-- no Radar de Editais). `saldo_avisos_sincronizar()` roda no FIM de toda rodada do cron,
-- para TODO MUNDO (não só quem foi avisado) — o snapshot sempre acompanha o saldo atual,
-- suba ou desça. É isso que evita a catraca: um saque baixa o snapshot em silêncio, e uma
-- comissão nova sempre fica acima do que foi sincronizado por último.

alter table public.perfis add column if not exists saldo_avisado_valor numeric;
alter table public.perfis add column if not exists saldo_avisado_em timestamptz;
comment on column public.perfis.saldo_avisado_valor is
  'Saldo disponível na última vez que o aviso de saque foi avaliado para este usuário (avisado OU sincronizado sem aviso). Nunca é um "pico": acompanha o saldo atual pra cima e pra baixo, via saldo_avisos_sincronizar().';

create or replace function public.saldo_avisos_pendentes()
returns table(user_id uuid, nome text, saldo_disponivel numeric, saldo_anterior numeric)
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare v_ativo boolean;
begin
  select coalesce((valor->>'ativo')::boolean, true) into v_ativo
    from regra_negocio where chave = 'saldo.aviso_disponivel';
  if not coalesce(v_ativo, true) then return; end if;

  return query
    select su.user_id, su.nome, su.saldo_disponivel, coalesce(p.saldo_avisado_valor, 0)
      from saldo_usuarios su
      join perfis p on p.id = su.user_id
     where su.saldo_disponivel > 0
       and (p.saldo_avisado_valor is null or su.saldo_disponivel > p.saldo_avisado_valor);
end $fn$;

revoke all on function public.saldo_avisos_pendentes() from public, anon, authenticated;
grant execute on function public.saldo_avisos_pendentes() to service_role;

create or replace function public.saldo_avisos_sincronizar()
returns integer
language sql
security definer
set search_path to 'public'
as $fn$
  with s as (
    update perfis p set saldo_avisado_valor = su.saldo_disponivel, saldo_avisado_em = now()
      from saldo_usuarios su
     where su.user_id = p.id
       and su.saldo_disponivel is distinct from coalesce(p.saldo_avisado_valor, 0)
    returning p.id
  )
  select count(*)::int from s;
$fn$;

revoke all on function public.saldo_avisos_sincronizar() from public, anon, authenticated;
grant execute on function public.saldo_avisos_sincronizar() to service_role;

-- Regra como DADO (CLAUDE.md): existe um interruptor (`ativo`) sem precisar de deploy pra
-- desligar o aviso, e a auditoria confere que `saldo_avisos_pendentes` realmente lê a chave
-- (não só documenta a intenção).
insert into public.regra_negocio (chave, valor, descricao, aplicada_por) values
  ('saldo.aviso_disponivel',
   '{"ativo": true}'::jsonb,
   'Notifica por e-mail todo usuário com saldo disponível para saque (saldo_usuarios.saldo_disponivel > 0), sempre que esse saldo SOBE em relação à última rodada avaliada — sem teto mínimo de valor. O cron roda 1x/dia; saldo_avisado_valor acompanha o saldo pra cima e pra baixo a cada rodada (nunca fica preso num pico antigo), então um saque parcial seguido de comissão nova volta a disparar aviso mesmo sem atingir o valor anterior.',
   array['saldo_avisos_pendentes'])
on conflict (chave) do update set valor = excluded.valor, descricao = excluded.descricao,
  aplicada_por = excluded.aplicada_por, atualizado_em = now();
