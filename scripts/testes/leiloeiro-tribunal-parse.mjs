/**
 * npm run testar:leiloeiro-tribunal — listas de credenciados dos tribunais → `leiloeiro_tribunal` (29/10). Fixtures
 * recortadas das respostas reais de 29/10, só com os campos lidos (sem CPF, e-mail ou telefone).
 */
import { readFileSync } from 'node:fs';
import { parseTJSP, parseEXE, parsePlanilha, limparNome, dominioDe, normNome } from '../lib/leiloeiro-tribunal-parse.mjs';

const fx = (f) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
let ok = 0, falhas = 0;
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  ✓ ${nome}`); }
  else { falhas++; console.error(`  ✗ ${nome}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`); }
};
const acha = (rows, re) => rows.find((r) => re.test(r.nome));

console.log('\n1. NOME LIMPO E DOMÍNIO');
for (const [bruto, esperado] of [
  ['Sami Raicher LEILOEIRO OFICIAL    JUCESP 930', 'Sami Raicher'],
  ['DANIEL MELO CRUZ  GRUPO LANCE', 'DANIEL MELO CRUZ'],
  ['LUIZ CARLOS LEVOTO-JUCESP 942 - WWW.X.COM.BR', 'LUIZ CARLOS LEVOTO'],
  ['Thais Spagolla Fernandes- Jucesp 926- www.123leiloes.com.br', 'Thais Spagolla Fernandes'],
  ['José Valero Santos Júnior VALERO LEILÕES WWW.VALEROLEILOES.COM.BR', 'José Valero Santos Júnior'],
  ['Eduardo dos Reis, leiloeiro oficial Jucesp 748', 'Eduardo dos Reis'],
  ['Giovanna Tavares Martins Kerry .', 'Giovanna Tavares Martins Kerry'],
]) checa(`"${bruto.slice(0, 40)}…" → "${esperado}"`, limparNome(bruto) === esperado, limparNome(bruto));
checa('e-mail com www não é site', dominioDe('WWW.CONTATO@ACTIMOVEIS.COM.BR') === null);
checa('https://www.x.com.br/ → x.com.br', dominioDe('https://www.alvaroleiloes.com.br/') === 'alvaroleiloes.com.br');
checa('normNome igual ao do banco', normNome('ÁLVARO SÉRGIO FUZO (TRT)') === 'alvaro sergio fuzo');

console.log('\n2. TJSP');
const tj = parseTJSP(JSON.parse(fx('tribunal-tjsp.json')));
const ademilson = acha(tj, /ADEMILSON/);
checa('9 linhas', tj.length === 9, tj.length);
checa('chave = Codigo', ademilson?.chave === '88590', ademilson?.chave);
checa('matrícula JUCESP', ademilson?.matricula === 'JUCESP 1165', ademilson?.matricula);
checa('site é o 2º www (o 1º é e-mail)', ademilson?.dominio === 'actleiloes.com.br', ademilson?.dominio);
checa('site entre parênteses', acha(tj, /Renan Augusto/)?.dominio === 'startupleiloes.com.br');
checa('Valero com site do nome', acha(tj, /Valero/)?.dominio === 'valeroleiloes.com.br');

console.log('\n3. EXE-PJe (TRT15)');
const exe = parseEXE(JSON.parse(fx('tribunal-exe-trt15.json')), 'TRT15');
checa('21 habilitações → 3 leiloeiros', exe.length === 3, exe.length);
const alberto = acha(exe, /ALBERTO/);
checa('chave = leiloeiro.id, cidade e UF', alberto?.chave === '82' && alberto?.uf === 'SP' && alberto?.cidade === 'SAO PAULO', alberto);
checa('site normalizado', alberto?.site === 'https://albertomacedoleiloes.com.br', alberto?.site);
checa('nada além dos campos do cruzamento', Object.keys(alberto || {}).every((k) => ['tribunal', 'chave', 'nome', 'nome_norm', 'matricula', 'site', 'dominio', 'uf', 'cidade'].includes(k)));

console.log('\n4. PLANILHAS');
const t18 = parsePlanilha(fx('tribunal-trt18.csv'), 'TRT18');
checa('TRT18: 3 (linha repetida e vazias fora)', t18.length === 3, t18.map((r) => r.nome));
checa('TRT18: campo com quebra de linha não desalinha o site', acha(t18, /ALGL/)?.dominio === 'leiloesgoias.com.br', acha(t18, /ALGL/));
checa('TRT18: chave = nome normalizado', acha(t18, /FUZO/)?.chave === 'alvaro fuzo');
const t4 = parsePlanilha(fx('tribunal-trt4.csv'), 'TRT4', 'RS');
checa('TRT4: cabeçalho achado depois do título', t4.length === 4, t4.map((r) => r.nome));
checa('TRT4: observação entre parênteses sai do nome', acha(t4, /BARBIERI/)?.nome === 'MARCIANO BARBIERI', acha(t4, /BARBIERI/)?.nome);
checa('TRT4: cidade e UF', acha(t4, /BACK/)?.cidade === 'RIO PARDO' && acha(t4, /BACK/)?.uf === 'RS');

console.log(falhas ? `\n${falhas} falha(s), ${ok} ok` : `\n✓ leiloeiro-tribunal: ${ok}/${ok} asserções`);
if (falhas) process.exit(1);
