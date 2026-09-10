/**
 * npm run testar:sessao — sessão vencida se renova e relê; não vira "você é cliente comum".
 *
 * Relato do dono em 10/09, no PWA: "Não foi possível carregar suas análises · Detalhe técnico:
 * JWT expired" e "tive que fechar e reabrir o app pois meu acesso caiu de adm para comum".
 *
 * O token do Supabase dura pouco, e num app aberto há horas (ou em segundo plano, onde o timer
 * de renovação não roda) o servidor recusa TUDO. Cada tela reagia à sua maneira — quatro
 * códigos diferentes para a mesma causa, que é como as regras desta base sempre divergiram:
 *   /analise   → "não foi possível verificar os relatórios já gerados"
 *   /analises  → "JWT expired"
 *   o perfil   → role cai para `explorador` (fail-closed, correto) e o ADMIN vê tela de cliente
 *   apiCall    → 401 e um botão que não faz nada
 *
 * Fechar e reabrir resolvia porque forçava sessão nova. Agora o app faz isso sozinho: uma
 * renovação, uma releitura. UMA — renovação em cadeia sobre falha em cadeia é laço infinito.
 */
import { readFileSync } from 'node:fs';
import { ehErroDeSessao, renovarSessao, lerComRenovacao } from '../../src/lib/sessao-expirada.js';

let ok = 0, falhas = 0;
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  ✓ ${nome}`); }
  else { falhas++; console.error(`  ✗ ${nome}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`); }
};

console.log('\nRECONHECER A FALHA DE SESSÃO — e SÓ ela');
for (const [e, esp, nota] of [
  [{ message: 'JWT expired' }, true, 'a mensagem exata que o dono viu na tela'],
  [{ code: 'PGRST301', message: 'JWT expired' }, true, 'código do PostgREST'],
  [{ status: 401, message: 'Unauthorized' }, true, '401 do GoTrue'],
  [401, true, 'status cru'],
  [{ message: 'invalid JWT: unable to parse' }, true, 'token corrompido'],
  [{ message: 'Auth session missing!' }, true, 'sessão sumiu do storage'],
  [{ code: '42P01', message: 'relation "x" does not exist' }, false, 'tabela inexistente NÃO é sessão'],
  [{ code: '57014', message: 'canceling statement due to statement timeout' }, false, 'timeout NÃO é sessão'],
  [{ code: '42501', message: 'permission denied for table perfis' }, false, 'RLS NÃO é sessão'],
  [{ message: 'Failed to fetch' }, false, 'rede caída NÃO é sessão'],
  [null, false, 'sem erro'], [undefined, false, 'indefinido'],
]) checa(nota, ehErroDeSessao(e) === esp, { erro: e, deu: ehErroDeSessao(e) });

console.log('\nRENOVAR SEM NUNCA LANÇAR — e sempre dizendo o motivo');
{
  const sb = (r) => ({ auth: { refreshSession: async () => r } });
  let x = await renovarSessao(sb({ data: { session: { access_token: 'tok' } }, error: null }));
  checa('renovou → ok', x.ok === true && x.motivo === null, x);
  x = await renovarSessao(sb({ data: { session: null }, error: { message: 'Refresh Token Not Found' } }));
  checa('recusado → ok:false COM o motivo do servidor', x.ok === false && /Refresh Token/.test(x.motivo), x);
  x = await renovarSessao(sb({ data: null, error: null }));
  checa('sem sessão guardada → motivo próprio, não vazio', x.ok === false && x.motivo.length > 0, x);
  x = await renovarSessao({ auth: { refreshSession: async () => { throw new Error('storage bloqueado'); } } });
  checa('exceção não sobe — vira motivo', x.ok === false && /storage bloqueado/.test(x.motivo), x);
}

console.log('\nRELER UMA VEZ — nem zero, nem em laço');
{
  const sbOk = { auth: { refreshSession: async () => ({ data: { session: { access_token: 't' } }, error: null }) } };
  const sbNao = { auth: { refreshSession: async () => ({ data: null, error: { message: 'sem refresh token' } }) } };

  let n = 0;
  let r = await lerComRenovacao(sbOk, async () => { n++; return n === 1 ? { data: null, error: { message: 'JWT expired' } } : { data: [1, 2], error: null }; });
  checa('leu de novo depois de renovar, e entregou o dado', n === 2 && r.error === null && r.data.length === 2, { n, r });
  checa('e avisa que renovou', r.renovou === true);

  n = 0;
  r = await lerComRenovacao(sbOk, async () => { n++; return { data: [9], error: null }; });
  checa('leitura boa NÃO renova nem relê', n === 1 && r.renovou === false, { n });

  n = 0;
  r = await lerComRenovacao(sbOk, async () => { n++; return { data: null, error: { code: '42P01', message: 'relation does not exist' } }; });
  checa('erro que NÃO é de sessão não dispara renovação', n === 1 && r.error.code === '42P01', { n });

  n = 0;
  r = await lerComRenovacao(sbOk, async () => { n++; return { data: null, error: { message: 'JWT expired' } }; });
  checa('JWT expirado nas DUAS leituras para em 2 — não vira laço', n === 2, { n });

  n = 0;
  r = await lerComRenovacao(sbNao, async () => { n++; return { data: null, error: { message: 'JWT expired' } }; });
  checa('renovação recusada → não relê, e devolve o erro original', n === 1 && /JWT expired/.test(r.error.message), { n });
  checa('com o motivo da recusa junto, para o diagnóstico', /sem refresh token/.test(r.motivoRenovacao || ''), r.motivoRenovacao);
}

console.log('\nOS QUATRO PONTOS USAM A MESMA RÉGUA (era esse o vício)');
for (const [arq, marca] of [
  ['src/contexts/AuthContext.jsx', /lerComRenovacao\(supabase, \(\) => supabase\s*\n?\s*\.from\('perfis'\)/],
  ['src/pages/MinhasAnalises.jsx', /lerComRenovacao\(supabase, \(\) =>\s*\n?\s*supabase\.rpc\('minhas_analises_lista'/],
  ['src/contexts/AnalisesContext.jsx', /ehErroDeSessao\(falha\)/],
  ['src/utils/apiCall.js', /renovarSessao\(supabase\)/],
]) {
  const src = readFileSync(new URL(`../../${arq}`, import.meta.url), 'utf8');
  checa(`${arq} importa a régua`, /from '[^']*sessao-expirada'/.test(src));
  checa(`${arq} usa a régua no ponto certo`, marca.test(src));
}
{
  // Nenhuma tela pode voltar a escrever a própria detecção — foi a divergência que criou isto.
  for (const arq of ['src/contexts/AnalisesContext.jsx', 'src/utils/apiCall.js', 'src/pages/MinhasAnalises.jsx']) {
    const src = readFileSync(new URL(`../../${arq}`, import.meta.url), 'utf8');
    checa(`${arq} não tem regex de sessão própria`, !/\/jwt\|expired\|PGRST301/i.test(src));
  }
}

console.log(`\n${falhas ? '✗' : '✓'} ${ok} passaram, ${falhas} falharam\n`);
process.exit(falhas ? 1 : 0);
