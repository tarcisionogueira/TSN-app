/**
 * npm run testar:busca-modelo — na falta do Gemini, o Claude entra pelo modelo BARATO, e com a
 * variante da ferramenta de busca que aquele modelo aceita.
 *
 * Pedido do dono (09/09), depois de o projeto do Gemini ser negado (HTTP 403) e TODA busca cair
 * no fallback: "na falta do Gemini o Claude entra automaticamente usando um modelo econômico e
 * eficiente (Haiku)". Haiku 4.5 custa US$ 1/US$ 5 por milhão contra US$ 3/US$ 15 do Sonnet 4.6.
 *
 * O QUE PODE QUEBRAR SOZINHO, e por isso está vigiado aqui:
 *  (a) O PAR modelo × ferramenta. `web_search_20260209` só existe em Opus 4.6+/5 e Sonnet 4.6/5.
 *      Mandá-la para o Haiku é 400 — e 400 na busca não é "sem amostras", é o relatório caindo.
 *  (b) A subida de degrau. Só vale em 4xx estrutural (volta em segundos). Em abort/timeout o
 *      orçamento já foi gasto: repetir num modelo mais lento só troca o instante da morte.
 *  (c) Os três chamadores usarem a MESMA régua. Regra duplicada nesta base sempre divergiu.
 */
import { readFileSync } from 'node:fs';
import { ferramentaBusca, cascataBusca, subirDegrau, comCascataBusca } from '../../api/_busca-modelo.js';

