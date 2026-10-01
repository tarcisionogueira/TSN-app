// Previsão do andamento (30/09): janela pelo ritmo do processo, fluxo provável pela base (n>=5),
// etapa da arrematação com base legal. Amostra pequena não vira número.
import assert from 'node:assert/strict';
import { classeMovimento, ritmo, preverAndamento, etapaDaArrematacao, justicaDoNumero } from '../../api/_previsao-processo.js';

assert.equal(classeMovimento(51, 'Conclusão'), 'conclusao');
assert.equal(classeMovimento(11010, 'Mero expediente'), 'decisao');
assert.equal(classeMovimento(92, 'Publicação'), 'publicacao');
assert.equal(classeMovimento(null, 'Expedição de documento — Carta de arrematação'), 'expedicao');
assert.equal(justicaDoNumero('0000199-97.2016.5.05.0195'), 'trabalho');

assert.equal(ritmo(['2026-09-01', '2026-09-02']).mediana, undefined, 'menos de 4 intervalos: sem número');
const r = ritmo(['2026-06-01', '2026-06-11', '2026-06-21', '2026-07-11', '2026-07-21', '2026-07-21']);
assert.deepEqual([r.n, r.mediana, r.ultimo], [4, 10, '2026-07-21']);

const estat = [
  { de: 'conclusao', para: 'decisao_seguinte', n: 395, prob: null, p25: 4, mediana: 17, p75: 55 },
  { de: 'conclusao', para: 'decisao', n: 275, prob: 0.696, p25: 0, mediana: 0, p75: 4 },
  { de: 'conclusao', para: 'peticao', n: 69, prob: 0.175, p25: 0, mediana: 0, p75: 4 },
  { de: 'conclusao', para: 'raro', n: 2, prob: 0.005, p25: 1, mediana: 1, p75: 1 },
  { de: 'decisao', para: 'decisao_seguinte', n: 264, prob: null, p25: 18, mediana: 34, p75: 95 },
];
// Poucos movimentos → janela pela base; último ato = conclusão.
const p = preverAndamento({ movimentos: [{ data: '2026-09-20', descricao: 'Conclusão', codigo: 51 }, { data: '2026-09-10', descricao: 'Petição', codigo: 85 }], estat, hoje: '2026-09-30' });
assert.equal(p.ultimo_ato.classe, 'conclusao');
assert.equal(p.proxima_janela.de, '2026-09-24');
assert.equal(p.proxima_janela.ate, '2026-11-14');
assert.match(p.proxima_janela.fonte, /base da plataforma \(395 casos/);
assert.deepEqual(p.fluxo_provavel.map((f) => f.probabilidade), [70, 18], 'linha com n<5 fica fora');
assert.equal(p.entre_despachos.mediana, 34);
assert.match(p.resumo, /autos conclusos/);
// Ritmo próprio: janela pelo processo; atraso vira aviso de cobrar a secretaria.
const movs = ['2026-03-01', '2026-03-11', '2026-03-21', '2026-03-31', '2026-04-10'].map((d, i) => ({ data: d, descricao: i % 2 ? 'Mero expediente' : 'Petição', codigo: i % 2 ? 11010 : 85 }));
const q = preverAndamento({ movimentos: movs, estat, hoje: '2026-09-30' });
assert.equal(q.proxima_janela.atrasada, true);
assert.equal(q.status, 'parado');
assert.match(q.resumo, /cobrar a secretaria/);
// Caso REAL (TJSP 0014485-31.2024.8.26.0562, série do monitor): juiz despacha a cada ~17 dias; último
// despacho 24/08 → em 30/09 está atrasado. Antes o selo dizia "andando" ao lado de "já era esperada".
{
  const d = { '03-26': [51, 85, 12164], '04-07': [51, 12164], '05-06': [85, 11010], '06-16': [12164], '07-03': [51, 12164], '07-31': [51, 11010], '08-17': [12164], '08-21': [11010], '08-24': [51, 11010], '08-26': [85], '09-01': [85] };
  const movsR = Object.entries(d).flatMap(([k, cs]) => cs.map((c) => ({ data: `2026-${k}`, codigo: c, descricao: '' })));
  const pr = preverAndamento({ movimentos: movsR, estat, hoje: '2026-09-30' });
  assert.equal(pr.entre_despachos.fonte, 'este processo');
  assert.equal(pr.proximo_despacho.ultimo, '2026-08-24');
  assert.equal(pr.proximo_despacho.atrasado, true);
  assert.equal(pr.status, 'lento', 'atraso nunca aparece com selo "andando"');
  assert.match(pr.resumo, /^O juiz costuma despachar a cada ~\d+ dias/);
}
// Etapa legal
assert.equal(etapaDaArrematacao(['Lavrado o auto de arrematação']).etapa, 'auto de arrematação');
assert.match(etapaDaArrematacao(['Expeça-se carta de arrematação']).base_legal, /901/);
assert.equal(etapaDaArrematacao(['Petição juntada']), null);
assert.equal(preverAndamento({ movimentos: [] }).disponivel, false);
console.log('previsao-andamento: todos os casos passaram');

// Jurisprudência: só link verificável de tribunal/portal permitido; sem tese vazia; sem duplicata.
{
  const { urlPermitida, filtrarItens, chaveTema } = await import('../../api/_jurisprudencia.js');
  assert.equal(urlPermitida('https://processo.stj.jus.br/SCON/pesquisar.jsp?b=ACOR'), true);
  assert.equal(urlPermitida('https://www.conjur.com.br/2025-jan-10/x'), true);
  assert.equal(urlPermitida('https://www.jusbrasil.com.br/jurisprudencia/x'), false, 'fora da lista');
  assert.equal(urlPermitida('https://jus.br.golpe.com/x'), false, 'domínio falso');
  assert.equal(urlPermitida('javascript:alert(1)'), false);
  const itens = filtrarItens([
    { tribunal: 'STJ', processo: 'REsp 1.234', tese: 'O prazo de 10 dias para impugnar a arrematação conta da assinatura do auto.', url: 'https://scon.stj.jus.br/a' },
    { tribunal: 'STJ', processo: 'dup', tese: 'O prazo de 10 dias para impugnar a arrematação conta da assinatura do auto.', url: 'https://scon.stj.jus.br/a#x' },
    { tribunal: 'X', tese: 'curta', url: 'https://tjsp.jus.br/b' },
    { tribunal: 'Y', tese: 'Tese longa o bastante mas o link é de um site não permitido.', url: 'https://blog.com/c' },
  ]);
  assert.equal(itens.length, 1);
  assert.equal(chaveTema('Imissão na POSSE!', 'TRT5'), chaveTema('imissao na posse', 'trt5'));
  console.log('jurisprudencia-filtros: todos os casos passaram');
}

// CNJ fora (30/09 à noite: DataJud TRT5 com timeout de 30 s e DJEN 500 ao mesmo tempo): sem
// movimentação, o card mostra a REFERÊNCIA da base, dita como tal — em vez de sumir.
{
  const { preverAndamento: prev } = await import('../../api/_previsao-processo.js');
  const ref = prev({ movimentos: [], estat: [{ de: 'decisao', para: 'decisao_seguinte', n: 254, p25: 17, mediana: 33, p75: 93 }], justica: 'trabalho' });
  assert.equal(ref.disponivel, true);
  assert.equal(ref.so_referencia, true);
  assert.equal(ref.status, null, 'sem dado do processo não há selo de andamento');
  assert.match(ref.resumo, /Não consegui ler as movimentações deste processo agora/);
  assert.match(ref.aviso, /não do seu processo/);
  console.log('previsao-sem-fonte: todos os casos passaram');
}

// 01/10 — processo REAL do TRT5 (0000199-97.2016.5.05.0195): com os 20 últimos movimentos o ritmo de
// despachos saía vazio; com a série completa, ~40 dias entre despachos. E o agravo de petição de
// 10/09 (que só existe em complementosTabelados) é a etapa atual — o de 2025 fica fora (>180 dias).
{
  const { preverAndamento: pa, classeMovimento: cm } = await import('../../api/_previsao-processo.js');
  const desp = ['2026-08-26','2026-07-06','2026-04-27','2026-03-18','2026-02-02','2025-12-09','2025-11-04','2025-09-30','2025-07-29','2025-07-28','2025-07-14','2025-02-20','2024-11-14','2024-10-07','2024-09-02','2024-08-06','2024-07-03'];
  const movs = [{ data: '2026-09-10', codigo: 85, descricao: 'Petição — Agravo de Petição' }, { data: '2025-12-01', codigo: 85, descricao: 'Petição — Agravo de Petição' },
    ...desp.map((d) => ({ data: d, codigo: 11010, descricao: 'Mero expediente' }))];
  const pv = pa({ movimentos: movs, publicacoes: [], estat: [], justica: 'trabalho', hoje: '2026-10-01' });
  if (!pv.proximo_despacho || pv.entre_despachos?.fonte !== 'este processo') { console.error('FALHOU: série completa deveria dar o ritmo de despachos', pv); process.exit(1); }
  if (!/agravo de peti/.test(pv.etapa_arrematacao?.etapa || '')) { console.error('FALHOU: agravo de petição recente deveria ser a etapa', pv.etapa_arrematacao); process.exit(1); }
  const velho = pa({ movimentos: [{ data: '2025-12-01', codigo: 85, descricao: 'Petição — Agravo de Petição' }, ...desp.map((d) => ({ data: d, codigo: 11010, descricao: 'Mero expediente' }))], estat: [], hoje: '2026-10-01' });
  if (/agravo/.test(velho.etapa_arrematacao?.etapa || '')) { console.error('FALHOU: agravo de 10 meses atrás não é etapa atual'); process.exit(1); }
  if (cm(200, 'Não-Acolhimento de Embargos de Declaração') !== 'decisao') { console.error('FALHOU: código 200 é decisão'); process.exit(1); }
  console.log('✓ TRT5 real: ritmo de despachos com série completa, agravo de petição recente como etapa');
}
