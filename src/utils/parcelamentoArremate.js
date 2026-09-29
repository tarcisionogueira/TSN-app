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
//   parcelas, primeira_venc, indice, pagas: [índices pagos; 0 = entrada/à vista] }
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
  if (p.forma === 'a_vista') {
    const venc = p.entrada_venc || base;
    return venc ? [{ idx: 0, rotulo: 'Pagamento à vista', venc, valor: centavos(Number(valor)), paga: pagas.has(0) }] : [];
  }
  const pct = Math.min(100, Math.max(0, Number(p.entrada_pct ?? 25)));
  const n = Math.max(1, Math.min(60, Math.round(Number(p.parcelas) || 0)));
  const entrada = centavos(Number(valor) * pct / 100);
  const primeira = p.primeira_venc || (base ? somarMeses(base, 1) : null);
  if (!primeira) return [];
  const saldo = Number(valor) - entrada;
  const parcela = centavos(saldo / n);
  const itens = [{ idx: 0, rotulo: `Entrada (${pct}%)`, venc: p.entrada_venc || base, valor: entrada, paga: pagas.has(0) }];
  for (let i = 1; i <= n; i++) {
    // A última absorve o arredondamento: a soma fecha exatamente com o valor arrematado.
    const v = i === n ? centavos(saldo - parcela * (n - 1)) : parcela;
    itens.push({ idx: i, rotulo: `Parcela ${i}/${n}`, venc: somarMeses(primeira, i - 1), valor: v, paga: pagas.has(i) });
  }
  return itens.filter((x) => x.venc);
}

// Próxima parcela NÃO paga e quantos dias faltam (negativo = atrasada).
export function proximaPendente(itens, hojeIso = iso(new Date())) {
  const prox = itens.find((x) => !x.paga);
  if (!prox) return null;
  const dias = Math.round((deIso(prox.venc) - deIso(hojeIso)) / 86400000);
  return { ...prox, dias };
}

// Texto do risco, para a tela e o e-mail. Leilão JUDICIAL: art. 895 do CPC. Extrajudicial (banco/
// Caixa): quem manda é o contrato/edital — não citamos artigo que não se aplica.
export function avisoPenalidade(tipoLeilao) {
  return /judicial/i.test(String(tipoLeilao || '')) && !/extra/i.test(String(tipoLeilao || ''))
    ? 'Atraso em qualquer parcela gera multa de 10% sobre a parcela em atraso somada às que ainda vão vencer, e o credor pode pedir o desfazimento da arrematação ou cobrar o valor (art. 895, §§ 4º e 5º, do CPC).'
    : 'Atraso sujeita às penalidades do edital/contrato de venda — confira as condições antes do vencimento.';
}
