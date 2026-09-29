/**
 * scripts/testes/contato-leiloeiro.mjs — 29/09. Captura do e-mail do leiloeiro (scripts/_contato-leiloeiro.mjs).
 * Os hex abaixo são os `data-cfemail` REAIS das páginas de contato (pg_net, 29/09).
 */
import { decodificarCfEmail, extrairEmailDeHtml, motivoRecusaEmail, linksDeContato, buscarEmailDoSite } from '../_contato-leiloeiro.mjs';

let falhas = 0;
const ok = (c, oque) => { if (c) console.log(`  ✓ ${oque}`); else { falhas++; console.log(`  ✗ ${oque}`); } };

console.log('\ncontato do leiloeiro');
ok(decodificarCfEmail('583e39343d3b3736372b3b3718323739373d3531343137763b3735763a2a') === 'faleconosco@joaoemilio.com.br', 'Cloudflare: João Emílio decodificado');
ok(decodificarCfEmail('zz12') === null && decodificarCfEmail('ab') === null, 'hex inválido → null');

const joao = '<a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="583e39343d3b3736372b3b3718323739373d3531343137763b3735763a2a">[email&#160;protected]</a>';
ok(extrairEmailDeHtml(joao, 'https://www.joaoemilio.com.br')?.email === 'faleconosco@joaoemilio.com.br', 'e-mail protegido pelo Cloudflare é capturado');

const je = '<span data-cfemail="ff8b96d1959a939a9693909a8cbf97908b929e9693d19c9092"></span>';
ok(extrairEmailDeHtml(je, 'https://jeleiloes.com.br') === null, 'hotmail em texto solto na HOME não vale');
ok(extrairEmailDeHtml(je, 'https://jeleiloes.com.br', { paginaContato: true })?.email === 'ti.jeleiloes@hotmail.com', 'hotmail na página de CONTATO do próprio site vale');

ok(extrairEmailDeHtml('<a href="mailto:lgpd@kleiloes.com.br">x</a>', 'https://kleiloes.com.br') === null, 'canal de LGPD não é contato de proposta');
ok(motivoRecusaEmail('contato@alfaleiloes.com', 'https://www.alfaleiloes.com.br', true) === null, 'mesma marca em outro TLD (alfaleiloes .com × .com.br) é aceita');
ok(motivoRecusaEmail('contato@leiloes.com', 'https://www.leiloes.com.br', false) !== null, 'rótulo genérico não casa por TLD');
ok(motivoRecusaEmail('contato@jrfleiloes.com.br', 'https://www.superbid.net', true) !== null, 'e-mail de terceiro continua recusado (caso JRF)');
ok(motivoRecusaEmail('thiagovidal@othis.com.br', 'https://www.megaleiloes.com.br', false) !== null, 'e-mail da agência do site continua recusado (MEGA)');

const home = '<a href="/contato/indique">Indique</a><a href="/contato">Contato</a><a href="https://outro.com.br/contato">x</a><a href="mailto:a@b.com">m</a>';
const links = linksDeContato(home, 'https://www.calilleiloes.com.br');
ok(links.length === 1 && links[0] === 'https://www.calilleiloes.com.br/contato', `link de contato do mesmo site, sem "indique" nem outro domínio → ${links.join(' ')}`);

const paginas = {
  'https://www.agostinholeiloes.com.br': '<a href="/contato">Contato</a>',
  'https://www.agostinholeiloes.com.br/contato': '<a data-cfemail="f59f80879c919c969ab594929a86819c9b9d9a99909c999a9086db969a98db9787"></a>',
};
const r = await buscarEmailDoSite('https://www.agostinholeiloes.com.br', { obterHtml: async (u) => { if (!(u in paginas)) throw new Error('HTTP 404'); return paginas[u]; } });
ok(r.achado?.email === 'juridico@agostinholeiloes.com.br' && r.url.endsWith('/contato'), 'home sem e-mail → página de contato → achado');
const r2 = await buscarEmailDoSite('https://x.com.br', { obterHtml: async () => { throw new Error('HTTP 403'); } });
ok(!r2.achado && /inacess.*403/.test(r2.motivo), `bloqueio vira MOTIVO, não silêncio → "${r2.motivo}"`);
const r3 = await buscarEmailDoSite('https://y.com.br', { obterHtml: async () => '<p>contato@othis.com.br</p>' });
ok(!r3.achado && /outro domínio/.test(r3.motivo), `só e-mail de terceiro vira motivo → "${r3.motivo}"`);

if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1); }
console.log('\nok');
