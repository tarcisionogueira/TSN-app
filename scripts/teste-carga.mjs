/**
 * Teste de carga controlado ("rampa segura") do BidPro Brasil em produção.
 *
 * Por que existe (13/09): pedido do dono, antes de um lançamento, para registrar
 * números reais de capacidade — não estimativa. Roda no GitHub Actions (rede
 * liberada; o ambiente do Claude bloqueia acesso direto ao domínio de produção
 * por política).
 *
 * DESENHO DE SEGURANÇA (decisão combinada com o dono antes de rodar):
 *   - Fase "publicas": só GET em páginas públicas/estáticas (home, listagem,
 *     detalhe de leilão) — zero custo de IA, zero e-mail, zero e escrita no banco.
 *     Sobe a concorrência em degraus e ABORTA o degrau seguinte sozinho se a
 *     taxa de erro ou a latência p95 estourar o limiar — não é para derrubar
 *     produção, é para achar o teto antes da queda.
 *   - Fase "completo" (opcional, flag separada): inclui cadastro + login reais
 *     (poucas contas, e-mails com o padrão `tarcisioaraujo+cargaXXXX@reimob.com.br`
 *     — caem na caixa do próprio dono, fácil de achar e limpar depois) e um
 *     número PEQUENO de gerações de relatório reais (custam API da Anthropic +
 *     cota do Bright Data de verdade — por isso o teto é baixo e fixo, não
 *     escala com a concorrência das outras fases).
 *
 * Uso: TESTE_CARGA_FASE=publicas|completo node scripts/teste-carga.mjs
 */

const BASE = process.env.TESTE_CARGA_BASE_URL || 'https://www.bidprobrasil.com.br';
// URL e anon key vêm só de variável de ambiente (secret do GitHub Actions) — mesmo sendo
// uma chave "publicável" por natureza, o repositório é público e a regra do projeto é
// nunca gravar VALOR de credencial em arquivo versionado (CLAUDE.md). Sem os dois, a fase
// completa é pulada sozinha (ver faseCompleta) — a fase pública não depende delas.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const FASE = process.env.TESTE_CARGA_FASE || 'publicas';
const RUN_ID = Date.now().toString(36);

// Imóveis reais já confirmados no banco (usados em investigações anteriores desta sessão) —
// evita gastar um request adivinhando um id que não existe.
const IMOVEIS_REAIS = [
  '/leilao/2509dc8a-659c-4424-8d60-6e7146581b4c/imovel-ararangua-sc',
  '/leilao/dcbcc81a-16bb-4613-97ec-a501a77563cf/casa-campo-alegre-juazeiro-do-norte-ce',
  '/leilao/511316d4-45e7-4709-8bc9-977b373d6496/imovel',
];

const ROTAS_PUBLICAS = [
  '/',
  '/leiloes',
  '/leiloes/buscar',
  '/leiloes/sp/saopaulo',
  '/leiloes/ba/salvador',
  ...IMOVEIS_REAIS,
];

function agora() { return Date.now(); }

function percentil(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.floor((p / 100) * s.length));
  return s[idx];
}

async function umaRequisicao(path) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const t0 = agora();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    // consome o corpo para medir o tempo real de resposta completa, não só do header
    await r.arrayBuffer().catch(() => {});
    return { ok: r.ok, status: r.status, ms: agora() - t0 };
  } catch (e) {
    return { ok: false, status: 0, ms: agora() - t0, erro: String(e?.message || e).slice(0, 100) };
  }
}

async function rodarDegrau(concorrencia) {
  const total = concorrencia * 3; // 3 rajadas por nível de concorrência
  const resultados = [];
  for (let lote = 0; lote < 3; lote++) {
    const promessas = [];
    for (let i = 0; i < concorrencia; i++) {
      const rota = ROTAS_PUBLICAS[(lote * concorrencia + i) % ROTAS_PUBLICAS.length];
      promessas.push(umaRequisicao(rota));
    }
    resultados.push(...(await Promise.all(promessas)));
  }
  const tempos = resultados.map((r) => r.ms);
  const erros = resultados.filter((r) => !r.ok);
  const porStatus = {};
  for (const r of resultados) porStatus[r.status] = (porStatus[r.status] || 0) + 1;
  return {
    concorrencia,
    total,
    erros: erros.length,
    taxaErro: erros.length / total,
    p50: percentil(tempos, 50),
    p95: percentil(tempos, 95),
    p99: percentil(tempos, 99),
    max: Math.max(...tempos),
    porStatus,
    amostraErros: erros.slice(0, 3).map((e) => ({ status: e.status, erro: e.erro })),
  };
}

