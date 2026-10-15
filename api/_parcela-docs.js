/**
 * Leitura de GUIA e COMPROVANTE de parcela da arrematação (15/10) — uma só para a tela (api/guia-parcela.js) e
 * para o cron que liga os documentos chegados por e-mail às parcelas (api/parcelas-documentos-cron.js).
 *
 * `qualParcela` decide a parcela pelo que está ESCRITO no documento ("Parcela 01 de 16") e, sem isso, pelo valor.
 * Na dúvida não escolhe: devolve aviso. Guia ou comprovante ligado à parcela errada é o pior desfecho aqui.
 */
import { anthropicFetch } from './_claude.js';
import { classificarDocumento, blocoParaIA } from './_doc-leitura.js';

const CHAVE_IA = process.env.CLAUDE_KEY || process.env.ANTHROPIC_API_KEY;
const MODELO = 'claude-sonnet-4-6';

const SISTEMA_GUIA = `Você lê guias de depósito judicial (SIF, SISCONDJ, Caixa, Banco do Brasil) e boletos/PIX gerados para elas.
Responda apenas um JSON:
{"valor":number|null, "vencimento":"AAAA-MM-DD"|null, "linha_digitavel":string|null, "pix_copia_cola":string|null,
 "id_deposito":string|null, "banco":string|null, "processo":string|null, "depositante":string|null, "finalidade":string|null,
 "parcela_numero":number|null, "parcela_total":number|null}
Regras: "vencimento" é a VALIDADE/data limite da guia. "parcela_numero"/"parcela_total" só se o documento disser (ex.: "Parcela 01 de 16" → 1 e 16; "entrada" → 0). Copie linha digitável, PIX copia-e-cola e ID EXATAMENTE como impressos (o PIX começa com "000201"). Na dúvida, null. Nunca invente.`;

const SISTEMA_COMPROVANTE = `Você lê comprovantes de pagamento (PIX, boleto, depósito judicial, TED). Responda apenas um JSON:
{"valor":number|null, "data_pagamento":"AAAA-MM-DD"|null, "pagador":string|null, "favorecido":string|null,
 "id_deposito":string|null, "processo":string|null, "linha_digitavel":string|null, "descricao":string|null,
 "parcela_numero":number|null, "parcela_total":number|null}
Regras: "data_pagamento" é a data em que o pagamento foi EFETIVADO. "parcela_numero" só se o comprovante disser. Copie códigos exatamente. Na dúvida, null. Nunca invente.`;

async function lerComIA(sistema, buf, { contentType = '', nome = 'documento' } = {}) {
  if (!CHAVE_IA) throw new Error('chave da IA ausente');
  const doc = classificarDocumento(buf, { contentType });
  const bloco = blocoParaIA(doc, nome) || (doc.kind === 'texto' ? { type: 'text', text: doc.texto.slice(0, 40000) } : null);
  if (!bloco) throw new Error(doc.motivo || 'formato não lido');
  const r = await anthropicFetch({
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': CHAVE_IA, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODELO, max_tokens: 800, system: sistema, messages: [{ role: 'user', content: [bloco, { type: 'text', text: 'Extraia os dados deste documento.' }] }] }),
  }, { retries: 1, timeoutMs: 60000, noFallback: true });
  if (!r.ok) throw new Error(`IA respondeu HTTP ${r.status}: ${(await r.text().catch(() => '')).slice(0, 160)}`);
  const data = await r.json();
  if (data.stop_reason === 'max_tokens') throw new Error('resposta da IA cortada');
  const t = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
}

export const lerGuiaArquivo = (buf, opts) => lerComIA(SISTEMA_GUIA, buf, opts);
export const lerComprovanteArquivo = (buf, opts) => lerComIA(SISTEMA_COMPROVANTE, buf, opts);

const soDigitos = (s) => String(s || '').replace(/\D/g, '');
const str = (s, n) => (typeof s === 'string' && s.trim() && s.trim().toLowerCase() !== 'null' ? s.trim().slice(0, n) : null);
const dataOk = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? s : null);
const valorOk = (v) => (typeof v === 'number' && v > 0 ? Math.round(v * 100) / 100 : null);
const perto = (a, b, tol) => a > 0 && b > 0 && Math.abs(a - b) / b <= tol;

