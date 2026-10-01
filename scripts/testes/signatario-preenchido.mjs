// npm run testar:signatario — termo/procuração não saem com "[CPF/CNPJ DO SIGNATÁRIO]" quando o
// sistema sabe o dado, e não inventam quando não sabe.
import assert from 'node:assert/strict';
import { preencherSignatario, formatarDocumento, enderecoDoPerfil, temMarcadorSignatario } from '../../api/_signatario.js';
let n = 0; const ok = (m) => { n++; console.log('  ✓', m); };
const T = 'OUTORGANTE: [NOME DO SIGNATÁRIO], CPF/CNPJ nº [CPF/CNPJ DO SIGNATÁRIO], residente em [ENDEREÇO DO SIGNATÁRIO].\nOUTORGANTE: [NOME DO SIGNATÁRIO] — CPF/CNPJ [CPF/CNPJ DO SIGNATÁRIO]';

assert.equal(formatarDocumento('52998224725'), '529.982.247-25'); ok('CPF válido formatado');
assert.equal(formatarDocumento('12345678900'), null); ok('CPF com DV errado é recusado (não entra no documento)');
assert.equal(formatarDocumento('11.222.333/0001-81'), '11.222.333/0001-81'); ok('CNPJ válido');

let t = preencherSignatario(T, { nome: 'Fulano de Tal', documento: '529.982.247-25', endereco: 'Rua A, 10, Centro, Feira de Santana/BA' });
assert.ok(!temMarcadorSignatario(t)); assert.equal(t.match(/529\.982\.247-25/g).length, 2);
ok('todas as ocorrências preenchidas (corpo e linha de assinatura)');

t = preencherSignatario(T, { nome: 'Fulano', documento: null, endereco: 'BA' });
assert.ok(t.includes('[CPF/CNPJ DO SIGNATÁRIO]') && t.includes('[ENDEREÇO DO SIGNATÁRIO]'));
ok('sem dado (ou endereço curto demais) o marcador FICA — nunca preenche com qualquer coisa');

assert.equal(enderecoDoPerfil({ endereco_cidade: 'Feira de Santana', endereco_uf: 'BA' }), null);
ok('perfil só com cidade não vira endereço de qualificação');
assert.equal(enderecoDoPerfil({ endereco_logradouro: 'Rua A', endereco_numero: '10', endereco_cidade: 'Feira', endereco_uf: 'BA', endereco_cep: '44000-000' }), 'Rua A, 10, Feira/BA, CEP 44000-000');
ok('endereço montado dos campos do checkout');
assert.equal(enderecoDoPerfil({ endereco: 'Feira de Santana/BA', endereco_cidade: 'Feira de Santana' }), null);
ok('"Cidade/UF" no texto livre do perfil NÃO é endereço de qualificação');
t = preencherSignatario(T, { documento: '52998224725', endereco: 'Arujá - SP' });
assert.ok(t.includes('[ENDEREÇO DO SIGNATÁRIO]'));
ok('endereço só com cidade não substitui o marcador');
console.log(`\n✓ signatario: ${n} casos`);
