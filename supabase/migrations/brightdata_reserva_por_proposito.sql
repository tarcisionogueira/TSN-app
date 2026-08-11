-- ═══════════════════════════════════════════════════════════════════════════════
-- BRIGHT DATA — a sub-cota por propósito passa a EXISTIR de verdade (11/08)
-- ═══════════════════════════════════════════════════════════════════════════════
-- POR QUE (medido, não suposto):
--   `brightdata_uso` mostra o teto semanal de 450 SATURADO em 4 semanas seguidas
--   (20/07, 27/07, 03/08 e 10/08 — esta última bateu 450 já na segunda, 13:00).
--   Enquanto isso, o scraper RJ (única via possível: o site é 100% Cloudflare)
--   registrou `Nenhum lote na listagem` e saiu com **exit 0 / check verde**.
--
--   O `api/_brightdata.js` tinha sub-cotas por propósito (`rj: 120`), mas contadas
--   num `Map` EM MEMÓRIA DO PROCESSO. Cada run do Actions e cada invocação da Vercel
--   começa do zero → a sub-cota nunca limitou ninguém e, pior, **nunca reservou nada**.
--   Os consumidores sem sub-cota ('geral', 'certidao') comiam o teto global na segunda
--   e o RJ, que precisa de ~13 requests por semana, não achava um único crédito livre.
--
-- O QUE MUDA:
--   1. Contagem por (semana, propósito) PERSISTIDA — a sub-cota vira teto real.
--   2. RESERVA: um propósito com reserva tem N créditos garantidos na semana, que os
--      demais NÃO conseguem consumir. Isso não aumenta o custo — reparte o mesmo teto.
--   3. A RPC devolve `motivo` ('teto_global' | 'subcota' | 'reservado_para_outros'),
--      para o chamador poder distinguir "acabou a cota" de "a fonte não tem lote".
--
-- CUSTO: inalterado em regime. O teto global de 450/semana continua sendo a trava dura.
--   (Exceção transitória: numa semana em que o teto JÁ foi gasto antes da reserva
--   existir, o dono da reserva ainda recebe os créditos dela — no máximo +Σreservas
--   naquela semana, ~60 requests ≈ US$ 0,09. A partir da semana seguinte, nunca mais.)

create table if not exists public.brightdata_uso_proposito (
  semana        date    not null,
  proposito     text    not null,
  requests      int     not null default 0,
  atualizado_em timestamptz not null default now(),
  primary key (semana, proposito)
);
alter table public.brightdata_uso_proposito enable row level security;
-- Sem policy: só service_role/definer leem e escrevem (é contabilidade de custo, não PII).

create table if not exists public.brightdata_reserva (
  proposito     text primary key,
  reserva       int  not null default 0 check (reserva >= 0),
  teto          int  check (teto is null or teto >= 0),  -- teto suave próprio (null = sem)
  descricao     text,
  atualizado_em timestamptz not null default now()
);
alter table public.brightdata_reserva enable row level security;

-- Sementes: os tetos vêm das sub-cotas que já estavam declaradas em api/_brightdata.js
-- (agora com efeito real). RESERVA só para quem NÃO tem plano B: o RJ é a única fonte
-- cujo acesso grátis não existe (Cloudflare total) — as demais tentam residencial antes.
insert into public.brightdata_reserva (proposito, reserva, teto, descricao) values
  ('rj',       60,  120, 'Scraper RJ Leilões — 100% Cloudflare, sem via grátis. Reserva garantida.'),
  ('ljud',      0,  180, 'Paginação profunda do LJUD — maior consumidor, teto suave.'),
  ('docs',      0,  150, 'Captura de documentos de leiloeiros anti-bot.'),
  ('radar',     0,  250, 'Radar de Editais (DJEN/Comunica) — WAF do CNJ.'),
  ('soleon',    0,  150, 'Cluster SOLEON — tenta grátis primeiro.'),
  ('gestao',    0,  150, 'Cluster Gestão de Leilões — tenta grátis primeiro.'),
  ('certidao',  0,  120, 'Laudo/certidões — não tinha sub-cota nenhuma até 11/08.')
