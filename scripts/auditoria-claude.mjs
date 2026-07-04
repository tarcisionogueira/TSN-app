// Auditoria técnica do sistema pelo Claude — funcionalidades, fluxos de API e
// segurança dos dados. Roda numa GitHub Action (semanal + manual). Lê o
// código-fonte da camada de API (+ utilitários críticos), audita em lotes para
// caber no contexto, consolida os achados e grava o relatório em
// `auditoria_sistema` (o dashboard mostra em modo leitura).
//
// NÃO altera código. Correções são propostas nos achados (campo `correcao`) e
// viram PR revisável quando você aprovar — nada entra em produção sozinho.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CLAUDE_KEY   = process.env.CLAUDE_KEY;
const MODEL        = process.env.AUDIT_MODEL || 'claude-sonnet-4-6';
const COMMIT_SHA   = process.env.GITHUB_SHA || null;

if (!CLAUDE_KEY) { console.error('CLAUDE_KEY ausente'); process.exit(1); }
if (!SUPABASE_URL || !SERVICE_KEY) { console.error('Supabase ausente'); process.exit(1); }

const MAX_FILE = 30000;       // trunca arquivos grandes (evita blobs de dados)
const MAX_LOTE = 90000;       // ~22k tokens por lote → cabe folgado no contexto
const PULAR = /(_municipios)\.js$/; // dados puros, irrelevantes p/ auditoria

// Coleta os arquivos de código relevantes (API + utilitários críticos do src).
function coletarArquivos() {
  const out = [];
  const addDir = (dir, filtro) => {
    let entradas = [];
    try { entradas = readdirSync(dir); } catch { return; }
    for (const nome of entradas) {
      const p = join(dir, nome);
      let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { addDir(p, filtro); continue; }
      if (!filtro(nome, p)) continue;
      if (PULAR.test(nome)) continue;
      let txt = '';
      try { txt = readFileSync(p, 'utf8'); } catch { continue; }
      if (txt.length > MAX_FILE) txt = txt.slice(0, MAX_FILE) + `\n/* … truncado (${txt.length} chars) … */`;
      out.push({ path: p, txt });
    }
  };
  addDir('api', (n) => n.endsWith('.js'));
  // Utilitários de segurança/dados do front que importam contexto de auth/sessão.
  for (const f of ['src/utils/supabase.js', 'src/utils/apiCall.js', 'src/contexts/AuthContext.jsx']) {
    try { const txt = readFileSync(f, 'utf8'); out.push({ path: f, txt: txt.slice(0, MAX_FILE) }); } catch { /* ok */ }
  }
  return out;
}

// Agrupa arquivos em lotes que cabem no contexto.
function emLotes(arquivos) {
  const lotes = []; let atual = [], tam = 0;
  for (const a of arquivos) {
    if (tam + a.txt.length > MAX_LOTE && atual.length) { lotes.push(atual); atual = []; tam = 0; }
    atual.push(a); tam += a.txt.length;
  }
  if (atual.length) lotes.push(atual);
  return lotes;
}

function parseJSON(t) {
  if (!t) return null;
  const s = t.trim();
  try { return JSON.parse(s); } catch { /* */ }
  const md = s.match(/```(?:json)?\s*([\s\S]*?)```/); if (md) { try { return JSON.parse(md[1].trim()); } catch { /* */ } }
  const o = s.match(/\{[\s\S]*\}/); if (o) { try { return JSON.parse(o[0]); } catch { /* */ } }
  return null;
}

async function claude(system, user, maxTokens = 8000) {
  for (let tent = 0; tent < 4; tent++) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
      });
      if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 2000 * 2 ** tent)); continue; }
      const data = await r.json();
      return (data?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    } catch (e) { if (tent === 3) throw e; await new Promise((s) => setTimeout(s, 2000 * 2 ** tent)); }
  }
  return '';
}

