// Identidade do imóvel no edital (30/09, achado de 17/09 liberado pelo dono): o 1º "Rua/Condomínio/
// Bairro" do texto costuma ser o ESCRITÓRIO do leiloeiro (cabeçalho/rodapé), e o nome do condomínio
// vira âncora da busca de comparáveis. Agora vale a ocorrência cujo contexto mais próximo é o imóvel.
import assert from 'node:assert/strict';
import { extrairIdentidadeTexto } from '../../api/_doc-extracao.js';

// Cabeçalho com escritório ANTES do imóvel (forma mais comum).
const e1 = `EDITAL DE LEILÃO. JOSÉ DA SILVA, Leiloeiro Oficial, JUCESP nº 123, com escritório na Rua Augusta, 1500, Bairro Consolação, São Paulo/SP, telefone (11) 3333-4444, FAZ SABER que levará a leilão o imóvel: Apartamento nº 52, situado na Rua das Acácias, 200, Condomínio Residencial Jardim Europa, Bairro Vila Mariana, São Paulo/SP, matrícula 12.345 do 1º CRI.`;
const r1 = extrairIdentidadeTexto(e1);
assert.equal(r1.logradouro, 'Rua das Acácias', `logradouro do escritório: ${r1.logradouro}`);
assert.equal(r1.bairro, 'Vila Mariana', `bairro do escritório: ${r1.bairro}`);
assert.match(r1.nomeCondominio, /Jardim Europa/);

// Rodapé com o escritório DEPOIS do imóvel.
const e2 = `LOTE ÚNICO. Imóvel: casa localizada na Avenida Brasil, 900, Bairro Centro, Campinas/SP, com 180 m² de área construída, objeto da matrícula 99.999. Informações: Leiloeiro Oficial, escritório na Avenida Paulista, 1000 — www.leiloeiro.com.br — e-mail contato@leiloeiro.com.br.`;
const r2 = extrairIdentidadeTexto(e2);
assert.equal(r2.logradouro, 'Avenida Brasil');
assert.equal(r2.bairro, 'Centro');

// "Leiloeiro … levará a leilão o imóvel situado na Rua B": a pista mais próxima é o imóvel.
const e3 = `O Leiloeiro Oficial Fulano de Tal levará a público leilão o imóvel situado na Rua Dona Otília, 45, Bairro Jardim Paulista, na cidade de Ribeirão Preto/SP, conforme matrícula 7.777, livre de ocupação, a ser vendido nas condições deste edital.`;
assert.equal(extrairIdentidadeTexto(e3).logradouro, 'Rua Dona Otília');

// "1ª Praça" / "Praça única" é praça do LEILÃO, não logradouro.
const e4 = `CONDIÇÕES. A 1ª Praça Eletrônica ocorrerá em 10/11 e a 2ª Praça Eletrônica em 20/11. Descrição do bem: terreno situado na Estrada Municipal do Sertãozinho, km 3, zona rural de Itu/SP, matrícula 55.555, com 5.000 m².`;
assert.equal(extrairIdentidadeTexto(e4).logradouro, 'Estrada Municipal do Sertãozinho');

// Sem pista nenhuma: comportamento antigo (a primeira ocorrência).
const e5 = `${'Texto genérico do edital sem contexto relevante. '.repeat(3)} Rua Alfa, 10 e depois Rua Beta, 20.`;
assert.equal(extrairIdentidadeTexto(e5).logradouro, 'Rua Alfa');
console.log('identidade-nao-pega-escritorio-do-leiloeiro: todos os casos passaram');
