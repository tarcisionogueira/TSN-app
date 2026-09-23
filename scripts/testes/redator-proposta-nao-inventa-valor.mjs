// Redator de proposta: a trava de saída reprova valor em R$ inventado, link faltando e assinatura
// trocada; sem exemplo nenhum ele nem chama a IA. A IA é simulada (fetch falso) — o que se testa
// aqui é a trava, que é a garantia real (o prompt é só pedido).
import assert from 'node:assert/strict';
process.env.CLAUDE_KEY = 'teste';
let resposta = '';
globalThis.fetch = async () => new Response(JSON.stringify({ content: [{ text: resposta }] }), { status: 200, headers: { 'content-type': 'application/json' } });
const { redigirProposta } = await import('../../api/_redator-proposta.js');

const exemplos = [{ assunto: 'Contato — VOLKSWAGEN', texto: 'Prezados,\n\nO veiculo foi a leilão e não houveram licitantes. Gostaria de propor 50% do valor que foi a leilão com pagamento à vista.\n\nsegue o link: https://x/1\n\nTarcisio' }];
const lote = { tipo: 'Veículo', rotulo: 'FIAT UNO 2012/2013', link: 'https://www.superbid.net/oferta/1', valorMinimo: 12000, resultado: 'sem_lance' };
const nome = 'Tarcisio de Souza';

assert.equal((await redigirProposta({ nome, exemplos: [], lote })).motivo, 'sem e-mails anteriores seus para aprender o estilo');

resposta = `Prezados,\n\nO veículo FIAT UNO 2012/2013 foi a leilão sem licitantes. Gostaria de propor 50% do lance mínimo de R$ 12.000,00, à vista.\n\nLink: https://www.superbid.net/oferta/1\n\nAgradeço.\n\n${nome}`;
const ok = await redigirProposta({ nome, exemplos, lote });
assert.ok(ok.texto, `devia aceitar: ${ok.motivo}`);

resposta = `Prezados,\n\nProponho R$ 6.000,00 à vista pelo FIAT UNO.\n\nhttps://www.superbid.net/oferta/1\n\n${nome}`;
assert.match((await redigirProposta({ nome, exemplos, lote })).motivo, /R\$6\.000,00/);

resposta = `Prezados,\n\nGostaria de propor 50% do valor, à vista, pelo FIAT UNO 2012/2013 que não teve licitantes.\n\n${nome}`;
assert.match((await redigirProposta({ nome, exemplos, lote })).motivo, /link/);

resposta = `Prezados,\n\nGostaria de propor 50% do valor pelo FIAT UNO. https://www.superbid.net/oferta/1\n\nAtenciosamente, Equipe`;
assert.match((await redigirProposta({ nome, exemplos, lote })).motivo, /assinatura/);
console.log('redator-proposta-nao-inventa-valor: todos os casos passaram');
