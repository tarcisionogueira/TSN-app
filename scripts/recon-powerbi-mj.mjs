/**
 * RECON do Power BI público do MJ/SENAD ("Calendário de Leilões") — prova que dá p/ puxar
 * os dados direto do endpoint querydata (report "publish to web": só precisa do ResourceKey,
 * sem login) e DESCOBRE os nomes das colunas da entidade `Formulário` p/ montar a extração.
 * Log-only. Roda no GitHub Actions (egress liberado; o dev bloqueia HTTPS externo).
 *
 * O ResourceKey e os IDs são PÚBLICOS (vêm no embed do relatório) — não são segredo.
 */
const HOST = 'https://wabi-brazil-south-api.analysis.windows.net';
const RESOURCE_KEY = '92f6340b-8781-4afb-bbcb-23825ac2f26a';
const DATASET_ID = '435f6ba1-f605-4070-aa5e-1c1066578cec';
const REPORT_ID = 'd867acda-35b8-4d48-887a-1387b6f668e6';
const MODEL_ID = 2746711;
const ENTITY = 'Formulário'; // "Formulário"

const H = {
  'Content-Type': 'application/json;charset=UTF-8',
  'Accept': 'application/json, text/plain, */*',
  'X-PowerBI-ResourceKey': RESOURCE_KEY,
  'Origin': 'https://app.powerbi.com',
  'Referer': 'https://app.powerbi.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

async function post(path, body) {
  const r = await fetch(`${HOST}${path}`, { method: 'POST', headers: H, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
  const txt = await r.text().catch(() => '');
  return { status: r.status, txt };
}

// 1) Schema conceitual → lista entidades + propriedades (nomes reais das colunas).
async function schema() {
  console.log('\n════ conceptualschema (nomes das colunas)');
  const { status, txt } = await post('/public/reports/conceptualschema', {
    modelIds: [MODEL_ID], userPreferredLocale: 'pt-BR',
  });
  console.log(`  HTTP ${status} · ${txt.length} bytes`);
  // Extrai nomes de propriedades ao redor da entidade Formulário.
  const props = [...new Set((txt.match(/"[A-Za-zÀ-ÿ0-9 ºª._-]{2,40}"/g) || []).map(s => s.replace(/"/g, '')))];
  const rel = props.filter(p => /UF|Contrato|Hasta|Ativo|Leiloeiro|Fiscal|Suspens|Link|Data|Praça|Praca|Detalhe|Espécie|Especie|Munic|Lote|Valor/i.test(p));
  console.log('  candidatos de coluna:', JSON.stringify(rel.slice(0, 40)));
  console.log('  trecho:', txt.slice(0, 900).replace(/\s+/g, ' '));
}

// 2) querydata: confirma acesso aos dados (query mínima do capture: coluna UF).
async function amostraUF() {
  console.log('\n════ querydata — coluna UF (sanidade)');
  const body = {
    version: '1.0.0',
    queries: [{
      Query: { Commands: [{ SemanticQueryDataShapeCommand: {
        Query: {
          Version: 2,
          From: [{ Name: 'f', Entity: ENTITY, Type: 0 }],
          Select: [{ Column: { Expression: { SourceRef: { Source: 'f' } }, Property: 'UF' }, Name: 'Formulário.UF', NativeReferenceName: 'UF' }],
        },
        Binding: { Primary: { Groupings: [{ Projections: [0] }] }, DataReduction: { DataVolume: 3, Primary: { Window: {} } }, IncludeEmptyGroups: true, Version: 1 },
        ExecutionMetricsKind: 1,
      } }] },
      QueryId: '',
      ApplicationContext: { DatasetId: DATASET_ID, Sources: [{ ReportId: REPORT_ID }] },
    }],
    cancelQueries: [],
    modelId: MODEL_ID,
  };
  const { status, txt } = await post('/public/reports/querydata?synchronous=true', body);
  console.log(`  HTTP ${status} · ${txt.length} bytes`);
  console.log('  resposta:', txt.slice(0, 1500).replace(/\s+/g, ' '));
}

(async () => {
  console.log('🔎 RECON Power BI MJ/SENAD — Calendário de Leilões');
  try { await schema(); } catch (e) { console.log('  schema erro:', String(e.message).slice(0, 120)); }
  try { await amostraUF(); } catch (e) { console.log('  querydata erro:', String(e.message).slice(0, 120)); }
  console.log('\n✅ recon concluído.');
})();
