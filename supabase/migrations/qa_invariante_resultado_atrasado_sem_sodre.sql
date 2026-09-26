-- resultado_leilao_atrasado (26/09): SODRE sai da conta. O resultado do lote SODRE só existe
-- depois da hidratação JS da página (ver api/apurar-resultado-leilao-cron.js, 21/09) — NENHUM
-- apurador lê essa fonte hoje, por desenho. Contá-la deixava o invariante CRÍTICO vermelho para
-- sempre (9 veículos em 26/09), e alarme que nunca apaga ensina a ignorar o alarme. Quando houver
-- apurador para SODRE, tirar esta exclusão. Os outros 278 da mesma data eram SUPERBID com defeito
-- real no runner residencial (scripts/apurar-superbid-residencial.mjs) — corrigido no mesmo commit.
DO $do$
DECLARE
  src text;
  velho text := $m$from veiculos_leilao where ativo and resultado_leilao is null and data_leilao < now() - interval '2 days')$m$;
  novo  text := $m$from veiculos_leilao where ativo and resultado_leilao is null and data_leilao < now() - interval '2 days' and fonte <> 'SODRE')$m$;
BEGIN
  src := pg_get_functiondef('public.qa_invariantes'::regproc);
  IF position(velho in src) = 0 THEN
    RAISE EXCEPTION 'qa_invariantes(): marcador esperado nao encontrado — funcao mudou, revise antes de reaplicar';
  END IF;
  EXECUTE replace(src, velho, novo);
END $do$;
