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

console.log(`${falhas ? '✗' : '✓'} suporte-oferta-status: ${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
