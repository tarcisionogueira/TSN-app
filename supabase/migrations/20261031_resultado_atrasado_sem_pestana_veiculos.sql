-- 31/10 (abertura): `resultado_leilao_atrasado` (crítico) foi de 349 (29/10) a 697 — e 694 eram
-- veículos PESTANA (leilões de 22 a 29/10), os outros 3 do JOAOEMILIO. Imóveis: 0.
--
-- Não é atraso: é lote que NENHUM processo apura, contado como se algum devesse.
--   • `apurar-resultado-leilao-cron.js` exclui PESTANA de propósito (FONTES_APURACAO_NAO_CONFIAVEL).
--   • Recon de 25/09 (HANDOFF, runs 36142536809/36142747060): depois do pregão o lote SOME da
--     `/api/v2/lote` — 827 de 830. Sumir não diz se vendeu → regra "nunca infere".
--   • O único sinal explícito (`registrarVendidosPestana`, status "Vendido" na coleta) gravou ZERO
--     imóveis desde 25/09 (conferido em 31/10): o lote sai da lista antes de o status mudar.
--   • Imóvel PESTANA não aparece aqui porque sai na data da praça; veículo sem resultado fica ativo
--     até 10 dias (`desativar_leiloes_encerrados`) — então a coleta de veículos (21/10, ~150/dia)
--     passou a empilhar ~8 dias de lotes inapuráveis no invariante.
-- Mesmo tratamento já dado a SODRE e EDITAL_DJEN nesta linha. A falta de apuração da PESTANA vira
-- pendência própria (não some: está em pendencias_projeto), em vez de manter um crítico que nunca
-- pode zerar — e que, por estar sempre aceso, esconderia um atraso de verdade de outra fonte.
--
-- Troca só o trecho (a função tem ~37 KB); falha se o trecho não estiver lá exatamente uma vez.
do $mig$
declare
  d text := pg_get_functiondef('public.qa_invariantes'::regproc);
  velho constant text := $t$data_leilao < now() - interval '2 days' and fonte not in ('SODRE', 'EDITAL_DJEN'))), 0)$t$;
  novo  constant text := $t$data_leilao < now() - interval '2 days' and fonte not in ('SODRE', 'EDITAL_DJEN', 'PESTANA'))), 0)$t$;
begin
  if (length(d) - length(replace(d, velho, ''))) / length(velho) <> 1 then
    raise exception 'qa_invariantes: trecho de resultado_leilao_atrasado não encontrado exatamente 1 vez';
  end if;
  execute replace(d, velho, novo);
end
$mig$;
