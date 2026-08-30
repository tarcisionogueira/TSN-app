/**
 * scripts/testes/cadastro-telefone-repetido.mjs — o que o CLIENTE vê quando repete o telefone.
 *
 * POR QUE EXISTE (30/08). O índice `perfis_telefone_unico` impede o duplicado, mas o perfil
 * nasce no trigger `handle_new_user`: a violação estoura DENTRO do `auth.signUp` e o Supabase
 * devolve "Database error saving new user". Mensagem técnica na cara de quem está tentando
 * entrar é exatamente o que faz a pessoa recadastrar com outro e-mail — que é como os dois
 * duplicados do acervo nasceram. Ou seja: a trava sem a tela AUMENTA o problema que veio
 * resolver, e é a TELA que precisa de teste, não a constraint.
 *
 * O banco já foi medido à parte (insert em auth.users com telefone repetido → 23505 em
 * `perfis_telefone_unico`, com o controle de telefone livre passando, tudo revertido). Aqui a
 * rota `/api/verificar-cpf` é INTERCEPTADA devolvendo exatamente o que o endpoint devolve em
 * produção para cada caso — inclusive o 503, porque "não consegui verificar" virando "pode
 * passar" é a forma #1 do CLAUDE.md e é o caso que ninguém testa à mão.
 *
 * Como rodar:
 *   npm run dev -- --port 5199        (precisa de VITE_SUPABASE_* em .env.local, valores de
 *                                      fachada bastam: esta tela não fala com o Supabase)
 *   npx playwright@1.49.1 ...  ou     npm i --no-save playwright && node scripts/testes/cadastro-telefone-repetido.mjs
 *
 * Fora do CI de propósito: depende de navegador e de servidor de pé, e pôr isso no caminho do
 * build trocaria uma classe de falha por outra — a mesma decisão já registrada para o
 * `verificar:schema`.
 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:5199';
// Numeros FICTICIOS de proposito: a rota e interceptada, entao o que o teste exercita e a
// TELA, nao o acervo. Repositorio publico nao leva telefone de cliente nem em constante de teste.
const REPETIDO = '(43) 99999-0001';   // o intercept responde temConta: true para este
const LIVRE    = '(11) 98888-7766';   // e temConta: false para este
const linhas = [];
const ok = (c, t) => linhas.push(`  ${c ? '✓' : '✗ FALHOU'}  ${t}`) && c;
let falhas = 0;
const checa = (c, t) => { ok(c, t); if (!c) falhas++; return c; };

const navegador = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const pagina = await navegador.newPage();

let modoDaResposta = 'duplicado';
let chamadas = 0;
await pagina.route('**/api/verificar-cpf', async (rota) => {
  const corpo = JSON.parse(rota.request().postData() || '{}');
  if (!corpo.telefone) return rota.fulfill({ status: 200, body: JSON.stringify({ temConta: false }) });
  chamadas++;
  if (modoDaResposta === 'erro')  return rota.fulfill({ status: 503, body: JSON.stringify({ erro: 'indisponivel' }) });
  const dup = modoDaResposta === 'duplicado';
  await rota.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ temConta: dup, campo: 'telefone' }) });
});

async function abrirCadastro() {
  // goto para a MESMA url de hash nao remonta o React (o estado `modo` sobrevive):
  // recarrega de verdade, senao a tela fica onde o teste anterior a deixou.
  await pagina.goto(`${BASE}/#/login`, { waitUntil: 'domcontentloaded' });
  await pagina.reload({ waitUntil: 'domcontentloaded' });
  await pagina.waitForTimeout(1200);
  await pagina.locator('button:has-text("Criar conta")').first().click({ timeout: 15000 });
  await pagina.waitForSelector('input[placeholder="(00) 90000-0000"]', { timeout: 15000 });
}

