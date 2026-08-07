/**
 * LEILÃO ENCERRADO — a mesma regra do servidor (`api/_leilao-encerrado.js`), aqui na tela.
 *
 * POR QUE PRECISA EXISTIR NOS DOIS LADOS (achado do dono, 07/08 — "o imóvel em Guarulhos
 * continua com relatório disponível mesmo após o leilão encerrado"): o servidor já recusava
 * gerar relatório de lote vencido, mas a TELA não sabia disso. O cliente via o botão normal,
 * clicava, gastava a espera e só então tomava o "não". Do ponto de vista dele o relatório
 * continuava "disponível" — e continuava mesmo, até o clique.
 *
 * As duas cautelas que fazem esta regra não errar para o outro lado:
 *
 * 1) VENDA DIRETA NÃO TEM LEILÃO. Na Caixa, venda direta é venda contínua: 15.516 lotes não têm
 *    data nenhuma e 1.674 carregam uma data velha que a CEF nunca atualiza. Tratar essa data
 *    como "praça vencida" bloquearia 1.674 imóveis que estão à venda hoje. Venda direta nunca
 *    encerra por data — só sai do acervo quando some da fonte.
 *
 * 2) SEGUNDA PRAÇA. Só a 1ª praça ter passado é NORMAL (é quando a 2ª, mais barata, interessa).
 *    Encerrado = a MAIS FUTURA de todas as datas conhecidas já passou.
 *
 * E a falha é ABERTA: sem data confiável, não bloqueia. Impedir uma geração legítima por falta
 * de informação é pior que deixar passar uma inútil.
 */

// Aceita 'AAAA-MM-DD', ISO completo, Date. Devolve DUAS coisas, e a separação não é detalhe:
//   • `fim` — o instante em que o prazo acaba, para COMPARAR. Data sem hora vale até o fim do
//     dia em horário de Brasília; senão um leilão marcado para hoje apareceria encerrado desde
//     a meia-noite (e, se o fim do dia fosse tomado em UTC, o lote morreria às 21h BRT — com
//     pregão às 21h30 ainda rolando).
//   • `dia` — a data para MOSTRAR, tirada do texto original. Derivar o dia do instante era o bug
//     que o dono viu no print: leilão de 03/08 anunciado como "encerrado em 04/08", porque o fim
//     do dia em -03:00 cai depois da meia-noite UTC e o toISOString devolvia o dia seguinte.
function limite(v) {
  if (!v) return null;
  const s = String(v).trim();
  const soData = /^\d{4}-\d{2}-\d{2}$/.test(s);
  const fim = Date.parse(soData ? `${s}T23:59:59-03:00` : s);
  if (Number.isNaN(fim)) return null;
  // Com hora, o dia é lido no fuso de Brasília (é o fuso em que o leiloeiro publica).
  const dia = soData ? s : new Date(fim).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  return { fim, dia };
}

const ehVendaDireta = (m) => /venda[_\s-]?direta/i.test(String(m || ''));

/**
 * @param {object} im imóvel (aceita as duas convenções de nome usadas no app)
 * @returns {{encerrado: boolean, ultimaData: string|null, semData: boolean}}
 */
export function leilaoEncerrado(im) {
  if (!im) return { encerrado: false, ultimaData: null, semData: true };
  const modalidade = im.modalidade || im.modalidade_norm;
  const datas = [
    limite(im.data_leilao ?? im.dataLeilao),
    limite(im.data_leilao_2 ?? im.dataLeilao2),
    limite(im.data_fim ?? im.dataFim),
  ].filter(Boolean);

  if (!datas.length) return { encerrado: false, ultimaData: null, semData: true };
  if (ehVendaDireta(modalidade)) return { encerrado: false, ultimaData: null, semData: false };

  const ultima = datas.reduce((a, b) => (b.fim > a.fim ? b : a));
  return { encerrado: ultima.fim < Date.now(), ultimaData: ultima.dia, semData: false };
}

/**
 * PRAÇA DE REFERÊNCIA — sobre qual lance as projeções devem ser feitas.
 *
 * Regra do dono (07/08, vista na apresentação): *"as projeções do sistema e dos relatórios
 * serem geradas sobre as praças mais descontadas"*. O que ele viu foi o contrário: a simulação
 * saía sobre a praça mais PRÓXIMA no tempo — quase sempre a 1ª, a mais cara.
 *
 * O tamanho do erro, medido no acervo: 3.235 lotes ativos têm 2ª praça mais barata e ainda
 * futura. Neles o desconto médio pela 1ª praça é de **−6,1%** (ou seja, ACIMA da avaliação) e
 * pela 2ª é de **+23,5%** — a 2ª sai em média 27,3% abaixo da 1ª. Projetar pela 1ª faz uma
 * oportunidade real parecer um mau negócio.
 *
 * Escolhe o MENOR lance entre as praças cuja data ainda NÃO passou (praça vencida não é
 * oportunidade). Decide pelo VALOR, não pela coluna: as fontes divergem sobre qual campo guarda
 * a 1ª e qual guarda a 2ª (judicial × CEF). Espelha `escolherPraca` em api/gerar-analise.js.
 */
export function pracaMaisDescontada(im) {
  if (!im) return { valor: 0, data: null, qual: 'nenhuma', temDuas: false };
  const cand = [
    { valor: Number(im.valor_minimo ?? im.valorMinimo) || 0, data: im.data_leilao ?? im.dataLeilao ?? null },
    { valor: Number(im.valor_minimo_2 ?? im.valorMinimo2) || 0, data: im.data_leilao_2 ?? im.dataLeilao2 ?? null },
  ].filter((p) => p.valor > 0);
  if (!cand.length) return { valor: 0, data: null, qual: 'nenhuma', temDuas: false };

  const futura = (d) => { const l = limite(d); return !l || l.fim >= Date.now(); };
  const futuras = cand.filter((p) => futura(p.data));
  const pool = futuras.length ? futuras : cand; // nenhuma futura conhecida → considera todas
  const melhor = pool.reduce((a, b) => (b.valor < a.valor ? b : a));
  const temDuas = cand.length === 2 && cand[0].valor !== cand[1].valor;
  const maisBarata = temDuas && melhor.valor === Math.min(cand[0].valor, cand[1].valor);
  return { valor: melhor.valor, data: melhor.data, qual: temDuas ? (maisBarata ? '2a_praca' : '1a_praca') : 'unica', temDuas };
}

/** dd/mm/aaaa a partir de 'AAAA-MM-DD' (o formato que a função acima devolve). */
export const dataBR = (iso) => (iso ? String(iso).split('-').reverse().join('/') : '');

/** Texto único do bloqueio — o cliente precisa ler a mesma explicação venha da tela ou da API. */
export function motivoLeilaoEncerrado(ultimaData) {
  return ultimaData
    ? `O leilão deste lote já ocorreu (última data prevista: ${dataBR(ultimaData)}). Como não é mais possível dar lance, o relatório não pode ser gerado.`
    : 'O leilão deste lote já ocorreu. Como não é mais possível dar lance, o relatório não pode ser gerado.';
}
