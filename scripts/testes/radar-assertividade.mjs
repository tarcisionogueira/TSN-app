/**
 * npm run testar:radar-assertividade — as quatro correções do radar de editais de 29/10, medidas na 1ª rodada do radar
 * por nome (67 editais gravados: só 39 distintos, 32 `erro_parse`, leiloeiro "Ponte Nova"/"Monte Azul"/"S Oficias").
 *   1. teor em HTML ou com entidades vira texto limpo antes do filtro e do parser;
 *   2. o mesmo edital em outra comunicação (outro djen_id) não entra de novo — hash do conteúdo limpo;
 *   3. na busca por nome, o leiloeiro gravado é o BUSCADO (já confirmado no texto);
 *   4. município do IBGE não passa como nome de leiloeiro.
 */
import { textoLimpoEdital, hashConteudoEdital, extrairLeiloeiroAntes, pullDJENPorLeiloeiro } from '../../api/radar-editais-cron.js';

let ok = 0, falhas = 0;
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  ✓ ${nome}`); }
  else { falhas++; console.error(`  ✗ ${nome}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`); }
};

console.log('\n1. TEXTO LIMPO');
const html = '<html> <head> <meta> <style>p{color:red}</style> </head> <body> <article> <p>EDITAL DE LEIL&Atilde;O</p>'
  + '<p>Avalia&ccedil;&atilde;o: R$ 100.000,00</p> </article> </body></html>';
const limpo = textoLimpoEdital(html);
checa('HTML: sem tags nem CSS', !/[<>]|color:red/.test(limpo), limpo);
checa('HTML: entidades decodificadas', /EDITAL DE LEILÃO/.test(limpo) && /Avaliação: R\$ 100\.000,00/.test(limpo), limpo);
checa('texto com entidades sem tags (TJGO)', textoLimpoEdital('Estado de Goi&aacute;s - 3&ordf; UPJ') === 'Estado de Goiás - 3ª UPJ', textoLimpoEdital('Estado de Goi&aacute;s - 3&ordf; UPJ'));
checa('texto puro passa igual', textoLimpoEdital('Leilão em 10/11/2026') === 'Leilão em 10/11/2026');
checa('"menor que" solto não é tag', textoLimpoEdital('valor < 500 e > 100') === 'valor < 500 e > 100', textoLimpoEdital('valor < 500 e > 100'));

console.log('\n2. MESMO EDITAL, OUTRA COMUNICAÇÃO');
const h1 = hashConteudoEdital('TRT3', '0010-11.2020.5.03.0074', 'EDITAL  DE LEILÃO.\nBem: imóvel em Monte Azul.');
const h2 = hashConteudoEdital('TRT3', '0010-11.2020.5.03.0074', 'edital de leilão bem: imóvel em monte azul');
checa('espaço, quebra e caixa não mudam o hash', h1 === h2, [h1, h2]);
checa('outro processo, outro hash', h1 !== hashConteudoEdital('TRT3', '0099-11.2020.5.03.0074', 'EDITAL DE LEILÃO. Bem: imóvel em Monte Azul.'));
checa('prefixo c: (não colide com o hash antigo)', h1.startsWith('c:'));

const EDITAL = (leiloeiro, extra = '') => `EDITAL DE LEILÃO PÚBLICO. 1º Leilão em 10/11/2026. ENDEREÇO DE VISITAÇÃO: Rua X, 300, Ouro Preto/MG. `
  + `Leiloeiro oficial nomeado: ${leiloeiro}, JUCEMG nº 123. Avaliação: R$ 350.000,00. Lance mínimo R$ 175.000,00.${extra}`;
const gravadas = [];
const supabaseFalso = { from: () => ({ select: () => ({ in: async () => ({ data: [] }) }), upsert: async (rows) => { gravadas.push(...rows); return { error: null }; } }) };
const itens = [
  { id: 10, siglaTribunal: 'TRT3', numeroProcesso: '0010-11.2020.5.03.0074', tipoComunicacao: 'Edital', texto: EDITAL('Maria Aparecida Souza Lima') },
  // a MESMA publicação de novo, com outro id e em HTML (o DJEN faz isso)
  { id: 11, siglaTribunal: 'TRT3', numeroProcesso: '0010-11.2020.5.03.0074', tipoComunicacao: 'Edital', texto: `<html><body><p>${EDITAL('Maria Aparecida Souza Lima')}</p></body></html>` },
];
const r = await pullDJENPorLeiloeiro({ supabase: supabaseFalso, nomes: ['MARIA APARECIDA SOUZA LIMA'], ini: '2026-10-18', fim: '2026-10-28', ehIntegrado: () => false, t0: Date.now(), transporte: async () => ({ items: itens, count: 2 }), pausaMs: 0 });
checa('duas comunicações do mesmo edital → 1 gravada', gravadas.length === 1, gravadas.map((g) => g.djen_id));
checa('contagem de citações conta as duas', r.citados === 2, r);

console.log('\n3. O LEILOEIRO É O BUSCADO');
checa('leiloeiro_nome = nome buscado, em título', gravadas[0]?.leiloeiro_nome === 'Maria Aparecida Souza Lima', gravadas[0]?.leiloeiro_nome);
checa('leiloeiro_nome_norm preenchido', gravadas[0]?.leiloeiro_nome_norm === 'maria aparecida souza lima', gravadas[0]?.leiloeiro_nome_norm);

console.log('\n4. MUNICÍPIO NÃO É LEILOEIRO');
checa('"MONTE AZUL LEILOEIRO OFICIAL" → null', extrairLeiloeiroAntes('Vara do Trabalho - MONTE AZUL LEILOEIRO OFICIAL') === null,
  extrairLeiloeiroAntes('Vara do Trabalho - MONTE AZUL LEILOEIRO OFICIAL'));
checa('"OURO PRETO LEILOEIRO OFICIAL" → null', extrairLeiloeiroAntes('visitação - OURO PRETO LEILOEIRO OFICIAL') === null);
checa('nome de verdade continua passando', extrairLeiloeiroAntes('pagamento - RAFAEL ARAÚJO GOMES, LEILOEIRO OFICIAL') === 'Rafael Araújo Gomes',
  extrairLeiloeiroAntes('pagamento - RAFAEL ARAÚJO GOMES, LEILOEIRO OFICIAL'));
checa('primeira palavra de uma letra → null', extrairLeiloeiroAntes('pagamento - S OFICIAS LEILOEIRO OFICIAL') === null);

console.log(falhas ? `\n${falhas} falha(s), ${ok} ok` : `\n✓ radar-assertividade: ${ok}/${ok} asserções`);
if (falhas) process.exit(1);
