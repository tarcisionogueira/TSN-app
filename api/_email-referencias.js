/**
 * Normaliza o cabeçalho References para "<id1> <id2> …" (RFC 5322).
 *
 * POR QUE EXISTE (02/10). O Resend entrega `headers.references` como ARRAY; o inbound gravava
 * isso numa coluna text e o PostgREST guardava o JSON (`["<a>","<b>"]`). Na resposta, o
 * email-caixa colava esse texto cru no References — o cliente do outro lado devolvia o lixo
 * embrulhado de novo, e a cada volta o fio aninhava mais uma camada (a conversa da Leiloaria
 * Smart chegou a ~6 níveis, com ids partidos em `<leiloariasm>` `<ar>`). Fio quebrado = a nossa
 * resposta pode cair FORA da conversa no e-mail do leiloeiro.
 *
 * Aceita string, array ou o JSON legado, e extrai só os ids com cara de Message-ID
 * (`<algo@dominio>`) — de dentro do lixo antigo também, então linhas já gravadas se curam
 * na leitura. Sem duplicados; mantém o PRIMEIRO (raiz do fio) e os mais recentes até `max`.
 */
const RE_ID = /<[^<>\s"\\]+@[^<>\s"\\]+>/g;

export function idsDeReferencia(valor) {
  const bruto = Array.isArray(valor) ? valor.join(' ') : String(valor ?? '');
  const vistos = new Set();
  const ids = [];
  for (const id of bruto.match(RE_ID) || []) if (!vistos.has(id)) { vistos.add(id); ids.push(id); }
  return ids;
}

export function referenciasNormalizadas(valor, extra = null, max = 20) {
  const ids = idsDeReferencia(valor);
  for (const id of idsDeReferencia(extra)) if (!ids.includes(id)) ids.push(id);
  const corte = ids.length > max ? [ids[0], ...ids.slice(-(max - 1))] : ids;
  return corte.join(' ') || null;
}
