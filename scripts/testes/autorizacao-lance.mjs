// #419 (16/11): o texto da autorização de lance é o MESMO no navegador e no servidor (o servidor só grava se o texto
// que o cliente leu for idêntico ao dele). Sem toLocaleString: formatação à mão, determinística.
import assert from 'node:assert/strict';
import { textoAutorizacao, brlTexto, dataTexto, VERSAO_AUTORIZACAO } from '../../src/lib/autorizacao-lance.js';
import { textoAutorizacao as doServidor, VERSAO_AUTORIZACAO as versaoServidor } from '../../api/_oportunidade-selecionada.js';

assert.equal(brlTexto(250000), 'R$ 250.000,00');
assert.equal(brlTexto(1234567.5), 'R$ 1.234.567,50');
assert.equal(brlTexto(999.995), 'R$ 1.000,00');
assert.equal(dataTexto('2026-11-16T01:30:00Z'), '15/11/2026', 'Brasília (UTC−3): 01:30 UTC ainda é dia 15');
assert.equal(dataTexto(null), 'data não informada');
const dados = { titulo: 'Apto 701', cidade: 'Governador Valadares', uf: 'MG', valorMaximo: 250000,
  relatorios: { mercado: { gerado_em: '2026-11-10T12:00:00Z' }, documental: { gerado_em: '2026-11-11T12:00:00Z' } } };
const t = textoAutorizacao(dados);
assert.equal(t, doServidor(dados), 'navegador e servidor montam o mesmo texto');
assert.equal(VERSAO_AUTORIZACAO, versaoServidor);
assert.match(t, /até o valor máximo de R\$ 250\.000,00/);
assert.match(t, /mercadológico \(gerado em 10\/11\/2026\).*documental \(gerado em 11\/11\/2026\)/);
assert.match(t, /revogar/);
// A tela recebe as datas achatadas (mercado_em/documental_em); o texto tem de sair igual.
assert.equal(textoAutorizacao({ ...dados, relatorios: { mercado_em: '2026-11-10T12:00:00Z', documental_em: '2026-11-11T12:00:00Z' } }), t);
console.log('ok — autorização de lance: texto determinístico e igual no navegador e no servidor');
