// CRONOGRAMA DE PAGAMENTO DA ARREMATAÇÃO (29/09, pedido do dono).
//
// Uma regra só para a tela do arremate (src/pages/Arrematados.jsx) e para o cron que avisa antes
// do vencimento (api/parcelas-arremate-cron.js) — as duas nunca podem discordar de QUANDO vence.
//
// A guia de depósito judicial NÃO é gerada aqui: ela sai do portal do banco/tribunal pelo número do
// processo (sem API pública, com captcha). O que o sistema faz é saber o valor NOMINAL e a data de
// cada parcela, marcar paga e avisar antes. O valor nominal não inclui a correção do índice do
// edital — a guia do banco aplica.
//
// `p` (arrematados.parcelamento, jsonb): { forma: 'a_vista'|'parcelado', entrada_pct, entrada_venc,
//   entrada_paga_em, parcelas, primeira_venc, indice, folga_dias, pagas: [índices pagos; 0 = entrada/à vista],
//   guias: { [idx]: {...} } }
//
// VENCIMENTO (15/10, regra do dono): 30 dias CORRIDOS encadeados a partir do pagamento da entrada —
// parcela n = entrada + 30×n. Nunca a partir da data com folga (a folga acumularia parcela a parcela).
// `primeira_venc` deixa de mandar no encadeamento; fica só como dado lido do auto/edital.
// DATA DE PAGAMENTO (`pagar_ate`): vencimento − folga_dias (padrão 1), antecipada para o dia útil anterior
// se cair em fim de semana ou feriado bancário (src/utils/feriados.js). Lembretes e telas usam `pagar_ate`
// e mostram o `venc` real junto.
import { diaUtilAnteriorOuIgual, somarDias } from './feriados.js';

export const FOLGA_PADRAO_DIAS = 1;
export const DIAS_ENTRE_PARCELAS = 30;
const iso = (d) => d.toISOString().slice(0, 10);
const deIso = (s) => { const [a, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(Date.UTC(a, m - 1, d)); };

// Soma meses mantendo o dia; se o mês não tem o dia (31 → fevereiro), cai no último dia do mês.
export function somarMeses(dataIso, n) {
  const d = deIso(dataIso);
  const alvo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d.getUTCDate(), ultimo));
  return iso(alvo);
}

export function cronograma(p, { valor, dataArrematacao }) {
  if (!p || !p.forma || !(Number(valor) > 0)) return [];
  const pagas = new Set((p.pagas || []).map(Number));
  const base = dataArrematacao ? String(dataArrematacao).slice(0, 10) : null;
  const centavos = (v) => Math.round(v * 100) / 100;
  const folga = Math.max(0, Math.min(10, Number.isFinite(Number(p.folga_dias)) ? Math.round(Number(p.folga_dias)) : FOLGA_PADRAO_DIAS));
  const comData = (item) => (item.venc ? { ...item, pagar_ate: diaUtilAnteriorOuIgual(somarDias(item.venc, -folga)), folga_dias: folga } : item);
  if (p.forma === 'a_vista') {
    const venc = p.entrada_venc || base;
    return venc ? [comData({ idx: 0, rotulo: 'Pagamento à vista', venc, valor: centavos(Number(valor)), paga: pagas.has(0) })] : [];
  }
  const pct = Math.min(100, Math.max(0, Number(p.entrada_pct ?? 25)));
  const n = Math.max(1, Math.min(60, Math.round(Number(p.parcelas) || 0)));
  const entrada = centavos(Number(valor) * pct / 100);
  // Âncora do encadeamento: o dia em que a entrada foi PAGA; sem ele, o vencimento da entrada; sem ele, o leilão.
  const ancora = String(p.entrada_paga_em || p.entrada_venc || base || '').slice(0, 10) || null;
  if (!ancora) return [];
  const saldo = Number(valor) - entrada;
  const parcela = centavos(saldo / n);
  const itens = [comData({ idx: 0, rotulo: `Entrada (${pct}%)`, venc: p.entrada_venc || ancora, valor: entrada, paga: pagas.has(0) })];
  for (let i = 1; i <= n; i++) {
    // A última absorve o arredondamento: a soma fecha exatamente com o valor arrematado.
    const v = i === n ? centavos(saldo - parcela * (n - 1)) : parcela;
    itens.push(comData({ idx: i, rotulo: `Parcela ${i}/${n}`, venc: somarDias(ancora, DIAS_ENTRE_PARCELAS * i), valor: v, paga: pagas.has(i) }));
  }
  return itens.filter((x) => x.venc);
}

// Próxima parcela NÃO paga e quantos dias faltam (negativo = atrasada).
// `dias` conta até a DATA DE PAGAMENTO (com folga), que é a que os lembretes usam; `dias_venc`, até o vencimento real.
export function proximaPendente(itens, hojeIso = iso(new Date())) {
  const prox = itens.find((x) => !x.paga);
  if (!prox) return null;
  const ate = (d) => Math.round((deIso(d) - deIso(hojeIso)) / 86400000);
  return { ...prox, dias: ate(prox.pagar_ate || prox.venc), dias_venc: ate(prox.venc) };
}

// Texto do risco, para a tela e o e-mail. Leilão JUDICIAL: art. 895 do CPC. Extrajudicial (banco/
// Caixa): quem manda é o contrato/edital — não citamos artigo que não se aplica.
export function avisoPenalidade(tipoLeilao) {
  return /judicial/i.test(String(tipoLeilao || '')) && !/extra/i.test(String(tipoLeilao || ''))
    ? 'Atraso em qualquer parcela gera multa de 10% sobre a parcela em atraso somada às que ainda vão vencer, e o credor pode pedir o desfazimento da arrematação ou cobrar o valor (art. 895, §§ 4º e 5º, do CPC).'
    : 'Atraso sujeita às penalidades do edital/contrato de venda — confira as condições antes do vencimento.';
}
