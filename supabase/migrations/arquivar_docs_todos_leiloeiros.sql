-- Ampliação do arquivamento PROATIVO de documentos para TODOS os leiloeiros.
-- Pedido do dono ("temos memória, vamos usá-la"): estender a política do #263, que só
-- cobria fontes INSTÁVEIS (pago/misto ou qualidade<0.95 — 7 fontes), para o acervo
-- INTEIRO, INCLUSIVE os próximos leiloeiros que conectarmos.
--
-- Antes: arquivar_docs=true só p/ custo pago/misto OU qualidade<0.95; as fontes
--        gratuitas ESTÁVEIS (MEGA/PESTANA/GRUPOLANCE/ZUK/BIASI/FRAZAO/WEBLEILOES/VIP/
--        LEILOTECH/LEILOFY/SODRE) ficavam link-only.
-- Agora: arquivar_docs=true p/ TODA fonte real de leilão. O download continua indo pelo
--        CAMINHO 1 do captura-documentos.mjs (fetch DIRETO, GRÁTIS); fonte gratuita/sem
--        anti-bot nunca aciona o Bright Data (CAMINHO 3 só escala quando o navegador é
--        BLOQUEADO). Custo marginal = só Storage no bucket 'documentos'.
--
-- As guardas de "não há o que arquivar" seguem no enfileirar_docs_arquivar() e continuam
-- corretas mesmo com a flag ligada em todos:
--   • CEF        → pipeline próprio (matrícula = URL estática derivável; edital = coletivo
--                  por leilão) → o RPC exclui fonte='CEF' explicitamente;
--   • docs_status='esperado' (SUPERBID/SBID9/SBID21/SOLD/VENDASGOV) → a fonte NÃO publica o
--                  documento no lote, então não há PDF a guardar; o RPC pula 'esperado'. Se
--                  um dia a fonte passar a publicar (muda o docs_status), a flag JÁ ligada
--                  faz o arquivamento entrar sozinho — sem precisar lembrar de religar.

-- 1) FUTUROS leiloeiros: novo default = true. O auto-aprendizado do scraper
--    (scripts/lib/conhecimento.mjs → registrarConhecimento) faz upsert por 'fonte' SEM
--    nunca tocar em arquivar_docs → toda fonte NOVA nasce arquivando por padrão.
alter table public.leiloeiro_conhecimento
  alter column arquivar_docs set default true;

-- 2) TODAS as fontes de leilão ATUAIS: liga a flag. Exclui pseudo-fontes internas
--    (custo IS NULL, ex.: 'SUPORTE') — não são leiloeiros e não têm acervo a arquivar.
update public.leiloeiro_conhecimento
set arquivar_docs = true
where custo is not null
  and arquivar_docs = false;
