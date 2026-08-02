-- SATO: 30 lotes ATIVOS apontando para uma URL que NÃO EXISTE (404) — achado do ritual 02/08.
--
-- Prova (run 30746215037 do captura-documentos.yml, 02/08 11:40): 12 dos 40 lotes do lote de
-- trabalho eram SATO e TODOS voltaram `title="Not Found" bodyLen=13` — a página do lote não
-- existe. Causa no próprio scraper, que documenta a premissa não verificada:
--   scripts/scraper-sato.mjs:31  "palpite /leilao/{id} como url_lote; o 1º run real valida"
--   scripts/scraper-sato.mjs:314 url_lote: '/leilao/{id} (palpite — validar no 1º run)'
-- O padrão foi um CHUTE e nunca foi validado: `https://www.satoleiloes.com.br/leilao/<id>` é 404.
-- Efeito no cliente: "Acessar leiloeiro" leva a página inexistente (mesmo sintoma que
-- limpar-imoveis-stale-cron corrigiu para a CEF) + gasto de slots do drenador de documentos.
--
-- Agravante estrutural: a SATO era PONTO CEGO do monitor — não escreve `fonte_saude`, não está
-- em FONTES_SEM_SAUDE nem em BASELINE_FONTES (api/monitor-fontes-cron.js) e `scraper-sato.yml`
-- não tem cron (só workflow_dispatch). Coleta única em 30/07, sem ninguém para avisar.
-- Este arquivo trata os DADOS; a cobertura do monitor vai no mesmo commit (código).
--
-- REVERSÍVEL: quando a URL real for descoberta e a fonte rodar de novo, `scraper-sato.mjs:198`
-- já grava `ativo: true` no upsert — os lotes voltam sozinhos.

-- 1) Tira do ar os lotes com link quebrado (não apaga: o histórico e os anexos ficam).
update imoveis_leilao
   set ativo = false
 where fonte = 'SATO'
   and ativo
   and status = 'disponivel';

-- 2) Fila de documentos é fila de TRABALHO: lote inativo não tem trabalho pendente.
--    (mesma regra do purge de enfileirar_docs_faltantes, aplicada agora ao que já estava lá)
delete from documentos_fila f
 where f.processado_em is null
   and exists (select 1 from imoveis_leilao i where i.id = f.imovel_id and not i.ativo);

-- 3) Registra o aprendizado na base de conhecimento do leiloeiro. `docs_status='esperado'`
--    faz `enfileirar_docs_faltantes` PARAR de enfileirar SATO enquanto a URL for inválida.
update leiloeiro_conhecimento
   set docs_status = 'esperado',
       observacao = trim(coalesce(observacao || E'\n', '') ||
         'URL DO LOTE INVÁLIDA (2026-08-02): o padrão /leilao/{id} usado como url_lote era um ' ||
         'palpite do scraper (scraper-sato.mjs:31/314) e nunca foi validado — 12/12 lotes ' ||
         'sondados pelo captura-documentos voltaram HTTP "Not Found". Os 30 lotes ativos foram ' ||
         'desativados (link morto para o cliente) e a fonte saiu da fila de documentos. ' ||
         'Próximo passo: recon do padrão real de URL do lote antes de religar (a fonte também ' ||
         'não tem cron nem escreve fonte_saude — ver FONTES_SEM_SAUDE no monitor).')
 where fonte = 'SATO';
