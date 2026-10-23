/**
 * CURADORIA DE VEÍCULOS DO E-MAIL DE OPORTUNIDADES (23/10, regras do dono).
 *
 * - O e-mail leva 10 imóveis + até 5 veículos para quem RESPONDEU o questionário com interesse
 *   (perfis.interesse_veiculos = 'sim', veiculo_tipos, veiculo_faixa_fipe).
 * - Quem não respondeu não recebe veículo — exceto se já CLICOU em 2+ veículos (no comunicado ou no
 *   site pelo e-mail): aí o interesse está demonstrado e tipo/faixa saem dos cliques.
 * - LOCALIZAÇÃO NÃO PESA: o veículo está no pátio do leiloeiro e o comprador paga só o frete, então
 *   um carro em outro estado vale o mesmo que um na cidade dele. O que pesa é a INTENÇÃO (tipo e
 *   faixa de FIPE) e o desconto sobre a FIPE.
 * - Só veículo com pátio CONFIRMADO (é a promessa do comunicado) e nunca sucata — não há pergunta
 *   que autorize sucata ainda.
 * Tudo puro e exportado: é a parte que erra calada, então é ela que os testes exercitam.
 */

export const TIPOS_VEICULO = ['carro', 'moto', 'caminhao', 'van_utilitario', 'onibus', 'maquina'];
export const TIPOS_PADRAO = ['carro', 'moto'];
// Teto de FIPE por faixa; a "faixa ideal" é da metade do teto até ele (abaixo disso ainda entra,
// com menos pontos — mesmo raciocínio do imóvel: R$ 20 mil para quem quer até R$ 150 mil não é o alvo).
export const TETO_FIPE = { ate_50k: 50000, ate_100k: 100000, ate_150k: 150000, acima_150k: null };
const PISO_ACIMA = 150000;

const ROTULO_TIPO = { carro: 'carro', moto: 'moto', caminhao: 'caminhão', van_utilitario: 'utilitário', onibus: 'ônibus', maquina: 'máquina' };
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
/** Valor de referência do veículo: FIPE quando houver; sem ela, o lance mínimo (piso conservador). */
export const refValor = (v) => num(v?.valor_fipe) || num(v?.valor_minimo) || null;

export function faixaDoValor(valor) {
  if (!(valor > 0)) return null;
  if (valor <= 50000) return 'ate_50k';
  if (valor <= 100000) return 'ate_100k';
  if (valor <= 150000) return 'ate_150k';
  return 'acima_150k';
}

/** Maioria simples com ao menos 2 votos — um clique isolado é curiosidade, não preferência. */
function preferido(contagem) {
  const tot = Object.values(contagem).reduce((a, b) => a + b, 0);
  if (tot < 2) return null;
  const [k, n] = Object.entries(contagem).sort((a, b) => b[1] - a[1])[0] || [];
  return n / tot >= 0.5 ? k : null;
}

/**
 * @param {{interesse_veiculos?, veiculo_tipos?, veiculo_faixa_fipe?}} perfil
 * @param {Array<{sinal:'enviado'|'clique', criado_em, veiculo?:{tipo_veiculo,valor_fipe,valor_minimo,marca}}>} sinais
 * @returns {{quantidade, tipos, faixa, tipoPreferido, marcaPreferida, origem, nota}}
 */
