/**
 * VEÍCULO A PARTIR DO LOTE LIDO PELO MOTOR (21/10, pedido do dono: "faça todos os veículos").
 *
 * A varredura de 21/10 achou ~3.000 veículos à venda em ~25 fontes e ZERO no acervo: o motor de
 * imóveis buscava e lia cada lote e só NO FIM descartava o que não é imóvel (`naoEhImovel`). Em vez
 * de um parser por plataforma, o coletor de veículos (scraper-veiculos-motor.mjs) usa o MESMO
 * `parseDetalhe`/`montarRow` da fonte e esta função converte a linha de imóvel na de veículo.
 *
 * Regras que valem para todo coletor de veículo (as mesmas do NORDESTE/Astavero):
 *  · pátio pelo classificador ÚNICO (lib/patio-veiculo.mjs); sem ficha lida, `indefinido` com o
 *    motivo dizendo que NÃO leu (não inventa "sem sinal de pátio");
 *  · bem com o executado/devedor (`excluido`) nunca é gravado — quem chama descarta;
 *  · só veículo INTEIRO: sucata, peça, carcaça e máquina ficam de fora (decisão de 30/09).
 * Puro, sem rede: `npm run testar:veiculo-do-lote`.
 */
import { classificarPatio } from './patio-veiculo.mjs';
import { tipoVeiculo, marcaModeloAno, RE_MARCA } from './nordeste-veiculo.mjs';

// É veículo? Palavra de tipo, documento de veículo, ou "MARCA modelo" de marca conhecida no começo.
const RE_PALAVRA_VEICULO = /\b(ve[íi]culo|autom[óo]vel|carro|motocicleta|motoneta|ciclomotor|moto|caminh[ãa]o|caminhonete|camioneta|[ôo]nibus|micro-?[ôo]nibus|utilit[áa]rio|furg[ãa]o|reboque|semi-?reboque|carreta|placa\s*:?\s*[a-z]{3}-?\d|chassi|renavam)\b/i;
// Não é veículo inteiro (fica fora mesmo com marca no título).
const RE_NAO_VEICULO = /\b(sucata|carca[çc]a|pe[çc]as?\s+(avulsas|usadas|diversas)|lote\s+de\s+pe[çc]as|trator|colheitadeira|empilhadeira|retroescavadeira|escavadeira|motoniveladora|p[áa]\s+carregadeira|m[áa]quina|equipamento|implemento|embarca[çc][ãa]o|barco|lancha|jet-?ski|aeronave|avi[ãa]o|helic[óo]ptero|bicicleta|patinete|gerador|compressor)\b/i;
const RE_IMOVEL_FORTE = /\b(im[óo]vel|terreno|apartamento|matr[íi]cula\s+n|casa\s+(t[ée]rrea|residencial)|sala\s+comercial|galp[ãa]o|fazenda|ch[áa]cara|s[íi]tio)\b/i;

export function ehVeiculoInteiro(titulo, descricao = '') {
  const t = String(titulo || '');
  const tudo = `${t} ${String(descricao || '').slice(0, 600)}`;
  if (RE_NAO_VEICULO.test(t) || RE_IMOVEL_FORTE.test(t)) return false;
  if (RE_PALAVRA_VEICULO.test(tudo)) return true;
  const primeira = (t.replace(/^[^A-Za-zÀ-ÿ]+/, '').match(/^([A-Za-z.]+)/) || [])[1] || '';
  return RE_MARCA.test(primeira) || !!marcaModeloAno(t).marca;
}

