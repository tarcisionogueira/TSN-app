-- 13/10: o trigger que impede o upsert do coletor de RELIGAR uma cópia suprimida só conhecia
-- 'gemeo_hasta'. A migração de 10/10 (gemeos_mesma_fonte) diz que "trg_preservar_supressao_gemeo
-- segura o upsert" — não segurava 'gemeo_mesma_fonte'. Passa a cobrir também os motivos de hoje
-- ('segunda_praca_em_outro_anuncio', 'relistado'). Mesma regra: só age quando o upsert religa
-- SEM mexer no motivo (quem quer reativar de propósito limpa o motivo junto).
CREATE OR REPLACE FUNCTION public.preservar_supressao_gemeo()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if old.suprimido_motivo in ('gemeo_hasta', 'gemeo_mesma_fonte', 'segunda_praca_em_outro_anuncio', 'relistado')
     and new.suprimido_motivo is not distinct from old.suprimido_motivo and new.ativo then
    new.ativo := false;
  end if;
  return new;
end $function$;
