/**
 * Parser puro — HASTA (hastaleiloes.com.br — o site REAL; achado do dono 21/08).
 * ==============================================================================
 * ⚠️ HISTÓRIA DO DOMÍNIO: a 1ª versão apontava hastaleilao.com.br (SINGULAR), um
 * template/espelho estático que devolve a MESMA casca com lotes fake em qualquer URL —
 * a 1ª coleta gravou 17 registros idênticos (deletados). O site real é o PLURAL,
 * mapeado pelo dono via console do navegador (dump de listagem + detalhe, 21/08).
 *
 * ESTRUTURA (dump real do lote 10151, leilão 557 — comitente CAIXA):
 *   • Listagem: /lotes/imovel (30 lotes/pág; IDs sequenciais) → lote /item/<ID>/detalhes.
 *   • Detalhe, POR RÓTULO (moeda SEM espaço: "R$169.588,26"; ordinal "°" na listagem e
 *     "º" no detalhe — aceitar os dois):
 *       "Data 1º Leilão: 28/08/2026 10:00 · Lance Inicial: R$169.588,26"  → 1º leilão
 *       "Data 2º Leilão: 03/09/2026 10:00 · Lance Inicial: R$97.298,74"   → 2º = mínimo
 *       "Valor de Avaliação: R$162.164,57"                                → avaliação
 *       "Comissão (5%)", "Total a Pagar", "Incremento Mínimo"             → IGNORAR
 *   • "Cidade: Maceió/AL" · "Endereço: …" · "Matrícula: Matrícula: 140518 - IPTU: …"
 *   • Descrição: "CONDOMINIO … - IMOVEL 8555500903878 - TIPO APARTAMENTO - AREA 57,67 M2 …"
 *   • Menu lateral lista TODOS os lotes ("LOTE 001…NNN") — sem R$, não contamina o parse.
 *   • Comitente CAIXA: possível SOBREPOSIÇÃO com a fonte CEF (o "Número do Bem" é o id
 *     do imóvel no portal da Caixa) — vigiar duplicidade no acervo.
 *   • O site NÃO responde a datacenter (render vazio no runner do GitHub) — coleta é pelo
 *     runner RESIDENCIAL (motor dom), gate coleta_cliente.
 */
import { inferirTipo, extrairArea, checarQualidade } from './leilaopro-parse.mjs';
import { num, plaus, titleCase, textoDe, anexosDeHtml, montarRowDom } from './dom-parse-util.mjs';

export const TENANTS = {
  hasta: { fonte: 'HASTA', leiloeiro: 'Hasta Leilões', base: 'https://www.hastaleiloes.com.br' },
};

