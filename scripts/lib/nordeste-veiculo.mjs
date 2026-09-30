/**
 * Parser puro — VEÍCULOS da NORDESTE (30/09, pedido do dono: "só os veículos inteiros").
 * O acervo da NORDESTE (varas federais/TRT-5) tem ~400 lotes, a maioria bem móvel: o coletor de
 * imóveis descartava tudo. Aqui entram SÓ veículos inteiros — nada de sucata, peça, carcaça.
 * Mesmos dados do payload do site que o parser de imóvel já lê (`loteDoPayload`): título,
 * avaliação, lance da praça vigente, praças e leiloeiro; placa/chassi/Renavam e o local do bem
 * vêm da DESCRIÇÃO deste lote (nunca do texto solto da página, que traz os outros lotes).
 */
import { loteDoPayload, descricaoDoLote } from './nordeste-parse.mjs';
import { num, numPayload } from './dom-parse-util.mjs';
// Veículo de pátio ("veículos conservados") vale R$ 400–1.500 de verdade: o piso de imóvel (R$ 1.000)
// descartava 31 de 40 no seco de 30/09. Aqui o piso é R$ 100.
const plausV = v => (v >= 100 && v <= 50_000_000 ? v : 0);

// Slug começa pelo TIPO do bem: "213-065-automovel-chevrolets10-…", "213-001-motocicleta-…".
const RE_TIPO_VEICULO = /^\d+-\d+-(?:\d+-)?(ve[íi]culo|automovel|motocicleta|motoneta|ciclomotor|moto|onibus|micro-?onibus|caminhao|caminhonete|camioneta|utilitario|van|furgao|reboque|semi-?reboque|carreta|cavalo-mecanico)(?:-|$)/i;
// Veículo INTEIRO: fora sucata, peça, carcaça, motor avulso, pneus.
const RE_NAO_INTEIRO = /sucata|pecas|peca-|carcaca|motor-avulso|pneus|lataria|sinistro-total|baixa-definitiva/i;

export function slugDoLote(url) { return (String(url).match(/\/lotes\/([a-z0-9-]+)/i) || [])[1] || ''; }

export function ehVeiculoInteiro(url) {
  const slug = slugDoLote(url);
  return RE_TIPO_VEICULO.test(slug) && !RE_NAO_INTEIRO.test(slug);
}

export function tipoVeiculo(titulo) {
  const t = String(titulo || '').toLowerCase();
  if (/motocicleta|motoneta|ciclomotor|\bmoto\b/.test(t)) return 'moto';
  // Lote de pátio ("VEÍCULO CONSERVADO HONDA CG 125 …") não diz o tipo: moto pela marca/modelo.
  if (/\b(dafra|shineray|traxx|sundown|kasinski|haojue|jtz|garinni)\b/.test(t)
    || /\b(honda|yamaha|suzuki)\b[\s/]*(cg|cb|cbx|biz|pop|titan|fan|bros|nxr|xre|nx|twister|lead|pcx|ybr|factor|fazer|crypton|xtz|lander|neo|yes|intruder|dt|xt)\b/.test(t)) return 'moto';
  if (/[ôo]nibus/.test(t)) return 'onibus';
  if (/caminh[ãa]o|cavalo mec/.test(t)) return 'caminhao';
  if (/reboque|carreta/.test(t)) return 'reboque';
  if (/\bvan\b|furg[ãa]o|utilit[áa]rio/.test(t)) return 'van_utilitario';
  return 'carro';
}

