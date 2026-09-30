/**
 * PREVISÃO DO ANDAMENTO (30/09, dono: "estimativa entre cada despacho do juiz… em quanto tempo deve
 * sair a próxima movimentação… probabilidade de acordo com o fluxo jurídico").
 *
 * Nada aqui é palpite de IA. Três fontes, cada uma dita por extenso no retorno:
 *   1. RITMO DO PRÓPRIO PROCESSO — intervalos entre os dias com movimentação (DataJud + DJEN);
 *   2. BASE DA PLATAFORMA — `processo_fluxo_estatistica()` sobre a série real que o monitor grava
 *      (109 processos em 30/09): o que costuma vir depois de cada ato e em quantos dias, por Justiça;
 *   3. PRAZO LEGAL — etapas da arrematação com o artigo do CPC (não é probabilidade, é regra).
 * Amostra pequena não vira número (n < 5 → a linha não aparece). Puro, exceto `estatisticaFluxo`.
 */
const DIA = 86400000;

export const ROTULO_CLASSE = {
  conclusao: 'autos conclusos ao juiz', decisao: 'decisão/despacho do juiz', publicacao: 'publicação/intimação',
  peticao: 'petição das partes', prazo: 'fim de prazo (decurso)', expedicao: 'expedição de mandado/carta/ofício',
  remessa: 'remessa dos autos', ato_ordinatorio: 'ato da secretaria', encerramento: 'baixa/trânsito em julgado', outro: 'outro ato',
};

// Espelho de public.movimento_classe (SQL) — os dois lados precisam classificar igual.
export function classeMovimento(codigo, descricao) {
  const c = Number(codigo) || null, d = String(descricao || '');
  if ([51, 15101].includes(c) || /^conclus/i.test(d)) return 'conclusao';
  if ([22, 848, 246].includes(c) || /baixa defini|tr[âa]nsito em julgado|arquivamento defini/i.test(d)) return 'encerramento';
  if ([12164, 11010, 12185, 193, 12444, 219, 898, 12266, 220, 11009, 11021].includes(c)
    || /decis[ãa]o|despacho|mero expediente|julgament|senten[çc]a|deferi|indeferi|homolog|proced[eê]n/i.test(d)) return 'decisao';
  if ([92, 1061, 928].includes(c) || /publica[çc][ãa]o|disponibiliza[çc][ãa]o no di[áa]rio/i.test(d)) return 'publicacao';
  if (c === 1051 || /decurso de prazo/i.test(d)) return 'prazo';
  if ([85, 118].includes(c) || /peti[çc][ãa]o/i.test(d)) return 'peticao';
  if ([60, 12265, 12282, 106].includes(c) || /expedi|mandado|carta/i.test(d)) return 'expedicao';
  if ([123, 982, 132].includes(c) || /remessa|recebimento/i.test(d)) return 'remessa';
  if (c === 11383 || /ato ordinat/i.test(d)) return 'ato_ordinatorio';
  return 'outro';
}

export function justicaDoNumero(numero) {
  const d = String(numero || '').replace(/\D/g, '');
  return { 8: 'estadual', 5: 'trabalho', 4: 'federal' }[d[13]] || 'outra';
}

const quantil = (ord, q) => ord[Math.min(ord.length - 1, Math.max(0, Math.round(q * (ord.length - 1))))];
const soData = (x) => String(x || '').slice(0, 10);
const somaDias = (iso, dias) => new Date(new Date(`${iso}T12:00:00Z`).getTime() + dias * DIA).toISOString().slice(0, 10);

// Intervalos (dias > 0) entre DIAS com movimentação; os mais recentes pesam (últimos 15).
export function ritmo(datas) {
  const dias = [...new Set((datas || []).map(soData).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)))].sort();
  const iv = [];
  for (let i = 1; i < dias.length; i++) iv.push(Math.round((Date.parse(dias[i]) - Date.parse(dias[i - 1])) / DIA));
  const recentes = iv.filter((x) => x > 0).slice(-15);
  if (recentes.length < 4) return { n: recentes.length, ultimo: dias[dias.length - 1] || null };
  const ord = [...recentes].sort((a, b) => a - b);
  return { n: recentes.length, p25: quantil(ord, 0.25), mediana: quantil(ord, 0.5), p75: quantil(ord, 0.75), ultimo: dias[dias.length - 1] };
}

