// GUIA DE DEPÓSITO JUDICIAL DA PARCELA (12/10, pedido do dono — opção 2, em validação só pela equipe).
//
// O sistema NÃO emite a guia: ela sai do portal do tribunal/banco, que busca os dados direto no
// processo (o próprio BB recomenda "gere sua guia pelo link do tribunal" para evitar erro de
// digitação). O que fazemos é dizer ONDE emitir, a partir do nº CNJ, e entregar os dados prontos.
//
// Nº CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO — J = segmento (4 federal, 5 trabalho, 8 estadual),
// TR = tribunal, OOOO = vara/órgão de origem.
//
// Fontes dos links (conferidas em 12/10): trt5.jus.br/guias (SIF Caixa + SISCONDJ BB) e
// bb.com.br/site/setor-publico/judiciario/emissao-de-guia-de-deposito/ (portais SISCONDJ por tribunal).

const BB_PAGINA = 'https://www.bb.com.br/site/setor-publico/judiciario/emissao-de-guia-de-deposito/';
const CAIXA_DJ = 'https://depositojudicial.caixa.gov.br/';

// Portais SISCONDJ (Banco do Brasil) por tribunal, como o BB os lista.
const SISCONDJ_TRT = {
  '01': 'https://pje.trt1.jus.br/siscondj/login.jsp',
  '02': 'https://alvaraeletronico.trt2.jus.br/siscondj/login.jsp',
  '05': 'https://siscondj.trt5.jus.br/siscondj/pages/guia/publica/',
  '06': 'https://apps3.trt6.jus.br/alvaraeletronicobb/login.jsp',
  '07': 'https://pje.trt7.jus.br/siscondjtrt7/login.jsp',
  '09': 'https://www.trt9.jus.br/siscondjtrtpr/login.jsp',
  '12': 'https://siscondj.trt12.jus.br/siscondj/login.jsp',
  '13': 'https://www.trt13.jus.br/siscondj/login.jsp',
  '15': 'https://siscondj.trt15.jus.br/portaltrt15/login.jsp',
  '16': 'https://pje.trt16.jus.br/siscondj/login.jsp',
  '18': 'https://sistemas.trt18.jus.br/siscondj/login.jsp',
  '20': 'https://alvaraeletronico.trt20.jus.br/portaltrt/login.jsp',
  '22': 'https://aplicacoes.trt22.jus.br/siscondj/login.jsp',
  '23': 'https://solucoes.trt23.jus.br/siscondjt/login.jsp',
  '24': 'https://siscondj.trt24.jus.br/portaltrtms/login.jsp',
};
// TJ: código TR do CNJ → sigla e portal BB (só os que o BB lista; os demais caem na página do BB).
const TJ = {
  '05': { uf: 'BA', url: 'https://alvaraeletronico.tjba.jus.br/portalsiscondj/login.jsp' },
  '13': { uf: 'MG', url: 'https://depox.tjmg.jus.br/portaltjmg/login.jsp' },
  '20': { uf: 'RN', url: 'https://apps.tjrn.jus.br/portalsiscondj/login.jsp' },
  '23': { uf: 'RR', url: 'https://siscondj.tjrr.jus.br/portalsiscondj/login.jsp' },
  '26': { uf: 'SP', url: 'https://portaldecustas.tjsp.jus.br/portaltjsp/login.jsp' },
};

export function lerCnj(numero) {
  const m = String(numero || '').match(/(\d{7})-?(\d{2})\.?(\d{4})\.?(\d)\.?(\d{2})\.?(\d{4})/);
  if (!m) return null;
  const [, seq, dv, ano, j, tr, origem] = m;
  return { formatado: `${seq}-${dv}.${ano}.${j}.${tr}.${origem}`, seq, dv, ano, j, tr, origem };
}

// Onde emitir a guia. Devolve { tribunal, opcoes: [{ banco, sistema, url, nota }] } ou null
// quando o nº não é CNJ (aí a tela pede o nº ao jurídico em vez de chutar portal).
export function portaisDaGuia(numero) {
  const c = lerCnj(numero);
  if (!c) return null;
  if (c.j === '5') {
    const tribunal = `TRT da ${Number(c.tr)}ª Região`;
    const opcoes = [];
    if (c.tr === '05') {
      opcoes.push({ banco: 'Caixa', sistema: 'SIF (PJe)', url: 'https://pje.trt5.jus.br/sif/boleto/novo', nota: 'O TRT5 indica o SIF para processos do PJe; recebe por Caixa ou BB.' });
    }
    opcoes.push({ banco: 'Banco do Brasil', sistema: 'SISCONDJ-JT', url: SISCONDJ_TRT[c.tr] || BB_PAGINA, nota: SISCONDJ_TRT[c.tr] ? null : 'Escolha o tribunal na página do BB.' });
    return { tribunal, cnj: c, opcoes };
  }
  if (c.j === '8') {
    const tj = TJ[c.tr];
    return { tribunal: tj ? `TJ${tj.uf}` : `Tribunal de Justiça (código ${c.tr})`, cnj: c,
      opcoes: [{ banco: 'Banco do Brasil', sistema: 'Depósito judicial estadual', url: tj?.url || BB_PAGINA, nota: tj ? null : 'Escolha o tribunal na página do BB; alguns TJs usam outro banco.' }] };
  }
  if (c.j === '4') {
    return { tribunal: `TRF da ${Number(c.tr)}ª Região`, cnj: c,
      opcoes: [{ banco: 'Caixa', sistema: 'Depósito judicial (Justiça Federal)', url: CAIXA_DJ, nota: null }] };
  }
  return { tribunal: `Segmento ${c.j} do CNJ`, cnj: c, opcoes: [{ banco: 'Banco do Brasil', sistema: 'Página de guias do BB', url: BB_PAGINA, nota: 'Confirme o portal com o jurídico.' }] };
}

// Calculadora oficial do Banco Central para conferir a correção pelo índice do edital: o valor
// do cronograma é NOMINAL. Não calculamos aqui de propósito — índice "do TJ" ou "IPCA-E pro rata"
// variam por edital e um valor corrigido errado num depósito de dezenas de mil vira risco nosso.
export const CALCULADORA_BCB = 'https://www3.bcb.gov.br/CALCIDADAO/publico/exibirFormCorrecaoValores.do?method=exibirFormCorrecaoValores';
