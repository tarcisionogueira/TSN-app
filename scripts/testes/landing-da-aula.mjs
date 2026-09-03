/**
 * scripts/testes/landing-da-aula.mjs — a página que o dinheiro do anúncio compra.
 *
 * POR QUE EXISTE (01/09). Em 48 h a campanha mandou 462 pessoas para `/#/live/:slug` e nenhuma
 * se inscreveu. A primeira suspeita foi a página; um teste local meu chegou a imprimir "Esta
 * aula não está com inscrições abertas" — e o culpado era o MOCK, não a página (ver abaixo).
 * Quase virou aviso ao dono de que a landing estava fora do ar. Este arquivo existe para que a
 * próxima dúvida sobre esta página seja respondida por um teste que se recusa a dar veredito
 * quando não conseguiu medir.
 *
 * DUAS DECISÕES QUE VALEM ENTENDER ANTES DE MEXER:
 *
 * 1. UM handler de rota só, com despacho por URL. O Playwright casa rotas da ÚLTIMA registrada
 *    para a primeira: um catch-all registrado DEPOIS da rota específica vence, devolve `null`
 *    para `live_proxima`, e o componente faz o certo — sem evento, tela de inscrições fechadas.
 *    O teste reprovaria código são. Foi exatamente isso que aconteceu em 01/09.
 *
 * 2. O teste CONTA as interceptações e se declara INVÁLIDO se `live_proxima` não apareceu.
 *    "Não consegui medir" tratado como "está tudo bem" é a forma #1 do CLAUDE.md dentro do
 *    próprio instrumento — a mesma razão pela qual `verificar:schema` reprova quando não
 *    consegue falar com o banco.
 *
 * O payload é o que a RPC devolve DE VERDADE em produção, rodando como papel `anon`. Payload
 * inventado testa o mock, não a página.
 *
 * Como rodar:
 *   npm run dev -- --port 5199      (VITE_SUPABASE_* de fachada bastam em .env.local)
 *   npm i --no-save playwright && node scripts/testes/landing-da-aula.mjs
 *
 * Fora do CI de propósito: depende de navegador e de servidor de pé.
 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:5199';
const linhas = []; let mau = 0;
const checa = (c, t) => { linhas.push(`  ${c ? '✓' : '✗ FALHOU'}  ${t}`); if (!c) mau++; return c; };

// Forma do retorno real de `live_proxima('leilao-ao-vivo')` (medido em produção, papel anon).
const EVENTO = {
  id: '00000000-0000-0000-0000-000000000000', slug: 'leilao-ao-vivo',
  titulo: 'Como eu encontro e avalio um imóvel de leilão, ao vivo',
  subtitulo: 'Vou abrir a plataforma na sua frente.',
  descricao: '• Judicial x extrajudicial\n• Busca ao vivo\n• Laudo na hora',
  data_hora: '2026-09-02T22:00:00+00:00', duracao_min: 90, recorrencia: 'semanal',
  capa_url: null, vagas_max: null, imagens: [],
  apresentador: 'Tarcísio Nogueira', apresentador_bio: 'Engenheiro civil desde 2016.',
  apresentador_foto: null, apresentador_cargo: 'Engenheiro civil',
};

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

async function abrir(corpoProxima) {
  // Celular, que é de onde vem o tráfego do Instagram/Facebook. Testar em desktop mediria
  // uma tela que quase ninguém da campanha vê.
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const erros = []; p.on('pageerror', e => erros.push(String(e.message).slice(0, 150)));
  const vistos = {};
  await p.route('**/rest/v1/rpc/**', r => {
    const fn = r.request().url().split('/rpc/')[1].split('?')[0];
    vistos[fn] = (vistos[fn] || 0) + 1;
    if (fn === 'live_proxima') return r.fulfill(corpoProxima);
    if (fn === 'live_inscritos') return r.fulfill({ status: 200, contentType: 'application/json', body: '4' });
    return r.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
  });
  await p.goto(`${BASE}/#/live/leilao-ao-vivo`, { waitUntil: 'domcontentloaded' });
  // `goto` para a MESMA URL de hash não remonta o React — o reload é o que garante montagem.
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);
  return { p, erros, vistos };
}
const OK = { status: 200, contentType: 'application/json', body: JSON.stringify(EVENTO) };

// 1. há aula → a página VENDE: título, data de Brasília, formulário e botão
let { p, erros, vistos } = await abrir(OK);
if (!vistos.live_proxima) {
  console.log('\n✗ TESTE INVÁLIDO: o mock não interceptou live_proxima — sem isso qualquer');
  console.log('  veredito abaixo descreveria o mock, não a página. Confira o servidor em ' + BASE);
  await b.close(); process.exit(2);
}
const txt = await p.locator('body').innerText();
checa(/Como eu encontro e avalio/.test(txt), 'mostra o título da aula');
checa(/19:00/.test(txt), `mostra 19:00 (Brasília), não o fuso do navegador (${(txt.match(/\d\d:\d\d/g) || []).slice(0, 3)})`);
checa(!/inscrições abertas/i.test(txt), 'NÃO cai na tela de "inscrições fechadas" com evento válido');
checa(erros.length === 0, `nenhum erro de página (${erros.slice(0, 2).join(' | ') || 'nenhum'})`);
const campos = await p.locator('input:visible').count();
checa(campos >= 3, `o formulário está na tela (${campos} campos visíveis)`);
// A promessa da página é conversão: o formulário tem de estar ao alcance, não a três rolagens.
const cx = await p.locator('input:visible').first().boundingBox();
checa(!!cx && cx.y <= 844, `o 1º campo está acima da dobra do celular (y=${cx ? Math.round(cx.y) : '?'}px de 844)`);
const bt = p.getByText(/Quero participar/i).first();
const bb = await bt.boundingBox().catch(() => null);
checa(!!bb && bb.y <= 844 * 1.5, `o botão de envio está a menos de 1,5 tela (y=${bb ? Math.round(bb.y) : '?'}px)`);
// Há ~4,9 telas abaixo do formulário. O CTA fixo é o que impede que essa parte da página
// fique sem NENHUM caminho de volta — e ele tem de sumir quando o formulário está à vista,
// senão compete com o próprio formulário (rótulo diferente de propósito, para o funil
// conseguir separar quem clicou por aqui de quem clicou lá embaixo).
// O rótulo COMPLETO, com o "· é gratuito", porque há um segundo botão "Garantir minha vaga"
// na chamada final da página. Com o regex curto o teste casava com ESSE — que existe sempre e
// `isVisible()` aprova mesmo fora da tela (visibilidade no Playwright não é estar no viewport).
// O teste reprovou código são até eu olhar QUAL elemento tinha casado.
const fixo = p.getByText(/Garantir minha vaga · é gratuito/i);
checa(!(await fixo.isVisible().catch(() => false)), 'com o formulário à vista, o CTA fixo NÃO aparece');
await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.8));
await p.waitForTimeout(700);
checa(await fixo.isVisible().catch(() => false), 'rolando para longe do formulário, o CTA fixo aparece');
await p.close();

// 2. não há aula → tela de inscrições fechadas, e SEM botão de tentar de novo
({ p } = await abrir({ status: 200, contentType: 'application/json', body: 'null' }));
const t2 = await p.locator('body').innerText();
checa(/não está com inscrições abertas/i.test(t2), 'sem evento: diz que não há inscrição aberta');
checa(!/Tentar de novo/i.test(t2), 'sem evento: não oferece "tentar de novo" (não foi falha, foi resposta)');
await p.close();

// 3. a RPC FALHA → é diagnóstico OPOSTO de "não tem aula", e a tela precisa dizer isso.
// Sem esta distinção, um 500 mandaria embora quem clicou num anúncio já pago.
({ p } = await abrir({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' }));
const t3 = await p.locator('body').innerText();
checa(/Não conseguimos carregar/i.test(t3), 'erro da RPC: fala em falha de conexão, não em "não tem aula"');
checa(/Tentar de novo/i.test(t3), 'erro da RPC: oferece "tentar de novo"');
await p.close();

await b.close();
console.log('\nLANDING DA AULA — /#/live/:slug\n' + linhas.join('\n'));
console.log(mau ? `\n${mau} FALHA(S)` : `\n${linhas.length}/${linhas.length} OK`);
process.exit(mau ? 1 : 0);