// Etapa da ARREMATAÇÃO lida dos textos (movimentos + publicações). Prazo legal, não probabilidade.
const ETAPAS = [
  { re: /imiss[ãa]o na posse|mandado de imiss|imitid[oa] na posse/i, etapa: 'imissão na posse', proximo: 'Cumprimento do mandado de imissão pelo oficial de justiça; com a posse, o arrematante assume o imóvel.', base: 'CPC, art. 901, §1º' },
  { re: /carta de arremata/i, etapa: 'carta de arrematação', proximo: 'Registrar a carta no Cartório de Registro de Imóveis (transfere a propriedade) e, se ocupado, pedir/cumprir a imissão na posse.', base: 'CPC, art. 901, §2º; Lei 6.015/73' },
  { re: /embargos?\s+(à|a)\s+arremata|impugna[çc][ãa]o\s+(à|a|da)\s+arremata|a[çc][ãa]o anulat[óo]ria/i, etapa: 'impugnação da arrematação', proximo: 'O juiz decide a impugnação; a carta só é expedida depois. Enquanto isso a arrematação segue válida, salvo decisão suspendendo.', base: 'CPC, art. 903, §§2º a 4º' },
  { re: /auto de arremata/i, etapa: 'auto de arrematação', proximo: 'Assinado o auto, a arrematação é perfeita e irretratável. Há 10 dias para eventual impugnação; depois, com o preço e a comissão pagos, expede-se a carta de arrematação e o mandado de imissão.', base: 'CPC, arts. 901 e 903, §2º' },
  { re: /arremata[çc][ãa]o|arrematad[oa]|lance vencedor|leil[ãa]o positivo/i, etapa: 'arrematação realizada', proximo: 'Lavratura e assinatura do auto de arrematação (juiz, leiloeiro e arrematante), após o depósito do lance/sinal.', base: 'CPC, arts. 901 e 903' },
];
export function etapaDaArrematacao(textos) {
  const t = (textos || []).map((x) => String(x || '')).join(' \n ');
  for (const e of ETAPAS) if (e.re.test(t)) return { etapa: e.etapa, proximo: e.proximo, base_legal: e.base };
  return null;
}

/**
 * @param {{movimentos: Array<{data,descricao,codigo}>, publicacoes?: Array<{data_disponibilizacao,texto,tipo_documento}>,
 *          estat?: Array<{de,para,n,prob,p25,mediana,p75}>, hoje?: string}} p
 */
