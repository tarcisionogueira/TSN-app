/**
 * npm run testar:judicial-venda-direta — o badge não esconde "por venda direta" dentro do judicial.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * Achado do dono (03/09, na mesma varredura do bug CEF venda_direta/venda_online): a PESTANA
 * Leilões (RS) publica 9 lotes ativos cujo texto diz, com todas as letras, "Alienação Judicial
 * Por Venda Direta" — e o badge da ficha mostrava só "Judicial", sem essa nuance.
 *
 * A DECISÃO (documentada em src/utils/format.js): `modalidade` continua `'judicial'` no banco,
 * de propósito. Mudar o valor apagaria o risco processual que `api/calcular-score.js`,
 * `api/processar-analise.js` e o CPC 895 de `src/pages/Calculadora.jsx` tratam como judicial —
 * "por venda direta" tira o pregão competitivo, não o risco de embargo/recurso do processo.
 * `ehJudicialVendaDireta`/`modalidadeLabelDetalhado` são PURAMENTE de exibição: só enriquecem
 * o texto do badge, sem tocar em score, filtro de pagamento ou qualquer gate funcional.
 */
import { ehJudicialVendaDireta, modalidadeLabelDetalhado, MODAL_LABEL } from '../../src/utils/format.js';

let ok = 0, falhas = 0;
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  ✓ ${nome}`); }
  else { falhas++; console.error(`  ✗ ${nome}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`); }
};

console.log('\nO CASO REAL DA PESTANA (RS) — 9 lotes ativos em 03/09');
checa('"Alienação Judicial Por Venda Direta" é detectado',
  ehJudicialVendaDireta('judicial', 'Terreno - Lote Nº 6, Quadra Nº 11 — Alienação Judicial Por Venda Direta - Imóveis em Eldorado/RS'));
checa('"Judicial Por Venda Direta" (sem "Alienação") também é detectado',
  ehJudicialVendaDireta('judicial', 'Terreno Selbach RS Matrícula n° 2.956 — Judicial Por Venda Direta - Imóvel em Selbach/RS'));
checa('o badge fica "Judicial · Venda Direta"',
  modalidadeLabelDetalhado('judicial', 'Alienação Judicial Por Venda Direta') === 'Judicial · Venda Direta');

console.log('\nNÃO PODE VAZAR PARA O QUE NÃO É ESSE CASO');
checa('judicial comum (sem "venda direta" no texto) continua só "Judicial"',
  modalidadeLabelDetalhado('judicial', 'Leilão judicial de imóvel em execução fiscal') === 'Judicial');
checa('judicial sem nenhum texto continua só "Judicial"',
  modalidadeLabelDetalhado('judicial', null) === 'Judicial');
checa('extrajudicial com "venda direta" no texto NÃO vira o rótulo composto (não é judicial)',
  !ehJudicialVendaDireta('extrajudicial', 'Alienação Extrajudicial Por Venda Direta'));
checa('venda_direta da CEF (sem "judicial" no texto) não aciona a regra',
  !ehJudicialVendaDireta('venda_direta', 'Venda Direta Online — Apartamento'));
checa('"judicial" e "venda direta" longe demais um do outro no texto não conta como o mesmo caso',
  !ehJudicialVendaDireta('judicial', 'Processo judicial nº 123. Em outro parágrafo qualquer, uma venda qualquer, mas não é direta nem tem nada a ver com isso.'));

console.log('\nO CONJUNTO CANÔNICO CONTINUA GRAVANDO "judicial" NO BANCO (não muda o valor armazenado)');
checa('modalidade continua judicial — só o RÓTULO muda, o valor gravado (para score/filtro/CPC895) não',
  MODAL_LABEL.judicial === 'Judicial');
checa('modalidade normal (não-judicial) passa direto pelo MODAL_LABEL, sem qualquer sufixo',
  modalidadeLabelDetalhado('extrajudicial', 'qualquer coisa venda direta judicial') === 'Extrajudicial');

console.log(`\n${falhas === 0 ? '✓' : '✗'} ${ok}/${ok + falhas} asserções`);
if (ok + falhas < 9) {
  console.error('TESTE INVÁLIDO: rodou menos asserções do que este arquivo declara.');
  process.exit(2);
}
process.exit(falhas === 0 ? 0 : 1);
