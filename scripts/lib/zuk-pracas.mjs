/**
 * 1ª e 2ª PRAÇA da página do lote PortalZuk (24/09/2026, pedido do dono).
 *
 * O coletor da ZUK guardava UMA data (a menor futura da página) e nunca `data_leilao_2`: 18 de 772
 * lotes com 2ª praça. Como `data_fim` é a maior das praças, o lote "vencia" na 1ª praça e a limpeza
 * horária o tirava da vitrine com a 2ª — a mais barata — ainda por vir (recon de 24/09: Campo Novo
 * do Parecis e Cabo Frio com data 23/09 no banco e "Encerra em 25/09" na página; 249 ZUK
 * desligados por praça vencida em 3 dias).
 * Página real: "Lance mínimo: 1º Leilão 16/09/26 às 11h10 R$ 752.000,00 2º Leilão 18/09/26 às
 * 11h10 40 R$ 451.200,00". A frase "no dia 15/10/26 às 13h00 será realizado o 2º leilão deste lote
 * pelo valor de R$…" não casa (o número depois de "2º leilão" é valor, não data) — a tabela casa.
 * Recebe o TEXTO já sem a vitrine de outros lotes (cortarOutrosLotes).
 */
const RE = /([12])\s*[ºo°]\s*Leil[aã]o[^0-9]{0,20}(\d{2})\/(\d{2})\/(\d{2,4})(?:\s*(?:às|as|-)?\s*(\d{1,2})\s*[h:]\s*(\d{2})?)?/gi;

function iso(d, m, a, hh, mm) {
  const ano = a.length === 2 ? `20${a}` : a;
  const t = Date.parse(`${ano}-${m}-${d}T12:00:00-03:00`);
  if (Number.isNaN(t)) return null;
  if (hh == null) return { data: `${ano}-${m}-${d}`, ts: `${ano}-${m}-${d}T12:00:00-03:00`, hora: false };
  return { data: `${ano}-${m}-${d}`, ts: `${ano}-${m}-${d}T${String(hh).padStart(2, '0')}:${mm || '00'}:00-03:00`, hora: true };
}

export function pracasZuk(texto) {
  const out = { p1: null, p2: null };
  let m; RE.lastIndex = 0;
  while ((m = RE.exec(String(texto || '')))) {
    const k = m[1] === '1' ? 'p1' : 'p2';
    if (!out[k]) out[k] = iso(m[2], m[3], m[4], m[5], m[6]);
  }
  // 2ª praça só se for DEPOIS da 1ª (mesma regra do gatilho trg_normaliza_praca_duplicada)
  if (out.p1 && out.p2 && out.p2.data <= out.p1.data) out.p2 = null;
  return out;
}
