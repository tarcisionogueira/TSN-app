-- P3 de 21/08 — PRESERVAR area_m2 e valor_avaliacao enriquecidos (classe da regressão de
-- datas da CEF, migração preservar_data_leilao_enriquecida.sql).
--
-- O card da listagem de BIASI/GRUPOLANCE/SODRE/VIP não traz área nem avaliação; o
-- enriquecimento (enriquecerDocumentosLote, detalhe renderizado) preenche depois. Mas o
-- upsert diário reconstrói a linha a partir do CARD e mandava 0 — sobrescrevendo o valor
-- conquistado. Foi assim que o BIASI ficou com 0% de área (324 ativos) e empurrou o
-- invariante lote_sem_area_nem_matricula de 404→558.
--
-- Trigger BEFORE UPDATE: zero/nulo NOVO não apaga valor existente; valor novo NÃO-zero
-- continua sobrescrevendo normalmente. Protege independentemente de qual scraper escreve.
-- Idempotente. ⚠️ Escrita em 21/08 na branch de trabalho e AINDA NÃO APLICADA (produção
-- fica para o fim, decisão do dono) — aplicar no SQL Editor junto com o checklist.
-- Nome com prefixo trg_ (ordem alfabética dos gatilhos: roda antes do zzzz_set_* que LÊ).
create or replace function public.preservar_area_e_avaliacao()
returns trigger
language plpgsql
as $function$
begin
  if coalesce(new.area_m2, 0) = 0 and coalesce(old.area_m2, 0) > 0 then
    new.area_m2 := old.area_m2;
  end if;
  if coalesce(new.valor_avaliacao, 0) = 0 and coalesce(old.valor_avaliacao, 0) > 0 then
    new.valor_avaliacao := old.valor_avaliacao;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_preservar_area_e_avaliacao on public.imoveis_leilao;
create trigger trg_preservar_area_e_avaliacao
  before update on public.imoveis_leilao
  for each row
  execute function public.preservar_area_e_avaliacao();
