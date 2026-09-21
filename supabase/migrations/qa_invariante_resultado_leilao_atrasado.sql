-- Nova invariante em qa_invariantes(), pro mesmo achado corrigido em
-- api/apurar-resultado-leilao-cron.js (21/09): "não está puxando imóveis sem lance" —
-- confirmado, ZERO imóveis ativos tinham resultado_leilao preenchido (o cron ficava preso
-- processando backlog já INATIVO, ordenado do mais antigo pro mais novo, e o orçamento de
-- tempo se esgotava antes de chegar nos ativos-e-vencidos de hoje). Corrigido no cron
-- (filtra ativo=true, ordena DESC), mas sem monitoramento permanente o mesmo silêncio pode
-- voltar (ex.: fonte nova sem URL de lote, regressão futura na query) sem ninguém notar —
-- mesmo princípio já usado pra `mp_liberacao_atrasada`.
--
-- Conta imóvel/veículo ATIVO cujo leilão encerrou há mais de 2 dias (folga de 1 dia além da
-- janela de reforço de 3 dias do cron) e ainda não tem resultado_leilao — se o cron estiver
-- funcionando, isso tende a zero; se voltar a acumular, é o mesmo sintoma de hoje.
DO $do$
DECLARE
  src text;
  novo text;
  marcador_velho text := $m$dados_mp->>'date_approved')::timestamptz) > interval '1 day'), 0)
  )$m$;
  marcador_novo text := $m$dados_mp->>'date_approved')::timestamptz) > interval '1 day'), 0),
     ('resultado_leilao_atrasado','Imovel/veiculo ativo com leilao encerrado ha mais de 2 dias e resultado_leilao ainda nao apurado (achado 21/09: cron ficava preso processando backlog ja inativo, 0% dos imoveis ativos apurados)','Captura','critico',
       ((select count(*) from imoveis_leilao where ativo and resultado_leilao is null and data_fim < (now() at time zone 'America/Sao_Paulo')::date - 2)
        + (select count(*) from veiculos_leilao where ativo and resultado_leilao is null and data_leilao < now() - interval '2 days')), 0)
  )$m$;
BEGIN
  src := pg_get_functiondef('public.qa_invariantes'::regproc);
  IF position(marcador_velho in src) = 0 THEN
    RAISE EXCEPTION 'qa_invariantes(): marcador esperado nao encontrado — funcao mudou desde que esta migracao foi escrita, revise antes de reaplicar';
  END IF;
  novo := replace(src, marcador_velho, marcador_novo);
  EXECUTE novo;
END $do$;