export function perfilVeiculo(perfil, sinais = [], { limite = 5 } = {}) {
  const nenhum = (nota, origem = 'declarado') => ({ quantidade: 0, tipos: [], faixa: null, tipoPreferido: null, marcaPreferida: null, origem, nota });
  if (perfil?.interesse_veiculos === 'nao') return nenhum('declarou que não quer veículos');

  const cliques = sinais.filter(s => s.sinal === 'clique' && s.veiculo);
  const porTipo = {}, porMarca = {}, porFaixa = {};
  for (const { veiculo: v } of cliques) {
    if (v.tipo_veiculo) porTipo[v.tipo_veiculo] = (porTipo[v.tipo_veiculo] || 0) + 1;
    const m = String(v.marca || '').trim().toUpperCase();
    if (m) porMarca[m] = (porMarca[m] || 0) + 1;
    const f = faixaDoValor(refValor(v));
    if (f) porFaixa[f] = (porFaixa[f] || 0) + 1;
  }
  const tipoPreferido = preferido(porTipo);
  const marcaPreferida = preferido(porMarca);

  if (perfil?.interesse_veiculos === 'sim') {
    const tipos = (Array.isArray(perfil.veiculo_tipos) ? perfil.veiculo_tipos : []).filter(t => TIPOS_VEICULO.includes(t));
    const tiposOk = tipos.length ? tipos : TIPOS_PADRAO;
    return {
      quantidade: limite, tipos: tiposOk,
      faixa: TETO_FIPE[perfil.veiculo_faixa_fipe] !== undefined ? perfil.veiculo_faixa_fipe : null,
      // Dentro do declarado o clique ainda refina (declarou carro e moto, só clica moto).
      tipoPreferido: tipoPreferido && tiposOk.includes(tipoPreferido) ? tipoPreferido : null,
      marcaPreferida, origem: 'declarado',
      nota: `declarou ${tiposOk.join('+')}${perfil.veiculo_faixa_fipe ? ` · ${perfil.veiculo_faixa_fipe}` : ''}`,
    };
  }

  // Não respondeu: só com interesse DEMONSTRADO (2+ cliques em veículo).
  if (cliques.length < 2) return nenhum(`não respondeu · ${cliques.length} clique(s) em veículo`, 'sem_interesse');
  const tipos = Object.keys(porTipo).filter(t => TIPOS_VEICULO.includes(t));
  return {
    quantidade: limite, tipos: tipos.length ? tipos : TIPOS_PADRAO,
    faixa: preferido(porFaixa), tipoPreferido, marcaPreferida, origem: 'aprendido',
    nota: `${cliques.length} cliques em veículo`,
  };
}

/** O veículo pode entrar no e-mail desta pessoa? (rede de segurança, qualquer que seja a ordem) */
export function veiculoElegivel(v, pv, agora = Date.now()) {
  if (!v || !pv.tipos.includes(v.tipo_veiculo)) return false;
  if (v.is_sucata) return false;
  if (v.status_patio && v.status_patio !== 'confirmado') return false;
  if (!(num(v.valor_minimo) > 0)) return false;
  if (!Array.isArray(v.fotos) || !v.fotos.length) return false;   // sem foto ninguém clica
  const quando = Date.parse(v.data_leilao);
  if (!Number.isFinite(quando) || quando <= agora) return false;
  if (pv.faixa) {
    const ref = refValor(v);
    const teto = TETO_FIPE[pv.faixa];
    if (teto && ref > teto * 1.1) return false;                       // acima do que a pessoa disse que quer
    if (pv.faixa === 'acima_150k' && ref < PISO_ACIMA * 0.8) return false;
  }
  return true;
}

/** Pontua com motivo por extenso (vira a linha "💡" do card, como nos imóveis). */
export function pontuarVeiculo(v, pv, agora = Date.now()) {
  let pts = 0;
  const motivos = [];
  const desc = num(v.desconto_fipe_percentual) || 0;
  pts += Math.min(Math.max(desc, 0), 60) / 60 * 40;
  if (desc >= 15) motivos.push({ f: desc + 50, t: `${Math.round(desc)}% abaixo da FIPE` });
  if (pv.faixa) {
    const ref = refValor(v);
    const teto = TETO_FIPE[pv.faixa];
    if (teto ? ref >= teto * 0.5 : ref >= PISO_ACIMA) { pts += 15; motivos.push({ f: 75, t: 'na faixa de FIPE que você procura' }); }
  }
  if (pv.tipoPreferido && v.tipo_veiculo === pv.tipoPreferido) {
    pts += 10; motivos.push({ f: 70, t: `${ROTULO_TIPO[v.tipo_veiculo] || v.tipo_veiculo}, o que você mais tem aberto` });
  }
  if (pv.marcaPreferida && String(v.marca || '').toUpperCase() === pv.marcaPreferida) {
    pts += 8; motivos.push({ f: 65, t: `${v.marca}, marca que você tem olhado` });
  }
  const ano = num(v.ano_modelo) || num(v.ano_fabricacao);
  const anoAtual = new Date(agora).getFullYear();
  if (ano) pts += Math.max(0, 1 - (anoAtual - ano) / 15) * 8;
  if (ano && anoAtual - ano <= 5) motivos.push({ f: 55, t: `${ano}, seminovo` });
  if (v.sinistro) motivos.push({ f: 85, t: `atenção: ${String(v.sinistro).toLowerCase()}` });
  motivos.push({ f: 40, t: 'no pátio do leiloeiro' });
  const dias = (Date.parse(v.data_leilao) - agora) / 864e5;
  if (dias >= 2 && dias <= 14) pts += 5;
  if (dias < 2) pts -= 4;   // sem tempo de olhar o lote
  if (!num(v.valor_fipe)) pts -= 10;   // sem FIPE o e-mail perde o argumento principal
  motivos.sort((a, b) => b.f - a.f);
  return { pontos: Math.round(pts * 10) / 10, motivos: motivos.map(m => m.t) };
}

