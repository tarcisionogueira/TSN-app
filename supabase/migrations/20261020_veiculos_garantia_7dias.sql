-- 20/10 — GARANTIA DE 7 DIAS (CDC art. 49) NO PLANO VEÍCULOS (dono: "quanta garantia precisa colocar?").
-- A garantia do plano principal ancora em `plano_pago_em`; Veículos é outra trilha (acesso por data, ver
-- 20261020_veiculos_publico_acesso.sql) e precisa da âncora própria: o início do período pago ATUAL,
-- gravado por estenderAcessoVeiculos (api/_webhook-core.js) quando a cobrança abre um período novo (sem
-- acesso vigente). Renovação mensal não mexe nela — a janela de 7 dias é da contratação, não de cada mês.
alter table public.perfis add column if not exists veiculos_pago_em timestamptz;

-- O cliente não mexe na própria âncora (mesma trava de role/plano_pago_em/acesso_veiculos_ate).
do $$
declare d text; novo text;
begin
  select pg_get_functiondef('public.proteger_campos_sensiveis_perfil'::regproc) into d;
  if position('veiculos_pago_em' in d) > 0 then return; end if;
  novo := replace(d, 'new.acesso_veiculos_ate := old.acesso_veiculos_ate;',
                     'new.acesso_veiculos_ate := old.acesso_veiculos_ate;' || chr(10) || '    new.veiculos_pago_em := old.veiculos_pago_em;');
  if novo = d then raise exception 'proteger_campos_sensiveis_perfil: âncora acesso_veiculos_ate não encontrada'; end if;
  execute novo;
end $$;

-- Quem já assina hoje: âncora = 1 mês antes do vencimento (o período corrente começou ali).
update public.perfis set veiculos_pago_em = acesso_veiculos_ate - interval '1 month'
 where acesso_veiculos_ate > now() and veiculos_pago_em is null and role not in ('admin','analista','consultor','advogado');