export function extrairUrlsDeLote(html, base) {
  const urls = new Map();
  for (const m of String(html || '').matchAll(/href=["']([^"']*\/item\/(\d+)\/detalhes[^"']*)["']/gi)) {
    try { urls.set(m[2], new URL(m[1], base).href); } catch { /* skip */ }
  }
  return urls;
}
export const idDaUrl = url => (String(url).match(/\/item\/(\d+)\/detalhes/) || [])[1] || null;

const ORD = '[º°o]';   // "1º" no detalhe, "2°" na listagem — e defesa p/ "1o"

export function parseDetalhe(html, url) {
  const txt = textoDe(html);

  // Datas + lances POR PRAÇA: "Data 1º Leilão: 28/08/2026 10:00 … Lance Inicial: R$169.588,26".
  const pracas = [];
  for (const m of txt.matchAll(new RegExp(String.raw`Data\s+([12])${ORD}\s*Leil[ãa]o:?\s*(\d{2}/\d{2}/\d{4})(?:\s+\d{2}:\d{2})?[^R]{0,60}Lance\s+Inicial:?\s*R\$\s?([\d.]+,\d{2})`, 'gi'))) {
    pracas.push({ n: Number(m[1]), data: m[2], valor: plaus(num(m[3])) });
  }
  const p1 = pracas.find(p => p.n === 1);
  const p2 = pracas.find(p => p.n === 2);

  // Avaliação tem rótulo EXPLÍCITO (e pode ser MENOR que o lance do 1º — regra CEF).
  const avalExpl = plaus(num((txt.match(/Valor\s+de\s+Avalia[çc][ãa]o:?\s*R\$\s?([\d.]+,\d{2})/i) || [])[1]));
  let minimo = p2?.valor || p1?.valor || 0;
  let avaliacao = avalExpl || p1?.valor || minimo;
  if (!minimo) minimo = avaliacao;

  // Cidade/UF e endereço têm rótulo próprio ("Cidade: Maceió/AL").
  const mCid = txt.match(/Cidade:\s*([A-Za-zÀ-ÿ'. -]{2,40}?)\s*\/\s*([A-Z]{2})\b/);
  const cidade = mCid ? titleCase(mCid[1].trim()).slice(0, 60) : null;
  const estado = mCid ? mCid[2].toUpperCase() : null;
  const endereco = (txt.match(/Endere[çc]o:\s*([^]{5,120}?)(?=\s+(?:Matr[íi]cula|Cidade|Descri[çc][ãa]o|CEP\b)|$)/i) || [])[1]?.trim() || null;

  // "Matrícula: Matrícula: 140518 - IPTU: …" (o rótulo vem DUPLICADO no site).
  const mat = (txt.match(/Matr[íi]cula:\s*(?:Matr[íi]cula:\s*)?([\d.]{4,})/i) || [])[1] || null;

  // Descrição estruturada: "… - IMOVEL <num> - TIPO APARTAMENTO - AREA 57,67 M2 - …".
  const mDesc = txt.match(/Descri[çc][ãa]o:\s*([^]{10,500}?)(?=\s+(?:Observa[çc][õo]es|Localiza[çc][ãa]o|CONTATOS)|$)/i);
  const descricao = mDesc ? mDesc[1].trim().slice(0, 500) : null;
  const tipoDesc = (txt.match(/TIPO\s+([A-ZÀ-Ú]+)/) || [])[1] || '';
  const titulo = (() => {
    const cond = (descricao || '').match(/^([A-ZÀ-Ú0-9][^-]{4,70}?)\s*-\s*IMOVEL/);
    const nome = cond ? titleCase(cond[1].trim()) : null;
    return (nome ? `${nome}${cidade ? ` — ${cidade}/${estado}` : ''}` : null);
  })();

  const area = extrairArea(descricao || '', '') || extrairArea(txt.slice(0, 3000));
  const modalidade = /processo\s*n|\bjudicial\b/i.test(txt) && !/extrajudicial/i.test(txt) ? 'judicial' : 'extrajudicial';

  // Vivo/morto pelas DATAS das praças (o "ABERTO PARA LANCES" ajuda, mas data manda).
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const datas = pracas.map(p => { const [d, mo, y] = p.data.split('/').map(Number); return new Date(y, mo - 1, d); })
    .filter(d => !isNaN(d)).sort((a, b) => a - b);
  const fut = datas.find(d => d >= hoje) || datas[datas.length - 1] || null;
  const encerrado = datas.length > 0 && !datas.some(d => d >= hoje) && !/ABERTO\s+PARA\s+LANCES/i.test(txt);

  const docs = anexosDeHtml(html, url);
  return {
    titulo: titulo || null, cidade, estado, endereco,
    valor_avaliacao: avaliacao, valor_minimo: minimo,
    modalidade, area_m2: area,
    descricao,
    data_leilao: fut ? fut.toISOString().slice(0, 10) : null,
    numero_matricula: mat, ...docs,
    encerrado,
    tipo_hint: tipoDesc.toLowerCase(),
  };
}

export const montarRow = (url, det, tenant) => {
  const row = montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo);
  // O TIPO vem por extenso na descrição do site ("TIPO APARTAMENTO") — mais confiável que
  // inferir do título; usa quando o mapa conhece.
  const mapa = { apartamento: 'apartamento', casa: 'casa', terreno: 'terreno', comercial: 'comercial', sala: 'comercial', loja: 'comercial', rural: 'rural', fazenda: 'rural', sitio: 'rural' };
  if (det.tipo_hint && mapa[det.tipo_hint]) row.tipo = mapa[det.tipo_hint];
  if (det.endereco) row.endereco = det.endereco;
  return row;
};
export { checarQualidade };
