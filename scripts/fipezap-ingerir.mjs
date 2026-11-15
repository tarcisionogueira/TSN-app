// FIPEZAP OFICIAL (15/11, arena #484 item 5): baixa a série histórica publicada pela Fipe (grátis, sem cota) e grava o
// preço médio de venda e de locação residencial (R$/m², "Total") por cidade em fipezap_cidade. Serve SÓ de ALARME no
// Índice (não entra no valor). Antes, o "FipeZAP" vinha do que a IA declarava na pesquisa: Salvador a R$ 12.434/m² com
// 2 valores, Goiânia "casa" (o índice é de apartamentos).
//
// Estrutura conferida em seco (run 43747855482): uma aba por cidade; linha 4 = cabeçalho ("Data" na coluna B); dados
// da linha 5 em diante, data em serial do Excel na coluna B; "Preço médio (R$/m²) Total" de VENDA na coluna 17 e de
// LOCAÇÃO na 37 (0-based). Célula sem dado vem como ".". A aba "Índice FipeZAP" é o composto nacional (fica de fora).
// A aba não traz UF: casa pelo nome em municipio_norm; homônimo só com UF declarada em HOMONIMOS (senão fica de fora
// e aparece no log — não chuta).
//
// FIPEZAP_SECO=1: imprime o casamento cidade→UF e os últimos valores, sem gravar.
import { lerXlsx, serialParaData } from './lib/xlsx-leve.mjs';

const URL_FZ = 'https://downloads.fipe.org.br/indices/fipezap/fipezap-serieshistoricas.xlsx';
const SECO = process.env.FIPEZAP_SECO === '1';
const SB = process.env.VITE_SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_KEY;
const COL_DATA = 1, COL_VENDA = 17, COL_LOC = 37, MESES = 24;
const HOMONIMOS = { 'campo grande': 'MS', 'santo andre': 'SP', 'sao jose': 'SC', 'sao bernardo do campo': 'SP',
  'sao caetano do sul': 'SP', 'vitoria': 'ES', 'guaruja': 'SP', 'jaboatao dos guararapes': 'PE', 'contagem': 'MG',
  'betim': 'MG', 'canoas': 'RS', 'osasco': 'SP', 'barueri': 'SP', 'niteroi': 'RJ', 'sao luis': 'MA', 'natal': 'RN',
  'londrina': 'PR', 'pelotas': 'RS', 'santos': 'SP', 'sao vicente': 'SP', 'praia grande': 'SP', 'diadema': 'SP',
  'novo hamburgo': 'RS', 'caxias do sul': 'RS', 'sao jose dos campos': 'SP', 'sao jose dos pinhais': 'PR',
  'goiania': 'GO', 'brasilia': 'DF', 'belem': 'PA', 'manaus': 'AM', 'maceio': 'AL', 'recife': 'PE', 'salvador': 'BA',
  'fortaleza': 'CE', 'joao pessoa': 'PB', 'teresina': 'PI', 'aracaju': 'SE', 'cuiaba': 'MT', 'curitiba': 'PR',
  'florianopolis': 'SC', 'porto alegre': 'RS', 'rio de janeiro': 'RJ', 'belo horizonte': 'MG', 'sao paulo': 'SP',
  'campinas': 'SP', 'ribeirao preto': 'SP', 'sorocaba': 'SP', 'guarulhos': 'SP', 'joinville': 'SC', 'blumenau': 'SC',
  'balneario camboriu': 'SC', 'itajai': 'SC', 'vila velha': 'ES', 'serra': 'ES', 'cariacica': 'ES', 'sao goncalo': 'RJ',
  'duque de caxias': 'RJ', 'nova iguacu': 'RJ', 'uberlandia': 'MG', 'juiz de fora': 'MG', 'maringa': 'PR',
  'ponta grossa': 'PR', 'cascavel': 'PR', 'santa maria': 'RS', 'campos dos goytacazes': 'RJ', 'petropolis': 'RJ',
  'mogi das cruzes': 'SP', 'sao jose do rio preto': 'SP', 'jundiai': 'SP', 'piracicaba': 'SP', 'taubate': 'SP',
  'bauru': 'SP', 'franca': 'SP', 'limeira': 'SP', 'americana': 'SP', 'indaiatuba': 'SP', 'macae': 'RJ' };
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

