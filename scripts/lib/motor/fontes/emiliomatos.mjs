/**
 * FONTE (config) — Emílio Matos (Superbid/MBV SSR). Fonte única (1 tenant). Reusa o parser puro
 * lib/emiliomatos-parse.mjs. montarRow(url, det) ignora o 3º arg (tenant) que o runner passa.
 */
import {
  FONTE, LEILOEIRO, BASE, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../emiliomatos-parse.mjs';

export default {
  chave: 'emiliomatos',
  catalogo: '/busca/segmento/imoveis',
  paginaParam: 'page',                // ⚠️ Superbid usa ?page= (não ?pagina=)
  maxPages: 15,
  tenants: [
    { fonte: FONTE, leiloeiro: LEILOEIRO, base: BASE },   // sem `chaveTenant`: id antigo intacto
    // ─── JUCEMG (triagem 29/08) ────────────────────────────────────────────────────────────
    // Onze sites rodando ESTA plataforma (Superbid/MBV white-label), todos com acesso GRÁTIS
    // funcionando — a triagem os identificou pela assinatura `/busca/segmento/` no HTML, que é
    // exatamente o `catalogo` daqui. Compartilham a fonte `MBV` em vez de ganharem onze códigos
    // novos: onze fontes significariam onze linhas no monitor, onze baselines e onze critérios
    // de qualidade para a MESMA plataforma. É o modelo que o SUPORTE já usa, e é por isso que
    // `chaveTenant` entra no `fonte_id` — sem ela o lote 100 de um sobrescreveria o do outro.
    { fonte: 'MBV', chaveTenant: 'bm',          leiloeiro: 'Breno Magalhães Leilões',  base: 'https://www.bmleiloes.com.br' },
    { fonte: 'MBV', chaveTenant: 'chui',        leiloeiro: 'Chui Leilões',             base: 'https://www.chuileiloes.com.br' },
    { fonte: 'MBV', chaveTenant: 'clebercardoso', leiloeiro: 'Cleber Cardoso Leilões', base: 'https://www.clebercardosoleiloes.com.br' },
    { fonte: 'MBV', chaveTenant: 'davisonmoreira', leiloeiro: 'Davison Moreira Leilões', base: 'https://www.davisonmoreira.com.br' },
    { fonte: 'MBV', chaveTenant: 'eco',         leiloeiro: 'Eco Leilões',              base: 'https://www.ecoleiloes.com.br' },
    { fonte: 'MBV', chaveTenant: 'hoppe',       leiloeiro: 'Hoppe Leilões',            base: 'https://www.hoppeleiloes.com.br' },
    { fonte: 'MBV', chaveTenant: 'kananda',     leiloeiro: 'Kananda Leilões',          base: 'https://www.kanandaleiloes.com.br' },
    { fonte: 'MBV', chaveTenant: 'leilominas',  leiloeiro: 'Leilo Minas',              base: 'https://www.leilominas.com.br' },
    { fonte: 'MBV', chaveTenant: 'lincoln',     leiloeiro: 'Lincoln Leilões',          base: 'https://www.lincolnleiloes.com.br' },
    { fonte: 'MBV', chaveTenant: 'milani',      leiloeiro: 'Milani Leilões',           base: 'https://www.milanileiloes.com.br' },
    { fonte: 'MBV', chaveTenant: 'saladeleiloes', leiloeiro: 'Sala de Leilões',        base: 'https://www.saladeleiloes.com.br' },
  ],
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Superbid/MBV (white-label SSR)', acesso: 'gratis+brightdata', custo: 'misto',
    anti_bot: 'cloudflare', enumeracao: '/busca/segmento/imoveis?page=N',
    url_lote: '/imoveis/<tipo>/<slug>-<ID>', scraper: 'scraper-emiliomatos.mjs',
  },
};
