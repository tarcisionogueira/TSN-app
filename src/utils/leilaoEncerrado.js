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

// Aceita 'AAAA-MM-DD', ISO completo, Date. Data sem hora vale até o FIM do dia — senão um leilão
// marcado para hoje apareceria como encerrado desde a meia-noite.
function ms(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) { const t = Date.parse(s); return Number.isNaN(t) ? null : t; }
  const t = Date.parse(s.length === 10 ? `${s}T23:59:59-03:00` : s);
  return Number.isNaN(t) ? null : t;
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
    ms(im.data_leilao ?? im.dataLeilao),
    ms(im.data_leilao_2 ?? im.dataLeilao2),
    ms(im.data_fim ?? im.dataFim),
  ].filter((x) => Number.isFinite(x));

  if (!datas.length) return { encerrado: false, ultimaData: null, semData: true };
  if (ehVendaDireta(modalidade)) return { encerrado: false, ultimaData: null, semData: false };

  const ultima = Math.max(...datas);
  return {
    encerrado: ultima < Date.now(),
    ultimaData: new Date(ultima).toISOString().slice(0, 10),
    semData: false,
  };
}

/** dd/mm/aaaa a partir de 'AAAA-MM-DD' (o formato que a função acima devolve). */
export const dataBR = (iso) => (iso ? String(iso).split('-').reverse().join('/') : '');

/** Texto único do bloqueio — o cliente precisa ler a mesma explicação venha da tela ou da API. */
export function motivoLeilaoEncerrado(ultimaData) {
  return ultimaData
    ? `O leilão deste lote já ocorreu (última data prevista: ${dataBR(ultimaData)}). Como não é mais possível dar lance, o relatório não pode ser gerado.`
    : 'O leilão deste lote já ocorreu. Como não é mais possível dar lance, o relatório não pode ser gerado.';
}
