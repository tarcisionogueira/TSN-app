/**
 * Parser puro — ALBERTOMACEDOLEILOES (albertomacedoleiloes.com.br). Fonte `dom`, plataforma
 * própria (recon 07/09). A home lista os "leilões" (`/leilao/<slug>`), e cada um pode ser um
 * imóvel único ("terreno-de-3-hectares-em-barretos", confirmado: tabela limpa de praças) OU um
 * PACOTE com vários imóveis, cada um com sua PRÓPRIA página `/lote/<n>-<slug>` (achado 17/09,
 * dono reportou lote que não aparecia no sistema: `/lote/2-lote-residencial-buri-residence`,
 * filho de `/leilao/02-imoveis-em-burisp`). NÃO dá pra saber pela URL do `/leilao/` se é
 * single ou pacote — resolvido com o NÍVEL 2 do motor (`extrairUrlsDeEvento`): toda URL
 * `/leilao/<slug>` da home é tratada como "evento" e revisitada; se ela listar `/lote/`
 * dentro, esses viram itens de verdade (extrairUrlsDeLote reconhece os dois padrões agora).
 * Página single-item não lista `/lote/` nenhum (confirmado: recon na própria página do lote
 * achou 0 `/lote/` internos) — o revisitar dela no nível 2 é barato e idempotente, sem
 * duplicar item (namespace de slug de `/leilao/` e `/lote/` não colide).
 *
 * Confirmado (leilao/terreno-de-3-hectares-em-barretos E lote/2-lote-residencial-buri-
 * residence — mesmo template): tabela PRAÇA/ABERTURA/ENCERRAMENTO/INICIAL (1ª e 2ª praça) +
 * rótulo solto "Avaliação (FEVEREIRO de 2025): R$ 1.082.794,61". Sem PDF encontrado no recon
 * (real ou apenas fora da janela capturada — a checar num dry-run); fotos reais via API
 * própria (api.albertomacedoleiloes.com.br/storage/...).
 */
import { inferirTipo, cidadeUF, extrairArea, proximaData, checarQualidade } from './leilaopro-parse.mjs';
import { num, plaus, textoDe, tituloDeSlug, anexosDeHtml, montarRowDom, linhasDeTabela } from './dom-parse-util.mjs';

export const TENANTS = {
  albertomacedo: { fonte: 'ALBERTOMACEDOLEILOES', leiloeiro: 'Alberto Macedo Leilões', base: 'https://albertomacedoleiloes.com.br' },
};

