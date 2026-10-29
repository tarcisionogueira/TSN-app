/**
 * npm run testar:radar-leiloeiro — busca do DJEN pelo NOME do leiloeiro sem site (28/10).
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * A busca `texto=` da API Comunica casa palavra solta ("Juliana Pereira" → 10.000 comunicações), então quem decide se a
 * comunicação é DO leiloeiro é o texto: o nome inteiro, com fronteira de palavra. Depois disso vale o mesmo filtro duro
 * (`ehEditalReal`) e o mesmo parser do radar por termo — sem transporte de rede: o transporte é falso e devolve itens
 * montados aqui.
 */
import { citaLeiloeiro, pullDJENPorLeiloeiro } from '../../api/radar-editais-cron.js';

let ok = 0, falhas = 0;
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  ✓ ${nome}`); }
  else { falhas++; console.error(`  ✗ ${nome}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`); }
};

const EDITAL = (leiloeiro) => `EDITAL DE LEILÃO PÚBLICO. 1º Leilão em 10/11/2026. Leiloeiro oficial nomeado: ${leiloeiro}, JUCEPE nº 123. `
  + 'Imóvel objeto da matrícula nº 74.956 do 1º Registro de Imóveis de Recife/PE. Avaliação: R$ 350.000,00. Lance mínimo R$ 175.000,00.';

console.log('\nO NOME INTEIRO, COM FRONTEIRA DE PALAVRA');
checa('acento e caixa não importam', citaLeiloeiro('o leiloeiro ROBERTO JACINTO PINHO JUNIOR', 'Roberto Jacinto Pinho Júnior'));
checa('só o prenome e o sobrenome não bastam', !citaLeiloeiro('Roberto Pinho, leiloeiro', 'Roberto Jacinto Pinho Júnior'));
checa('nome dentro de outro nome não vale', !citaLeiloeiro('ana paula silvana souza', 'ana paula silva'));
checa('nome curto demais não vale (< 8 letras)', !citaLeiloeiro('ana lu', 'Ana Lu'));
checa('texto vazio', !citaLeiloeiro('', 'Roberto Jacinto Pinho Júnior'));

console.log('\nO PULL: SÓ ENTRA EDITAL QUE CITA O NOME');
const itens = [
  { id: 1, siglaTribunal: 'TRT6', tipoComunicacao: 'Edital', data_disponibilizacao: '2026-10-27', texto: EDITAL('Roberto Jacinto Pinho Júnior') },
  // mesma busca, edital de OUTRO leiloeiro (a API casou palavra solta)
  { id: 2, siglaTribunal: 'TRT6', tipoComunicacao: 'Edital', data_disponibilizacao: '2026-10-27', texto: EDITAL('Roberto Carlos Pinho') },
  // cita o leiloeiro, mas é despacho que só menciona leilão — o filtro duro tira
  { id: 3, siglaTribunal: 'TRT6', tipoComunicacao: 'Intimação', data_disponibilizacao: '2026-10-26', texto: 'Intime-se o leiloeiro Roberto Jacinto Pinho Júnior para manifestação sobre o leilão.' },
];
const gravadas = [];
const supabaseFalso = { from: () => ({ select: () => ({ in: async () => ({ data: [] }) }), upsert: async (rows) => { gravadas.push(...rows); return { error: null }; } }) };
const urls = [];
const transporte = async (url) => { urls.push(url); return { items: url.includes('ERRO') ? null : itens, count: itens.length }; };
const r = await pullDJENPorLeiloeiro({ supabase: supabaseFalso, nomes: ['Roberto Jacinto Pinho Júnior'], ini: '2026-10-18', fim: '2026-10-28', ehIntegrado: () => false, t0: Date.now(), transporte, pausaMs: 0 });
checa('1 edital gravado (o do nome), 2 fora', gravadas.length === 1 && gravadas[0].djen_id === '1', gravadas.map((x) => x.djen_id));
checa('contagem: 3 vistos, 2 citam o nome, 1 edital real', r.vistos === 3 && r.citados === 2 && r.reais === 1 && r.novos === 1, r);
checa('busca nacional (sem siglaTribunal) e com a janela pedida', !urls[0].includes('siglaTribunal') && urls[0].includes('dataDisponibilizacaoInicio=2026-10-18'), urls[0]);
checa('o tribunal vem do item (TRT6)', gravadas[0]?.tribunal === 'TRT6');
checa('leiloeiro_nome sai do parser do edital', /roberto jacinto pinho/i.test(gravadas[0]?.leiloeiro_nome || ''), gravadas[0]?.leiloeiro_nome);
checa('comEdital lista quem teve edital', r.comEdital.length === 1 && r.comEdital[0].editais === 1, r.comEdital);

console.log('\nFALHA DE UMA BUSCA NÃO DERRUBA AS OUTRAS');
const r2 = await pullDJENPorLeiloeiro({
  supabase: supabaseFalso, nomes: ['Fulano de Tal Primeiro', 'Roberto Jacinto Pinho Júnior'], ini: '2026-10-18', fim: '2026-10-28',
  ehIntegrado: () => false, t0: Date.now(), pausaMs: 0,
  transporte: async (url) => { if (url.includes('Fulano')) throw new Error('fetch failed'); return { items: itens, count: 3 }; },
});
checa('1 falha, 1 ok, sem erro geral', r2.falhas === 1 && r2.ok === 1 && !r2.erroGeral, r2);
const r3 = await pullDJENPorLeiloeiro({
  supabase: supabaseFalso, nomes: ['Fulano de Tal Primeiro'], ini: '2026-10-18', fim: '2026-10-28',
  ehIntegrado: () => false, t0: Date.now(), pausaMs: 0, transporte: async () => { throw new Error('fetch failed'); },
});
checa('todas falharam → erro geral', !!r3.erroGeral, r3.erroGeral);

console.log(falhas ? `\n${falhas} falha(s), ${ok} ok` : `\n✓ radar-por-leiloeiro: ${ok}/${ok} asserções`);
if (falhas) process.exit(1);
