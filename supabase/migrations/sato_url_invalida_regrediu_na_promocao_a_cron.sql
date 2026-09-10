-- SATO: A URL INVÁLIDA VOLTOU — o fix de 02/08 foi desfeito na promoção a cron de 08/09,
-- sem que o próprio problema que motivou o fix fosse checado de novo (achado 10/09, revisão
-- geral dos scrapers pedida pelo dono).
--
-- HISTÓRICO, na ordem em que aconteceu:
--   02/08 — `sato_lotes_com_url_inexistente.sql`: 12/12 lotes SATO sondados pelo
--           captura-documentos voltaram HTTP "Not Found" em `/leilao/{id}` (scraper-sato.mjs,
--           um PALPITE nunca validado — o próprio código dizia isso no comentário). Fix:
--           desativou os 30 lotes ativos, purgou a fila de documentos, e marcou
--           `leiloeiro_conhecimento.docs_status='esperado'` para a fila de documentos PARAR
--           de gastar slot em algo que sempre falha. Texto da observação era explícito:
--           "Próximo passo: recon do padrão real de URL do lote antes de religar."
--   08/09 — `scraper-sato.yml` promovido a cron diário. A observação do próprio
--           `leiloeiro_conhecimento` registra o que foi validado: "114 leilões, 24 prontos,
--           zero erro" — ou seja, confirmou que a LISTAGEM da API funciona. NINGUÉM validou
--           de novo o padrão de URL por lote, que era o único problema real. `docs_status`
--           voltou para 'integrado' e o cron começou a gravar `ativo=true` todo dia.
--   10/09 (hoje) — confirmado: 27 lotes SATO ativos, TODOS com `url_lote`/`link_edital` =
--           `https://www.satoleiloes.com.br/leilao/<id>` (o MESMO padrão nunca corrigido, só
--           re-verificado que ainda existe no código), gravados às 13:44 UTC de hoje. 25
--           entradas pendentes em `documentos_fila` para esses mesmos lotes — a fila de
--           documentos estava, de novo, na rota de gastar tempo tentando ler uma página que
--           não existe.
--
-- É A MESMA FORMA Nº7 do CLAUDE.md num disfarce novo: não é "migração escrita não aplicada",
-- é "correção aplicada e depois silenciosamente revertida por uma mudança que validou a
-- coisa ERRADA" — o dry-run de 08/09 provou que o scraper FUNCIONA, não que o LINK FUNCIONA,
-- e ninguém perguntou a segunda pergunta.
--
-- Efeito no cliente, de novo: "Acessar leiloeiro" numa ficha SATO ativa leva a uma página que
-- não existe. Mesmo remédio de 02/08, reaplicado — e desta vez o CÓDIGO/CRON também é
-- ajustado no mesmo commit (ver scraper-sato.yml), para o dia seguinte não desfazer isto de
-- novo sozinho.
--
-- REVERSÍVEL: quando o padrão real de URL for descoberto (recon ao vivo, fora deste sandbox)
-- e o cron for religado, os lotes voltam sozinhos (scraper-sato.mjs grava `ativo: true`).

update imoveis_leilao
   set ativo = false
 where fonte = 'SATO'
   and ativo
   and status = 'disponivel';

delete from documentos_fila f
 where f.processado_em is null
   and exists (select 1 from imoveis_leilao i where i.id = f.imovel_id and i.fonte = 'SATO');

update leiloeiro_conhecimento
   set docs_status = 'esperado',
       observacao = trim(coalesce(observacao || E'\n', '') ||
         'REGRESSÃO (2026-09-10): a promoção a cron diário de 08/09 validou só a listagem da ' ||
         'API (114 leilões, zero erro) e não o padrão de URL do lote, que seguia sendo o mesmo ' ||
         '/leilao/{id} nunca corrigido desde 02/08. docs_status tinha voltado para ''integrado'' ' ||
         'e o cron reativou 27 lotes com link morto + reencheu 25 entradas na fila de ' ||
         'documentos. Desativado de novo e o `schedule` de scraper-sato.yml foi suspenso ' ||
         '(mesmo padrão do EMILIOMATOS) até o padrão real de URL ser confirmado por recon ao ' ||
         'vivo — só então religar cron e voltar docs_status para ''integrado''.')
 where fonte = 'SATO';
