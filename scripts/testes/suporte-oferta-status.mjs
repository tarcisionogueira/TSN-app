// Suporte "oferta" (rafaelleiloeiro e cia): qual lote conta como aberto (27/10).
// O Rafael mostrava 5 fazendas "Aberto para lances" com 2º leilão em 27/10, e o parser as dava por
// encerradas porque o lote vinha com status 2 (só aceitava 1). Fixture real de 26/10, com o status e a
// data do próximo leilão trocados para cobrir os casos.
import fs from 'node:fs';
import { parseDetalhe } from '../lib/suporte-oferta-parse.mjs';

const base = fs.readFileSync(new URL('./fixtures/suporte-oferta-rafael-947.html', import.meta.url), 'utf8');
const URL_LOTE = 'https://www.rafaelleiloeiro.com.br/oferta/leilao/imoveis/terreno/947/id-947/x';
const futuro = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
const comLote = (html, status) => html.replace('"status":1,"valorMinimo"', `"status":${status},"valorMinimo"`);
const comProximo = (html, dia) => html.replace(/"dataProximoLeilao":\{"date":"\d{4}-\d{2}-\d{2}/, `"dataProximoLeilao":{"date":"${dia}`);

let ok = 0, falhas = 0;
const conferir = (nome, html, esperado) => {
  const d = parseDetalhe(html, URL_LOTE);
  const v = d && d.encerrado;
  if (v === esperado) ok++; else { falhas++; console.log(`✗ ${nome}: encerrado=${v}, esperado ${esperado}`); }
};

conferir('status 1 (aberto) — fixture original', comProximo(base, futuro), false);
conferir('status 2 com próximo leilão no futuro (caso Rafael 27/10)', comProximo(comLote(base, 2), futuro), false);
conferir('status 2 com próximo leilão já passado', comProximo(comLote(base, 2), '2026-01-10'), true);
conferir('status 4 (fora do aberto)', comProximo(comLote(base, 4), futuro), true);
// Ramos Leilões / Rodrigo Costa (27/10): status 1 "Aberto para lances" com TODAS as praças vencidas (fixture: 1º 30/09,
// 2º 22/10/2026; próximo leilão trocado para 10/01/2026) — praça vencida não entra como lote ativo.
conferir('status 1 com todas as praças vencidas', comProximo(base, '2026-01-10'), true);

// DEPAULA (28/10, #376): descrição colada do Word — <!--[if gte mso 9]><xml>…</xml><![endif]--> ocupava os 6.000
// caracteres e o texto do imóvel ficava depois do corte. A marcação sai antes do corte.
const word = '<!--[if gte mso 9]><xml> <o:OfficeDocumentSettings> <o:AllowPNG/> </o:OfficeDocumentSettings> </xml><![endif]-->'
  + '<!--[if gte mso 9]><xml> <w:WordDocument> <w:View>Normal</w:View> </w:WordDocument> </xml><![endif]-->'.repeat(80);
const iDesc = base.indexOf('"descricao":"Área de terreno', base.indexOf('var lote = {')); // a do `lote`, não a do leilão
const comWord = `${base.slice(0, iDesc)}"descricao":"${word.replace(/"/g, '\\"')}<p>${base.slice(iDesc + '"descricao":"'.length)}`;
const dWord = parseDetalhe(comWord, URL_LOTE)?.descricao || '';
if (/^Área de terreno com cerca de 100\.000m²/.test(dWord) && !/<|mso|w:/.test(dWord)) ok++;
else { falhas++; console.log(`✗ descrição com marcação do Word: ${JSON.stringify(dWord.slice(0, 120))}`); }

// Luiz Lobato (28/10): "… - Centro - São Paulo - SP" no título; sem ler isso o lote caía na UF do leiloeiro (MG).
const comTitulo = (t) => base.replace(/(var lote = \{[\s\S]*?"titulo":")[^"]*/, `$1${t}`);
for (const [t, cid, uf] of [['Prédio Comercial - Largo do Paissandú Nº 62 - Centro - São Paulo - SP', 'São Paulo', 'SP'],
  ['Lotes de Terrenos Nº 31 e 32 da Quadra 01, Situado na Rua Felipe de Vasconcelos, Centro, Sete Lagoas/mg. Área Total', 'Sete Lagoas', 'MG']]) {
  const d = parseDetalhe(comTitulo(t), URL_LOTE) || {};
  if (d.cidade === cid && d.estado === uf) ok++; else { falhas++; console.log(`✗ cidade do título "${t.slice(0, 40)}…": ${d.cidade}/${d.estado}`); }
}

console.log(`${falhas ? '✗' : '✓'} suporte-oferta-status: ${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
