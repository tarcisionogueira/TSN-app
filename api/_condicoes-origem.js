/**
 * CONDIÇÕES DE PAGAMENTO COM ORIGEM POR CAMPO E CENÁRIO DECIDIDO NO SERVIDOR (15/11, arena — classe Brooklin).
 * Módulo puro (Edge e Node), testado em scripts/testes/condicoes-origem.mjs.
 *
 * O Brooklin precisou de três elos: (1) a leitura ("não é permitido o FGTS" → fgts:true), (2) a escrita (o relatório
 * reescreveu o lote para 'financiado') e (3) a apresentação (a tela abriu o cenário financiado com 5%/360 do formulário
 * vazio). Este módulo fecha o (3) e dá a régua do (1): cada condição sai com {valor, origem, trecho}, e o cenário
 * inicial só sai de "à vista" com PROVA FORTE — trecho do edital que, relido, diz o mesmo valor, ou a ficha estruturada
 * da Caixa. Título do anúncio, paráfrase do documental (IA) e padrão do leiloeiro aparecem com o nome deles e nunca
 * abrem o cenário financiado sozinhos: o cliente liga a simulação, e ela vem marcada como premissa.
 *
 * Origens: edital_texto (o trecho citado, relido pelo extrator, dá o mesmo valor) · edital_sem_trecho (veio do texto
 * do edital, mas o trecho citado não o sustenta) · ficha_cef · documental_ia · anuncio · padrao_leiloeiro.
 */
import { extrairPagamentoTexto } from './_doc-extracao.js';

export const VERSAO_CONDICOES = 1;
export const CAMPOS_PAGAMENTO = ['aVista', 'parcelamentoPermitido', 'parcelas', 'sinalPct', 'financiavel', 'fgts', 'prazoDias', 'comissaoPct'];
const PROVA_FORTE = new Set(['edital_texto', 'ficha_cef']);

const temValor = (v) => v !== null && v !== undefined && v !== '' && !(typeof v === 'number' && !Number.isFinite(v));
const mesmo = (a, b) => (typeof a === 'number' || typeof b === 'number') ? Number(a) === Number(b) : a === b;

/**
 * @param {object} p
 * @param {{regras?:object, texto?:string}} [p.edital]      regras extraídas do edital + a cláusula CITADA (formaPagamento)
 * @param {{regras?:object, texto?:string}} [p.documental]  extração do texto que o documental (IA) devolveu
 * @param {{regras?:object, texto?:string}} [p.anuncio]     extração do título do anúncio
 * @param {{regras?:object, amostras?:number}} [p.prior]    consenso do leiloeiro × modalidade
 * @param {object} [p.fichaCef]                             ficha estruturada da Caixa (financiamento/fgts)
 * @param {string} [p.modalidade]
 */
export function montarCondicoesPagamento({ edital, documental, anuncio, prior, fichaCef, modalidade } = {}) {
  // Releitura do trecho citado: o que o PRÓPRIO trecho diz é a prova. Paráfrase, título ou consenso não passam.
  const doTrecho = edital?.texto ? extrairPagamentoTexto(String(edital.texto)) : null;
  const camadas = [];
  if (edital?.regras) camadas.push({ regras: edital.regras, origemDe: (campo, v) => (doTrecho && mesmo(doTrecho[campo], v) ? 'edital_texto' : 'edital_sem_trecho'), trecho: edital.texto || null });
  if (fichaCef && typeof fichaCef === 'object') {
    const fin = fichaCef.financiamento, fg = fichaCef.fgts;
    const r = {};
    if (fin === true || fin === false) r.financiavel = fin;
    if (fg === true || fg === false) r.fgts = fg;
    if (Object.keys(r).length) camadas.push({ regras: r, origemDe: () => 'ficha_cef', trecho: 'ficha do imóvel publicada pela Caixa' });
  }
  if (documental?.regras) camadas.push({ regras: documental.regras, origemDe: () => 'documental_ia', trecho: documental.texto || null });
  if (anuncio?.regras) camadas.push({ regras: anuncio.regras, origemDe: () => 'anuncio', trecho: anuncio.texto || null });
  if (prior?.regras) camadas.push({ regras: prior.regras, origemDe: () => 'padrao_leiloeiro', trecho: prior.amostras ? `padrão de ${prior.amostras} edital(is) deste leiloeiro` : 'padrão deste leiloeiro' });

  const campos = {};
  for (const campo of CAMPOS_PAGAMENTO) {
    for (const c of camadas) {
      const v = c.regras?.[campo];
      if (!temValor(v)) continue;
      campos[campo] = { valor: v, origem: c.origemDe(campo, v), trecho: c.trecho ? String(c.trecho).slice(0, 400) : null };
      break;
    }
  }

  const forte = (campo) => campos[campo] && PROVA_FORTE.has(campos[campo].origem);
  const vedaProvado = forte('parcelamentoPermitido') && campos.parcelamentoPermitido.valor === false;
  const parcelaProvada = (forte('parcelas') && Number(campos.parcelas.valor) >= 2)
    || (forte('parcelamentoPermitido') && campos.parcelamentoPermitido.valor === true)
    || (forte('financiavel') && campos.financiavel.valor === true);
  // FGTS NÃO entra: aceitar FGTS não é parcelamento (o Brooklin começou aí).
  const cenarioInicial = !vedaProvado && parcelaProvada ? 'financiado' : 'aVista';
  const judicial = String(modalidade || '').toLowerCase() === 'judicial';
  return {
    versao: VERSAO_CONDICOES,
    campos,
    cenarioInicial,
    // 'parcelado_judicial' é o art. 895 (saldo corrigido, hipoteca ao juízo), não financiamento bancário.
    tipoParcelamento: cenarioInicial === 'financiado' ? (judicial && !(forte('financiavel') && campos.financiavel.valor === true) ? 'parcelado_judicial' : 'financiamento') : null,
    provado: cenarioInicial === 'financiado' || vedaProvado || (forte('aVista') && campos.aVista.valor === true),
    motivo: vedaProvado ? 'edital veda parcelamento'
      : parcelaProvada ? 'parcelamento comprovado (edital citado ou ficha da Caixa)'
      : Object.keys(campos).length ? 'sem prova de parcelamento no edital — abre à vista; simulação parcelada é premissa'
      : 'condições não lidas — abre à vista; confirme no edital',
  };
}

/** Rótulo curto da origem, para a tela/PDF. */
export function rotuloOrigem(origem) {
  return ({ edital_texto: 'edital', edital_sem_trecho: 'edital (sem trecho citado)', ficha_cef: 'ficha da Caixa', documental_ia: 'documental (IA)',
    anuncio: 'anúncio do leiloeiro', padrao_leiloeiro: 'padrão do leiloeiro' })[origem] || 'não verificado';
}
