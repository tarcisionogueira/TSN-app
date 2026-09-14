-- 14/09: investigação pedida pelo dono sobre as 4 falhas reais de "daily email sending quota"
-- de 13/09. Causa raiz: TRÊS processos independentes (enviarEmail() em cada request comum,
-- enviar-alertas-cron.js — maior volume, roda em loop de minutos — e drenar-fila-emails-cron.js)
-- cada um lia orcamentoRestanteHoje() (uma CONTAGEM em emails_log) e decidia sozinho se podia
-- mandar. Sem trava atômica entre eles: enquanto o cron de alertas está no meio de um lote
-- (minutos), os outros dois continuam lendo uma contagem que ainda não reflete os envios em
-- andamento — e cada um, isoladamente, "tinha margem". A soma dos três estourou o teto real do
-- Resend. É a MESMA classe de bug que o Bright Data já teve (`registrar_uso_brightdata`,
-- documentado em api/_brightdata.js: "as sub-cotas eram contadas num Map em memória do
-- processo... não RESERVAVAM nada"), com a mesma correção: reserva ATÔMICA no banco, um único
-- INSERT...ON CONFLICT...WHERE que soma e checa o teto na MESMA operação — impossível dois
-- chamadores concorrentes lerem o mesmo valor e passarem os dois.
create table if not exists public.emails_uso_dia (
  dia date primary key,
  reservado integer not null default 0,
  atualizado_em timestamptz not null default now()
);
alter table public.emails_uso_dia enable row level security;
-- Sem política = nega tudo pra anon/authenticated; só service_role (que ignora RLS) usa esta
-- tabela — mesmo padrão de emails_log/emails_fila/brightdata_uso.

create or replace function public.reservar_orcamento_email(p_teto integer default 80)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_dia date := (now() at time zone 'utc')::date;
  v_reservado integer;
begin
  insert into public.emails_uso_dia (dia, reservado, atualizado_em)
  values (v_dia, 1, now())
  on conflict (dia) do update
    set reservado = public.emails_uso_dia.reservado + 1, atualizado_em = now()
    where public.emails_uso_dia.reservado < p_teto
  returning reservado into v_reservado;

  if v_reservado is null then
    select reservado into v_reservado from public.emails_uso_dia where dia = v_dia;
    return jsonb_build_object('permitido', false, 'motivo', 'orcamento_diario_excedido',
      'reservado', coalesce(v_reservado, p_teto), 'teto', p_teto);
  end if;

  return jsonb_build_object('permitido', true, 'reservado', v_reservado, 'teto', p_teto);
end;
$function$;
