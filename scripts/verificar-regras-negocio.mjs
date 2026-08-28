/**
 * verificar:regras — a régua da INTENÇÃO no código bate com a declarada no banco?
 *
 * POR QUE EXISTE (28/08): a regra é APLICADA em `src/lib/intencao.js` (a Busca monta o filtro
 * no cliente e o cron de alertas no servidor) e DECLARADA em `public.intencao_filtro`, que é
 * o que a `auditoria_regras_negocio()` consegue enxergar. Duas moradas para o mesmo fato é
 * exatamente a forma que este projeto cataloga — a diferença aqui é que existe alguém
 * conferindo, e é este script.
 *
 * Sem ele, subir o piso da revenda no JS e esquecer o banco deixaria a auditoria verde
 * enquanto a regra real mudou. O inverso também: mudar no banco e não no código faria a
 * declaração descrever um sistema que não existe.
 *
 * REPROVA QUANDO NÃO CONSEGUE VERIFICAR (saída 2), pelo mesmo motivo do `verificar:schema`:
 * tratar "não consegui checar" como "está tudo bem" seria cometer, dentro da trava, o defeito
 * que ela existe para pegar.
 */
import { ajustarFiltrosPorIntencao } from '../src/lib/intencao.js';

const URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;

if (!URL || !KEY) {
  console.error('\n⚠️  NÃO VERIFICADO — faltam VITE_SUPABASE_URL e/ou SUPABASE_SERVICE_KEY.');
  console.error('   Isto NÃO é aprovação: é ausência de medição.\n');
  process.exit(2);
}

const INTENCOES = ['revenda', 'locacao', 'temporada'];
const iguais = (a, b) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

let falhas = 0;
for (const intencao of INTENCOES) {
  let banco;
  try {
    const r = await fetch(`${URL}/rest/v1/rpc/intencao_filtro`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_intencao: intencao }),
    });
    if (!r.ok) { console.error(`✗ ${intencao}: RPC intencao_filtro devolveu HTTP ${r.status}`); process.exit(2); }
    banco = await r.json();
  } catch (e) {
    console.error(`✗ ${intencao}: não consegui chamar intencao_filtro — ${e?.message || e}`);
    process.exit(2);
  }

  // O JS aplica sobre "sem tipo escolhido e sem desconto pedido": é o estado em que a regra
  // da intenção aparece pura, sem a interseção com o que o usuário digitou.
  const js = ajustarFiltrosPorIntencao(intencao, [], 0);

  if (!iguais(js.tipos, banco.tipos || [])) {
    console.error(`✗ ${intencao} · TIPOS divergem\n    código: ${JSON.stringify([...js.tipos].sort())}\n    banco : ${JSON.stringify([...(banco.tipos || [])].sort())}`);
    falhas++;
  }
  if (Number(js.descontoMin) !== Number(banco.desconto_min)) {
    console.error(`✗ ${intencao} · DESCONTO MÍNIMO diverge — código: ${js.descontoMin}%  ·  banco: ${banco.desconto_min}%`);
    falhas++;
  }
  if (!falhas) console.log(`✓ ${intencao.padEnd(10)} tipos=${js.tipos.length}  desconto_min=${js.descontoMin}%`);
}

if (falhas) {
  console.error(`\n✗ ${falhas} divergência(s) entre src/lib/intencao.js e public.intencao_filtro.`);
  console.error('  Alinhe os dois: a regra que o cliente sente é a do CÓDIGO, a que a auditoria vê é a do BANCO.\n');
  process.exit(1);
}
console.log('\n✓ A régua da intenção é a mesma no código e no banco.');
