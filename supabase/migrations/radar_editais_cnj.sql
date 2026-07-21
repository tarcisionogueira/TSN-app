-- Radar de Editais (CNJ) — monitorar editais de leilão (TJSP/TRT15) via DJEN/Comunica.
-- Tabelas + RPC admin de leitura. O cron api/radar-editais-cron.js popula via service_role.
-- Ver docs/RADAR_EDITAIS_CNJ.md.

create table if not exists public.editais_leilao (
  id uuid primary key default gen_random_uuid(),
  djen_id text unique,                         -- id/numeroComunicacao do DJEN (dedup primário)
  fonte text not null default 'djen',
  tribunal text, numero_processo text, orgao text, comarca text, uf text,
  classe text, tipo_documento text,
  data_disponibilizacao date,
  data_praca_1 timestamptz, data_praca_2 timestamptz,
  leiloeiro_nome text, leiloeiro_nome_norm text, leiloeiro_jucesp text, leilao_plataforma_url text,
  leiloeiro_integrado boolean default false,   -- casa com um leiloeiro/fonte que já raspamos?
  valor_avaliacao numeric, lance_minimo numeric,
  imovel_cidade text, imovel_uf text, imovel_endereco text, imovel_matricula text,
  texto_integral text,
  hash_dedup text unique,                      -- dedup defensivo
  payload jsonb,
  status text not null default 'novo',         -- novo | processado | erro_parse
  criado_em timestamptz default now(), atualizado_em timestamptz default now()
);
create index if not exists idx_editais_disp on public.editais_leilao(data_disponibilizacao desc);
create index if not exists idx_editais_leiloeiro on public.editais_leilao(leiloeiro_nome_norm);
create index if not exists idx_editais_processo on public.editais_leilao(numero_processo);
create index if not exists idx_editais_status on public.editais_leilao(status);
alter table public.editais_leilao enable row level security; -- só service_role/admin (via RPC)

create table if not exists public.monitor_runs (
  id uuid primary key default gen_random_uuid(),
  fonte text, janela_inicio date, janela_fim date,
  itens_vistos integer default 0, itens_novos integer default 0, duracao_ms integer, erro text,
  ran_at timestamptz default now()
);
alter table public.monitor_runs enable row level security;

-- RPC de leitura para a tela admin (admin-gated, definer — bypassa a RLS fechada).
create or replace function public.admin_radar_editais(p_dias integer default 30, p_so_nao_integrado boolean default false)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_role text;
begin
  select role into v_role from public.perfis where id = auth.uid();
  if v_role is distinct from 'admin' then raise exception 'apenas admin'; end if;

  return jsonb_build_object(
    'gerado_em', now(),
    'kpis', (
      select jsonb_build_object(
        'total', count(*),
        'novos_7d', count(*) filter (where data_disponibilizacao > (now()-interval '7 days')::date),
        'leiloeiros_distintos', count(distinct leiloeiro_nome_norm),
        'nao_integrados', count(*) filter (where not leiloeiro_integrado),
        'ja_no_acervo', count(*) filter (where leiloeiro_integrado),
        'erro_parse', count(*) filter (where status = 'erro_parse')
      )
      from public.editais_leilao
      where data_disponibilizacao > (now() - (p_dias || ' days')::interval)::date
    ),
    'editais', coalesce((
      select jsonb_agg(to_jsonb(e) - 'texto_integral' - 'payload' order by e.data_disponibilizacao desc, e.criado_em desc)
      from (
        select * from public.editais_leilao
        where data_disponibilizacao > (now() - (p_dias || ' days')::interval)::date
          and (not p_so_nao_integrado or not leiloeiro_integrado)
        order by data_disponibilizacao desc, criado_em desc
        limit 300
      ) e
    ), '[]'::jsonb)
  );
end $fn$;
revoke execute on function public.admin_radar_editais(integer, boolean) from public, anon;
grant execute on function public.admin_radar_editais(integer, boolean) to authenticated;
