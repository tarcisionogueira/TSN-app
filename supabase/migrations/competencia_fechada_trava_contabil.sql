-- ============================================================================
-- TRAVA DE COMPETÊNCIA (08/08)
--
-- POR QUE: a contabilidade fecha o mês e entrega. Se depois disso um lançamento
-- novo cair em março — uma reimportação, um extrato atrasado, uma correção —, a
-- DRE de março passa a divergir do que já foi entregue. Não é erro de cálculo:
-- é o número mudando embaixo de quem já assinou. Uma vez que isso acontece, o
-- contador para de confiar no sistema e volta para a planilha dele.
--
-- COMO: mês fechado vira DADO (`competencia_fechada`) e um trigger recusa
-- qualquer INSERT/UPDATE/DELETE em `conciliacao_lancamento` daquela competência,
-- com mensagem que diz o que fazer. Reabrir é possível, exige motivo e fica
-- REGISTRADO — a trava existe para tornar a mudança consciente, não impossível.
--
-- Testado nos dois sentidos antes de subir: com julho fechado o insert é recusado
-- com a mensagem correta; agosto (aberto) aceita normalmente.
-- ============================================================================

create table if not exists public.competencia_fechada (
  competencia   date primary key,          -- sempre o dia 1º do mês
  fechada_em    timestamptz not null default now(),
  fechada_por   uuid references auth.users(id),
  observacao    text,
  reaberta_em   timestamptz,
  reaberta_por  uuid references auth.users(id),
  reabertura_motivo text
);

comment on table public.competencia_fechada is
  'Meses entregues à contabilidade. Enquanto a linha existir e reaberta_em for NULL, nenhum lançamento entra ou muda naquela competência.';

alter table public.competencia_fechada enable row level security;
drop policy if exists "Equipe lê competências" on public.competencia_fechada;
create policy "Equipe lê competências" on public.competencia_fechada for select using (public.is_equipe());

create or replace function public.competencia_esta_fechada(p_data date)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.competencia_fechada
     where competencia = date_trunc('month', p_data)::date
       and reaberta_em is null
  )
$$;

-- `conciliacao_lancamento.competencia` é TEXTO ('2026-07'), não date — quem manda é a
-- coluna `data`; o texto só entra como reserva quando a data está nula.
create or replace function public.trg_bloqueia_competencia_fechada()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_data date;
  v_reg  record;
begin
  v_reg := case when tg_op = 'DELETE' then old else new end;

  v_data := v_reg.data;
  if v_data is null and coalesce(v_reg.competencia, '') ~ '^\d{4}-\d{2}$' then
    v_data := to_date(v_reg.competencia || '-01', 'YYYY-MM-DD');
  end if;

  if v_data is not null and public.competencia_esta_fechada(v_data) then
    raise exception
      'Competência % está FECHADA e já foi entregue à contabilidade — o lançamento de % não pode ser gravado, alterado nem removido. Se a mudança for necessária, reabra a competência (fica registrado quem reabriu e por quê) ou lance no mês corrente.',
      to_char(date_trunc('month', v_data), 'MM/YYYY'), to_char(v_data, 'DD/MM/YYYY')
      using errcode = 'check_violation';
  end if;

  -- Mover a DATA para dentro de um mês fechado é a mesma violação pela porta dos fundos.
  if tg_op = 'UPDATE' and old.data is distinct from new.data
     and old.data is not null and public.competencia_esta_fechada(old.data) then
    raise exception 'O lançamento pertence à competência %, que está fechada.',
      to_char(date_trunc('month', old.data), 'MM/YYYY') using errcode = 'check_violation';
  end if;

  return v_reg;
end $$;

drop trigger if exists tg_competencia_fechada on public.conciliacao_lancamento;
create trigger tg_competencia_fechada
  before insert or update or delete on public.conciliacao_lancamento
  for each row execute function public.trg_bloqueia_competencia_fechada();

create or replace function public.fechar_competencia(p_competencia date, p_user_id uuid, p_obs text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_m date := date_trunc('month', p_competencia)::date; v_qtd int; v_pend int;
begin
  select count(*), count(*) filter (where conta = '9.9' or conta is null)
    into v_qtd, v_pend
    from public.conciliacao_lancamento
   where date_trunc('month', data)::date = v_m;

  insert into public.competencia_fechada (competencia, fechada_por, observacao)
  values (v_m, p_user_id, p_obs)
  on conflict (competencia) do update
     set reaberta_em = null, reaberta_por = null, reabertura_motivo = null,
         fechada_em = now(), fechada_por = excluded.fechada_por, observacao = excluded.observacao;

  -- Fechar com lançamento ainda em 9.9 é permitido, mas nunca em silêncio: o aviso vai
  -- para a tela porque "A CLASSIFICAR" na DRE entregue é uma escolha, não um acidente.
  return jsonb_build_object('ok', true, 'competencia', to_char(v_m, 'MM/YYYY'),
    'lancamentos', v_qtd, 'sem_classificacao', v_pend,
    'aviso', case when v_pend > 0
      then v_pend || ' lançamento(s) foram fechados ainda em 9.9 A CLASSIFICAR — eles entram na DRE como não classificados.'
      else null end);
end $$;

create or replace function public.reabrir_competencia(p_competencia date, p_user_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_m date := date_trunc('month', p_competencia)::date;
begin
  if coalesce(btrim(p_motivo), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'Informe o motivo da reabertura — ele fica registrado.');
  end if;
  update public.competencia_fechada
     set reaberta_em = now(), reaberta_por = p_user_id, reabertura_motivo = p_motivo
   where competencia = v_m and reaberta_em is null;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Essa competência não está fechada.');
  end if;
  return jsonb_build_object('ok', true, 'competencia', to_char(v_m, 'MM/YYYY'));
end $$;

revoke all on function public.competencia_esta_fechada(date) from public, anon, authenticated;
revoke all on function public.fechar_competencia(date, uuid, text) from public, anon, authenticated;
revoke all on function public.reabrir_competencia(date, uuid, text) from public, anon, authenticated;
