-- Corpus de aprendizado dos arremates reais (atribuídos pela equipe, sem cobrança).
-- 1 linha por imóvel-âncora. Guarda o PREVISTO (relatórios da IA) × o REALIZADO
-- (valor arrematado, revenda, aluguel) e a ASSERTIVIDADE calculada, segmentado por
-- modalidade + origem/tribunal + tipo de aquisição — para a IA se ajustar por tipo.
create table if not exists public.arremate_aprendizado (
  id             uuid primary key default gen_random_uuid(),
  imovel_id      text not null unique,
  caso_id        uuid,
  user_id        uuid,
  modalidade     text,
  origem         text,
  tipo_aquisicao text,                 -- 'financiado' | 'a_vista' | null
  previsto       jsonb,                -- { valor_mercado, valor_locacao, veredito }
  realizado      jsonb,                -- { valor_arrematado, valor_revenda, aluguel_mensal }
  assertividade  jsonb,                -- { desconto_real_pct, valor_delta_pct, locacao_delta_pct }
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_arremate_aprend_seg on public.arremate_aprendizado (modalidade, tipo_aquisicao);
alter table public.arremate_aprendizado enable row level security;
comment on table public.arremate_aprendizado is 'Corpus previsto×realizado dos arremates reais. Alimenta o ajuste da IA por modalidade.';

-- Resumo agregado por segmento (só onde há assertividade calculada). Os geradores
-- injetam isto no prompt para calibrar as próximas previsões por modalidade.
create or replace function public.arremate_aprendizado_resumo(p_modalidade text default null)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
    select modalidade, tipo_aquisicao,
      count(*) as n,
      round(avg((assertividade->>'valor_delta_pct')::numeric), 1)   as valor_delta_pct_med,
      round(avg((assertividade->>'locacao_delta_pct')::numeric), 1) as locacao_delta_pct_med,
      round(avg((assertividade->>'desconto_real_pct')::numeric), 1) as desconto_real_pct_med
    from public.arremate_aprendizado
    where assertividade is not null
      and (p_modalidade is null or modalidade = p_modalidade)
    group by modalidade, tipo_aquisicao
    having count(*) >= 1
  ) t;
$$;