/**
 * Extrator do CALENDÁRIO OFICIAL de leilões do MJ/SENAD (Power BI público "publish to web").
 * ────────────────────────────────────────────────────────────────────────────
 * Fonte ADICIONAL/cruzamento: puxa a tabela `Formulário` (só ESPÉCIE ATIVO = IMÓVEL) via o
 * endpoint querydata (sem login — só o ResourceKey público), decodifica o formato columnar
 * (DSR) do Power BI e guarda em `leiloes_mj_radar`. Depois cruza com o acervo (domínio do
 * link × url_lote) p/ marcar leiloeiros já conhecidos × novos. Roda no GitHub Actions.
 *
 * Não é segredo: ResourceKey/IDs vêm no próprio embed do relatório.
 * SEGURANÇA: DRY-RUN por padrão (MJ_DRYRUN != '0') — só extrai e mostra. MJ_DRYRUN=0 grava.
 * Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY, [MJ_DRYRUN].
 */
import { createClient } from '@supabase/supabase-js';

const HOST = 'https://wabi-brazil-south-api.analysis.windows.net';
const RESOURCE_KEY = '92f6340b-8781-4afb-bbcb-23825ac2f26a';
const DATASET_ID = '435f6ba1-f605-4070-aa5e-1c1066578cec';
const REPORT_ID = 'd867acda-35b8-4d48-887a-1387b6f668e6';
const MODEL_ID = 2746711;
const ENTITY = 'Formulário'; // "Formulário"
const DRYRUN = process.env.MJ_DRYRUN !== '0';
const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

// [Property no Power BI, chave de saída]
const COLS = [
  ['UF', 'uf'], ['CONTRATO', 'contrato'], ['LEILOEIRO', 'leiloeiro'], ['FISCAL', 'fiscal'],
  ['DATA LEILÃO', 'data_leilao'], ['DATA 2ª HASTA', 'data_hasta2'],
  ['LINK DO LEILÃO', 'link_leilao'], ['LINK DO EDITAL', 'link_edital'],
];