/**
 * Escolhe até `pv.quantidade`, sem repetir o já enviado, com variedade: no máximo 2 do mesmo
 * modelo e, sem preferência aprendida, ao menos um de cada tipo declarado quando houver.
 */
export function selecionarVeiculos(candidatos, pv, jaEnviados = new Set(), agora = Date.now()) {
  if (!pv.quantidade) return [];
  const pont = candidatos
    .filter(v => !jaEnviados.has(v.id) && veiculoElegivel(v, pv, agora))
    .map(v => ({ v, ...pontuarVeiculo(v, pv, agora) }))
    .sort((a, b) => b.pontos - a.pontos);
  const out = [];
  const porModelo = {};
  const chaveModelo = (v) => `${v.marca || ''}|${v.modelo || v.titulo || ''}`.toLowerCase();
  const cabe = (c) => (porModelo[chaveModelo(c.v)] || 0) < 2;
  const pega = (c) => { out.push(c); porModelo[chaveModelo(c.v)] = (porModelo[chaveModelo(c.v)] || 0) + 1; };
  if (!pv.tipoPreferido && pv.quantidade >= pv.tipos.length) {
    for (const t of pv.tipos) { const c = pont.find(x => x.v.tipo_veiculo === t && !out.includes(x) && cabe(x)); if (c) pega(c); }
  }
  for (const c of pont) { if (out.length >= pv.quantidade) break; if (!out.includes(c) && cabe(c)) pega(c); }
  return out.sort((a, b) => b.pontos - a.pontos).slice(0, pv.quantidade);
}

/**
 * Consulta PostgREST do pool de candidatos para um perfil — NACIONAL (sem estado), pátio
 * confirmado, sem sucata, lance dentro do teto da faixa. Uma por combinação tipos×faixa (cache
 * no chamador). O lance fica abaixo da FIPE, então o teto vale para ele também.
 */
export function consultaPoolVeiculos(pv, agoraIso = new Date().toISOString()) {
  const tipos = [...pv.tipos].sort();
  const teto = pv.faixa ? TETO_FIPE[pv.faixa] : null;
  const faixaQs = teto ? `&valor_minimo=lte.${Math.round(teto * 1.1)}`
    : pv.faixa === 'acima_150k' ? `&valor_minimo=gte.${Math.round(PISO_ACIMA * 0.4)}` : '';
  return {
    chave: `${tipos.join(',')}|${pv.faixa || '*'}`,
    qs: `veiculos_leilao?ativo=eq.true&status_patio=eq.confirmado&data_leilao=gt.${agoraIso}&valor_minimo=gt.0`
      + `&tipo_veiculo=in.(${tipos.join(',')})&or=(is_sucata.is.null,is_sucata.is.false)${faixaQs}`
      + '&order=desconto_fipe_percentual.desc.nullslast&limit=300'
      + '&select=id,tipo_veiculo,marca,modelo,titulo,ano_modelo,ano_fabricacao,valor_minimo,valor_fipe,desconto_fipe_percentual,capa:fotos->>0,data_leilao,estado,cidade,is_sucata,sinistro,status_patio',
  };
}
