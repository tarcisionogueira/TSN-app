/**
 * PORTA ÚNICA DA BRIGHT DATA PARA OS SCRIPTS DE RECON (29/08).
 *
 * POR QUE EXISTE, medido: 22 arquivos chamavam o endpoint cru da Web Unlocker DIRETO, contra 18 que
 * passavam por `api/_brightdata.js`. O teto semanal — que vive em 550/550 — vigiava menos da
 * metade de quem gasta. É a causa da distância entre o nosso ledger (~2.549 requisições desde
 * 29/06) e os ~780 créditos que o painel mostrava, que o CLAUDE.md registra como pendência sem
 * causa conhecida. Não era mistério: era gasto fora do livro.
 *
 * O estrago não é contábil, é operacional. O freio existe para impedir que uma coleta nova
 * cale outra que já funciona — e um chamador invisível fura a fila de todos sem aparecer em
 * lugar nenhum. Pior: toda decisão de "cortar custo" passa a ser tomada sobre um número que
 * descreve metade da realidade.
 *
 * POR QUE NÃO É `api/_brightdata.js` DIRETO: aquele módulo é o caminho da COLETA, com sub-cota
 * por fonte (soleon, rj, pecini…). Recon é outra natureza de gasto — exploratório, manual,
 * pontual — e merece sub-cota própria (`recon`) para não comer a cota de quem coleta todo dia.
 * A mecânica é a mesma: reserva atômica ANTES, desfecho REAL depois.
 *
 * FALHA FECHADA: sem cota, LANÇA. Um recon que devolve corpo vazio por falta de orçamento e
 * deixa quem chamou concluir "o site não tem nada" é a forma nº 5 do CLAUDE.md — o freio de
 * custo entregue como conteúdo. Aqui ele grita.
 */
import { buscarViaBrightData } from '../../api/_brightdata.js';

const PROPOSITO = process.env.BD_RECON_PROPOSITO || 'recon';

/**
 * Substitui, nos scripts de recon, exatamente isto:
 *     await fetch(<endpoint cru da Web Unlocker>, { …init… })
 * por:
 *     await fetchUnlockerContado({ …init… })
 * O `init` é idêntico (method/headers/body/signal) — a única diferença é passar pelo livro.
 * Devolve o mesmo Response que o `fetch` devolvia; `exigirOk:false` preserva o comportamento
 * antigo de deixar o chamador olhar `r.status` (vários recon usam o status como diagnóstico).
 */
export async function fetchUnlockerContado(init = {}) {
  let payload = {};
  try { payload = JSON.parse(init.body || '{}') || {}; } catch { payload = {}; }
  // `zone`, `format` e `headers` são remontados pelo módulo oficial; o resto do payload
  // (o `body` de um POST, `data_format`, …) segue como `extras` para não se perder. Sem isso,
  // o recon-comprei-pgfn — que manda corpo de formulário — passaria a enviar requisição vazia
  // e voltaria sem dado, com cara de "o site não respondeu".
  const { zone: _z, url, format: _f, method = 'GET', headers = null, ...extras } = payload;
  return buscarViaBrightData(url || '', {
    method,
    headers: headers || null,
    proposito: PROPOSITO,
    timeoutMs: 45000,
    exigirOk: false,
    extras: Object.keys(extras).length ? extras : null,
  });
}
