// A página do lote lista OUTROS lotes ("Veja também") com as datas deles — elas não podem virar
// a 2ª praça / o início do lote aberto. Trecho REAL da ZUK (recon 23/09, Alameda dos Lírios 196).
import assert from 'node:assert/strict';
import { extrairDatasLeilao } from '../../api/enriquecer-lote.js';

const ano = new Date().getFullYear() + 1; // datas sempre futuras, o teste não envelhece
const zuk = `<h1>Casa à venda em leilão</h1> Relação completa do leilão Encerra em 29/09/${ano % 100} às 11h40
  Em leilão pelo valor de R$ 1.500.000,00 01 Dias 01 Horas Lance mínimo: Data 29/09/${ano % 100} às 11h40
  <h2>Descrição do imóvel</h2> Ocupado. <h2>Veja também</h2> Apartamento Barueri / SP - Alphaville Avenida Sagitário, 138
  1º leilão R$ 1.431.732,27 28/09/${ano} às 14:03 2º leilão R$ 715.866,15 05/10/${ano} às 14:03
  Loja Barueri Lance inicial R$ 3.600.000,00 14/10/${ano} às 11:00`;
const r = extrairDatasLeilao(zuk);
assert.equal(r.praca2, null, `praca2 veio do vizinho: ${r.praca2}`);
assert.equal(r.inicio, `${ano}-09-29`, `início veio do vizinho: ${r.inicio}`);
assert.equal(r.encerramento, new Date(`${ano}-09-29T11:40:00-03:00`).toISOString());
console.log('ok  ZUK "Veja também" não contamina', JSON.stringify(r));

// Marcador ANTES de qualquer data do lote (menu) não corta o lote.
const menu = `Menu: Veja também nossos parceiros. 1º Leilão: 10/11/${ano} às 10:00 2º Leilão: 17/11/${ano} às 10:00`;
const r2 = extrairDatasLeilao(menu);
assert.equal(r2.inicio, `${ano}-11-10`);
assert.ok(r2.praca2 || r2.fim, 'a 2ª praça do PRÓPRIO lote tem de continuar sendo lida');
console.log('ok  marcador no menu não apaga as datas do lote', JSON.stringify(r2));
// GRUPOLANCE (30/09, Osasco 28149): o lote NÃO publica data e a vitrine tem cabeçalho explícito.
// A regra "só corta depois da 1ª data do lote" não cortava nada, e o vizinho virou o prazo.
const gl = `Imóvel Comercial, AC 15.658,00m², Jardim Maurilópolis, Osasco/SP Localização Av. Manoel Pedro Pimentel, 50
  Veja também Lotes que podem te interessar Casa, 228m², Osasco/SP 28061 - LOTE 1 Faça seu lance P. Única
  Abertura 20/07/${ano} às 00:00 Encerramento 20/10/${ano} às 15:05 Veículo C4 Em breve Leilão 09/11/${ano} às 00:00`;
const r3 = extrairDatasLeilao(gl);
assert.equal(r3.inicio, null, `início veio do vizinho: ${r3.inicio}`);
assert.equal(r3.encerramento, null, `encerramento veio do vizinho: ${r3.encerramento}`);
console.log('ok  cabeçalho "Lotes que podem te interessar" corta mesmo sem data do lote', JSON.stringify(r3));
console.log('datas-do-lote-nao-vem-dos-vizinhos: todos os casos passaram');