// Reconhece as DUAS formas de item: `/leilao/<slug>` (single, ou pacote — descartado depois
// por falta de valor único) e `/lote/<n>-<slug>` (item de dentro de um pacote — só aparece
// dentro da página do `/leilao/` pai, nunca na home direto, confirmado 17/09).
export function extrairUrlsDeLote(html, base) {
  const urls = new Map();
  for (const m of String(html || '').matchAll(/href=["'](\/(?:leilao|lote)\/([a-z0-9][a-z0-9-]{2,}))\/?["']/gi)) {
    try { urls.set(m[2], new URL(m[1], base).href); } catch { /* skip */ }
  }
  return urls;
}
// NÍVEL 2 do motor (runner.mjs `enumerar`): toda URL `/leilao/<slug>` da home vira "evento" —
// cada uma é revisitada e passa de novo por `extrairUrlsDeLote`, que agora também acha
// `/lote/` dentro dela se for um pacote. Mesmo padrão já usado por HASTA/NORDESTE.
export function extrairUrlsDeEvento(html, base) {
  const eventos = new Map();
  for (const m of String(html || '').matchAll(/href=["'](\/leilao\/([a-z0-9][a-z0-9-]{2,})?)\/?["']/gi)) {
    if (!m[2]) continue;   // "/leilao/-1" e afins: sem slug de verdade, nada pra identificar
    try { eventos.set(m[2], new URL(m[1], base).href); } catch { /* skip */ }
  }
  return eventos;
}
export const idDaUrl = url => (String(url).match(/\/(?:leilao|lote)\/([a-z0-9-]+)/i) || [])[1] || null;

// Tabela de praças: pega a ÚLTIMA linha com valor em R$ na coluna final (2ª praça = mínimo
// vigente); a 1ª linha de dados vira avaliação de reserva se não houver rótulo "Avaliação".
// FALLBACK SEM <table> (17/09, achado real: /lote/<n>-<slug>, o template dos itens de pacote
// — diferente do /leilao/<slug> single-item, que usa <table> de verdade). A mesma informação
// ("PRAÇA ABERTURA ENCERRAMENTO INICIAL Praça única ... R$ 70.000,00") existe, só que
// renderizada sem elemento <table> — `linhasDeTabela` (que só lê <tr>/<td>) volta vazio e o
// lote inteiro caía em avaliação=0, descartado como se fosse pacote sem valor. Ancora no MESMO
// cabeçalho da tabela antiga e lê os valores em R$ logo depois, na ordem em que aparecem —
// janela curta (250 chars) de propósito: "Incremento"/"Lance atual" (R$1.000/R$0, medidos no
// dump real) vêm bem mais adiante no texto, e um plaus()>=1000 sozinho não bastaria pra
// descartar o incremento.
function precosDoTextoSemTabela(txt) {
  const m = txt.match(/PRA[ÇC]A\s+ABERTURA\s+ENCERRAMENTO\s+INICIAL([\s\S]{0,250})/i);
  if (!m) return { primeira: 0, ultima: 0 };
  const valores = [...m[1].matchAll(/R\$\s*([\d.]+,\d{2})/g)].map((v) => plaus(num(v[1]))).filter(Boolean);
  if (!valores.length) return { primeira: 0, ultima: 0 };
  return { primeira: valores[0], ultima: valores[valores.length - 1] };
}
function precosDaTabela(html, txt) {
  const linhas = linhasDeTabela(html).filter((cols) => cols.some((c) => /R\$/.test(c)));
  if (!linhas.length) return precosDoTextoSemTabela(txt);
  const valorDaLinha = (cols) => plaus(num((cols.find((c) => /R\$/.test(c)) || '').match(/R\$\s*([\d.]+,\d{2})/)?.[1] || ''));
  return { primeira: valorDaLinha(linhas[0]), ultima: valorDaLinha(linhas[linhas.length - 1]) };
}

export function parseDetalhe(html, url) {
  const txt = textoDe(html);
  const slug = idDaUrl(url) || '';
  const { primeira, ultima } = precosDaTabela(html, txt);

  const avalExplicita = plaus(num((txt.match(/Avalia[çc][ãa]o\s*(?:\([^)]*\))?\s*:?\s*R\$\s*([\d.]+,\d{2})/i) || [])[1]));
  let avaliacao = avalExplicita || primeira;
  let minimo = ultima || avaliacao;
  if (!avaliacao) avaliacao = minimo;
  // GUARDA (07/09, reescrita depois de dado real): a home mistura "leilões" de imóvel com
  // veículo sob a MESMA URL /leilao/<slug> ("fiatpalio-weekend-ex" com avaliação de
  // R$13.337 — carro, não imóvel). 1ª versão testava AUSÊNCIA de palavra de imóvel no corpo
  // inteiro — mas o dump real do fiatpalio mostrou "bateu=Rural" vindo de um FILTRO DE
  // CATEGORIA fixo na barra lateral ("Eletrônicos Imóveis Imóveis comerciais Imóveis
  // residenciais Máquinas Móveis Rural Veículos Estado UF AC - Acre..."), presente em TODA
  // página do site, item ou não — a guarda nunca disparava de verdade, pra nenhum slug.
  // Troca de estratégia: sinal POSITIVO de veículo (placa/renavam/chassi/combustível/km) —
  // esses termos não aparecem num filtro de categoria genérico, só na ficha real do bem.
  // Pacote multi-imóvel continua caindo por outro caminho (nenhum valor único de avaliação).
  if (/\bplaca\b|\brenavam\b|\bchassi\b|combust[íi]vel|quilometragem|\bkm\s*rodados?\b/i.test(txt)) {
    avaliacao = 0; minimo = 0;
  }

  const titulo = tituloDeSlug(slug);
  const { cidade, estado } = cidadeUF(titulo || '', txt.slice(0, 1500));
  const area = extrairArea(titulo || '', txt.slice(0, 1500));
  const modalidade = /extrajudicial/i.test(txt) ? 'extrajudicial' : /judicial|processo\s*n/i.test(txt) ? 'judicial' : 'extrajudicial';
  const mat = (txt.match(/matr[íi]cula\s*(?:n[º°.]?\s*)?([\d.]{3,})/i) || [])[1] || null;
  const docs = anexosDeHtml(html, url);

  return {
    titulo, cidade, estado,
    valor_avaliacao: avaliacao, valor_minimo: minimo,
    modalidade, area_m2: area,
    descricao: null,
    data_leilao: proximaData(txt.slice(0, 3000)),
    numero_matricula: mat, ...docs,
    encerrado: /\b(arrematado|vendido|deserto|cancelad[oa]|suspens[oa])\b/i.test(txt.slice(0, 2000)),
  };
}

export const montarRow = (url, det, tenant) => montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo);
export { checarQualidade };
