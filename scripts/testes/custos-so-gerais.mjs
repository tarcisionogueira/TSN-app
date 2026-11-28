// 28/11: em edital de VÁRIOS lotes sem o bloco deste isolado, IPTU/condomínio são de algum lote — não deste.
// custosSoGerais tira os valores por lote e mantém a cláusula geral (taxa administrativa / despesas fixas).
import { extrairCustosTexto, custosSoGerais } from '../../api/_doc-extracao.js';
let ok = 0, falhas = 0;
const eq = (nome, a, b) => { const p = JSON.stringify(a) === JSON.stringify(b); p ? ok++ : falhas++; if (!p) console.log(`✗ ${nome}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };
const t = 'Edital de leilão judicial. Taxa administrativa de 5% sobre a arrematação. Lote 1: apartamento. Consta débito de IPTU no valor de R$ 27.095,44 e débito de condomínio em aberto de R$ 539.672,06, que serão sub-rogados no preço nos termos do art. 130, parágrafo único, do CTN. Lote 2: casa avaliada em R$ 300.000,00 com informações gerais sobre o leilão e as praças.';
const c = extrairCustosTexto(t);
eq('texto inteiro lê os débitos', [c.iptuDebito, c.condominioDebito, c.taxaAdmPct], [27095.44, 539672.06, 5]);
const g = custosSoGerais(c);
eq('só gerais: débitos e carrego por lote saem', [g.iptuDebito, g.condominioDebito, g.iptuMensal, g.condominioMensal, 'responsabilidadeDebitos' in g], [null, null, null, null, false]);
eq('só gerais: taxa administrativa fica', g.taxaAdmPct, 5);
eq('só gerais: nada geral → null', custosSoGerais({ iptuDebito: 10, condominioDebito: 20 }), null);
eq('só gerais: entrada nula → null', custosSoGerais(null), null);
console.log(`custos-so-gerais: ${ok} ok, ${falhas} falha(s)`);
if (falhas) process.exit(1);