const SISTEMA = `Você é um auditor sênior de engenharia e segurança da BidPro Brasil (plataforma de leilões imobiliários: React + Vite no front, funções serverless Vercel em Node/Edge, Supabase Postgres com RLS, pagamentos Asaas/Mercado Pago, e-mail Resend, IA Claude+Gemini).
Audite o CÓDIGO fornecido com foco em: (1) segurança de dados (autenticação/autorização, RLS, vazamento de segredos, injeção, verificação de webhooks, CORS, exposição de PII), (2) fluxos de API (validação de entrada, tratamento de erro, idempotência, rate-limit, timeouts), (3) funcionalidades (bugs, condições de corrida, casos de borda).
Seja concreto e conservador: só reporte o que o código realmente mostra. Priorize por severidade e risco real. Para cada achado, proponha a correção de forma acionável.`;

function promptLote(arquivos) {
  const corpo = arquivos.map((a) => `\n===== ARQUIVO: ${a.path} =====\n${a.txt}`).join('\n');
  return `Audite os arquivos abaixo. Responda APENAS este JSON (sem markdown):
{"achados":[{"categoria":"seguranca|api|funcionalidade|dados","severidade":"critica|alta|media|baixa","area":"resumo curto","arquivo":"caminho","linha":0,"descricao":"o problema, objetivo","correcao":"como corrigir (código/passo)","tipo":"auto|manual|externo"}]}
- tipo=auto: corrigível no código deste repositório (vira PR).
- tipo=manual: exige decisão/config sua (ex.: girar um segredo, ajustar painel).
- tipo=externo: depende de serviço externo (ex.: configurar webhook no provedor).
Se não houver achados relevantes, retorne {"achados":[]}.
${corpo}`;
}

async function main() {
  const arquivos = coletarArquivos();
  const lotes = emLotes(arquivos);
  console.log(`Auditando ${arquivos.length} arquivos em ${lotes.length} lote(s)…`);

  let achados = [];
  for (let i = 0; i < lotes.length; i++) {
    console.log(`  Lote ${i + 1}/${lotes.length} (${lotes[i].length} arquivos)…`);
    const txt = await claude(SISTEMA, promptLote(lotes[i]));
    const j = parseJSON(txt);
    if (j?.achados?.length) achados.push(...j.achados);
  }

  // Ordena por severidade e limita para o relatório não explodir.
  const ordem = { critica: 0, alta: 1, media: 2, baixa: 3 };
  achados.sort((a, b) => (ordem[a.severidade] ?? 9) - (ordem[b.severidade] ?? 9));
  achados = achados.slice(0, 60);

  const nCrit = achados.filter((a) => a.severidade === 'critica').length;
  const nAlto = achados.filter((a) => a.severidade === 'alta').length;
  const saude = nCrit > 0 ? 'vermelho' : nAlto > 0 ? 'amarelo' : 'verde';

  // Síntese executiva (1 chamada) a partir dos achados consolidados.
  let resumo = '';
  try {
    const s = await claude(
      'Você é o auditor-chefe. Escreva um resumo executivo de 2-4 frases do estado do sistema a partir dos achados, destacando os riscos mais urgentes e o tom geral. Português, direto, sem markdown.',
      `Achados (JSON): ${JSON.stringify(achados)}\nSaúde calculada: ${saude} (${nCrit} críticos, ${nAlto} altos).`,
      1000,
    );
    resumo = (s || '').trim();
  } catch { resumo = `${achados.length} achados (${nCrit} críticos, ${nAlto} altos).`; }

  const row = {
    gerado_em: new Date().toISOString(), modelo: MODEL, escopo: 'api+seguranca',
    saude, resumo, achados, n_criticos: nCrit, n_altos: nAlto, n_total: achados.length,
    commit_sha: COMMIT_SHA,
  };
  const r = await fetch(`${SUPABASE_URL}/rest/v1/auditoria_sistema`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(row),
  });
  if (!r.ok) { console.error('Falha ao gravar auditoria:', r.status, await r.text().catch(() => '')); process.exit(1); }
  console.log(`Auditoria concluída: saúde=${saude}, ${achados.length} achados (${nCrit} críticos, ${nAlto} altos).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
