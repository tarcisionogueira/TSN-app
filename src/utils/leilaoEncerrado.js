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

/** dd/mm/aaaa a partir de 'AAAA-MM-DD' (o formato que a função acima devolve). */
export const dataBR = (iso) => (iso ? String(iso).split('-').reverse().join('/') : '');

/** Texto único do bloqueio — o cliente precisa ler a mesma explicação venha da tela ou da API. */
export function motivoLeilaoEncerrado(ultimaData) {
  return ultimaData
    ? `O leilão deste lote já ocorreu (última data prevista: ${dataBR(ultimaData)}). Como não é mais possível dar lance, o relatório não pode ser gerado.`
    : 'O leilão deste lote já ocorreu. Como não é mais possível dar lance, o relatório não pode ser gerado.';
}
