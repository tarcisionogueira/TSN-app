-- ============================================================
-- Fix: comissões + gerar_codigo_indicacao (segurança e idempotência)
-- Execute no SQL Editor do Supabase
-- ============================================================

-- ─── 1. Constraint UNIQUE em asaas_payment_id ───────────────
-- Garante que o mesmo pagamento Asaas nunca gere duas comissões
-- (proteção dupla além do check no webhook)
alter table public.comissoes
  add constraint if not exists comissoes_asaas_payment_id_unique
  unique (asaas_payment_id);

-- ─── 2. gerar_codigo_indicacao: valida que p_id = caller ────
-- Evita que um usuário gere código de indicação para outro perfil
create or replace function public.gerar_codigo_indicacao(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  novo text;
begin
  -- Apenas o próprio usuário pode gerar seu código
  if p_id != auth.uid() then
    raise exception 'permission denied';
  end if;

  -- Apenas consultores podem ter código de indicação
  if not exists (select 1 from public.perfis where id = p_id and role = 'consultor') then
    raise exception 'role must be consultor';
  end if;

  loop
    novo := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (select 1 from public.perfis where codigo_indicacao = novo);
  end loop;

  update public.perfis set codigo_indicacao = novo where id = p_id and codigo_indicacao is null;
  return novo;
end;
$$;

-- ─── 3. Regenera códigos para consultores existentes sem código ──
-- (re-executa sem mudança de lógica, apenas com a função corrigida acima
--  esta parte usa SECURITY DEFINER então auth.uid() não se aplica aqui)
create or replace function public._admin_gerar_codigos_faltantes()
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id from public.perfis where role = 'consultor' and codigo_indicacao is null loop
    declare novo text;
    begin
      loop
        novo := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
        exit when not exists (select 1 from public.perfis where codigo_indicacao = novo);
      end loop;
      update public.perfis set codigo_indicacao = novo where id = r.id;
    end;
  end loop;
end;
$$;

select public._admin_gerar_codigos_faltantes();
