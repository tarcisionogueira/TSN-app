/**
 * scripts/testes/modo-suporte-nao-mostra-o-admin.mjs — a ficha do cliente nunca mostra o
 * e-mail de quem está olhando.
 *
 * POR QUE EXISTE (31/08, reportado pelo dono com print). No modo suporte, `/perfil → Meus
 * dados` exibia nome e telefone CORRETOS do cliente (Leonardo Oliveira, `16992265426`) ao lado
 * do e-mail do ADMIN (`tarcisioaraujo@reimob.com.br`). Uma ficha com dois donos, sem nada na
 * tela dizendo qual campo era de quem — e é sobre esse e-mail que o suporte iria falar com o
 * cliente.
 *
 * O caso que este teste existe para não deixar passar é o ÚLTIMO: quando o e-mail do cliente
 * não veio na carga do modo suporte, a resposta certa é um MARCADOR. Cair no e-mail da sessão
 * seria trocar "não sei" por um valor plausível e errado — a forma #10 do CLAUDE.md, e o
 * defeito original. Vazio faz perguntar; preenchido errado, não.
 */
import { emailVisivel, EMAIL_NAO_CARREGADO } from '../../src/utils/identidadeVisivel.js';

const ADMIN = { email: 'tarcisioaraujo@reimob.com.br' };
const CLIENTE = 'leolucasrp@gmail.com';

const casos = [
  ['fora do modo suporte, mostra o proprio e-mail',
    null, ADMIN, ADMIN.email],
  ['modo suporte COM e-mail na carga → mostra o do CLIENTE',
    { id: 'a2d0', nome: 'Leonardo Oliveira', email: CLIENTE }, ADMIN, CLIENTE],
  ['modo suporte SEM e-mail (carga antiga no sessionStorage) → marcador, NUNCA o do admin',
    { id: 'a2d0', nome: 'Leonardo Oliveira' }, ADMIN, EMAIL_NAO_CARREGADO],
  ['modo suporte com e-mail null → marcador',
    { id: 'a2d0', nome: 'Leonardo Oliveira', email: null }, ADMIN, EMAIL_NAO_CARREGADO],
  ['modo suporte com e-mail em branco → marcador (string vazia e ausencia, nao valor)',
    { id: 'a2d0', nome: 'Leonardo Oliveira', email: '   ' }, ADMIN, EMAIL_NAO_CARREGADO],
  ['fora do modo suporte e sem sessao → vazio',
    null, null, ''],
];

let mau = 0;
for (const [oque, imp, user, esperado] of casos) {
  const got = emailVisivel(imp, user);
  const ok = got === esperado;
  // A assercao que mais importa, e vale para TODOS os casos com impersonate:
  const vazouAdmin = !!imp && got === ADMIN.email;
  if (!ok || vazouAdmin) mau++;
  console.log(`${ok && !vazouAdmin ? '  ok  ' : '  FALHOU '} ${JSON.stringify(got)} `
    + `· esperado ${JSON.stringify(esperado)}${vazouAdmin ? ' · VAZOU O E-MAIL DO ADMIN' : ''} · ${oque}`);
}

if (mau) {
  console.error(`\n❌ ${mau} caso(s) fora do esperado em emailVisivel.`);
  process.exit(1);
}
console.log(`\n✅ ${casos.length} casos: a ficha do cliente nunca mostra a identidade de quem olha.`);
