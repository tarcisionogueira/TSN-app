/**
 * /api/apurar-resultado-leilao-cron — uma vez por dia, ao final do dia (18h Brasília), apura o
 * RESULTADO REAL de cada leilão que encerrou hoje: teve lance (vendido, com valor quando a
 * página publica) ou não (sem lance/deserto). Pedido do dono (20/09): aprender quais praças são
 * mais disputadas e, sobretudo, identificar os lotes SEM lance para propor compra direta ao
 * leiloeiro — "no próprio site do leiloeiro que já faz a busca ele consta os lances... ao final
 * do dia ele acessar e puxar o lance dado e se consta o status de vendido ou sem licitantes".
 *
 * Diferente da coleta em massa (que só lê a LISTAGEM), este cron revisita a PÁGINA DE CADA LOTE
 * individualmente — mesma infraestrutura de fetch+Bright Data de `enriquecer-lote.js` — porque
 * o resultado do leilão só aparece ali, não na busca geral.
 *
 * JANELA: dos ÚLTIMOS 3 DIAS (não só hoje) — cobre o lote de hoje E dá 2 dias de reforço para
 * quem falhou (fonte fora do ar, sem cota do Bright Data naquele dia). Teto de tentativas evita
 * martelar para sempre uma página que nunca resolve.
 *
 * NUNCA INFERE: só grava `resultado_leilao` quando a própria página afirma (ver
 * `_resultado-leilao.js`). Sem sinal confiável, grava `indeterminado` — distinto de NULL (ainda
 * não apurado) e distinto de `sem_lance` (a página disse que não teve lance).
 *
 * IMÓVEIS + VEÍCULOS no MESMO run (21/09, pedido do dono: "tanto para veículos como para
 * imóveis"): o filtro de veículo era só INFERÊNCIA por data ("leilão negativo" em
 * BuscaVeiculos.jsx e o gate de api/propor-veiculo-leiloeiro.js) — mesma limitação que os
 * imóveis tinham antes de 20/09. `apurarResultadoDoTexto`/`fetchLote` são genéricos (texto e
 * URL, sem nada imóvel-específico), então uma segunda passada aqui — orçamento de tempo
 * COMPARTILHADO, sem cron novo — cobre os dois acervos com o mesmo código de apuração.
 */
export const config = { runtime: 'nodejs', maxDuration: 280 };

import { isCronAuthorized } from './_auth.js';
import { fetchLote } from './enriquecer-lote.js';
import { apurarResultadoDoTexto } from './_resultado-leilao.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const MAX_TENTATIVAS = 3;
const LOTE_TAMANHO = 250;
const ORCAMENTO_MS = 250000; // corta antes do maxDuration de 280s, sobra pra responder

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

const ehVendaDireta = (m) => /venda[_\s-]?(direta|online)/i.test(String(m || ''));

// FONTES QUE ESTE MÉTODO (fetch de texto + regex) NUNCA VAI CONSEGUIR APURAR — duas causas
// raiz diferentes, achadas ao vivo, mas o mesmo efeito: melhor NÃO tentar do que gerar ruído.
//   • PESTANA / EDITAL_DJEN (21/09): `url_lote`/`link_edital` NÃO é a página do lote — é a
//     AGENDA do leilão inteiro (PESTANA: até 1.070 lotes compartilhando a mesma URL) ou a
//     HOMEPAGE do leiloeiro (EDITAL_DJEN). A cláusula padrão de "condições de venda"/"despesas
//     do arrematante", presente em QUALQUER edital, casava com o sinal de venda e marcava
//     'vendido' falso (10 lotes PESTANA no primeiro dia — reset em
//     supabase/migrations/reset_resultado_leilao_falso_positivo.sql).
//   • SODRE (21/09, achado do dono com print — "HONDA CG 160 CARGO" mostrando VENDIDO/R$9.000
//     na página, apurado como indeterminado por nós): confirmado ao vivo que a página é um
//     Nuxt SSR cujo HTML estático não contém a palavra "vendido" em lugar NENHUM — nem no texto
//     visível nem em atributo/JSON de topo. O resultado do lote só existe depois de hidratação
//     JS (ou numa chamada de API separada que só o navegador faz) — sem headless browser aqui,
//     não tem como ler. Todas as 44 tentativas SODRE (1 imóvel + 43 veículos) deram
//     'indeterminado', nunca um falso 'vendido' — mas por isso mesmo SODRE nunca teria "sem
//     lance" real: ficaria pra sempre empurrando ruído pro filtro "Sem lance" (que agora
//     também mostra indeterminado — pedido do dono, mesma sessão). Fica de fora até termos
//     como ler a página renderizada (ex.: reaproveitar Puppeteer do scraper principal).
//   • CEF/Caixa (21/09): confirmado ao vivo (fetchLote direto no lote real) que o fetch direto
//     falha — IP do servidor bloqueado, mesma causa já documentada em enriquecer-lote.js — e o
//     fallback Bright Data também falha, por cota semanal esgotada (`via:"sem_cota"`,
//     `html_len:0`). Diferente de PESTANA/EDITAL_DJEN, a URL do lote é 1:1 (não é o problema),
//     mas insistir aqui é gasto puro: nunca traz conteúdo pra apurar.
const FONTES_APURACAO_NAO_CONFIAVEL = new Set(['PESTANA', 'EDITAL_DJEN', 'SODRE', 'CEF']);

