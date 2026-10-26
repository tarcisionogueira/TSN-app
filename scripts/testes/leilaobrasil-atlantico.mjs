// 26/10: Atlântico Leilões (template LeilãoBrasil da Suporte) — `valorMinimo`/`valorAvaliacao` = 0, lance de abertura
// em `valorInicial`, foto em `bem.arquivos` (sem `bem.image`). Valores do lote 1147 (Baraúna/PB) lidos pelo banco.
import assert from 'node:assert/strict';
import { parseLoteObj } from '../lib/leilaobrasil-parse.mjs';

const foto = 'https://static.suporteleiloes.com.br/atlanticoleiloescombr/bens/588/arquivos/6a50e7738a67f-6a50e773954cd.jpg';
const lote = {
  id: 1147, valorAvaliacao: 0, valorMinimo: 0, valorInicial: 90000, valorInicial2: 45000,
  bem: { siteTitulo: 'Imóvel residencial, localizado na Rua Castelo Branco, 415, Centro, Baraúna - PB', cidade: 'Baraúna', uf: 'PB',
    image: null, arquivos: [{ url: 'https://static.suporteleiloes.com.br/atlanticoleiloescombr/bens/588/arquivos/edital.pdf' }, { url: foto }] },
  leilao: { id: 500, titulo: 'Imóvel residencial', judicial: true },
};
const r = parseLoteObj(lote);
assert.equal(r.valor_minimo, 90000);
assert.equal(r.link_foto, foto);
// Quem preenche valorMinimo (LEILAOBRASIL/LUTHERO) não muda.
assert.equal(parseLoteObj({ ...lote, valorMinimo: 120000 }).valor_minimo, 120000);
assert.equal(parseLoteObj({ ...lote, bem: { ...lote.bem, image: { full: { url: 'https://x.com/a.jpg' } } } }).link_foto, 'https://x.com/a.jpg');
console.log('leilaobrasil-atlantico: ok');
