-- ============================================================================
-- Documenta a causa raiz da cobertura documental 0% de GESTAOLEILOES e
-- FERREIRALEIL em leiloeiro_conhecimento (04/09) — mesmo padrão já usado para
-- SBID9/SBID21. Achado ao investigar `docs/COBERTURA_DOCUMENTAL_LEILOEIROS.md`
-- mostrar 0% para as duas: os dois registros já existiam, mas docs_status e
-- docs_estrategia estavam NULOS (nunca documentados) — diferente de SBID9/21,
-- que já explicam o motivo (login-gated).
--
-- FERREIRALEIL: confirmado com dado real (amostra de 4 lotes ativos) que
-- `scripts/scraper-soleon.mjs` (código COMPARTILHADO, plataforma SOLEON) roda
-- normalmente e o parser de anexos (varre <a href> por .pdf/edital/matrícula/
-- laudo na página de detalhe) FUNCIONA — só não encontra nada porque o site
-- deste leiloeiro especificamente não publica PDF nenhum (`anexos: []`,
-- `link_edital` cai no próprio url_lote). `numero_matricula` É extraído do
-- TEXTO da página normalmente — o número existe, só não tem arquivo. Não é bug
-- do scraper; é limitação do site de origem, sem contramedida grátis conhecida.
--
-- GESTAOLEILOES: `scripts/scraper-gestao.mjs` NUNCA implementou descoberta de
-- anexos/PDF (ao contrário do scraper-soleon.mjs irmão) — só grava
-- numero_matricula (regex de texto) e link_edital genérico (leilao.php, uma
-- página de listagem, não um PDF). url_lote está 100% populado (104 de 104
-- ativos em 04/09), então a lacuna é de CÓDIGO (funcionalidade nunca escrita),
-- não de link faltando. Não implementei a extração agora: exigiria portar a
-- lógica do scraper-soleon.mjs sem poder validar contra o HTML ao vivo do site
-- (egress deste ambiente bloqueia o domínio) — mesmo cuidado de "não conserto
-- no escuro" já registrado para outros achados desta sessão.
-- ============================================================================

update public.leiloeiro_conhecimento
   set docs_status = 'sem_pdf_na_origem',
       docs_estrategia = 'Site não publica PDF de documento na página do lote (confirmado 04/09 via '
         || 'amostra real: anexos=[] em todos os lotes ativos, link_edital cai no próprio url_lote — '
         || 'o parser de anexos do SOLEON (scripts/scraper-soleon.mjs) roda normalmente, só não '
         || 'encontra <a href> com .pdf/edital/matrícula/laudo). numero_matricula É extraído do texto '
         || 'da página (regex sobre o corpo), então o NÚMERO existe mesmo sem o arquivo. Não é bug do '
         || 'scraper — é limitação do site de origem. Sem contramedida grátis conhecida.'
 where fonte = 'FERREIRALEIL';

update public.leiloeiro_conhecimento
   set docs_status = 'nao_implementado',
       docs_estrategia = 'scripts/scraper-gestao.mjs NUNCA implementou descoberta de anexos/PDF (ao '
         || 'contrário do scraper-soleon.mjs irmão) — só grava numero_matricula (regex de texto) e '
         || 'link_edital genérico (leilao.php, página de listagem, não um PDF). url_lote 100% '
         || 'populado (104/104 em 04/09), então a lacuna é código, não falta de link. Contramedida '
         || 'possível: portar a mesma lógica de descoberta de anexos do scraper-soleon.mjs (varre '
         || '<a href> por .pdf/edital/matrícula/laudo na página de detalhe) — não implementada agora '
         || 'por falta de acesso ao HTML ao vivo do site para validar (egress deste ambiente bloqueia '
         || 'o domínio); precisa de sessão com acesso à rede ou teste manual antes de aplicar.'
 where fonte = 'GESTAOLEILOES';
