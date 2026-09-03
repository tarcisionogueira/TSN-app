-- ═══════════════════════════════════════════════════════════════════════════════
-- suprimido_motivo ERA SÓ PARA O GÊMEO HASTA×CEF — 0 de 2892 lotes ZUK inativos com
-- data futura tinham motivo registrado (medido em 03/09), porque as duas rotinas que
-- realmente desativam a maioria do acervo (o sweep de "sumiu da coleta" e a expiração
-- por data) nunca escreviam nesta coluna. O banco não distinguia "a fonte tirou do
-- ar" de "nós falhamos em coletar" para nenhum lote fora do caso CEF/HASTA.
--
-- ⚠️ POR QUE NÃO BASTA só escrever o motivo nos dois sweeps: o trigger
-- trg_preservar_supressao_gemeo (gemeos_hasta_cef.sql) força ativo=false sempre que
-- OLD.suprimido_motivo e NEW.suprimido_motivo são AMBOS não-nulos — condição pensada
-- só para o caso 'gemeo_hasta' (onde só a função de reconciliação pode limpar o
-- motivo no mesmo update). Com um motivo novo tipo 'sumiu_da_fonte', o PRÓPRIO
-- scraper reativando o lote no dia seguinte cairia nessa trava: NEW.suprimido_motivo
-- chegaria não-nulo (herdado, PostgREST não reenvia coluna ausente do payload) e o
-- trigger prenderia o lote em ativo=false PARA SEMPRE — um bug novo, pior que o que
-- veio consertar. Por isso o trigger passa a checar especificamente 'gemeo_hasta'.
-- ═══════════════════════════════════════════════════════════════════════════════

create or replace function public.preservar_supressao_gemeo()
returns trigger language plpgsql as $$
begin
  -- Só o motivo 'gemeo_hasta' é "pegajoso" (só a reconciliação limpa). Qualquer outro
  -- motivo (ex.: 'sumiu_da_fonte', 'praca_vencida') não trava reativação — o scraper
  -- que confirma o lote de volta na fonte tem que conseguir reativar sem intervenção.
  if old.suprimido_motivo = 'gemeo_hasta' and new.suprimido_motivo = 'gemeo_hasta' and new.ativo then
    new.ativo := false;
  end if;
  return new;
end $$;

-- Expiração por data (desativar_leiloes_encerrados, roda de hora em hora): registra
-- POR QUE venceu. Só atinge linhas com ativo=true (suprimido_motivo já é null nelas —
-- gemeo_hasta já as excluiria via ativo=false antes), então não há motivo antigo para
-- sobrescrever.
create or replace function public.desativar_leiloes_encerrados()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_n integer;
begin
  update public.imoveis_leilao
     set ativo = false, suprimido_motivo = 'praca_vencida'
   where ativo
     and public.leilao_ja_encerrado(data_leilao, data_leilao_2, data_fim, modalidade);
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;
