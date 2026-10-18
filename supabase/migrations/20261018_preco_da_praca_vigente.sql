-- ─────────────────────────────────────────────────────────────────────────────────────────
-- "O PREÇO" DO LOTE = A PRAÇA VIGENTE (decisão do dono, 18/10 — pendência 33)
--
-- `valor_minimo_ref` era coluna GERADA = LEAST(1ª, 2ª praça): 2.955 lotes com a 1ª praça ainda por vir
-- apareciam na busca (filtro de faixa, ordenação, card) pelo valor da 2ª — um preço que ninguém consegue
-- pagar se o lote sair na 1ª. Regra nova: enquanto a 1ª praça não passou, vale o valor da 1ª; passou (ou não há
-- 1ª), vale a 2ª. Sem data → 1ª (conservador).
--
-- Coluna gerada não pode depender de "hoje", então vira coluna comum mantida por (a) trigger em toda escrita
-- e (b) varredura diária no limpar-imoveis-stale-cron para os lotes cuja 1ª praça passou ontem sem ninguém
-- reescrevê-los. Mesmo nome de coluna → busca, raio (buscar_por_raio_v2), alertas e invariantes seguem iguais.
--
-- ⚠️ PASSO DO DONO (o conector trava em DROP): rodar no SQL Editor, ANTES do resto:
--   alter table public.imoveis_leilao alter column valor_minimo_ref drop expression;
-- (instantâneo: não reescreve a tabela, só deixa de recalcular; os valores atuais ficam.)
-- ─────────────────────────────────────────────────────────────────────────────────────────

create or replace function public.valor_praca_vigente(vm numeric, vm2 numeric, d1 text)
returns numeric language sql stable set search_path to 'public' as $$
  -- Comparação de TEXTO ISO (AAAA-MM-DD): sem cast, uma data inválida no acervo não derruba a busca.
  select case
    when coalesce(vm2, 0) > 0 and (coalesce(vm, 0) <= 0
          or (d1 ~ '^\d{4}-\d{2}-\d{2}' and left(d1, 10) < to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD')))
      then vm2
    else vm
  end
$$;

create or replace function public.trg_valor_praca_vigente()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  new.valor_minimo_ref := public.valor_praca_vigente(new.valor_minimo, new.valor_minimo_2, new.data_leilao);
  return new;
end $$;

-- Lotes ativos cujo preço vigente mudou sem ninguém escrevê-los (a 1ª praça passou). O UPDATE dispara o trigger.
create or replace function public.atualizar_valor_vigente_lote(lote integer default 200)
returns integer language plpgsql security invoker set search_path to 'public' as $$
declare n integer;
begin
  -- Até o dono rodar o "drop expression", a coluna ainda é gerada: não há o que fazer (e o UPDATE falharia).
  if (select attgenerated from pg_attribute where attrelid = 'public.imoveis_leilao'::regclass and attname = 'valor_minimo_ref') <> '' then
    return 0;
  end if;
  with alvo as (
    select id from public.imoveis_leilao
     where ativo and valor_minimo_ref is distinct from public.valor_praca_vigente(valor_minimo, valor_minimo_2, data_leilao)
     limit greatest(1, least(lote, 1000))
  )
  update public.imoveis_leilao i set valor_minimo_ref = public.valor_praca_vigente(i.valor_minimo, i.valor_minimo_2, i.data_leilao)
    from alvo where i.id = alvo.id;
  get diagnostics n = row_count;
  return n;
end $$;

-- SECURITY INVOKER de propósito: chamada por anon/authenticated esbarra na RLS e não altera nada; o cron usa a
-- service key. (DEFINER exposto a anon acusava no auditor de segurança, e o REVOKE trava o conector MCP.)

-- O trigger SÓ depois do drop expression (em coluna gerada a atribuição falharia). Nome com 'trg_zzzz_' para
-- rodar depois dos triggers que mexem em valor/data (ordem alfabética).
do $$
begin
  if (select attgenerated from pg_attribute where attrelid = 'public.imoveis_leilao'::regclass and attname = 'valor_minimo_ref') = '' then
    if not exists (select 1 from pg_trigger where tgname = 'trg_zzzz_valor_praca_vigente') then
      create trigger trg_zzzz_valor_praca_vigente before insert or update on public.imoveis_leilao
        for each row execute function public.trg_valor_praca_vigente();
    end if;
  else
    raise notice 'valor_minimo_ref ainda é gerada — rode o drop expression e aplique esta migração de novo';
  end if;
end $$;
