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

// Aceita 'AAAA-MM-DD', ISO completo e Date. Devolve ms ou null.
function ms(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : t;
  }
  const t = Date.parse(s.length === 10 ? `${s}T23:59:59Z` : s);
  return Number.isNaN(t) ? null : t;
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
  const validas = [ms(row.data_leilao), ms(row.data_leilao_2), ms(row.data_fim)].filter((x) => Number.isFinite(x));
  if (!validas.length) return { encerrado: false, ultimaData: null }; // sem data → não afirma nada
  const ultima = Math.max(...validas);
  return { encerrado: ultima < Date.now(), ultimaData: new Date(ultima).toISOString().slice(0, 10) };
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
      `imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}&select=data_leilao,data_leilao_2,data_fim,modalidade,ativo&limit=1`
    )).json();
    if (row) {
      // Venda direta: a data que a fonte publica não é praça e não vence o lote (ver nota 3).
      if (/venda[_\s-]?direta/i.test(String(row.modalidade || ''))) return { encerrado: false, ultimaData: null };
      // `data_fim` é o "último prazo relevante" mantido pelo banco (trigger trg_data_fim_leilao):
      // ficava de fora e, em lote cujo prazo real só vive nela, o gate não enxergava nada.
      candidatas.push(ms(row.data_leilao), ms(row.data_leilao_2), ms(row.data_fim));
      // Lote ATIVO sem nenhuma data conhecida: não dá para afirmar que encerrou.
      if (row.ativo && !candidatas.some(Boolean)) return { encerrado: false, ultimaData: null };
    }
  } catch { return { encerrado: false, ultimaData: null }; } // consulta falhou → falha aberta
  candidatas.push(ms(dataDoCliente));

  const validas = candidatas.filter((x) => Number.isFinite(x));
  if (!validas.length) return { encerrado: false, ultimaData: null }; // sem data → não bloqueia

  const ultima = Math.max(...validas);
  return {
    encerrado: ultima < Date.now(),
    ultimaData: new Date(ultima).toISOString().slice(0, 10),
  };
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
