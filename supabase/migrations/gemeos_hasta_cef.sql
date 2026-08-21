-- ═══════════════════════════════════════════════════════════════════════════════
-- GÊMEOS HASTA × CEF — opção (a) do dono (21/08): enquanto o leilão HASTA está
-- VIVO, o gêmeo CEF sai da vitrine; passada a praça (ou sumindo o lote HASTA),
-- o CEF volta sozinho.
--
-- Contexto (medição de 21/08): 539 dos 579 lotes HASTA são o MESMO leilão que o
-- portal CEF anuncia (mesma data em 535), com valor mínimo DIVERGENTE em 100% —
-- o cliente via o mesmo imóvel 2× com preços diferentes. A chave exata é o
-- "IMOVEL <id>" na descrição HASTA = dígitos do fonte_id CEF.
--
-- ⚠️ POR QUE O TRIGGER: o importador diário da CEF (api/scraper-caixa.js) faz
-- upsert com `ativo: true` — sem o trigger, o gêmeo suprimido RESSUSCITAVA toda
-- madrugada. Regra: linha com suprimido_motivo preenchido NÃO reativa; o ÚNICO
-- caminho de volta é limpar suprimido_motivo NO MESMO update (é o que a função
-- de reconciliação faz). Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════════

alter table public.imoveis_leilao add column if not exists suprimido_motivo text;

create or replace function public.preservar_supressao_gemeo()
returns trigger language plpgsql as $$
begin
  -- Upsert/refresh que tenta reativar SEM limpar o motivo → mantém suprimido.
  if old.suprimido_motivo is not null and new.suprimido_motivo is not null and new.ativo then
    new.ativo := false;
  end if;
  return new;
end $$;
drop trigger if exists trg_preservar_supressao_gemeo on public.imoveis_leilao;
create trigger trg_preservar_supressao_gemeo before update on public.imoveis_leilao
  for each row execute function public.preservar_supressao_gemeo();

-- Reconciliação (idempotente; roda 1×/dia no monitor-fontes-cron, DEPOIS do sync CEF):
--   suprime  → gêmeo CEF ativo cujo lote HASTA está ativo com leilão hoje/futuro;
--   reativa  → SÓ o que NÓS suprimimos ('gemeo_hasta') e cujo gêmeo saiu de cena.
create or replace function public.reconciliar_gemeos_hasta_cef()
returns jsonb language sql volatile security definer set search_path = public, pg_temp as $$
  with alvo as materialized (
    select distinct (regexp_match(descricao, 'IMOVEL\s+(\d{10,16})'))[1] as caixa_id
      from public.imoveis_leilao
     where fonte = 'HASTA' and ativo
       -- data_leilao é TEXT na tabela; o HASTA grava ISO (YYYY-MM-DD). Cast só quando
       -- o formato confere; formato estranho = trata como vivo (não reativa à toa).
       and (data_leilao is null
            or data_leilao !~ '^\d{4}-\d{2}-\d{2}'
            or substring(data_leilao, 1, 10)::date >= current_date)
  ),
  sup as (
    update public.imoveis_leilao c
       set ativo = false, suprimido_motivo = 'gemeo_hasta'
     where c.fonte in ('CEF','caixa') and c.ativo and c.suprimido_motivo is null
       and regexp_replace(c.fonte_id, '\D', '', 'g') in (select caixa_id from alvo where caixa_id is not null)
    returning 1
  ),
  rea as (
    update public.imoveis_leilao c
       set ativo = true, suprimido_motivo = null
     where c.fonte in ('CEF','caixa') and c.suprimido_motivo = 'gemeo_hasta'
       and regexp_replace(c.fonte_id, '\D', '', 'g') not in (select caixa_id from alvo where caixa_id is not null)
    returning 1
  )
  select jsonb_build_object(
    'suprimidos', (select count(*) from sup),
    'reativados', (select count(*) from rea),
    'gemeos_vivos', (select count(*) from alvo where caixa_id is not null),
    'em', now());
$$;
-- Função de OPERAÇÃO (service key/cron) — cliente nenhum executa.
revoke all on function public.reconciliar_gemeos_hasta_cef() from public, anon, authenticated;