on conflict (proposito) do update
  set teto = excluded.teto, descricao = excluded.descricao, atualizado_em = now();

-- A assinatura antiga (só p_teto) sai: com um 2º parâmetro DEFAULT as duas ficariam
-- ambíguas para o PostgREST. O corpo mantém compatibilidade — chamar sem propósito
-- continua funcionando e cai em 'geral' (sem reserva, sem teto próprio), como antes.
drop function if exists public.registrar_uso_brightdata(int);

create or replace function public.registrar_uso_brightdata(
  p_teto int,
  p_proposito text default 'geral'
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_semana          date := date_trunc('week', now())::date;
  v_prop            text := coalesce(nullif(trim(p_proposito), ''), 'geral');
  v_total           int;
  v_usado_p         int;
  v_reserva         int;
  v_teto_p          int;
  v_reservado_alheio int;
  v_limite          int;
begin
  select coalesce(reserva, 0), teto into v_reserva, v_teto_p
    from brightdata_reserva where proposito = v_prop;
  v_reserva := coalesce(v_reserva, 0);

  select coalesce(requests, 0) into v_total from brightdata_uso where semana = v_semana;
  v_total := coalesce(v_total, 0);

  select coalesce(requests, 0) into v_usado_p
    from brightdata_uso_proposito where semana = v_semana and proposito = v_prop;
  v_usado_p := coalesce(v_usado_p, 0);

  -- (a) teto suave do próprio propósito — impede um consumidor de devorar tudo.
  if v_teto_p is not null and v_usado_p >= v_teto_p then
    return jsonb_build_object('permitido', false, 'motivo', 'subcota',
      'proposito', v_prop, 'usado', v_usado_p, 'teto', v_teto_p, 'usado_total', v_total);
  end if;

  -- (b) reservas AINDA NÃO consumidas pelos OUTROS donos ficam fora do bolo comum.
  select coalesce(sum(greatest(0, r.reserva - coalesce(u.requests, 0))), 0)
    into v_reservado_alheio
    from brightdata_reserva r
    left join brightdata_uso_proposito u
           on u.proposito = r.proposito and u.semana = v_semana
   where r.proposito <> v_prop and r.reserva > 0;

  -- (c) dentro da PRÓPRIA reserva o crédito é garantido; fora dela, disputa o que
  --     sobra do teto global depois de descontadas as reservas alheias.
  v_limite := case
    when v_usado_p < v_reserva then p_teto + (v_reserva - v_usado_p)
    else p_teto - v_reservado_alheio
  end;

  if v_total >= v_limite then
    return jsonb_build_object('permitido', false,
      'motivo', case when v_total >= p_teto then 'teto_global' else 'reservado_para_outros' end,
      'proposito', v_prop, 'usado', v_usado_p, 'usado_total', v_total,
      'teto', p_teto, 'reservado_alheio', v_reservado_alheio);
  end if;

  insert into brightdata_uso (semana, requests) values (v_semana, 1)
    on conflict (semana) do update
      set requests = brightdata_uso.requests + 1, atualizado_em = now();

  insert into brightdata_uso_proposito (semana, proposito, requests) values (v_semana, v_prop, 1)
    on conflict (semana, proposito) do update
      set requests = brightdata_uso_proposito.requests + 1, atualizado_em = now();

  return jsonb_build_object('permitido', true, 'motivo', 'ok', 'proposito', v_prop,
    'usado', v_usado_p + 1, 'usado_total', v_total + 1, 'teto', p_teto,
    'reserva', v_reserva, 'subcota', v_teto_p);
end $fn$;

revoke execute on function public.registrar_uso_brightdata(int, text) from public, anon, authenticated;
grant  execute on function public.registrar_uso_brightdata(int, text) to service_role;
