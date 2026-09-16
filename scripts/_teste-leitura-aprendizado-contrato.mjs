// Cenário 2: confere o lado da LEITURA do aprendizado do gerador de contrato (o 1º teste só
// confirmou a ESCRITA). Uma lição foi inserida manualmente em contrato_aprendizado dizendo que
// o valor real de mercado para este serviço é R$ 1.500,00, nunca R$ 1.000,00. Gera um contrato
// com a MESMA descrição do teste anterior (que pede R$ 1.000,00) e confere se a IA aplicou a
// lição. Não envia para assinatura — só a geração.
const SB = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const APP_URL = process.env.APP_URL || 'https://www.bidprobrasil.com.br';
const EMAIL = process.env.TESTE_EMAIL || 'tarcisioaraujo@reimob.com.br';

async function mintarSessao() {
  const r1 = await fetch(`${SB}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: EMAIL }),
  });
  const d1 = await r1.json();
  if (!r1.ok) throw new Error(`generate_link falhou: ${r1.status} ${JSON.stringify(d1).slice(0, 500)}`);
  const hashed_token = d1?.hashed_token || d1?.properties?.hashed_token;
  if (!hashed_token) throw new Error('generate_link sem hashed_token');

  const r2 = await fetch(`${SB}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: hashed_token }),
  });
  const d2 = await r2.json();
  if (!r2.ok || !d2?.access_token) throw new Error(`verify falhou: ${r2.status} ${JSON.stringify(d2).slice(0, 300)}`);
  return d2.access_token;
}

async function main() {
  console.log('1) Mintando sessão de teste...');
  const token = await mintarSessao();
  console.log('   ok.');

  console.log('2) Gerando contrato (mesma descrição do teste anterior, pedindo R$ 1.000,00)...');
  const iaRes = await fetch(`${APP_URL}/api/gerar-contrato-ia`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      descricao: 'Contrato de prestação de serviços de consultoria em tecnologia entre a BidPro Brasil e um fornecedor pessoa jurídica. Objeto: testes automatizados do gerador de contrato (sem efeito jurídico real). Valor de R$ 1.000,00 mensais. Prazo de 12 meses.',
      tipo: 'servico',
    }),
  });
  const iaTxt = await iaRes.text();
  let iaData; try { iaData = JSON.parse(iaTxt); } catch { iaData = null; }
  if (!iaRes.ok || !iaData?.ok || !iaData?.contrato) {
    throw new Error(`gerar-contrato-ia falhou: HTTP ${iaRes.status} — ${iaTxt.slice(0, 400)}`);
  }
  const contrato = iaData.contrato;
  console.log(`   ok, ${contrato.length} caracteres gerados.`);

  const tem1500 = /1\.500,00/.test(contrato);
  const tem1000 = /1\.000,00/.test(contrato);
  console.log(`3) Resultado: contém "1.500,00"? ${tem1500} | contém "1.000,00"? ${tem1000}`);

  // Mostra o trecho relevante para conferência humana no log.
  const idx = contrato.search(/1\.500,00|1\.000,00|VALOR/i);
  if (idx >= 0) console.log('--- trecho ---\n' + contrato.slice(Math.max(0, idx - 200), idx + 300) + '\n--- fim do trecho ---');

  if (tem1500) {
    console.log('\n✅ SUCESSO: a IA aplicou a lição gravada em contrato_aprendizado (usou R$ 1.500,00 em vez do R$ 1.000,00 pedido na descrição).');
  } else {
    console.log('\n⚠️ A IA NÃO aplicou a lição desta vez (manteve R$ 1.000,00 ou outro valor). Pode ser variação normal de um modelo de linguagem, não necessariamente falha de encanamento — checar se o log "[gerar-contrato-ia] aprendizado injetado" mostrou texto não-vazio.');
    process.exit(1);
  }
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
