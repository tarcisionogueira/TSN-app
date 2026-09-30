// Teste da taxa repassada no honorário (src/utils/taxaHonorario.js): o LÍQUIDO que a BidPro recebe,
// depois de o gateway descontar a taxa DELE do total cobrado, nunca pode ficar abaixo do honorário.
import { honorarioComTaxa, TAXA_BOLETO_ASAAS, TAXA_CARTAO_MP_PCT, TAXA_CARTAO_ASAAS } from '../../src/utils/taxaHonorario.js';
let falhas = 0;
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) falhas++; };
for (const h of [7000, 54835.52, 100000, 499999.99, 0.5]) {
  const b = honorarioComTaxa(h, 'boleto_asaas');
  ok(Math.abs(b.total - TAXA_BOLETO_ASAAS - h) < 0.005 && b.taxa === TAXA_BOLETO_ASAAS, `boleto ${h}: total ${b.total}`);
  const c = honorarioComTaxa(h, 'cartao_mp');
  const liqMp = Math.round((c.total - c.total * TAXA_CARTAO_MP_PCT / 100) * 100) / 100;
  ok(liqMp >= h && liqMp - h <= 0.02, `cartão MP ${h}: total ${c.total}, líquido ${liqMp}`);
  const a = honorarioComTaxa(h, 'cartao_asaas');
  const liqA = Math.round((a.total - a.total * TAXA_CARTAO_ASAAS.pct / 100 - TAXA_CARTAO_ASAAS.fixo) * 100) / 100;
  ok(liqA >= h && liqA - h <= 0.02, `cartão Asaas ${h}: total ${a.total}, líquido ${liqA}`);
  ok(Math.abs(c.honorario + c.taxa - c.total) < 0.001, `honorário + taxa = total (${h})`);
}
ok(honorarioComTaxa(0, 'boleto_asaas').total === 0, 'saldo zero não cobra taxa');
let lancou = false; try { honorarioComTaxa(10, 'pix'); } catch { lancou = true; }
ok(lancou, 'meio desconhecido (Pix) é recusado');
if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1); }
console.log('\nok');
