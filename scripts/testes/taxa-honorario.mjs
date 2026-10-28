// Teste do honorário cobrado (src/utils/taxaHonorario.js).
// 21/10 (decisão do dono, substitui o repasse de 30/09): boleto e cartão 1× → o cliente paga só o saldo (taxa 0,
// a tarifa fica com a BidPro); juros do parcelado de 2× em diante são do cliente pelo próprio gateway, fora daqui.
// O gross-up antigo segue no código atrás de REPASSAR_TAXA_DO_MEIO=false; se a regra voltar, este teste muda junto.
import { honorarioComTaxa, gatewayDoBoleto, TETO_BOLETO_MP } from '../../src/utils/taxaHonorario.js';
let falhas = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) falhas++; };
for (const h of [7000, 54835.52, 100000, 499999.99, 0.5]) {
  for (const meio of ['boleto_mp', 'boleto_asaas', 'cartao_mp', 'cartao_asaas']) {
    const r = honorarioComTaxa(h, meio);
    ok(r.taxa === 0 && r.total === h && r.honorario === h, `${meio} ${h}: cobra só o saldo (total ${r.total}, taxa ${r.taxa})`);
  }
}
ok(honorarioComTaxa(54835.524, 'boleto_mp').total === 54835.52, 'saldo arredondado no centavo');
ok(honorarioComTaxa(0, 'boleto_asaas').total === 0, 'saldo zero não cobra nada');
let lancou = false; try { honorarioComTaxa(10, 'pix'); } catch { lancou = true; }
ok(lancou, 'meio desconhecido (Pix) é recusado');
ok(gatewayDoBoleto(TETO_BOLETO_MP) === 'mp' && gatewayDoBoleto(TETO_BOLETO_MP + 0.01) === 'asaas', `boleto até R$ ${TETO_BOLETO_MP} pelo MP, acima pelo Asaas`);
if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1); }
console.log('\nok');
