/**
 * CURADORIA DE VEÍCULOS DO E-MAIL DE OPORTUNIDADES (23/10, pedido do dono).
 *
 * O e-mail passa a levar 10 imóveis + até 5 veículos. Duas fontes de perfil, nesta ordem:
 *  1. DECLARADO na triagem (perfis.interesse_veiculos / veiculo_finalidade) — vale sempre.
 *  2. APRENDIDO do clique no próprio e-mail (veiculos_email_sinal), para quem não respondeu:
 *     tipo, marca, faixa de preço e se aceita sucata saem do que a pessoa CLICOU. Quem recebe
 *     veículo envio após envio e nunca clica passa a receber menos (nunca zero — sem amostra
 *     não há o que aprender); clicou uma vez, volta ao cheio.
 * Tudo puro e exportado: é a parte que erra calada (mandar sucata a quem quer rodar, ou
 * "aprender" com um clique só), então é ela que os testes exercitam.
 */

export const TIPOS_POR_INTERESSE = {
  carro: ['carro'],
  moto: ['moto'],
  carro_moto: ['carro', 'moto'],
  pesado: ['caminhao', 'van_utilitario', 'onibus'],
};
// Quem não declarou: o que a maioria compra. Ônibus/reboque/máquina só por declaração ou clique.
export const TIPOS_SEM_DECLARACAO = ['carro', 'moto', 'van_utilitario'];

const ROTULO_TIPO = { carro: 'carro', moto: 'moto', caminhao: 'caminhão', van_utilitario: 'utilitário', onibus: 'ônibus' };
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const DIA = 864e5;

/** Maioria simples com ao menos 2 votos — um clique isolado é curiosidade, não preferência. */
function preferido(contagem) {
  const tot = Object.values(contagem).reduce((a, b) => a + b, 0);
  if (tot < 2) return null;
  const [k, n] = Object.entries(contagem).sort((a, b) => b[1] - a[1])[0] || [];
  return n / tot >= 0.5 ? k : null;
}

/**
 * @param {{interesse_veiculos?:string|null, veiculo_finalidade?:string|null}} perfil
 * @param {Array<{sinal:'enviado'|'clique', criado_em:string, veiculo?:{tipo_veiculo,is_sucata,valor_minimo,marca}}>} sinais
 * @param {{limite?:number}} opts
 * @returns {{quantidade:number, tipos:string[], tipoPreferido:string|null, aceitaSucata:boolean,
 *            precoAlvo:number|null, marcaPreferida:string|null, origem:'declarado'|'aprendido'|'teste', nota:string}}
 */
export function perfilVeiculo(perfil, sinais = [], { limite = 5 } = {}) {
  const interesse = perfil?.interesse_veiculos || null;
  const finalidade = perfil?.veiculo_finalidade || null;
  const vazio = { quantidade: 0, tipos: [], tipoPreferido: null, aceitaSucata: false, precoAlvo: null, marcaPreferida: null };
  if (interesse === 'nao') return { ...vazio, origem: 'declarado', nota: 'declarou que não quer veículos' };

  const cliques = sinais.filter(s => s.sinal === 'clique' && s.veiculo);
  const porTipo = {}, porMarca = {};
  let sucataClicada = 0;
  for (const c of cliques) {
    const v = c.veiculo;
    if (v.tipo_veiculo) porTipo[v.tipo_veiculo] = (porTipo[v.tipo_veiculo] || 0) + 1;
    const m = String(v.marca || '').trim().toUpperCase();
    if (m) porMarca[m] = (porMarca[m] || 0) + 1;
    if (v.is_sucata) sucataClicada++;
  }
  const precos = cliques.map(c => num(c.veiculo.valor_minimo)).filter(p => p > 0).sort((a, b) => a - b);
  const precoAlvo = precos.length >= 2 ? precos[Math.floor(precos.length / 2)] : null;
  const tipoPreferido = preferido(porTipo);
  const marcaPreferida = preferido(porMarca);

  if (interesse) {
    return {
      quantidade: limite,
      tipos: TIPOS_POR_INTERESSE[interesse] || TIPOS_SEM_DECLARACAO,
      // Dentro do declarado o clique ainda refina (ex.: declarou carro e moto, só clica moto).
      tipoPreferido: tipoPreferido && (TIPOS_POR_INTERESSE[interesse] || []).includes(tipoPreferido) ? tipoPreferido : null,
      aceitaSucata: finalidade === 'recuperar',
      precoAlvo, marcaPreferida, origem: 'declarado',
      nota: `declarou ${interesse}${finalidade ? `/${finalidade}` : ''}`,
    };
  }

  // NÃO DECLAROU → aprende. Envios contados por DIA (um e-mail leva vários veículos).
  const diasEnviados = new Set(sinais.filter(s => s.sinal === 'enviado').map(s => String(s.criado_em).slice(0, 10)));
  const ultimoClique = cliques.reduce((mx, c) => Math.max(mx, Date.parse(c.criado_em) || 0), 0);
  // Envios SEM resposta = dias de envio depois do último clique (todos, se nunca clicou).
  const semClique = [...diasEnviados].filter(d => Date.parse(d) > ultimoClique).length;
  const quantidade = semClique >= 6 ? 1 : semClique >= 3 ? 2 : limite;
  const tipos = tipoPreferido && !TIPOS_SEM_DECLARACAO.includes(tipoPreferido)
    ? [...TIPOS_SEM_DECLARACAO, tipoPreferido] : TIPOS_SEM_DECLARACAO;
  return {
    quantidade, tipos, tipoPreferido,
    // Sucata só para quem a CLICOU de forma consistente (2+ e metade ou mais dos cliques).
    aceitaSucata: sucataClicada >= 2 && sucataClicada / cliques.length >= 0.5,
    precoAlvo, marcaPreferida,
    origem: cliques.length ? 'aprendido' : 'teste',
    nota: cliques.length ? `${cliques.length} clique(s) em veículo` : `${diasEnviados.size} envio(s) sem clique`,
  };
}