let ok = 0, falhas = 0;
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  ✓ ${nome}`); }
  else { falhas++; console.error(`  ✗ ${nome}${extra !== undefined ? ` → ${JSON.stringify(extra)}` : ''}`); }
};

console.log('\nO PAR MODELO × FERRAMENTA');
checa('Haiku 4.5 recebe a variante BÁSICA (a nova não existe nele → 400)',
  ferramentaBusca('claude-haiku-4-5', 6).type === 'web_search_20250305', ferramentaBusca('claude-haiku-4-5', 6));
checa('Sonnet 4.6 mantém a variante dinâmica que já usava',
  ferramentaBusca('claude-sonnet-4-6', 6).type === 'web_search_20260209');
checa('Opus 5 e Sonnet 5 também têm a dinâmica',
  ferramentaBusca('claude-opus-5', 3).type === 'web_search_20260209' && ferramentaBusca('claude-sonnet-5', 3).type === 'web_search_20260209');
checa('id com sufixo de data não engana o par (o acervo tem chamadas antigas assim)',
  ferramentaBusca('claude-haiku-4-5-20251001', 6).type === 'web_search_20250305');
checa('modelo desconhecido cai na BÁSICA — a que funciona em mais modelos',
  ferramentaBusca('claude-modelo-que-nao-existe', 6).type === 'web_search_20250305');
checa('o nome da ferramenta é sempre web_search', ferramentaBusca('claude-haiku-4-5', 6).name === 'web_search');
checa('max_uses vai junto quando pedido', ferramentaBusca('claude-haiku-4-5', 4).max_uses === 4);
checa('sem teto, não inventa max_uses', !('max_uses' in ferramentaBusca('claude-haiku-4-5')));

console.log('\nA CASCATA COMEÇA BARATO E TERMINA NO QUE JÁ FUNCIONAVA');
{
  const c = cascataBusca().map(d => d.model);
  checa('primeiro degrau é o Haiku', c[0] === 'claude-haiku-4-5', c);
  checa('último degrau é o Sonnet 4.6 (comportamento anterior preservado)', c[c.length - 1] === 'claude-sonnet-4-6', c);
  checa('cada degrau sabe montar a PRÓPRIA ferramenta',
    cascataBusca()[0].ferramenta(6).type === 'web_search_20250305' && cascataBusca()[1].ferramenta(6).type === 'web_search_20260209');
}
{
  process.env.MERCADO_MODELO_BUSCA = 'claude-sonnet-4-6';
  const c = cascataBusca().map(d => d.model);
  checa('env apontando para o Sonnet não duplica o degrau', c.length === 1 && c[0] === 'claude-sonnet-4-6', c);
  delete process.env.MERCADO_MODELO_BUSCA;
}

console.log('\nQUANDO SOBE DE DEGRAU — E QUANDO NÃO SOBE');
checa('400 (modelo × ferramenta, contexto estourado) → sobe, e custa segundos', subirDegrau(new Error('anthropic_http_400')));
checa('404 → sobe', subirDegrau(new Error('anthropic_http_404')));
checa('401 não sobe: é chave, trocar de modelo não resolve', !subirDegrau(new Error('anthropic_http_401')));
checa('403 não sobe: é permissão', !subirDegrau(new Error('anthropic_http_403')));
checa('429 não sobe: é limite de uso, e o degrau de cima cai no mesmo', !subirDegrau(new Error('anthropic_http_429')));
checa('5xx não sobe: já gastou o tempo', !subirDegrau(new Error('anthropic_http_529')));
checa('ABORT/TIMEOUT não sobe — é a regra que impede dobrar o orçamento',
  !subirDegrau(new Error('This operation was aborted')));
checa('erro sem forma conhecida não sobe', !subirDegrau(null) && !subirDegrau(new Error('boom')));

console.log('\nO ORQUESTRADOR');
{
  const vistos = [];
  const r = await comCascataBusca(async (d) => { vistos.push(d.model); return `ok:${d.model}`; });
  checa('sucesso no 1º degrau não chama o 2º', r === 'ok:claude-haiku-4-5' && vistos.length === 1, vistos);
}
{
  const vistos = [];
  const r = await comCascataBusca(async (d) => {
    vistos.push(d.model);
    if (d.model === 'claude-haiku-4-5') throw new Error('anthropic_http_400');
    return 'ok';
  });
  checa('400 no Haiku sobe para o Sonnet e entrega', r === 'ok' && vistos.length === 2, vistos);
}
{
  const vistos = [];
  let erro = null;
  try { await comCascataBusca(async (d) => { vistos.push(d.model); throw new Error('This operation was aborted'); }); }
  catch (e) { erro = e; }
  checa('abort NÃO tenta o 2º degrau', vistos.length === 1, vistos);
  checa('e o erro é PROPAGADO — vazio nunca vira resposta', /aborted/.test(String(erro?.message)));
}
{
  const vistos = [];
  await comCascataBusca(async (d) => { vistos.push(d.model); if (vistos.length === 1) throw new Error('anthropic_http_400'); return 'ok'; },
    { podeContinuar: () => true });
  checa('podeContinuar=true permite subir', vistos.length === 2);
  const vistos2 = [];
  let e2 = null;
  try {
    await comCascataBusca(async (d) => { vistos2.push(d.model); throw new Error('anthropic_http_400'); }, { podeContinuar: () => false });
  } catch (e) { e2 = e; }
  checa('sem orçamento, NÃO sobe mesmo em 400 (o chamador manda no relógio)', vistos2.length === 1, vistos2);
  checa('e ainda assim propaga o erro', /anthropic_http_400/.test(String(e2?.message)));
}
{
  const registros = [];
  try { await comCascataBusca(async () => { throw new Error('anthropic_http_400'); }, { aoFalhar: (d, e, subiu) => registros.push([d.model, subiu]) }); } catch { /* esperado */ }
  checa('aoFalhar recebe cada degrau e se subiu', registros.length === 2 && registros[0][1] === true && registros[1][1] === false, registros);
  await comCascataBusca(async () => 'ok', { aoFalhar: () => { throw new Error('log quebrado'); } })
    .then(v => checa('log que lança não derruba a busca', v === 'ok'))
    .catch(() => checa('log que lança não derruba a busca', false));
}

console.log('\nOS TRÊS CHAMADORES USAM A RÉGUA — NENHUM ESCOLHE A FERRAMENTA À MÃO');
for (const arq of ['api/gerar-analise.js', 'api/indice-mercado.js', 'api/indice-reforco-cron.js']) {
  const src = readFileSync(new URL(`../../${arq}`, import.meta.url), 'utf8');
  checa(`${arq} importa a cascata`, /from '\.\/_busca-modelo\.js'/.test(src));
  checa(`${arq} não declara web_search_ à mão`, !/type: 'web_search_20\d{6}'/.test(src));
  checa(`${arq} monta a ferramenta pelo degrau`, /degrau\.ferramenta\(/.test(src));
}

console.log('\nO PREÇO DO HAIKU ESTÁ NA TABELA DE CUSTO (senão a economia não aparece no painel)');
{
  const uso = readFileSync(new URL('../../api/_uso.js', import.meta.url), 'utf8');
  checa('claude-haiku-4-5 tem preço', /'claude-haiku-4-5':\s*\{\s*in:\s*1e-6,\s*out:\s*5e-6/.test(uso));
}

console.log(`\n${falhas ? '✗' : '✓'} ${ok} passaram, ${falhas} falharam\n`);
process.exit(falhas ? 1 : 0);
