// Teste real do loop de aprendizado do gerador de contrato: gera uma minuta via IA,
// "edita" (simula a correção que o staff faria), envia como se fosse assinatura real
// (destinatário = o próprio dono, para não incomodar terceiros), e confere se
// contrato_aprendizado recebeu a correção extraída. Limpa os artefatos no final.
const SB = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const APP_URL = process.env.APP_URL || 'https://www.bidprobrasil.com.br';
const EMAIL = process.env.TESTE_EMAIL || 'tarcisioaraujo@reimob.com.br';

function sb(path, opts = {}) {
  return fetch(`${SB}/rest/v1/${path}`, { ...opts, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
}

async function mintarSessao() {
  const r1 = await fetch(`${SB}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: EMAIL }),
  });
  const d1 = await r1.json();
  if (!r1.ok) throw new Error(`generate_link falhou: ${r1.status} ${JSON.stringify(d1).slice(0, 500)}`);
  const hashed_token = d1?.hashed_token || d1?.properties?.hashed_token || d1?.email_otp;
  if (!hashed_token) throw new Error('generate_link sem hashed_token — chaves: ' + Object.keys(d1 || {}).join(',') + ' | corpo: ' + JSON.stringify(d1).slice(0, 800));

  const r2 = await fetch(`${SB}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token: hashed_token }),
  });
  const d2 = await r2.json();
  if (!r2.ok || !d2?.access_token) throw new Error(`verify falhou: ${r2.status} ${JSON.stringify(d2).slice(0, 300)}`);
  return d2.access_token;
}

async function main() {
  console.log('1) Mintando sessão de teste...');
  const token = await mintarSessao();
  console.log('   ok, token obtido.');

  console.log('2) Gerando minuta via /api/gerar-contrato-ia...');
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
  const original = iaData.contrato;
  console.log(`   ok, ${original.length} caracteres gerados.`);

  console.log('3) Editando a minuta (simula correção real do staff)...');
  const marcador = '\n\nCLÁUSULA DE TESTE AUTOMATIZADO: o valor da multa rescisória foi corrigido manualmente para 25% (vinte e cinco por cento) sobre o valor total do contrato, em vez do percentual original, para validar o aprendizado do gerador — este texto não é uma cláusula de negócio real.';
  const textoFinal = original + marcador;

  console.log('4) Enviando para assinatura via /api/gerar-contrato (conteudoDireto)...');
  const sendRes = await fetch(`${APP_URL}/api/gerar-contrato`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      titulo: 'TESTE AUTOMATIZADO — ignorar (validação do aprendizado do gerador de contrato)',
      tipo: 'servico',
      signatarios: [{ nome: 'Teste Automatizado', email: EMAIL }],
      conteudo: textoFinal,
      geradoPorIA: true,
      contratoOriginalIA: original,
      verificacaoIdentidade: 'nenhuma',
    }),
  });
  const sendTxt = await sendRes.text();
  let sendData; try { sendData = JSON.parse(sendTxt); } catch { sendData = null; }
  if (!sendRes.ok || !sendData?.ok) {
    throw new Error(`gerar-contrato falhou: HTTP ${sendRes.status} — ${sendTxt.slice(0, 400)}`);
  }
  const grupoId = sendData.grupo_id;
  console.log(`   ok, contrato_grupo_id=${grupoId}, ${sendData.links?.length || 0} link(s) de assinatura criado(s).`);

  console.log('5) Aguardando 5s e conferindo contrato_aprendizado...');
  await new Promise(r => setTimeout(r, 5000));
  const aprRes = await sb(`contrato_aprendizado?contrato_grupo_id=eq.${grupoId}&select=*`);
  const aprData = await aprRes.json(); // padrao-ok: script de teste descartável, checagem de sucesso é o length abaixo
  console.log(`   ${Array.isArray(aprData) ? aprData.length : 0} correção(ões) gravada(s):`);
  console.log(JSON.stringify(aprData, null, 2));

  console.log('6) Limpando artefatos de teste (contratos_link + contrato_aprendizado)...');
  const delLink = await sb(`contratos_link?contrato_grupo_id=eq.${grupoId}`, { method: 'DELETE' });
  const delApr = await sb(`contrato_aprendizado?contrato_grupo_id=eq.${grupoId}`, { method: 'DELETE' });
  console.log(`   contratos_link delete: ${delLink.status} | contrato_aprendizado delete: ${delApr.status}`);

  if (Array.isArray(aprData) && aprData.length > 0) {
    console.log('\n✅ SUCESSO: o servidor extraiu e gravou a correção do teste (limpo em seguida).');
  } else {
    console.log('\n⚠️ Nenhuma correção foi gravada — pode ser que a IA extratora não tenha considerado a edição significativa, ou algo falhou silenciosamente (best-effort, checar logs da Vercel).');
    process.exit(1);
  }
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