const campoTel = () => pagina.locator('input[placeholder="(00) 90000-0000"]');
const aviso    = () => pagina.getByText(/Este telefone já tem cadastro/i);
const botao    = () => pagina.locator('button[type=submit]:has-text("Criar conta")').last();

// ── 1. TELEFONE REPETIDO ────────────────────────────────────────────────────────────────
await abrirCadastro();
modoDaResposta = 'duplicado';
await campoTel().fill(REPETIDO);
await campoTel().blur();
await pagina.waitForTimeout(600);
checa(await aviso().isVisible().catch(() => false), 'o aviso aparece ao sair do campo');
const texto = await aviso().textContent().catch(() => '');
checa(/entrar/i.test(texto) && /recuperar a senha/i.test(texto), 'traz as duas saidas (entrar / recuperar a senha)');
checa(!/erro|falha|constraint|database/i.test(texto), 'nenhum jargao tecnico no texto');
const borda = await campoTel().evaluate(el => getComputedStyle(el).borderColor);
checa(/220, 38, 38/.test(borda), `o campo fica vermelho (${borda})`);
checa(await botao().isDisabled(), 'o botao de criar conta para de aceitar clique');
const opac = await botao().evaluate(el => getComputedStyle(el).opacity);
const cur  = await botao().evaluate(el => getComputedStyle(el).cursor);
checa(Number(opac) < 1 && cur === 'not-allowed', `e PARECE bloqueado (opacity ${opac}, cursor ${cur})`);

// ── 2. O CAMINHO DE VOLTA ───────────────────────────────────────────────────────────────
await pagina.locator('button:has-text("recuperar a senha")').last().click();
await pagina.waitForTimeout(400);
checa(await pagina.getByText(/recuperar|redefinir/i).first().isVisible().catch(() => false),
      'o botao "recuperar a senha" leva mesmo para a recuperacao');

// ── 3. TELEFONE LIVRE — a trava nao pode atrapalhar quem e novo ─────────────────────────
await abrirCadastro();
modoDaResposta = 'livre';
await campoTel().fill(LIVRE);
await campoTel().blur();
await pagina.waitForTimeout(600);
checa(!(await aviso().isVisible().catch(() => false)), 'telefone livre: nenhum aviso');

// ── 4. DIGITAR DE NOVO limpa o aviso ────────────────────────────────────────────────────
await abrirCadastro();
modoDaResposta = 'duplicado';
await campoTel().fill(REPETIDO); await campoTel().blur(); await pagina.waitForTimeout(500);
checa(await aviso().isVisible().catch(() => false), 'aviso posto para o teste seguinte');
await campoTel().fill('(11) 91111-2222');
await pagina.waitForTimeout(200);
checa(!(await aviso().isVisible().catch(() => false)), 'corrigir o numero limpa o aviso na hora');

// ── 5. API FORA DO AR — "nao consegui verificar" nao pode virar "pode passar" ────────────
await abrirCadastro();
modoDaResposta = 'duplicado';
await campoTel().fill(REPETIDO); await campoTel().blur(); await pagina.waitForTimeout(500);
modoDaResposta = 'erro';
await campoTel().fill(REPETIDO); await campoTel().blur(); await pagina.waitForTimeout(600);
checa(await aviso().isVisible().catch(() => false),
      '503 da API NAO rebaixa duplicado para liberado (o aviso permanece)');

// ── 6. numero curto nao gasta chamada ───────────────────────────────────────────────────
await abrirCadastro();
modoDaResposta = 'duplicado';
const antes = chamadas;
await campoTel().fill('(43) 9919'); await campoTel().blur(); await pagina.waitForTimeout(500);
checa(chamadas === antes, 'numero incompleto nem chega a consultar a API');

await navegador.close();
console.log('\nCADASTRO COM TELEFONE REPETIDO — tela\n' + linhas.join('\n'));
console.log(falhas === 0 ? `\n${linhas.length}/${linhas.length} OK\n` : `\n${falhas} FALHA(S)\n`);
process.exit(falhas ? 1 : 0);
