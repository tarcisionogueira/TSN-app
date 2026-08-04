-- ─────────────────────────────────────────────────────────────────────────────
-- PRESERVAR O EDITAL REAL (PDF) CONTRA O UPSERT DIÁRIO
--
-- ACHADO (04/08, ritual de abertura): em 03/08 o backfill deixou 10.015 dos 10.035
-- lotes CEF de LEILÃO com `link_edital` apontando para o PDF real do edital. Hoje,
-- às 11h16–11h20 UTC, o scraper diário (`scripts/scraper.js`, cron 09:00 UTC) rodou
-- e **9.483 desses lotes voltaram a apontar para a PÁGINA HTML do anúncio** — e
-- `numero_edital` foi zerado junto (sobraram 549, exatamente os que o CSV de hoje
-- não trouxe).
--
-- CAUSA-RAIZ: `scripts/scraper.js` monta `link_edital = <página de detalhe>` para
-- todo lote que não é venda direta (linha ~371) e `numero_edital = m.numero_edital
-- || null`. Como o upsert é por (fonte,fonte_id) com merge-duplicates, o valor do
-- dia — que é uma PÁGINA, nunca o PDF — sobrescreve o edital que a captura dedicada
-- (backfill-edital-cef / captura-matricula-cef) tinha conquistado. O backfill das
-- 13:25 UTC recuperava tudo, então o defeito ficava invisível no log: o que se via
-- era um backfill "saudável" refazendo 9,5 mil buscas por dia. O dano real é duplo —
-- ~4h por dia em que o relatório documental lê a página HTML como se fosse o edital
-- (foi exatamente o defeito da demo de Cuiabá), e 9,5 mil requisições diárias
-- desnecessárias contra a Caixa (risco de bloqueio pelo Radware).
--
-- CORREÇÃO (aqui): um gatilho, no MESMO espírito de `trg_preservar_data_leilao` —
-- documento conquistado não retrocede. Vale para QUALQUER caminho de escrita
-- (scraper diário, endpoint, backfill futuro), não só o que causou o problema hoje.
--
-- REGRA: se o valor ANTIGO é um PDF de edital de verdade e o NOVO não é, mantém o
-- antigo. PDF novo diferente (o edital mudou) passa normalmente. A página do lote
-- continua disponível em `url_lote`, que é de onde ela deve ser lida.
-- ─────────────────────────────────────────────────────────────────────────────

-- Um `link_edital` só é EDITAL quando é PDF e não é a matrícula nem as "regras de
-- venda online" da venda direta — é a mesma régua de medição que o registro da CEF
-- em `leiloeiro_conhecimento` passou a usar em 04/08 (a métrica antiga contava a
-- página HTML como edital e por isso declarava "100%" com 0,03% de cobertura real).
create or replace function public.eh_edital_pdf(p_url text)
returns boolean
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select p_url is not null
     and p_url ~* '\.pdf(\?|#|$)'
     and p_url !~* '/editais/matricula/'
     and p_url !~* 'matr[íi]cula[^/]*\.pdf'
     and p_url !~* 'regras-VOL';
$$;

create or replace function public.preservar_link_edital()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  -- Edital conquistado (PDF real) não volta a ser página/nulo.
  if public.eh_edital_pdf(old.link_edital) and not public.eh_edital_pdf(new.link_edital) then
    new.link_edital := old.link_edital;
    -- O número acompanha o link: sem isto o par ficaria incoerente (PDF antigo com
    -- número zerado pelo CSV do dia, que não traz essa coluna para a maioria dos lotes).
    if new.numero_edital is null then
      new.numero_edital := old.numero_edital;
    end if;
  end if;

  -- Mesmo raciocínio isolado para o número: o CSV manda `null` todo dia e apagava a
  -- rastreabilidade ("Edital 0027/0326 - CPVE/RE") que o backfill tinha lido da página.
  if new.numero_edital is null and old.numero_edital is not null then
    new.numero_edital := old.numero_edital;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_preservar_link_edital on public.imoveis_leilao;
create trigger trg_preservar_link_edital
  before update on public.imoveis_leilao
  for each row
  execute function public.preservar_link_edital();

-- Ambas são SECURITY INVOKER e puras (não leem nada além do argumento), então não
-- entram no radar de `auditoria_seguranca()` (que persegue SECURITY DEFINER exposta
-- a anon). NÃO revogar EXECUTE: `preservar_link_edital` roda como INVOKER e precisa
-- chamar `eh_edital_pdf` em nome de quem estiver fazendo o UPDATE — revogar
-- quebraria a escrita do próprio scraper.
