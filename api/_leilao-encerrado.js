/**
 * LEILÃO JÁ ENCERRADO — gate ANTES de cobrar a cota.
 *
 * Regra do dono (07/08): "não vale, pois já passou a data de arrematar". Um relatório de um lote
 * cujo leilão já aconteceu não tem uso — não dá para dar lance — e até hoje o sistema deixava
 * gerar, consumindo a cota do cliente. Pior: a limpeza apagava esse relatório logo em seguida
 * (era o achado do "Expira em 31/07" num relatório gerado em 07/08).
 *
 * Duas cautelas que fazem este gate ser seguro, e que são o motivo de ele não ser um simples
 * `data_leilao < hoje`:
 *
 * 1) SEGUNDA PRAÇA. O lote tem `data_leilao` (1ª praça) e `data_leilao_2` (2ª). Só a 1ª ter
 *    passado é NORMAL — é justamente quando a 2ª praça, mais barata, fica interessante. Só
 *    bloqueia quando a MAIS FUTURA de todas as datas conhecidas já passou.
 *
 * 2) DATA DO ACERVO, NÃO DO CLIENTE. A data chega do formulário, e a lição de hoje é que o
 *    servidor não decide por dado do cliente quando tem dado melhor em casa. Aqui a consulta é
 *    ao `imoveis_leilao`; a do cliente entra só como reforço, nunca sozinha.
 *
 * 3) VENDA DIRETA NÃO TEM LEILÃO — acrescentado em 07/08 depois de MEDIR o acervo. Na Caixa,
 *    venda direta é venda CONTÍNUA: 15.516 lotes ativos não têm data nenhuma e 1.674 carregam
 *    uma data velha (até 25 dias) que a CEF nunca atualiza, embora o lote siga na planilha de
 *    hoje. A primeira versão deste gate tratava essa data como praça vencida e teria bloqueado
 *    esses 1.674 imóveis, que estão à venda agora. Venda direta só sai quando some da fonte.
 *
 * FALHA ABERTA por decisão: sem data confiável (lote manual, acervo sem data, consulta que
 * falhou) o gate NÃO bloqueia. Impedir uma geração legítima por falta de informação é pior que
 * deixar passar uma inútil — o cliente pode ter contexto que o acervo não tem.
 */

// Aceita 'AAAA-MM-DD', ISO completo e Date. Devolve o instante do FIM do prazo (para comparar) e
// o DIA (para mostrar) — separados de propósito, porque juntá-los produzia dois erros opostos:
//   • fim do dia em UTC dava o lote por encerrado às 20h59 de Brasília, com pregão das 21h ainda
//     acontecendo;
//   • derivar o dia do instante em -03:00 anunciava um leilão de 03/08 como "encerrado em 04/08"
//     (o print do dono, lote Rua Ita 55).
// A referência é sempre Brasília: é o fuso em que o leiloeiro publica.
function limite(v) {
  if (!v) return null;
  const s = String(v).trim();
  const soData = /^\d{4}-\d{2}-\d{2}$/.test(s);
  const fim = Date.parse(soData ? `${s}T23:59:59-03:00` : s);
  if (Number.isNaN(fim)) return null;
  const dia = soData ? s : new Date(fim).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  return { fim, dia };
}

/**
 * Versão PURA: decide a partir de uma linha já em mãos (sem ida ao banco). Usada por quem já
 * carregou o lote — o e-mail de oportunidades, por exemplo, que avalia dezenas de lotes por
 * cliente e não pode consultar um a um. Mesmas regras da versão com consulta.
 * @param {{data_leilao?, data_leilao_2?, data_fim?, modalidade?}} row
 */
export function encerradoPorDatas(row) {
  if (!row) return { encerrado: false, ultimaData: null };
  if (/venda[_\s-]?direta/i.test(String(row.modalidade || ''))) return { encerrado: false, ultimaData: null };
  const validas = [limite(row.data_leilao), limite(row.data_leilao_2), limite(row.data_fim),
                   limite(row.praca1_fim), limite(row.praca2_fim)].filter(Boolean);
  if (!validas.length) return { encerrado: false, ultimaData: null }; // sem data → não afirma nada
  const ultima = validas.reduce((a, b) => (b.fim > a.fim ? b : a));
  return { encerrado: ultima.fim < Date.now(), ultimaData: ultima.dia };
}

/**
 * @param {Function} sb    cliente REST do Supabase do próprio gerador (mesma sessão/service key)
 * @param {string} imovelId
 * @param {string|null} dataDoCliente  data que veio do formulário (reforço, nunca decide sozinha)
 * @returns {Promise<{encerrado: boolean, ultimaData: string|null}>}
 */
export async function leilaoEncerrado(sb, imovelId, dataDoCliente = null) {
  const candidatas = [];
  try {
    const [row] = await (await sb(
      `imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}&select=data_leilao,data_leilao_2,data_fim,praca1_fim,praca2_fim,modalidade,ativo&limit=1`
    )).json();
    if (row) {
      // Venda direta: a data que a fonte publica não é praça e não vence o lote (ver nota 3).
      if (/venda[_\s-]?direta/i.test(String(row.modalidade || ''))) return { encerrado: false, ultimaData: null };
      // `data_fim` é o "último prazo relevante" mantido pelo banco (trigger trg_data_fim_leilao):
      // ficava de fora e, em lote cujo prazo real só vive nela, o gate não enxergava nada.
      // `praca1_fim`/`praca2_fim` (28/08): o ENCERRAMENTO da praça. `data_leilao_2` é o
      // início da 2ª — usá-lo como prazo recusava relatório de lote ainda em pregão.
      candidatas.push(limite(row.data_leilao), limite(row.data_leilao_2), limite(row.data_fim),
                      limite(row.praca1_fim), limite(row.praca2_fim));
      // Lote ATIVO sem nenhuma data conhecida: não dá para afirmar que encerrou.
      if (row.ativo && !candidatas.some(Boolean)) return { encerrado: false, ultimaData: null };
    }
  } catch { return { encerrado: false, ultimaData: null }; } // consulta falhou → falha aberta
  candidatas.push(limite(dataDoCliente));

  const validas = candidatas.filter(Boolean);
  if (!validas.length) return { encerrado: false, ultimaData: null }; // sem data → não bloqueia

  const ultima = validas.reduce((a, b) => (b.fim > a.fim ? b : a));
  return { encerrado: ultima.fim < Date.now(), ultimaData: ultima.dia };
}

// Mensagem única para os dois geradores — o cliente precisa ver a mesma explicação venha de onde
// vier, e saber que NÃO foi cobrado (a dúvida sobre cobrança é o que gera chamado no suporte).
export function respostaLeilaoEncerrado(ultimaData) {
  return {
    error: ultimaData
      ? `O leilão deste lote já ocorreu (última data prevista: ${ultimaData.split('-').reverse().join('/')}). Como não é mais possível dar lance, o relatório não foi gerado e nenhuma cota foi consumida.`
      : 'O leilão deste lote já ocorreu. Como não é mais possível dar lance, o relatório não foi gerado e nenhuma cota foi consumida.',
    motivo: 'leilao_encerrado',
    ultima_data: ultimaData || null,
  };
}
