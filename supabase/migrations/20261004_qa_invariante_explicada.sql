-- 04/10: `estado_fora_do_padrao` tinha piso fixo de 6 casos ACEITOS de propósito (lote sem cidade porque
-- inventar seria pior) — um 7º caso, defeito de verdade, chegaria como "7" e passaria batido.
-- (1) Casos investigados vão para `qa_invariante_explicada` e saem da conta até `explicado_ate`
--     (30 dias; vencido, voltam sozinhos — o mesmo desenho de `fonte_regressao_explicada`).
-- (2) Cascas sem conteúdo (MILAN "Imóvel", SATO "IMÓVEIS | GO" = página de leilão, WEBLEILOES
--     "Apartamento") desativadas com suprimido_motivo='casca_sem_conteudo' — não são imóvel vendável.
create table if not exists public.qa_invariante_explicada (
  chave text not null,
  imovel_id uuid not null references public.imoveis_leilao(id) on delete cascade,
  explicacao text not null,
  explicado_em timestamptz not null default now(),
  explicado_ate date not null default (current_date + 30),
  primary key (chave, imovel_id)
);
alter table public.qa_invariante_explicada enable row level security;
comment on table public.qa_invariante_explicada is 'Casos de invariante investigados e aceitos de proposito (ex.: lote sem cidade porque inventar seria pior). Saem da conta ate explicado_ate; vencido, voltam sozinhos. Sem politica: so service role.';

do $$
declare d text;
  antigo text := $a$where ativo and (estado is null or estado !~ '^[A-Za-z]{2}$')), 0),$a$;
begin
  d := pg_get_functiondef('public.qa_invariantes'::regproc);
  if strpos(d, antigo) = 0 then return; end if; -- já aplicada
  d := replace(d, antigo, $n$where ativo and (estado is null or estado !~ '^[A-Za-z]{2}$')
           and not exists (select 1 from qa_invariante_explicada x where x.chave = 'estado_fora_do_padrao'
                             and x.imovel_id = imoveis_leilao.id and x.explicado_ate >= current_date)), 0),$n$);
  execute d;
end $$;