// Campos da guia como ficam em parcelamento.guias[idx].
export function camposDaGuia(lido) {
  return {
    valor: valorOk(lido?.valor), vencimento: dataOk(lido?.vencimento),
    linha_digitavel: str(lido?.linha_digitavel, 70), pix: str(lido?.pix_copia_cola, 400), id_deposito: str(lido?.id_deposito, 30),
    banco: str(lido?.banco, 40), lida_em: new Date().toISOString(),
  };
}

// Avisos de conferência (mesmos da tela): valor longe do nominal, processo de outro caso, guia sem código.
export function avisosDaGuia(lido, parcela, processoCaso) {
  const avisos = [];
  const valor = valorOk(lido?.valor);
  if (!valor) avisos.push('Não achei o valor na guia.');
  else if (!perto(valor, parcela.valor, 0.10)) avisos.push(`Valor da guia ${valor.toFixed(2)} longe do nominal ${Number(parcela.valor).toFixed(2)} (> 10%).`);
  const pg = soDigitos(lido?.processo), pc = soDigitos(processoCaso);
  if (pg && pc && pg !== pc) avisos.push(`Processo da guia (${lido.processo}) diferente do caso (${processoCaso}).`);
  if (!lido?.linha_digitavel && !lido?.pix_copia_cola && !lido?.id_deposito) avisos.push('Sem código de barras, PIX ou ID de depósito legível.');
  return avisos;
}

/**
 * Qual parcela do cronograma o documento é. `tipo`: 'guia' | 'comprovante'.
 * 1) número escrito no documento (conferindo o total quando vier); 2) sem número: as parcelas PENDENTES cujo valor
 * bate (guia: ±10% do nominal, a correção do índice cabe aí; comprovante: ±2% do valor da guia enviada, ou ±10% do
 * nominal) — só decide se sobrar UMA, ou se a mais próxima da data do documento for a única dentro de 20 dias.
 */
export function qualParcela(tipo, lido, itens, guias = {}) {
  const n = itens.length - 1;
  const num = Number.isInteger(lido?.parcela_numero) ? lido.parcela_numero : null;
  const tot = Number.isInteger(lido?.parcela_total) ? lido.parcela_total : null;
  if (num !== null) {
    if (tot && n > 0 && tot !== n) return { aviso: `O documento diz parcela ${num} de ${tot}, mas o cronograma tem ${n} parcelas.` };
    const item = itens.find((x) => x.idx === num);
    return item ? { idx: num, por: 'numero' } : { aviso: `Parcela ${num} não existe no cronograma.` };
  }
  const valor = valorOk(lido?.valor);
  if (!valor) return { aviso: 'Sem número da parcela e sem valor legível: não dá para saber de qual parcela é.' };
  const candidatas = itens.filter((x) => !x.paga && (tipo === 'guia'
    ? perto(valor, x.valor, 0.10)
    : (guias[x.idx]?.valor ? perto(valor, guias[x.idx].valor, 0.02) : perto(valor, x.valor, 0.10))));
  if (!candidatas.length) return { aviso: `Valor ${valor.toFixed(2)} não bate com nenhuma parcela pendente.` };
  if (candidatas.length === 1) return { idx: candidatas[0].idx, por: 'valor' };
  // Parcelas iguais: desempata pela data do documento (validade da guia / dia do pagamento), se houver.
  const ref = dataOk(tipo === 'guia' ? lido?.vencimento : lido?.data_pagamento);
  if (ref) {
    const dist = (x) => Math.abs((Date.parse(x.venc) - Date.parse(ref)) / 864e5);
    const perto20 = candidatas.filter((x) => dist(x) <= 20);
    if (perto20.length === 1) return { idx: perto20[0].idx, por: 'valor+data' };
  }
  // Comprovante: a ÚNICA guia já enviada e não paga desempata.
  if (tipo === 'comprovante') {
    const enviadas = candidatas.filter((x) => guias[x.idx]?.enviada_em);
    if (enviadas.length === 1) return { idx: enviadas[0].idx, por: 'guia_enviada' };
  }
  return { aviso: `Valor bate com ${candidatas.length} parcelas pendentes (${candidatas.map((x) => x.rotulo).join(', ')}); confirme na tela.` };
}
