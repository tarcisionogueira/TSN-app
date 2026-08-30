/**
 * scripts/testes/faixa-aula-na-home.mjs — a faixa da aula aparece, some, e não inventa.
 *
 * Os quatro casos que importam, e três deles ninguém testa à mão:
 *   1. há aula em cartaz → faixa com título, dia e HORA DE BRASÍLIA (não a do navegador)
 *   2. o X dispensa por EDIÇÃO — a aula da semana seguinte reaparece sozinha
 *   3. não há aula → não renderiza nada, nem espaço em branco
 *   4. a RPC falha → NÃO vira faixa, mas deixa o motivo no console. Anunciar aula que não
 *      existe é pior que não anunciar; e engolir o erro faria "a RPC quebrou" virar "não tem
 *      aula", que são diagnósticos opostos (formas #1 e #2 do CLAUDE.md).
 *
 * A rota `live_em_cartaz` é interceptada — o teste é da TELA, não do banco (a função foi medida
 * à parte, em transação revertida).
 *
 * Como rodar:
 *   npm run dev -- --port 5199      (VITE_SUPABASE_* de fachada bastam em .env.local)
 *   npm i --no-save playwright && node scripts/testes/faixa-aula-na-home.mjs
 *
 * Fora do CI de propósito: depende de navegador e de servidor de pé.
 */
import { chromium } from 'playwright';
const BASE='http://127.0.0.1:5199';
const linhas=[]; let mau=0;
const checa=(c,t)=>{linhas.push(`  ${c?'✓':'✗ FALHOU'}  ${t}`); if(!c) mau++; return c;};
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

async function abrir(resposta) {
  const p = await b.newPage({ viewport: { width: 1100, height: 800 } });
  const avisos=[]; p.on('console', m => { if(m.type()==='warning'||m.type()==='error') avisos.push(m.text().slice(0,120)); });
  // O catch-all vai PRIMEIRO: o Playwright casa rotas da ÚLTIMA registrada para a primeira,
  // então registrá-lo depois faria ele engolir a específica — e o teste reprovaria código são.
  await p.route('**/rest/v1/rpc/**', r => r.fulfill({ status:200, contentType:'application/json', body:'null' }));
  await p.route('**/rest/v1/rpc/live_em_cartaz', r => r.fulfill(resposta));
  await p.goto(`${BASE}/#/`, { waitUntil:'domcontentloaded' });
  await p.reload({ waitUntil:'domcontentloaded' });
  await p.waitForTimeout(1500);
  return { p, avisos };
}
const AULA = { status:200, contentType:'application/json',
  body: JSON.stringify({ slug:'leilao-ao-vivo', titulo:'Como eu encontro e avalio um imóvel de leilão, ao vivo', data_hora:'2026-09-02T22:00:00+00:00' }) };

// 1. com aula em cartaz
let { p } = await abrir(AULA);
const faixa = p.getByText(/Aula ao vivo/i).first();
checa(await faixa.isVisible().catch(()=>false), 'a faixa aparece quando há aula em cartaz');
const txt = await p.locator('body').innerText();
checa(/Como eu encontro e avalio/.test(txt), 'mostra o título da aula');
checa(/quarta-feira/i.test(txt), 'mostra o dia da semana');
checa(/19:00/.test(txt), `mostra 19:00, não o fuso do navegador (${(txt.match(/\d\d:\d\d/g)||[]).slice(0,3)})`);
checa(/hor[áa]rio de Bras[ií]lia/i.test(txt), 'diz de que fuso está falando');
// clique leva à landing da aula
await p.getByText(/Garantir minha vaga/i).first().click();
await p.waitForTimeout(900);
checa(/#\/live\/leilao-ao-vivo/.test(p.url()), `o clique leva à landing da aula (${p.url().split('#')[1]})`);
await p.close();

// 2. fechar, e continuar fechada depois de recarregar
({ p } = await abrir(AULA));
await p.locator('button[aria-label="Fechar aviso da aula"]').click();
await p.waitForTimeout(300);
checa(!(await p.getByText(/Aula ao vivo/i).first().isVisible().catch(()=>false)), 'o X fecha a faixa');
await p.reload({ waitUntil:'domcontentloaded' }); await p.waitForTimeout(1500);
checa(!(await p.getByText(/Aula ao vivo/i).first().isVisible().catch(()=>false)), 'fechada continua fechada depois do reload');
// outra EDIÇÃO da aula reaparece
await p.route('**/rest/v1/rpc/live_em_cartaz', r => r.fulfill({ status:200, contentType:'application/json',
  body: JSON.stringify({ slug:'leilao-ao-vivo', titulo:'Aula da semana seguinte', data_hora:'2026-09-09T22:00:00+00:00' }) }));
await p.reload({ waitUntil:'domcontentloaded' }); await p.waitForTimeout(1500);
checa(await p.getByText(/Aula ao vivo/i).first().isVisible().catch(()=>false), 'a edição SEGUINTE reaparece, não herda o "fechada"');
await p.close();

// 3. sem aula em cartaz → nada, nem espaço em branco
({ p } = await abrir({ status:200, contentType:'application/json', body:'null' }));
checa(!(await p.getByText(/Aula ao vivo/i).first().isVisible().catch(()=>false)), 'sem aula em cartaz: nada é renderizado');
await p.close();

// 4. RPC com erro → não inventa faixa, MAS deixa rastro
let r4 = await abrir({ status:500, contentType:'application/json', body:'{"message":"boom"}' });
checa(!(await r4.p.getByText(/Aula ao vivo/i).first().isVisible().catch(()=>false)), 'erro da RPC não vira faixa');
checa(r4.avisos.some(a => /faixa-aula/.test(a)), `erro deixa o motivo no console (${r4.avisos.filter(a=>/faixa-aula/.test(a)).length} aviso)`);
await r4.p.close();

await b.close();
console.log('\nFAIXA DA AULA NA HOME\n'+linhas.join('\n'));
console.log(mau?`\n${mau} FALHA(S)\n`:`\n${linhas.length}/${linhas.length} OK\n`);
process.exit(mau?1:0);
