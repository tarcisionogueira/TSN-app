// Teste real do fix "laudo de viabilidade absorvido" — chama recalcularArremate()
// direto (mesmo arquivo do repo) contra o caso REAL do Marcos: 2 relatórios concluídos
// (mercadológico + documental), sem laudo, sem reunião. Antes do fix, `previsto` nunca
// era calculado para este cenário; depois do fix, deve vir preenchido com
// valor_mercado (do mercadológico) e veredito=null (sem laudo nem reunião — esperado).
import { recalcularArremate } from '../api/_arremate-aprendizado.js';

const IMOVEL_ID = 'dfc5ab9b-6c5d-49ba-97ec-57d704bc70ab';
const SB = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;

async function lerLinha() {
  const r = await fetch(`${SB}/rest/v1/arremate_aprendizado?imovel_id=eq.${IMOVEL_ID}&select=previsto,realizado,assertividade`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  return (await r.json())[0]; // padrao-ok: script de teste descartável, log abaixo mostra o corpo bruto se algo vier vazio
}

console.log('--- ANTES ---');
console.log(JSON.stringify(await lerLinha(), null, 2));

await recalcularArremate(IMOVEL_ID);

console.log('--- DEPOIS ---');
const depois = await lerLinha();
console.log(JSON.stringify(depois, null, 2));

if (depois?.previsto?.valor_mercado > 0) {
  console.log('\n✅ SUCESSO: previsto.valor_mercado foi calculado (era null antes do fix).');
} else {
  console.log('\n❌ FALHA: previsto continua sem valor_mercado.');
  process.exit(1);
}