const H = {
  'Content-Type': 'application/json;charset=UTF-8',
  'Accept': 'application/json, text/plain, */*',
  'X-PowerBI-ResourceKey': RESOURCE_KEY,
  'Origin': 'https://app.powerbi.com',
  'Referer': 'https://app.powerbi.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

const selCol = (prop) => ({ Column: { Expression: { SourceRef: { Source: 'f' } }, Property: prop }, Name: `Formulário.${prop}`, NativeReferenceName: prop });

function buildBody() {
  return {
    version: '1.0.0',
    queries: [{
      Query: { Commands: [{ SemanticQueryDataShapeCommand: {
        Query: {
          Version: 2,
          From: [{ Name: 'f', Entity: ENTITY, Type: 0 }],
          Select: COLS.map(([p]) => selCol(p)),
          Where: [{ Condition: { In: {
            Expressions: [{ Column: { Expression: { SourceRef: { Source: 'f' } }, Property: 'ESPÉCIE ATIVO' } }],
            Values: [[{ Literal: { Value: "'IMÓVEL'" } }]],
          } } }],
        },
        Binding: {
          Primary: { Groupings: [{ Projections: COLS.map((_, i) => i) }] },
          DataReduction: { DataVolume: 3, Primary: { Window: { Count: 2000 } } },
          Version: 1,
        },
        ExecutionMetricsKind: 1,
      } }] },
      QueryId: '',
      ApplicationContext: { DatasetId: DATASET_ID, Sources: [{ ReportId: REPORT_ID }] },
    }],
    cancelQueries: [],
    modelId: MODEL_ID,
  };
}

// Decodifica o DSR (columnar do Power BI): dicionários de valores + bitmasks de repetição (R)
// e nulo (Ø). Cada linha traz em C só os valores não-repetidos e não-nulos, em ordem de coluna.
function decodeDSR(dsr) {
  const ds = (dsr.DS || [])[0] || {};
  const vd = ds.ValueDicts || {};
  const dm = ((ds.PH || [])[0] || {}).DM0 || [];
  let dn = COLS.map(() => null); // nome do dicionário por coluna (se codificada)
  const rows = [];
  let prev = [];
  for (const item of dm) {
    if (item.S) dn = item.S.map(s => s.DN || null);
    const temDados = item.C !== undefined || item.R !== undefined || item['Ø'] !== undefined;
    if (!temDados) continue;
    const C = item.C || [];
    const R = item.R || 0;
    const NUL = item['Ø'] || 0;
    const row = [];
    let ci = 0;
    for (let i = 0; i < COLS.length; i++) {
      const bit = 1 << i;
      if (NUL & bit) row[i] = null;
      else if (R & bit) row[i] = prev[i];
      else {
        let v = C[ci++];
        if (dn[i] && typeof v === 'number' && vd[dn[i]]) v = vd[dn[i]][v];
        row[i] = v;
      }
    }
    rows.push(row);
    prev = row;
  }
  return rows.map(r => Object.fromEntries(COLS.map(([, k], i) => [k, r[i]])));
}

// Datas do Power BI vêm em epoch ms; alguns campos vêm em texto ou vazios.
function toDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && v > 1e11) return new Date(v).toISOString().slice(0, 10);
  const s = String(v);
  const dmy = s.match(/(\d{2})\/(\d{2})\/(\d{4})/); if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  const iso = s.match(/\d{4}-\d{2}-\d{2}/); return iso ? iso[0] : null;
}
// Limpa link: tira o prefixo do visualizador de PDF (chrome-extension://…) que vazou no dado
// e prefixa https:// quando veio só o domínio.
function cleanLink(u) {
  if (!u) return null;
  u = String(u).replace(/^chrome-extension:\/\/[a-z]+\//i, '').trim();
  if (!u) return null;
  if (/^www\./i.test(u)) u = 'https://' + u;
  return u.slice(0, 700);
}

async function main() {
  const r = await fetch(`${HOST}/public/reports/querydata?synchronous=true`, {
    method: 'POST', headers: H, body: JSON.stringify(buildBody()), signal: AbortSignal.timeout(45000),
  });
  const j = await r.json().catch(() => null);
  const dsr = j?.results?.[0]?.result?.data?.dsr;
  if (!dsr) { console.error('Sem DSR na resposta:', JSON.stringify(j).slice(0, 800)); process.exit(1); }

  const linhas = decodeDSR(dsr).map(l => ({
    uf: l.uf || null, contrato: l.contrato || null, leiloeiro: l.leiloeiro || null, fiscal: l.fiscal || null,
    data_leilao: toDate(l.data_leilao), data_hasta2: toDate(l.data_hasta2),
    link_leilao: cleanLink(l.link_leilao), link_edital: cleanLink(l.link_edital),
  })).filter(l => l.leiloeiro || l.link_leilao);
  console.log(`📅 Extraídos ${linhas.length} leilões-imóvel do calendário do MJ.`);
  console.log('Amostra:', JSON.stringify(linhas.slice(0, 4), null, 1));

  if (DRYRUN) { console.log('\nDRY-RUN — não gravei. Rode com MJ_DRYRUN=0.'); return; }
  if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
  const sb = createClient(SB_URL, SB_KEY);

  const rows = linhas.map(l => ({ ...l, especie: 'IMÓVEL', atualizado_em: new Date().toISOString() }));
  // Snapshot: limpa o calendário anterior e insere o atual.
  const { error: eDel } = await sb.from('leiloes_mj_radar').delete().not('id', 'is', null);
  if (eDel) { console.error('erro ao limpar snapshot:', eDel.message); process.exit(1); }
  const { error } = await sb.from('leiloes_mj_radar').insert(rows);
  if (error) { console.error('erro insert:', error.message); process.exit(1); }
  console.log(`✅ ${rows.length} leilões gravados em leiloes_mj_radar (snapshot).`);

  // Cruzamento com o acervo (domínio do link × url_lote dos imóveis).
  const { data: cruz, error: eC } = await sb.rpc('cruzar_radar_mj');
  if (eC) console.log('  (cruzamento pulou:', eC.message + ')');
  else console.log(`🔗 Cruzamento: ${cruz ?? '?'} leiloeiro(s) já no acervo marcados.`);
}

main().catch(e => { console.error(e); process.exit(1); });
