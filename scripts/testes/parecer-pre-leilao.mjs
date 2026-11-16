// Teste do parecer-pre-leilao-cron (16/11): as partes puras, com o texto REAL das respostas de 16/11.
// O confronto pela IA não entra aqui (precisa de chave); ele é conferido em produção pela tabela
// parecer_pre_leilao_lido.
import assert from 'node:assert/strict';
import { semCitacao, resumoDocumental } from '../../api/parecer-pre-leilao-cron.js';

// Resposta do escritório (Gmail): o pedido nosso vem citado depois de "Em ... escreveu:".
const gmail = `Bom dia, Tarcísio. Segue em anexo a análise solicitada.

Em qui., 12 de nov. de 2026 às 14:28, Tarcisio de Souza Nogueira de Araujo
(BidPro Brasil) <tarcisio@bidprobrasil.com.br> escreveu:

> Prezados, Solicitamos a análise da documentação do imóvel abaixo
> Imóvel: Apartamento Nº 106`;
assert.equal(semCitacao(gmail), 'Bom dia, Tarcísio. Segue em anexo a análise solicitada.');

// Resposta do Outlook: o histórico começa em "De:".
const outlook = `Tks

Operações de credito acima de R$ 500.000,00

De: Escritório <x@y.adv.br>
Enviada em: segunda-feira, 16 de novembro de 2026 11:01
Assunto: Re: Apoio jurídico`;
assert.equal(semCitacao(outlook), 'Tks\n\nOperações de credito acima de R$ 500.000,00');

assert.equal(semCitacao(null), '');

// Recorte do relatório: as chaves do result real chegam ao prompt (débitos em extracao, processo em cnj).
const result = {
  parecer: 'Viável com ressalvas', nivelRisco: 'medio',
  riscos: [{ categoria: 'Hipoteca CEF não cancelada' }],
  extracao: { debitosDiscriminados: [{ tipo: 'Hipoteca CEF', valor: 35978.35 }], outra: 'x'.repeat(5000) },
  cnj: { parecer: { nivel: 'verde' }, processos: [] },
  raioX: { debitos: { totalAssumidoArrematante: 12443.91 }, cadeiaDominial: [] },
};
const r = JSON.parse(resumoDocumental(result));
assert.equal(r.nivelRisco, 'medio');
assert.equal(r.debitosDiscriminados[0].valor, 35978.35);
assert.equal(r.processo.nivel, 'verde');
assert.equal(r.raioX.debitos.totalAssumidoArrematante, 12443.91);
assert.ok(!('outra' in r), 'o recorte não carrega o resto da extração');

// Relatório num formato desconhecido: cai no JSON inteiro em vez de mandar um recorte vazio à IA.
assert.ok(resumoDocumental({ formatoNovo: { a: 1 } }).includes('formatoNovo'));
assert.ok(resumoDocumental({ x: 'y'.repeat(40000) }).length <= 16000);

console.log('✓ parecer-pre-leilao: corte da citação e recorte do relatório');