async function faseePublicas() {
  console.log(`\n📊 FASE PÚBLICAS — rampa segura contra ${BASE}\n`);
  const DEGRAUS = [10, 25, 50, 100, 150, 250, 400];
  const LIMIAR_ERRO = 0.10; // 10% de erro no degrau aborta a rampa
  const LIMIAR_P95_MS = 6000; // p95 acima de 6s aborta a rampa

  for (const c of DEGRAUS) {
    const r = await rodarDegrau(c);
    console.log(
      `concorrência=${String(c).padStart(4)}  total=${r.total}  erros=${r.erros} (${(r.taxaErro * 100).toFixed(1)}%)  ` +
      `p50=${r.p50}ms p95=${r.p95}ms p99=${r.p99}ms max=${r.max}ms  status=${JSON.stringify(r.porStatus)}`
    );
    if (r.amostraErros.length) console.log(`   amostra de erro: ${JSON.stringify(r.amostraErros)}`);
    if (r.taxaErro > LIMIAR_ERRO) {
      console.log(`\n🛑 ABORTADO no degrau ${c}: taxa de erro ${(r.taxaErro * 100).toFixed(1)}% > limiar ${LIMIAR_ERRO * 100}%.`);
      console.log(`   Teto encontrado: sistema aguenta bem até ~${DEGRAUS[DEGRAUS.indexOf(c) - 1] ?? '<10'} requisições simultâneas.`);
      return;
    }
    if (r.p95 > LIMIAR_P95_MS) {
      console.log(`\n🛑 ABORTADO no degrau ${c}: p95 ${r.p95}ms > limiar ${LIMIAR_P95_MS}ms (degradação séria de latência).`);
      return;
    }
    await new Promise((s) => setTimeout(s, 1500)); // respiro entre degraus
  }
  console.log(`\n✅ Rampa completa sem abortar — sistema aguentou até o maior degrau testado (${DEGRAUS[DEGRAUS.length - 1]}).`);
}

// ─── Fase completa: cadastro + login + geração de relatório (custo real, N pequeno) ───

async function signupUmaConta(i) {
  const email = `tarcisioaraujo+carga${RUN_ID}_${i}@reimob.com.br`;
  const senha = `Carga!${RUN_ID}${i}Aa`;
  const t0 = agora();
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: senha }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, ms: agora() - t0, email, senha, access_token: j?.access_token || null };
  } catch (e) {
    return { ok: false, status: 0, ms: agora() - t0, email, senha, erro: String(e?.message || e).slice(0, 150) };
  }
}

async function loginUmaConta(email, senha) {
  const t0 = agora();
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: senha }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, ms: agora() - t0, access_token: j?.access_token || null };
  } catch (e) {
    return { ok: false, status: 0, ms: agora() - t0, erro: String(e?.message || e).slice(0, 150) };
  }
}

async function gerarRelatorio(token, imovelId) {
  const t0 = agora();
  try {
    const r = await fetch(`${BASE}/api/gerar-analise`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ imovelId }),
      signal: AbortSignal.timeout(60000),
    });
    const txt = await r.text().catch(() => '');
    return { ok: r.ok, status: r.status, ms: agora() - t0, corpo: txt.slice(0, 200) };
  } catch (e) {
    return { ok: false, status: 0, ms: agora() - t0, erro: String(e?.message || e).slice(0, 150) };
  }
}

async function faseCompleta() {
  if (!SUPABASE_URL || !ANON_KEY) {
    console.log('\n⚠️  Fase completa pulada: VITE_SUPABASE_URL/SUPABASE_ANON_KEY não configurados.');
    return;
  }
  const N_CONTAS = 10;
  const N_RELATORIOS = 5;

  console.log(`\n📊 FASE COMPLETA — cadastro + login (${N_CONTAS} contas simultâneas) + ${N_RELATORIOS} gerações reais\n`);
  console.log(`   e-mails: tarcisioaraujo+carga${RUN_ID}_N@reimob.com.br (todas caem na sua caixa, prefixo p/ limpar depois)`);

  const cadastros = await Promise.all(Array.from({ length: N_CONTAS }, (_, i) => signupUmaConta(i)));
  const okCadastro = cadastros.filter((c) => c.ok).length;
  console.log(`\ncadastro: ${okCadastro}/${N_CONTAS} ok`);
  cadastros.filter((c) => !c.ok).slice(0, 3).forEach((c) => console.log(`   erro cadastro: status=${c.status} ${c.erro || ''}`));

  // Supabase pode exigir confirmação de e-mail antes do login — tenta mesmo assim,
  // é sinal relevante (se falhar por "email not confirmed", isso é esperado, não bug).
  await new Promise((s) => setTimeout(s, 2000));
  const logins = await Promise.all(cadastros.filter((c) => c.ok).map((c) => loginUmaConta(c.email, c.senha)));
  const okLogin = logins.filter((l) => l.ok).length;
  console.log(`login: ${okLogin}/${logins.length} ok`);
  logins.filter((l) => !l.ok).slice(0, 3).forEach((l) => console.log(`   erro login: status=${l.status} ${l.erro || ''}`));

  const tokensValidos = logins.filter((l) => l.access_token).map((l) => l.access_token);
  if (!tokensValidos.length) {
    console.log('\n⚠️  Nenhum login retornou token — pulando geração de relatório (provável confirmação de e-mail obrigatória).');
    return;
  }
  const alvo = tokensValidos.slice(0, N_RELATORIOS);
  const relatorios = await Promise.all(
    alvo.map((tok, i) => gerarRelatorio(tok, IMOVEIS_REAIS[i % IMOVEIS_REAIS.length].split('/')[2]))
  );
  const okRelatorio = relatorios.filter((r) => r.ok).length;
  console.log(`\ngeração de relatório: ${okRelatorio}/${relatorios.length} ok`);
  relatorios.forEach((r, i) => console.log(`   [${i}] status=${r.status} ms=${r.ms} ${r.ok ? '' : (r.erro || r.corpo || '')}`));

  console.log(`\n🧹 Limpeza: contas de teste com e-mail LIKE 'tarcisioaraujo+carga${RUN_ID}_%@reimob.com.br' — apagar depois.`);
}

async function main() {
  await faseePublicas();
  if (FASE === 'completo') await faseCompleta();
  console.log('\nFim do teste de carga.');
}

main().catch((e) => { console.error(e); process.exit(1); });