// Mesma lista acima, mas pronta pro operador `not.in` do PostgREST — aplicada DENTRO da
// consulta SQL (não só depois em JS). Achado 21/09: aplicar só em JS deixava o `LIMIT 250`
// ser consumido pelas 587 linhas candidatas de PESTANA + 587 de CEF ANTES do filtro rodar,
// varrendo o lote inteiro e sobrando zero vaga pro dia inteiro para fontes menores (SATO,
// CALIL, KRONLEILOES, LEILOTECH, FRAZAO, TORRES3, VIP, SUPERBID, APICE, GRUPOLANCE,
// HASTAPUBLICA, LANCEJA, LEFFA, AGOSTINHO, CERULI, RIGOLONLEILOES, ROCHALEILOES,
// SIMONLEILOES, FRANCOLEILOES — todas com 100% "não apurado", zero tentativas). Excluir na
// própria query devolve essas vagas pra quem tem URL de lote real e pode ser lido.
const FONTES_EXCLUIDAS_SQL = `fonte=not.in.(${[...FONTES_APURACAO_NAO_CONFIAVEL].join(',')})`;

// Apura um LOTE de candidatos (imóvel ou veículo — mesma forma mínima: id, url do lote,
// tentativas já feitas) contra a MESMA tabela de origem. `T0`/`orcamentoRestante` são
// compartilhados entre as duas passadas (imóveis primeiro, veículos com o que sobrar).
async function apurarLote(tabela, candidatos, T0, orcamentoRestante) {
  let vendidos = 0, semLance = 0, indeterminados = 0, semUrl = 0, semConteudo = 0, cortado = false;
  for (const c of candidatos) {
    if (Date.now() - T0 > orcamentoRestante) { cortado = true; break; }
    const tentativas = (Number(c.resultado_apuracao_tentativas) || 0) + 1;
    if (!c.alvo || !/^https?:\/\//.test(c.alvo)) {
      semUrl++;
      await sb(`${tabela}?id=eq.${encodeURIComponent(c.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ resultado_leilao: 'indeterminado', resultado_apurado_em: new Date().toISOString(), resultado_apuracao_tentativas: tentativas }) }).catch(() => {});
      continue;
    }
    let html = '';
    // fetchLote() já resolve/loga suas próprias falhas (direto→BrightData→'fail'); este catch só
    // protege contra um throw inesperado fora desse contrato — html='' cai no ramo de "sem
    // conteúdo" logo abaixo, honesto (não conta tentativa, não afirma resultado).
    try { ({ html } = await fetchLote(c.alvo, { proposito: 'geral' })); } catch { html = ''; } // padrao-ok: fetchLote já loga a falha real; ver comentário acima
    if (!html) {
      // Sem conteúdo (fonte fora do ar, bloqueio, sem cota do dia): NÃO conta como tentativa —
      // a janela de 3 dias já cobre o reforço, e martelar sem ter respondido nada não ensina.
      semConteudo++;
      continue;
    }
    const achado = apurarResultadoDoTexto(html);
    const patch = { resultado_apurado_em: new Date().toISOString(), resultado_apuracao_tentativas: tentativas };
    if (achado) {
      patch.resultado_leilao = achado.resultado;
      if (achado.valor) patch.valor_lance_vencedor = achado.valor;
      if (achado.resultado === 'vendido') vendidos++; else semLance++;
    } else {
      patch.resultado_leilao = 'indeterminado';
      indeterminados++;
    }
    await sb(`${tabela}?id=eq.${encodeURIComponent(c.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) }).catch(() => {});
  }
  return { candidatos: candidatos.length, vendidos, semLance, indeterminados, semUrl, semConteudo, cortado };
}

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'não autorizado' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }

  const hojeBRT = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const desde = new Date(Date.now() - 3 * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const T0 = Date.now();

  // ── Imóveis (data_fim é `date`) ──────────────────────────────────────────────────────────
  const rIm = await sb(`imoveis_leilao?data_fim=gte.${desde}&data_fim=lte.${hojeBRT}&resultado_leilao=is.null&resultado_apuracao_tentativas=lt.${MAX_TENTATIVAS}&${FONTES_EXCLUIDAS_SQL}&select=id,fonte,modalidade,url_lote,link_edital,resultado_apuracao_tentativas&order=data_fim.asc&limit=${LOTE_TAMANHO}`);
  if (!rIm.ok) {
    const detalhe = await rIm.text().catch(() => '');
    console.error('[apurar-resultado-leilao] imoveis', rIm.status, detalhe.slice(0, 300));
    res.status(500).json({ error: 'Falha ao selecionar imóveis', detalhe: detalhe.slice(0, 300) });
    return;
  }
  const candidatosImoveis = (await rIm.json().catch(() => []))
    .filter(im => !ehVendaDireta(im.modalidade))
    .map(im => ({ id: im.id, alvo: im.url_lote || im.link_edital, resultado_apuracao_tentativas: im.resultado_apuracao_tentativas }));
  const resumoImoveis = await apurarLote('imoveis_leilao', candidatosImoveis, T0, ORCAMENTO_MS * 0.6);

  // ── Veículos (data_leilao é `timestamptz`, sem praça2/data_fim — usa a própria coluna) ────
  const desdeISO = new Date(Date.now() - 3 * 86400000).toISOString();
  const agoraISO = new Date().toISOString();
  const rVe = await sb(`veiculos_leilao?ativo=eq.true&data_leilao=gte.${desdeISO}&data_leilao=lte.${agoraISO}&resultado_leilao=is.null&resultado_apuracao_tentativas=lt.${MAX_TENTATIVAS}&${FONTES_EXCLUIDAS_SQL}&select=id,fonte,link_lote,resultado_apuracao_tentativas&order=data_leilao.asc&limit=${LOTE_TAMANHO}`);
  let resumoVeiculos = { candidatos: 0, vendidos: 0, semLance: 0, indeterminados: 0, semUrl: 0, semConteudo: 0, cortado: false, erro: null };
  if (!rVe.ok) {
    const detalhe = await rVe.text().catch(() => '');
    console.error('[apurar-resultado-leilao] veiculos', rVe.status, detalhe.slice(0, 300));
    resumoVeiculos.erro = `HTTP ${rVe.status}`;
  } else {
    const candidatosVeiculos = (await rVe.json().catch(() => []))
      .map(v => ({ id: v.id, alvo: v.link_lote, resultado_apuracao_tentativas: v.resultado_apuracao_tentativas }));
    resumoVeiculos = { ...(await apurarLote('veiculos_leilao', candidatosVeiculos, T0, ORCAMENTO_MS)), erro: null };
  }

  // Log incondicional (mesmo princípio já usado em outras rotinas desta base): sem isto, "não
  // havia candidato hoje" e "a rotina parou de rodar" são indistinguíveis de fora.
  const resumo = { imoveis: resumoImoveis, veiculos: resumoVeiculos };
  console.log('[apurar-resultado-leilao]', JSON.stringify(resumo));
  res.status(200).json({ ok: true, ...resumo });
}