export function preverAndamento({ movimentos = [], publicacoes = [], estat = [], hoje = new Date().toISOString().slice(0, 10), justica = null }) {
  const movs = (movimentos || []).filter((m) => m?.data)
    .map((m) => ({ data: soData(m.data), descricao: m.descricao || '', classe: classeMovimento(m.codigo, m.descricao) }))
    .sort((a, b) => b.data.localeCompare(a.data));
  const pubs = (publicacoes || []).filter((p) => p?.data_disponibilizacao)
    .map((p) => ({ data: soData(p.data_disponibilizacao), descricao: `Publicação${p.tipo_documento ? ` (${p.tipo_documento})` : ''}`, classe: 'publicacao' }));
  const eventos = [...movs, ...pubs].sort((a, b) => b.data.localeCompare(a.data));
  if (!eventos.length) {
    // Fontes fora (DataJud/DJEN instáveis, 30/09 à noite) ou processo sem movimentação lida: ainda dá
    // para mostrar a REFERÊNCIA da base — dita como tal — em vez de sumir com o card.
    const eb = (estat || []).find((x) => x.de === 'decisao' && x.para === 'decisao_seguinte' && Number(x.n) >= 5);
    const cb = (estat || []).find((x) => x.de === 'conclusao' && x.para === 'decisao_seguinte' && Number(x.n) >= 5);
    if (!eb && !cb) return { disponivel: false, motivo: 'sem movimentações com data para calcular' };
    return {
      disponivel: true, so_referencia: true, justica, status: null,
      entre_despachos: eb ? { n: eb.n, p25: eb.p25, mediana: eb.mediana, p75: eb.p75, fonte: 'base da plataforma' } : null,
      proximo_despacho: null, proxima_janela: null, fluxo_provavel: [], etapa_arrematacao: null, ultimo_ato: null,
      resumo: `Não consegui ler as movimentações deste processo agora. Referência da base da plataforma${justica ? ` (Justiça ${justica})` : ''}: ${eb ? `o juiz despacha em média a cada ${eb.mediana} dias (metade entre ${eb.p25} e ${eb.p75})` : ''}${eb && cb ? '; ' : ''}${cb ? `com os autos conclusos, a decisão sai em ~${cb.mediana} dias` : ''}.`,
      aviso: 'Referência geral, não do seu processo — consulte de novo quando o CNJ responder para a previsão deste processo.',
    };
  }

  const ultimo = eventos.find((e) => e.classe !== 'outro') || eventos[0];
  const diasDesde = Math.max(0, Math.round((Date.parse(hoje) - Date.parse(eventos[0].data)) / DIA));
  const proprio = ritmo(eventos.map((e) => e.data));
  const despachos = ritmo(movs.filter((m) => m.classe === 'decisao').map((m) => m.data));
  const linha = (de, para) => (estat || []).find((x) => x.de === de && x.para === para && Number(x.n) >= 5) || null;

  // Janela da próxima movimentação: ritmo do próprio processo (≥ 4 intervalos); senão, a base.
  let janela = null;
  if (proprio.mediana != null) {
    janela = { de: somaDias(eventos[0].data, proprio.p25), ate: somaDias(eventos[0].data, proprio.p75), mediana_dias: proprio.mediana, fonte: `ritmo deste processo (${proprio.n} intervalos recentes)` };
  } else {
    const alvo = ultimo.classe === 'conclusao' ? linha('conclusao', 'decisao_seguinte')
      : [...(estat || [])].filter((x) => x.de === ultimo.classe && x.para !== 'decisao_seguinte' && Number(x.n) >= 5).sort((a, b) => Number(b.n) - Number(a.n))[0];
    if (alvo) janela = { de: somaDias(eventos[0].data, alvo.p25), ate: somaDias(eventos[0].data, Math.max(alvo.p75, 1)), mediana_dias: alvo.mediana, fonte: `base da plataforma (${alvo.n} casos${justica ? `, Justiça ${justica}` : ''})` };
  }
  const atrasado = !!(janela && hoje > janela.ate);

  // PRÓXIMO DESPACHO DO JUIZ (o que o dono quer saber): último ato do juiz + intervalo típico entre
  // despachos (deste processo; senão da base). A janela de "qualquer movimentação" é dominada por atos
  // de secretaria (medido 30/09: mediana de 2 dias num TJSP com 60 movimentos) — vem depois.
  const entreDespachosBase = linha('decisao', 'decisao_seguinte');
  const entre = despachos.mediana != null ? { ...despachos, fonte: 'este processo' }
    : entreDespachosBase ? { n: entreDespachosBase.n, p25: entreDespachosBase.p25, mediana: entreDespachosBase.mediana, p75: entreDespachosBase.p75, fonte: 'base da plataforma' } : null;
  const ultDecisao = movs.find((m) => m.classe === 'decisao');
  const proximoDespacho = entre && ultDecisao ? {
    ultimo: ultDecisao.data, de: somaDias(ultDecisao.data, entre.p25), ate: somaDias(ultDecisao.data, Math.max(entre.p75, 1)),
    dias_desde: Math.max(0, Math.round((Date.parse(hoje) - Date.parse(ultDecisao.data)) / DIA)), fonte: entre.fonte,
  } : null;
  if (proximoDespacho) proximoDespacho.atrasado = hoje > proximoDespacho.ate;

  // Status coerente com as janelas (antes: selo "andando" ao lado de "já era esperada até…").
  const muitoParado = diasDesde > Math.max(90, (proprio.mediana || 30) * 3)
    || (proximoDespacho?.atrasado && proximoDespacho.dias_desde > Math.max(90, 2 * (entre?.p75 || 45)));
  const status = muitoParado ? 'parado' : (atrasado || proximoDespacho?.atrasado) ? 'lento' : 'andando';

  const fluxo = (estat || []).filter((x) => x.de === ultimo.classe && x.para !== 'decisao_seguinte' && Number(x.n) >= 5 && x.prob != null)
    .sort((a, b) => Number(b.prob) - Number(a.prob)).slice(0, 4)
    .map((x) => ({ proximo: ROTULO_CLASSE[x.para] || x.para, probabilidade: Math.round(Number(x.prob) * 100), mediana_dias: x.mediana, p25: x.p25, p75: x.p75, n: x.n }));
  const conclusoBase = linha('conclusao', 'decisao_seguinte');
  const etapa = etapaDaArrematacao([...movs.map((m) => m.descricao), ...(publicacoes || []).map((p) => p.texto)]);

  const frases = [];
  if (proximoDespacho) frases.push(proximoDespacho.atrasado
    ? `O juiz costuma despachar a cada ~${entre.mediana} dias (${entre.fonte}); o último despacho foi em ${proximoDespacho.ultimo}, há ${proximoDespacho.dias_desde} dias — ACIMA do normal${status === 'parado' ? ' (processo parado)' : ''}; vale cobrar a secretaria.`
    : `Próximo despacho do juiz esperado entre ${proximoDespacho.de} e ${proximoDespacho.ate} (o juiz costuma despachar a cada ~${entre.mediana} dias — ${entre.fonte}; último em ${proximoDespacho.ultimo}).`);
  else if (entre) frases.push(`Entre um despacho e outro do juiz, a mediana é de ${entre.mediana} dias (metade entre ${entre.p25} e ${entre.p75}; ${entre.fonte}).`);
  frases.push(`Último ato: ${ROTULO_CLASSE[ultimo.classe] || ultimo.descricao} em ${ultimo.data} (há ${diasDesde} dia${diasDesde === 1 ? '' : 's'}).`);
  if (janela && !atrasado) frases.push(`Alguma movimentação (inclusive da secretaria) é provável entre ${janela.de} e ${janela.ate} (${janela.fonte}).`);
  if (ultimo.classe === 'conclusao' && conclusoBase) frases.push(`Com os autos conclusos, a decisão costuma sair em ${conclusoBase.mediana} dias (metade entre ${conclusoBase.p25} e ${conclusoBase.p75}).`);

  return {
    disponivel: true, justica, status, dias_desde_ultimo: diasDesde,
    ultimo_ato: { classe: ultimo.classe, rotulo: ROTULO_CLASSE[ultimo.classe] || null, data: ultimo.data, descricao: String(ultimo.descricao).slice(0, 160) },
    proxima_janela: janela ? { ...janela, atrasada: !!atrasado } : null,
    ritmo_processo: proprio.mediana != null ? proprio : null,
    entre_despachos: entre,
    proximo_despacho: proximoDespacho,
    fluxo_provavel: fluxo,
    etapa_arrematacao: etapa,
    resumo: frases.join(' '),
    aviso: 'Estimativa estatística a partir de movimentações passadas — o juízo pode andar mais rápido ou mais devagar; não é prazo nem promessa.',
  };
}

// Estatística da base por Justiça; cai para "todas" quando a Justiça tem pouca amostra.
export async function estatisticaFluxo(justica) {
  const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SB || !KEY) return { linhas: [], justica: null };
  const ler = async (j) => {
    const r = await fetch(`${SB}/rest/v1/rpc/processo_fluxo_estatistica`, {
      method: 'POST', signal: AbortSignal.timeout(8000),
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_justica: j }),
    });
    if (!r.ok) throw new Error(`processo_fluxo_estatistica HTTP ${r.status}`);
    return r.json();
  };
  try {
    if (justica && justica !== 'outra') {
      const l = await ler(justica);
      if (l.filter((x) => Number(x.n) >= 5).length >= 6) return { linhas: l, justica };
    }
    return { linhas: await ler(null), justica: null };
  } catch (e) {
    console.warn('[previsao] estatística indisponível:', e?.message || e);
    return { linhas: [], justica: null, erro: String(e?.message || e) };
  }
}
