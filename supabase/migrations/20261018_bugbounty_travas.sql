-- ─────────────────────────────────────────────────────────────────────────────────────────
-- BUG BOUNTY 18/10 — travas no banco
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- (1) A mesma NF não documenta dois saques. O índice "uma ativa por pessoa" só olha lancamento_id nulo:
--     consumida, a nota saía dele e o mesmo PDF podia ser reenviado para outro saque.
--     (Tabela vazia em 18/10 — o índice entra sem conflito.)
create unique index if not exists saque_nf_nota_unica
  on public.saque_nf (emitente_cnpj, numero)
  where status in ('revisao_manual', 'aprovada') and emitente_cnpj is not null and numero is not null;

-- (2) "Cobrar posição": a política de UPDATE deixa o dono da linha mudar QUALQUER coluna — `enviadas=-500`
--     faria o cron mandar centenas de "Re:" ao mesmo destinatário. O usuário só pode DESLIGAR; contador,
--     intervalo, próxima data e a lista de envios são do cron (service_role).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'email_cobranca_enviadas_ck') then
    alter table public.email_cobranca add constraint email_cobranca_enviadas_ck check (enviadas >= 0);
  end if;
end $$;

create or replace function public.email_cobranca_so_desligar()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then return new; end if;
  if tg_op = 'INSERT' then
    new.enviadas := 0; new.envios := '{}'; new.ativo := true;
    new.encerrado_motivo := null; new.encerrado_em := null;
    new.max_cobrancas := 3;
    return new;
  end if;
  -- UPDATE pelo usuário: só vale desligar.
  new.email_id := old.email_id; new.user_id := old.user_id; new.intervalo_dias := old.intervalo_dias;
  new.max_cobrancas := old.max_cobrancas; new.enviadas := old.enviadas; new.envios := old.envios;
  new.proxima_em := old.proxima_em; new.criado_em := old.criado_em;
  if new.ativo is distinct from false or old.ativo is distinct from true then
    new.ativo := old.ativo; new.encerrado_motivo := old.encerrado_motivo; new.encerrado_em := old.encerrado_em;
  else
    new.encerrado_motivo := 'parado';
  end if;
  return new;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_email_cobranca_so_desligar') then
    create trigger trg_email_cobranca_so_desligar before insert or update on public.email_cobranca
      for each row execute function public.email_cobranca_so_desligar();
  end if;
end $$;