async function rest(path, init = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path.split('?')[0]}: HTTP ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

const r = await fetch(URL_FZ, { signal: AbortSignal.timeout(60000) });
if (!r.ok) { console.error(`[fipezap] download falhou: HTTP ${r.status}`); process.exit(1); }
const { abas } = lerXlsx(new Uint8Array(await r.arrayBuffer()));
console.log(`[fipezap] ${abas.length} abas`);

const linhas = [], foraDeCasamento = [];
for (const a of abas) {
  const cab = a.linhas[3] || [];
  if (cab[COL_DATA] !== 'Data' || /^[íi]ndice fipezap/i.test(a.nome)) continue;
  const rotulo = String((a.linhas[0] || [])[1] || a.nome).trim();
  const n = norm(rotulo);
  // municipio_norm: nome_norm com espaço; cidade_norm do Índice = mesmo nome sem espaço.
  const cands = await rest(`municipio_norm?nome_norm=eq.${encodeURIComponent(n)}&select=uf`);
  const ufs = [...new Set((cands || []).map((c) => c.uf))];
  const uf = ufs.length === 1 ? ufs[0] : (HOMONIMOS[n] && ufs.includes(HOMONIMOS[n]) ? HOMONIMOS[n] : null);
  if (!uf) { foraDeCasamento.push(`${rotulo} (${ufs.join('/') || 'nenhuma UF'})`); continue; }
  const dados = a.linhas.slice(4).filter((l) => typeof l[COL_DATA] === 'number' && (num(l[COL_VENDA]) || num(l[COL_LOC])));
  for (const l of dados.slice(-MESES)) {
    linhas.push({ cidade_norm: n.replace(/ /g, ''), uf, mes: serialParaData(l[COL_DATA]).slice(0, 8) + '01',
      venda_m2: num(l[COL_VENDA]) ? Math.round(l[COL_VENDA]) : null, locacao_m2: num(l[COL_LOC]) ? Math.round(l[COL_LOC] * 100) / 100 : null,
      cidade_rotulo: rotulo, atualizado_em: new Date().toISOString() });
  }
}
const cidades = [...new Set(linhas.map((l) => `${l.cidade_norm}/${l.uf}`))];
console.log(`[fipezap] ${cidades.length} cidades casadas, ${linhas.length} linhas (${MESES} meses)`);
if (foraDeCasamento.length) console.log(`[fipezap] SEM UF (fora): ${foraDeCasamento.join(' · ')}`);
// Validação contra o número conhecido (CLAUDE.md forma 8): o último mês de algumas capitais.
for (const c of ['saopaulo', 'riodejaneiro', 'salvador', 'belohorizonte', 'curitiba']) {
  const u = linhas.filter((l) => l.cidade_norm === c).sort((x, y) => x.mes.localeCompare(y.mes)).slice(-1)[0];
  if (u) console.log(`[fipezap] ${c}: ${u.mes} venda R$ ${u.venda_m2}/m² · locação R$ ${u.locacao_m2}/m²·mês`);
}
console.log(`[fipezap] cidades: ${cidades.join(' ')}`);
if (SECO) { console.log('[fipezap] modo seco: nada gravado'); process.exit(0); }
if (!linhas.length) { console.error('[fipezap] nenhuma linha — planilha mudou de formato? NÃO gravo vazio.'); process.exit(1); }
for (let i = 0; i < linhas.length; i += 500) {
  await rest('fipezap_cidade?on_conflict=cidade_norm,uf,mes', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(linhas.slice(i, i + 500)) });
}
const conf = await rest('fipezap_cidade?select=cidade_norm&limit=1&order=atualizado_em.desc');
console.log(`[fipezap] gravado: ${linhas.length} linhas (conferência: ${conf?.length ? 'ok' : 'VAZIO'})`);
if (!conf?.length) process.exit(1);
