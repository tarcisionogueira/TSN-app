// Teste COM REDE (05/10, pendência 49): baixa editais reais do Leilão Brasil em .doc e .docx e
// confere que `_doc-normalizar.js` devolve TEXTO com cara de edital, e que `extrairCondicoes`
// acha algo nele. Não roda no CI comum (precisa de rede para o static.suporteleiloes) — roda
// pelo workflow manual testar-leitura-word.yml. Uso: node scripts/testes/leitura-word-real.mjs
import { normalizarDocumento } from '../../api/_doc-normalizar.js';
import { extrairCondicoes } from '../../api/_edital-extrato.js';

const URLS = [
  'https://static.suporteleiloes.com.br/leilaobrasilcombr/leiloes/2112/documentos/sl-doc-2112-6aa29ad1e71a3-6aa29ad1e73e6.doc',
  'https://static.suporteleiloes.com.br/leilaobrasilcombr/leiloes/3258/documentos/sl-doc-3258-6a8717ac446b0-6a8717ac4544a.doc',
  'https://static.suporteleiloes.com.br/leilaobrasilcombr/leiloes/2226/documentos/sl-doc-2226-6a57921479ca2-6a5792147a4cc.docx',
  'https://static.suporteleiloes.com.br/leilaobrasilcombr/leiloes/2104/documentos/sl-doc-2104-6aa3f093d8fd9-6aa3f093d9dfa.docx',
];
let falhas = 0;
for (const url of URLS) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) { console.log(`✗ HTTP ${r.status} ${url}`); falhas++; continue; }
  const buf = Buffer.from(await r.arrayBuffer());
  const d = await normalizarDocumento(buf, { url, contentType: r.headers.get('content-type') || '' });
  const texto = d.texto || '';
  const pareceEdital = /leil[ãa]o|edital|lance|arremat/i.test(texto);
  const cond = texto ? extrairCondicoes(texto) : null;
  const ok = d.kind === 'texto' && texto.length > 500 && pareceEdital;
  if (!ok) falhas++;
  console.log(`${ok ? '✓' : '✗'} ${url.split('.').pop().padEnd(4)} kind=${d.kind} ${d.convertido || d.motivo || ''} chars=${texto.length} edital=${pareceEdital}`
    + ` condicoes=${cond ? Object.keys(cond).filter((k) => cond[k] != null && cond[k] !== false).join(',') : '-'}`);
  console.log(`    «${texto.replace(/\s+/g, ' ').slice(0, 220)}»`);
}
process.exit(falhas ? 1 : 0);
