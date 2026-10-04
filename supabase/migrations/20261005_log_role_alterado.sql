-- 05/10 — pendência 101: troca de role não deixava rastro em atividade_log.
--
-- O Admin troca o plano/papel com UPDATE direto em perfis (Admin.jsx, seletor de role), e
-- nada registrava quem mudou, de quê para quê, nem quando. Um trigger no banco pega TODOS
-- os caminhos (tela, SQL Editor, endpoints) — instrumentar só o front deixaria os outros cegos.
--
-- evento:
--   • 'role_alterado_manual'  → havia sessão (auth.uid() não nulo): alguém da equipe mexeu.
--   • 'role_alterado_sistema' → sem sessão (service role: webhook de pagamento, cron, SQL
--     Editor). Gravado também, com outro nome, para que o filtro do "manual" não misture
--     upgrade pago com intervenção humana.
-- Colunas conferidas no information_schema em 05/10: atividade_log(user_id, ator_id, evento,
-- detalhe, meta, criado_em default now(), apagar_em default now()+90d; id identity).
--
-- Falha ao gravar o log NÃO pode impedir a troca de role (o log é rastro, não trava):
-- o insert fica num bloco com exceção que só avisa.

create or replace function public.trg_log_role_alterado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ator uuid := auth.uid();
begin
  begin
    insert into public.atividade_log (user_id, ator_id, evento, detalhe, meta)
    values (
      new.id,
      v_ator,
      case when v_ator is null then 'role_alterado_sistema' else 'role_alterado_manual' end,
      coalesce(old.role, '(nulo)') || ' -> ' || coalesce(new.role, '(nulo)'),
      jsonb_build_object('role_antigo', old.role, 'role_novo', new.role, 'ator_id', v_ator)
    );
  exception when others then
    raise warning 'trg_log_role_alterado: não gravou atividade_log para %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

comment on function public.trg_log_role_alterado() is
  'Rastro de troca de role em perfis (05/10, pendência 101). Só é chamada pelo trigger perfis_log_role_alterado.';

do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.perfis'::regclass
       and tgname = 'perfis_log_role_alterado'
  ) then
    create trigger perfis_log_role_alterado
      after update of role on public.perfis
      for each row
      when (old.role is distinct from new.role)
      execute function public.trg_log_role_alterado();
  end if;
end $$;