/** O veículo pode entrar no e-mail desta pessoa? (rede de segurança, qualquer que seja a ordem) */
export function veiculoElegivel(v, pv, agora = Date.now()) {
  if (!v || !pv.tipos.includes(v.tipo_veiculo)) return false;
  if (v.is_sucata && !pv.aceitaSucata) return false;
  if (!(num(v.valor_minimo) > 0)) return false;
  if (!Array.isArray(v.fotos) || !v.fotos.length) return false;   // sem foto ninguém clica
  const quando = Date.parse(v.data_leilao);
  return Number.isFinite(quando) && quando > agora;
}

/** Pontua com motivo por extenso (vira a linha "💡" do card, como nos imóveis). */
export function pontuarVeiculo(v, pv, ctx = {}, agora = Date.now()) {
  let pts = 0;
  const motivos = [];
  const desc = num(v.desconto_fipe_percentual) || 0;
  pts += Math.min(Math.max(desc, 0), 60) / 60 * 40;
  if (desc >= 20) motivos.push({ f: desc + 50, t: `${Math.round(desc)}% abaixo da FIPE` });
  if (ctx.uf && v.estado && String(v.estado).toUpperCase() === String(ctx.uf).toUpperCase()) {
    pts += 15;
    const naCidade = ctx.cidade && String(v.cidade || '').toLowerCase() === String(ctx.cidade).toLowerCase();
    if (naCidade) pts += 8;
    motivos.push({ f: 80, t: naCidade ? 'na sua cidade' : `em ${v.estado}, seu estado` });
  }
  if (pv.tipoPreferido && v.tipo_veiculo === pv.tipoPreferido) {
    pts += 12; motivos.push({ f: 70, t: `${ROTULO_TIPO[v.tipo_veiculo] || v.tipo_veiculo}, o que você mais tem aberto` });
  }
  if (pv.marcaPreferida && String(v.marca || '').toUpperCase() === pv.marcaPreferida) {
    pts += 8; motivos.push({ f: 65, t: `${v.marca}, marca que você tem olhado` });
  }
  const p = num(v.valor_minimo);
  if (pv.precoAlvo && p) {
    const r = p / pv.precoAlvo;
    if (r >= 0.5 && r <= 1.6) { pts += 8; motivos.push({ f: 60, t: 'na faixa de preço que você clica' }); }
    else if (r > 3 || r < 0.2) pts -= 8;
  }
  const ano = num(v.ano_modelo) || num(v.ano_fabricacao);
  const anoAtual = new Date(agora).getFullYear();
  if (ano) pts += Math.max(0, 1 - (anoAtual - ano) / 15) * 8;
  if (ano && anoAtual - ano <= 5) motivos.push({ f: 55, t: `${ano}, seminovo` });
  if (v.is_sucata) motivos.push({ f: 90, t: 'sucata — para recuperar ou peças' });
  else if (v.sinistro) motivos.push({ f: 85, t: `atenção: ${String(v.sinistro).toLowerCase()}` });
  const dias = (Date.parse(v.data_leilao) - agora) / DIA;
  if (dias >= 2 && dias <= 14) pts += 5;
  if (dias < 2) pts -= 4;   // sem tempo de olhar o lote
  if (!desc && !num(v.valor_fipe)) pts -= 10;   // sem FIPE o e-mail não tem o argumento principal
  motivos.sort((a, b) => b.f - a.f);
  return { pontos: Math.round(pts * 10) / 10, motivos: motivos.map(m => m.t) };
}

/**
 * Escolhe até `pv.quantidade`, sem repetir o já enviado, com variedade: no máximo 2 do mesmo
 * modelo e, sem preferência aprendida, ao menos um de cada tipo quando houver.
 */
export function selecionarVeiculos(candidatos, pv, ctx = {}, jaEnviados = new Set(), agora = Date.now()) {
  if (!pv.quantidade) return [];
  const pont = candidatos
    .filter(v => !jaEnviados.has(v.id) && veiculoElegivel(v, pv, agora))
    .map(v => ({ v, ...pontuarVeiculo(v, pv, ctx, agora) }))
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
