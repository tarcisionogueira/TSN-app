/**
 * GESTÃO DE LEILÕES — layout "lotePadrao" (26/10, Fidalgo Leilões). Parser puro, usado por scraper-gestao.mjs.
 * Fixture real: scripts/testes/fixtures/gestao-fidalgo-evento-3766.html (lido pelo banco em 26/10, acentos
 * reconstruídos por repararLatin1Perdido — o banco entrega o latin1 com U+FFFD).
 */
import { decodificarEntidades } from '../../api/_texto-imovel.js';
import { inferirUF } from './inferir-uf.mjs';

const num = s => parseFloat(String(s || '').replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
const tituloCase = s => s.toLowerCase().replace(/(^|[\s'"–—-])(\p{L})/gu, (_, p, c) => p + c.toUpperCase());
function inferirTipo(txt = '') {
  const t = txt.toLowerCase();
  if (/apartament|apto|flat|kitnet|studio|unidade aut/.test(t)) return 'apartamento';
  if (/casa|sobrado|residenc/.test(t)) return 'casa';
  if (/terreno|lote de terreno|gleba|data de terra/.test(t)) return 'terreno';
  if (/comercial|loja|sala|gal[pã]|pr[ée]dio|escrit[óo]rio|barrac/.test(t)) return 'comercial';
  if (/rural|fazenda|s[íi]tio|ch[áa]cara/.test(t)) return 'rural';
  return 'outros';
}

// LAYOUT "lotePadrao" (26/10, Fidalgo). Card `div.lotePadrao` com a coluna de texto `col-lg-5 … goTo('lote.php?idLote=N')`:
// "IMÓVEL: <descrição cortada>", "Local do bem: RUA …, 81 - SANTO AMARO - SÃO PAULO/SP", status ("Aberto para lances") e
// "Lance inicial R$ 1.400.000,00" (o lance da praça vigente). A categoria é o prefixo da descrição ("IMÓVEL:",
// "VEÍCULO:"…). Praças no cabeçalho do evento: "1ª Praça Abertura: 12/11/2026 às 14h00 Encerramento: 17/11/2026…".
// "Exibindo resultado 1 a 20 de 57" é o total do evento (o `todos=1` traz o resto, como no clássico).
export const ehPadrao = h => /class="mb-4 back-11 lotePadrao\b/.test(h);
export function fatiarCardsPadrao(html) {
  return html.split(/<div class="mb-4 back-11 lotePadrao\b/).slice(1).map((pedaco) => {
    const idLote = (pedaco.match(/goTo\('(?:lote|loteVendaDireta)\.php\?idLote=(\d+)'\)/) || [])[1];
    return idLote ? { idLote, vendaDireta: /loteVendaDireta\.php/.test(pedaco), html: pedaco.slice(0, 9000) } : null;
  }).filter(Boolean);
}
export function pracasPadrao(textoEvento) {
  const t = String(textoEvento || '');
  const enc = (n) => {
    const m = t.match(new RegExp(`${n}[ªaº°]\\s*Pra[çc]a[\\s\\S]{0,120}?Encerramento:?\\s*(\\d{2})/(\\d{2})/(\\d{4})`, 'i'));
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  };
  const unica = t.match(/Encerramento:?\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  return { data_leilao: enc(1) || (unica ? `${unica[3]}-${unica[2]}-${unica[1]}` : null), data_leilao_2: enc(2) };
}
export function parseCardPadrao(card, ctx) {
  const txt = decodificarEntidades(card.html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const bens = decodificarEntidades(((card.html.match(/class="col-12 lotePadraoBens[^"]*">\s*<div>([\s\S]*?)<\/div>/i) || [])[1] || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const cat = (bens.match(/^([A-ZÀ-Ýa-zà-ÿ ]{3,30}):/) || [])[1] || '';
  if (!/im[óo]ve/i.test(cat)) return null;
  // O card corta a descrição com "...": tira a palavra partida do fim ("in..." → "").
  const descricao = bens.replace(/^[^:]{3,30}:\s*/, '').replace(/\s*\S*\.\.\.$/, '…').trim() || null;
  const local = (txt.match(/Local do bem:\s*(.+?)\s+Lances\b/i) || [])[1]?.trim() || null;
  let cidade = null, estado = null, bairro = null, endereco = local;
  const ml = local && local.match(/^(.*?)\s+-\s+([^-]+?)\s+-\s+([^-/]+?)\s*\/\s*([A-Z]{2})\s*$/);
  if (ml) { endereco = ml[1]; bairro = tituloCase(ml[2]); cidade = tituloCase(ml[3]).replace(/ (Da|De|Do|Das|Dos|E) /g, (y) => y.toLowerCase()); estado = ml[4]; }
  else {
    const m2 = local && local.match(/([^-,]+?)\s*\/\s*([A-Z]{2})\s*$/);
    if (m2) { cidade = tituloCase(m2[1].trim()); estado = m2[2]; }
  }
  if (!estado) {
    const x = inferirUF({ cidade, titulo: null, endereco, descricao: `${descricao || ''} ${local || ''}` });
    if (x) { estado = x.uf; if (x.cidade && !cidade) cidade = tituloCase(x.cidade); }
  }
  const lance = num((txt.match(/Lance inicial\s*R\$\s*([\d.]+,\d{2})/i) || [])[1]);
  const status = (card.html.match(/class="lotePadraoStatus text-center[^"]*"[^>]*>\s*([^<]+?)\s*</i) || [])[1] || '';
  if (/encerrad|arrematad|vendid|cancelad|suspens|retirad|sustad/i.test(status)) return null;
  const matricula = (txt.match(/matr[íi]cula[:\s]*n?[ºo°.]?\s*(\d[\d.\-\/]{2,})/i) || [])[1]?.replace(/[.\-/]$/, '') || null;
  const area = num((txt.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)\s*m²/i) || [])[1]);
  const reFotoLote = new RegExp(`["']([^"']*/${card.idLote}_[^"'/]*\\.(?:jpe?g|png|webp|jfif)[^"']*)["']`, 'i');
  const foto = (card.html.match(reFotoLote) || String(ctx.htmlEvento || '').match(reFotoLote) || [])[1] || null;
  const base = ctx.dominio.replace(/^www\./, '').split('.')[0];
  // A 1ª frase costuma ser a matrícula ("Matrícula 285.648 - 11º Cartório…"): o título é a 1ª que descreve o bem.
  const frases = (descricao || '').split(/(?<=[a-zà-ú0-9)])\.\s/i).map((f) => f.trim()).filter(Boolean);
  const titulo = (frases.find((f) => !/^matr[íi]cula\b/i.test(f)) || frases[0] || `Imóvel ${ctx.leiloeiro} ${card.idLote}`).slice(0, 180);
  return {
    fonte: 'GESTAOLEILOES',
    fonte_id: `gestao_${base}_${card.idLote}`,
    titulo, tipo: inferirTipo(`${titulo} ${descricao || ''}`.slice(0, 300)),
    modalidade: card.vendaDireta ? 'venda_direta' : (ctx.judicial ? 'judicial' : 'extrajudicial'),
    estado, cidade, bairro, endereco,
    valor_avaliacao: lance, valor_minimo: lance,
    area_m2: area || 0,
    descricao,
    numero_matricula: matricula,
    link_edital: `https://${ctx.dominio}/leilao.php?idLeilao=${ctx.idLeilao}`,
    url_lote: `https://${ctx.dominio}/lote.php?idLote=${card.idLote}`,
    link_foto: foto ? (foto.startsWith('http') ? foto : `https://${ctx.dominio}/${foto.replace(/^\//, '')}`) : null,
    leiloeiro: ctx.leiloeiro,
    data_leilao: card.vendaDireta ? null : (ctx.data_leilao || null),
    data_leilao_2: card.vendaDireta ? null : (ctx.data_leilao_2 || null),
    forma_pagamento: 'a_vista',
    ativo: true, viavel: null, score_viabilidade: 30, desconto_percentual: null,
    atualizado_em: new Date().toISOString(),
  };
}