// "YYYY-MM-DD" (data_leilao de imoveis_leilao é texto) ou ISO → timestamptz de veiculos_leilao.
function dataParaTimestamp(v) {
  if (!v) return null;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T12:00:00-03:00`;
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString();
}

// marcaModeloAno (NORDESTE) espera "MARCA/MODELO" e o par "AAAA/AAAA". Nas outras plataformas vem
// "AUTOMÓVEL CHEVROLET PRISMA 10MT JOYE, ANO 2018" — marca no meio, ano único. Completa o que faltou.
function marcaAnoDoTitulo(titulo) {
  const r = marcaModeloAno(titulo);
  if (!r.marca) {
    const palavras = titulo.replace(/[^A-Za-zÀ-ÿ0-9./ -]/g, ' ').split(/[\s/]+/).slice(0, 6);
    const i = palavras.findIndex((p) => RE_MARCA.test(p));
    if (i >= 0) {
      r.marca = palavras[i].toUpperCase().replace(/^M\.?\s*BENZ$/, 'MERCEDES-BENZ').replace(/^VW$/, 'VOLKSWAGEN').replace(/^GM$/, 'CHEVROLET');
      r.modelo = palavras.slice(i + 1).join(' ').split(/,/)[0].trim().slice(0, 80) || r.modelo;
    }
  }
  if (!r.ano_modelo) {
    const a = titulo.match(/\bano\s*:?\s*((?:19[5-9]|20[0-4])\d)\b/i);
    if (a) r.ano_modelo = r.ano_fabricacao = Number(a[1]);
  }
  return r;
}

const RE_PLACA = /\bPLACA(?:\s+POLICIAL)?\s*:?\s*([A-Z]{3}-?\d[A-Z0-9]\d{2})\b/i;
const RE_CHASSI = /\bCHASSI\s*:?\s*([A-HJ-NPR-Z0-9]{17})\b/i;
const RE_RENAVAM = /\bRENAVAM\s*:?\s*(\d{9,11})\b/i;
const RE_KM = /\b(?:km|quilometragem|hod[ôo]metro)\s*:?\s*([\d.]{1,9})\b/i;

/**
 * row  = linha de imóvel montada pelo `montarRow` da fonte (titulo, descricao, valores, cidade…)
 * id   = id do lote na fonte (o mesmo do imóvel) · fonte = rótulo da fonte (ex.: 'FREITAS')
 * Devolve { row } pronto para `veiculos_leilao`, ou { motivo } explicando por que ficou fora.
 */
export function veiculoDoLote(row, { id, fonte }) {
  if (!row) return { motivo: 'lote sem leitura' };
  // "1 (UM) AUTOMÓVEL CHEVROLET PRISMA…" (SOLEON): a quantidade no começo esconde tipo e marca.
  const titulo = String(row.titulo || '').replace(/\s+/g, ' ').trim().replace(/^\d+\s*\(\s*[a-zà-ú]+\s*\)\s*/i, '').slice(0, 180);
  const descricao = String(row.descricao || '').replace(/\s+/g, ' ').trim();
  if (!ehVeiculoInteiro(titulo, descricao)) return { motivo: 'não é veículo inteiro' };
  const vMin = Number(row.valor_minimo) || 0, vAval = Number(row.valor_avaliacao) || 0;
  if (!vMin && !vAval) return { motivo: 'sem valor' };
  const texto = `${titulo} ${descricao}`;
  // A ficha só conta como lida se tem mais que o título (mesmo cuidado do NORDESTE, 07/10).
  const fichaLida = descricao && descricao.length > titulo.length + 40;
  const patio = fichaLida ? classificarPatio(descricao)
    : { status: 'indefinido', motivo: `ficha do lote não lida — pátio não classificado (${fonte.toLowerCase()})` };
  const placa = (texto.match(RE_PLACA) || [])[1];
  const chassi = (texto.match(RE_CHASSI) || [])[1];
  const km = Number(String((texto.match(RE_KM) || [])[1] || '').replace(/\./g, '')) || null;
  const fotos = Array.isArray(row.fotos) && row.fotos.length ? row.fotos : (row.link_foto ? [row.link_foto] : null);
  const out = {
    fonte, fonte_id: `${fonte.toLowerCase()}_veic_${id}`,
    leiloeiro: row.leiloeiro || null, titulo: titulo || `Veículo ${fonte} ${id}`, descricao: (descricao || titulo).slice(0, 8000),
    ...marcaAnoDoTitulo(titulo), tipo_veiculo: tipoVeiculo(titulo),
    placa: placa ? placa.replace('-', '').toUpperCase() : null, chassi: chassi ? chassi.toUpperCase() : null,
    renavam: (texto.match(RE_RENAVAM) || [])[1] || null, km: km && km < 2_000_000 ? km : null,
    valor_minimo: vMin || vAval, valor_avaliacao: vAval || null,
    desconto_percentual: vAval > 0 && vMin > 0 && vMin < vAval ? Math.round((1 - vMin / vAval) * 100) : null,
    cidade: row.cidade || null, estado: /^[A-Z]{2}$/.test(row.estado || '') ? row.estado : null,
    link_lote: row.url_lote || null, data_leilao: dataParaTimestamp(row.data_leilao_2 || row.data_leilao),
    modalidade: row.modalidade || null, forma_pagamento: row.forma_pagamento || 'a_vista',
    is_sucata: false, status_patio: patio.status, status_patio_motivo: patio.motivo,
    ativo: true, atualizado_em: new Date().toISOString(),
  };
  // Só manda o que leu: num upsert em grupo, coluna ausente não apaga a gravada (fotos/anexos).
  if (fotos) out.fotos = fotos;
  if (Array.isArray(row.anexos) && row.anexos.length) out.anexos = row.anexos;
  if (patio.status === 'excluido') return { motivo: 'bem com o executado/devedor — nunca gravado', row: out };
  return { row: out };
}