// "AUTOMÓVEL CHEVROLET/S10 LTZ DD2 2.8 TDI 4X2 CD DIES. AUT, ANO 2012/2013"
// "VEÍCULO I/TOYOTA HILUX 4CD SR5, ANO 1998/1998" · "MOTOCICLETA HONDA/CG 160 FAN, ANO 2018/2018"
export function marcaModeloAno(titulo) {
  const t = String(titulo || '').replace(/\s+/g, ' ').trim();
  const semTipo = t.replace(/^(ve[íi]culo|autom[óo]vel|motocicleta|motoneta|ciclomotor|moto|[ôo]nibus|micro-?[ôo]nibus|caminh[ãa]o|caminhonete|camioneta|utilit[áa]rio|van|furg[ãa]o|reboque|semi-?reboque|carreta)\b\s*:?\s*/i, '');
  const ano = t.match(/\bano\s*:?\s*(19[5-9]\d|20[0-4]\d)\s*\/\s*(19[5-9]\d|20[0-4]\d)/i) || t.match(/\b(19[5-9]\d|20[0-4]\d)\s*\/\s*(19[5-9]\d|20[0-4]\d)\b/);
  // "VEÍCULO CONSERVADO VW GOL 1.0 - 2004/2005": sai o "CONSERVADO" (é o lote de pátio, não a marca)
  // e o "- AAAA/AAAA" do fim, que é o ano.
  const corpo = semTipo.replace(/^conservad[oa]\s+/i, '').split(/,?\s*\bano\b/i)[0]
    .replace(/\s*-?\s*(19|20)\d{2}\s*\/\s*(19|20)\d{2}\s*$/, '')
    .replace(/^i\s*\//i, '').replace(/^marca\s*\/?\s*modelo\s*:?\s*/i, '');
  let [marcaBruta, ...resto] = corpo.split('/');
  // Sem barra ("I/TOYOTA HILUX" vira "TOYOTA HILUX"): 1ª palavra, se for marca conhecida.
  if (!resto.length) {
    const m = corpo.trim().match(/^(\S+)\s+(.+)$/);
    if (m && RE_MARCA.test(m[1])) { marcaBruta = m[1]; resto = [m[2]]; }
  }
  const marca = resto.length ? marcaBruta.trim().toUpperCase().replace(/^M\.?\s*BENZ$/, 'MERCEDES-BENZ') : null;
  const modelo = (resto.length ? resto.join('/') : corpo).trim().replace(/[,.;]+$/, '') || null;
  return {
    marca, modelo: modelo ? modelo.slice(0, 80) : null,
    ano_fabricacao: ano ? Number(ano[1]) : null, ano_modelo: ano ? Number(ano[2]) : null,
  };
}

const RE_MARCA = /^(honda|yamaha|fiat|ford|volkswagen|vw|chevrolet|gm|renault|toyota|hyundai|nissan|peugeot|citroen|jeep|mitsubishi|suzuki|kawasaki|bmw|iveco|scania|volvo|mercedes|m\.?benz|kia|chery|jac|audi|land|dafra|shineray|haojue|agrale|marcopolo|mpolo)$/i;

const dataISO = v => (v && !isNaN(new Date(v)) ? new Date(v).toISOString() : null);

export function veiculoDoDetalhe(html, url) {
  const slug = slugDoLote(url);
  const lote = loteDoPayload(html, slug);
  if (!lote) return { motivo: 'payload do lote não encontrado na página' };
  const desc = descricaoDoLote(html, lote);
  const titulo = String(lote.title || '').slice(0, 180);
  const avaliacao = plausV(numPayload(lote.avaliation)) || plausV(num((desc.match(/Avalia[çc][ãa]o:?\s*R\$\s*([\d.]+,\d{2})/i) || [])[1]));
  const minimo = plausV(numPayload(lote.initialBid)) || plausV(numPayload(lote.minimunSale)) || plausV(num((desc.match(/Lance M[íi]nimo:?\s*R\$\s*([\d.]+,\d{2})/i) || [])[1])) || avaliacao;
  const pracas = (lote.auction?.squares || []).filter(q => !q.hidden)
    .sort((a, b) => (a.type?.square || 0) - (b.type?.square || 0)).map(q => dataISO(q.closing)).filter(Boolean);
  const agora = new Date().toISOString();
  const proxima = pracas.find(d => d >= agora) || pracas[pracas.length - 1] || null;
  // "Localização do Bem: RUA …, CENTRO, PIRITIBA/BA."
  const loc = desc.match(/Localiza[çc][ãa]o do Bem:[^.]*?([A-ZÀ-Ý][A-Za-zÀ-ÿ' -]{2,40})\s*\/\s*([A-Z]{2})\b/);
  const placa = (desc.match(/\bPLACA(?:\s+POLICIAL)?\s*:?\s*([A-Z]{3}-?\d[A-Z0-9]\d{2})\b/i) || [])[1] || null;
  const chassi = (desc.match(/\bCHASSI\s*:?\s*([A-HJ-NPR-Z0-9]{17})\b/i) || [])[1] || null;
  const renavam = (desc.match(/\bRENAVAM\s*:?\s*(\d{9,11})\b/i) || [])[1] || null;
  return {
    titulo, ...marcaModeloAno(titulo), tipo_veiculo: tipoVeiculo(titulo),
    valor_avaliacao: avaliacao || 0, valor_minimo: minimo || 0,
    cidade: loc ? loc[1].trim() : (lote.city || null), estado: loc ? loc[2] : (/^[A-Z]{2}$/.test(lote.state || '') ? lote.state : null),
    placa: placa ? placa.replace('-', '').toUpperCase() : null, chassi: chassi ? chassi.toUpperCase() : null, renavam,
    descricao: desc.slice(0, 8000) || titulo,
    data_leilao: proxima,
    leiloeiro: lote.auction?.auctioneer?.name || 'Nordeste Leilões',
    email_leiloeiro: lote.auction?.auctioneer?.email || null,
    encerrado: lote.status?.code === 'CLOSED' || (pracas.length > 0 && !pracas.some(d => d >= agora)),
    motivo: null,
  };
}

export function montarRowVeiculo(url, v) {
  return {
    fonte: 'NORDESTE', fonte_id: `nordeste_${(slugDoLote(url).match(/^\d+-\d+/) || [slugDoLote(url)])[0]}`,
    titulo: v.titulo, descricao: v.descricao, marca: v.marca, modelo: v.modelo,
    ano_fabricacao: v.ano_fabricacao, ano_modelo: v.ano_modelo, placa: v.placa, chassi: v.chassi, renavam: v.renavam,
    tipo_veiculo: v.tipo_veiculo, valor_avaliacao: v.valor_avaliacao, valor_minimo: v.valor_minimo,
    cidade: v.cidade, estado: v.estado, link_lote: url, data_leilao: v.data_leilao,
    leiloeiro: v.leiloeiro, modalidade: 'judicial', forma_pagamento: 'a_vista', is_sucata: false,
    status_patio: 'indefinido', status_patio_motivo: 'sem sinal de pátio na ficha (nordeste)',
    ativo: !v.encerrado, atualizado_em: new Date().toISOString(),
  };
}
