// Aprendizado processual (30/09, dono): a consulta feita na tela/chat/triagem ENSINA o agente
// documental — série de movimentos, desfecho do arremate, lição 'processual' — e o documental
// RECEBE a leitura já feita do processo. Fetch simulado: prova ONDE cada coisa é gravada/lida.
import assert from 'node:assert/strict';
process.env.VITE_SUPABASE_URL = 'https://sb.test';
process.env.SUPABASE_SERVICE_KEY = 'k';
const chamadas = [];
// Datas RELATIVAS a hoje (01/10): a etapa só olha atos dos últimos 180 dias, então datas fixas
// faziam o teste quebrar sozinho com o passar do tempo (~fev/2027). Offsets = os de 01/10/2026.
const diasAtras = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const serie = [
  { data: diasAtras(11), codigo: 51, descricao: 'Conclusão' }, { data: diasAtras(21), codigo: 11010, descricao: 'Mero expediente' },
  { data: diasAtras(42), codigo: 12164, descricao: 'Outras Decisões — auto de arrematação' }, { data: diasAtras(61), codigo: 11010, descricao: 'Mero expediente' },
  { data: diasAtras(83), codigo: 11010, descricao: 'Mero expediente' }, { data: diasAtras(103), codigo: 12164, descricao: 'Outras Decisões' },
];
const estat = [{ de: 'decisao', para: 'decisao_seguinte', n: 254, p25: 17, mediana: 33, p75: 93 }, { de: 'conclusao', para: 'decisao_seguinte', n: 390, p25: 4, mediana: 17, p75: 56 }];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url); chamadas.push({ u, m: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
  const json = (x) => ({ ok: true, status: 200, json: async () => x });
  if (u.includes('rpc/processo_fluxo_estatistica')) return json(estat.concat(Array.from({ length: 6 }, (_, i) => ({ de: 'x' + i, para: 'y', n: 9, prob: 0.1, p25: 1, mediana: 2, p75: 3 }))));
  if (u.includes('rpc/buscar_lote_por_processo')) return json([{ id: 'lote-1', cidade: 'Salvador', estado: 'BA' }]);
  if (u.includes('arremate_aprendizado?imovel_id=eq.lote-1&limit=1')) return json([{ imovel_id: 'lote-1', realizado: {} }]);
  if (u.includes('processo_movimentos?numero_processo=in.')) return json(serie);
  if (u.includes('jurisprudencia_cache')) return json([{ tema: 'imissão na posse', resultado: { itens: [{ tribunal: 'STJ', processo: 'REsp 1', tese: 'Arrematante tem direito à imissão após a carta.', url: 'https://scon.stj.jus.br/x' }] } }]);
  return json([]);
};
const { aprenderDaConsulta, contextoProcessualParaDocumental } = await import('../../api/_aprendizado-processual.js');

const r = await aprenderDaConsulta({ numero: '0000199-97.2016.5.05.0195', origem: 'tela_caso',
  processo: { numero: '00001999720165050195', tribunal: 'TRT5', classe: 'ATOrd', movimentos: serie } });
assert.equal(r.movimentos_gravados, 6);
const post = chamadas.find((c) => c.u.includes('processo_movimentos?on_conflict'));
assert.equal(post.body[0].numero_processo, '00001999720165050195', 'série sempre com os 20 dígitos (como o monitor)');
assert.ok(chamadas.some((c) => c.u.includes('arremate_aprendizado?imovel_id=eq.lote-1') && c.m === 'PATCH'), 'desfecho gravado no arremate do lote');
const licao = chamadas.find((c) => c.u.includes('agente_aprendizado'));
assert.equal(licao.body.agente, 'processual');
assert.equal(licao.body.corpus.origem, 'tela_caso');
assert.equal(licao.body.corpus.justica, 'trabalho');
assert.equal(licao.body.corpus.etapa, 'auto de arrematação');

const ctx = await contextoProcessualParaDocumental({ numeroProcesso: '0000199-97.2016.5.05.0195' });
assert.match(ctx, /APRENDIZADO DAS CONSULTAS PROCESSUAIS/);
assert.match(ctx, /JÁ FOI LIDO pela plataforma \(6 movimentações/);
assert.match(ctx, /entre despachos do juiz, mediana 33 dias/);
assert.match(ctx, /scon\.stj\.jus\.br/);
assert.equal(await contextoProcessualParaDocumental({ numeroProcesso: '' }).then((x) => /JÁ FOI LIDO/.test(x)), false, 'sem número: sem leitura inventada');
console.log('aprendizado-processual: todos os casos passaram');

// Série completa (01/10, até 400): o "trânsito em julgado" da fase de CONHECIMENTO, anos antes do
// leilão, não pode marcar o arremate como encerrado — desfecho só pelos 20 movimentos recentes.
{
  chamadas.length = 0;
  const longa = [{ data: diasAtras(21), codigo: 85, descricao: 'Petição — Agravo de Petição' }];
  for (let i = 0; i < 25; i++) longa.push({ data: diasAtras(30 + i * 12), codigo: 11010, descricao: 'Mero expediente' });
  longa.push({ data: '2019-05-01', codigo: 848, descricao: 'Trânsito em julgado' });
  await aprenderDaConsulta({ numero: '0000199-97.2016.5.05.0195', origem: 'tela_caso', processo: { numero: '00001999720165050195', movimentos: longa } });
  const patch = chamadas.find((c) => c.u.includes('arremate_aprendizado?imovel_id=eq.lote-1') && c.m === 'PATCH');
  assert.equal(patch.body.realizado.juridico.encerrado, false, 'trânsito de 2019 não encerra o arremate de 2026');
  console.log('aprendizado-processual: série longa não fabrica desfecho');
}
